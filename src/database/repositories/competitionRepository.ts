import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { createRng } from '../../game/rng.ts';
import { DEFAULT_CALENDAR, firstMatchday, scheduleLeague } from '../../game/competition-engine/schedule.ts';
import { leagueFormat } from '../../game/format-engine/formats.ts';
import { brazilCalendar, createEstaduais, createFormatCompetition } from './formatRepository.ts';
import { brazilLeagueDates } from '../../game/career-engine/brazilCalendar.ts';
import { computeStandings, type MatchResult } from '../../game/competition-engine/standings.ts';
import { addDays, daysBetween } from '../../shared/date.ts';
import { turnoverDate } from '../../game/career-engine/contracts.ts';
import { UserError } from '../../shared/errors.ts';
import { getCareerState, type CareerState } from './careerRepository.ts';
import { settleFinances } from './financeRepository.ts';
import { processMarketDay } from './transferRepository.ts';
import { processScoutingDay } from './scoutRepository.ts';
import { youthIntake } from './youthRepository.ts';
import { processTrainingDay, processTrainingMonth } from './trainingRepository.ts';
import { processStaffDay } from './staffRepository.ts';
import { processConstructionDay } from './infrastructureRepository.ts';
import { fastForwarding, processBoardDay } from './boardRepository.ts';
import { processPromisesDay } from './promiseRepository.ts';
import { processSocialDay } from './socialRepository.ts';
import { createCups, createSupercup } from './cupRepository.ts';
import { allCountrySeasons, CURRENT_COMP, ensureCountrySeasons, userSeason, type CountrySeason } from './countrySeasonRepository.ts';
import { autoTurnovers } from './seasonRepository.ts';
import { CALENDAR_YEAR_LEAGUE_START, seasonLabelFor } from '../../game/career-engine/calendar.ts';
import type { LeagueRules } from '../../shared/types.ts';
import type {
  AdvanceMode, AdvanceResultDto, CalendarDto, CompetitionInfoDto, CompetitionLeadersDto, CompetitionTableDto, FixtureDto, LeaderRowDto, StandingRowDto, TableZone,
} from '../../shared/api.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);

export { getCareerState };
export type { CareerState };

/**
 * Garante que cada país tenha competições e calendário da sua temporada corrente. Idempotente e determinístico
 * (semente = semente do universo + temporada + liga). Também "repara" saves criados antes da Fase 3. `_season` é ignorado
 * (cada país tem a sua temporada; mantido por compatibilidade).
 */
export function ensureSeason(db: SqlDb, _season?: number): { created: number } {
  return withTransaction(db, () => createSeason(db));
}

/** Corpo de `ensureSeason` sem transação própria (usado pela virada, que já é atômica). `countryIds`: só esses países. */
export function createSeason(db: SqlDb, _season?: number, countryIds?: readonly string[]): { created: number } {
  ensureCountrySeasons(db);
  let created = 0;
  for (const cs of allCountrySeasons(db)) if (!countryIds || countryIds.includes(cs.countryId)) created += createCountrySeason(db, cs);
  return { created };
}

/** Ligas e copas da temporada corrente de um país (nenhuma no período parado antes da 1ª temporada). NÃO abre transação. */
function createCountrySeason(db: SqlDb, cs: CountrySeason): number {
  const seed = S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
  let created = 0;
  const insComp = db.prepare("INSERT INTO competitions (id, kind, league_id, country_id, season, name) VALUES (?, 'league', ?, ?, ?, ?)");
  const insFix = db.prepare('INSERT INTO fixtures (id, competition_id, round, match_date, home_club_id, away_club_id) VALUES (?, ?, ?, ?, ?, ?)');
  // período antes da 1ª temporada do país (meses simulados antes da carreira): o país fica parado, sem jogos
  if (cs.transition) return 0;
  for (const lg of db.prepare('SELECT id, name, rules_json FROM leagues WHERE country_id = ? AND active = 1 ORDER BY rowid').all(cs.countryId)) {
    const leagueId = S(lg.id);
    const compId = `cmp_${leagueId}_${cs.season}`;
    if (db.prepare('SELECT 1 AS x FROM competitions WHERE id = ?').get(compId)) continue;
    const teams = db.prepare('SELECT id FROM clubs WHERE league_id = ? ORDER BY id').all(leagueId).map((r) => S(r.id));
    if (teams.length < 2) continue;
    const rules = JSON.parse(S(lg.rules_json)) as LeagueRules;
    const base = rules.calendar ?? DEFAULT_CALENDAR;
    // divisão disputada em fases (Séries C e D reais): a 1ª fase já com jogos; as seguintes quando os participantes ficam definidos
    const fdef = leagueFormat(leagueId, teams.length);
    if (fdef) {
      const cal = cs.start === '01-01' && !rules.calendar ? { ...DEFAULT_CALENDAR, seasonStart: CALENDAR_YEAR_LEAGUE_START } : base;
      const seeds = db.prepare(`SELECT id FROM clubs WHERE league_id = ? ORDER BY reputation DESC, id`).all(leagueId).map((r) => S(r.id));
      createFormatCompetition(db, { compId, leagueId, countryId: cs.countryId, season: cs.season, name: `${S(lg.name)} ${seasonLabelFor(cs.season, cs.start)}`,
        def: fdef, seeds, start: firstMatchday(cs.season, cal), weekday: cal.matchWeekday, intervalDays: cal.intervalDays });
      created++;
      continue;
    }
    // ano civil: liga depois da pré-temporada de janeiro
    const cal = cs.start === '01-01' && !rules.calendar ? { ...DEFAULT_CALENDAR, seasonStart: CALENDAR_YEAR_LEAGUE_START } : base;
    const games = scheduleLeague(teams, rules.rounds, cs.season, cal, createRng(`schedule:${seed}:${cs.season}:${leagueId}`));
    // Brasil no ano civil: Séries A e B nas datas do modelo 2026 (Série A a partir de 28/01 com pausa na Copa do Mundo; B de 21/03 a 28/11)
    const brDates = brazilCalendar(db, cs) ? brazilLeagueDates(leagueId, cs.season, Math.max(...games.map((g) => g.round))) : null;
    if (brDates) for (const g of games) g.date = brDates[g.round - 1]!;
    const name = `${S(lg.name)} ${seasonLabelFor(cs.season, cs.start)}`;
    insComp.run(compId, leagueId, cs.countryId, cs.season, name);
    const perRound = new Map<number, number>();
    for (const g of games) {
      const idx = (perRound.get(g.round) ?? 0) + 1;
      perRound.set(g.round, idx);
      insFix.run(`${compId}_r${String(g.round).padStart(2, '0')}_m${idx}`, compId, g.round, g.date, g.home, g.away);
    }
    created++;
  }
  // estaduais (Brasil): antes das copas, para a Copa do Brasil evitar as datas deles
  if (created > 0) createEstaduais(db, cs.countryId, cs.season);
  // copas e supercopa: depois da liga (as datas evitam os jogos da liga); só numa temporada nova (saves antigos: saveService, com data mínima)
  if (created > 0) { createCups(db, { countryId: cs.countryId }); createSupercup(db, cs.countryId); }
  return created;
}

export const FIXTURE_SELECT = `
  SELECT f.id, f.competition_id, c.name AS competition_name, f.round, f.match_date, f.home_club_id, h.name AS home_name,
         f.away_club_id, a.name AS away_name, f.status, f.home_goals, f.away_goals,
         EXISTS (SELECT 1 FROM matches m WHERE m.fixture_id = f.id) AS has_report,
         f.leg, f.neutral, json_extract(c.format_json, '$.format.name') AS cup_name,
         (SELECT json_extract(c.format_json, '$.format.stages[' || t.stage || '].name') FROM cup_ties t WHERE t.id = f.tie_id) AS cup_stage
    FROM fixtures f
    JOIN competitions c ON c.id = f.competition_id
    JOIN clubs h ON h.id = f.home_club_id
    JOIN clubs a ON a.id = f.away_club_id`;

export function toFixture(r: Record<string, unknown>): FixtureDto {
  return {
    id: S(r.id), competitionId: S(r.competition_id), competitionName: S(r.competition_name), round: N(r.round), date: S(r.match_date),
    homeId: S(r.home_club_id), homeName: S(r.home_name), awayId: S(r.away_club_id), awayName: S(r.away_name),
    status: S(r.status) as FixtureDto['status'],
    homeGoals: r.home_goals == null ? null : N(r.home_goals), awayGoals: r.away_goals == null ? null : N(r.away_goals),
    hasReport: N(r.has_report ?? 0) === 1,
    cup: r.cup_stage == null ? null : { name: S(r.cup_name), stage: S(r.cup_stage), leg: (r.leg == null ? null : N(r.leg)) as 1 | 2 | null, neutral: N(r.neutral ?? 0) === 1 },
  };
}

export function getClubCalendar(db: SqlDb): CalendarDto {
  const st = getCareerState(db);
  // temporada corrente do país do clube (o calendário do clube é o do seu país)
  const rows = db.prepare(`${FIXTURE_SELECT} WHERE ${CURRENT_COMP} AND (f.home_club_id = ? OR f.away_club_id = ?) ORDER BY f.match_date, f.round`)
    .all(st.clubId, st.clubId);
  const us = userSeason(db);
  return { season: us.season, seasonLabel: us.label, seasonStarts: us.starts, turnover: us.turnover, gameDate: st.gameDate, clubId: st.clubId, fixtures: rows.map(toFixture) };
}

export function getNextFixture(db: SqlDb): FixtureDto | null {
  const st = getCareerState(db);
  const r = db.prepare(`${FIXTURE_SELECT} WHERE ${CURRENT_COMP} AND f.status = 'scheduled' AND (f.home_club_id = ? OR f.away_club_id = ?)
                         ORDER BY f.match_date, f.round LIMIT 1`).get(st.clubId, st.clubId);
  return r ? toFixture(r) : null;
}

export function listCompetitions(db: SqlDb): { userCompetitionId: string | null; competitions: CompetitionInfoDto[] } {
  const st = getCareerState(db);
  const competitions = db.prepare(
    `SELECT c.id, c.name, c.league_id, l.tier, l.team_count, co.name AS country, c.format_json
       FROM competitions c JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = l.country_id
      WHERE ${CURRENT_COMP} ORDER BY co.name, l.tier`).all()
    .map((r) => ({ id: S(r.id), leagueId: S(r.league_id), name: S(r.name), country: S(r.country), tier: N(r.tier), teamCount: N(r.team_count), kind: 'league', ...(r.format_json != null ? { staged: true } : {}) }) as CompetitionInfoDto);
  // copas nacionais (depois das divisões do país; a do país do usuário primeiro entre as copas)
  const myCountry = st.clubId ? S(db.prepare('SELECT country_id FROM clubs WHERE id = ?').get(st.clubId)?.country_id ?? '') : '';
  const cups = db.prepare(`SELECT c.id, c.name, c.country_id, co.name AS country, (SELECT COUNT(*) FROM json_each(json_extract(c.format_json, '$.clubs'))) AS n,
      json_extract(c.format_json, '$.format.kind') AS fk
      FROM competitions c JOIN countries co ON co.id = c.country_id WHERE c.kind = 'cup' AND ${CURRENT_COMP} ORDER BY c.country_id = ? DESC, co.name, c.id`).all(myCountry)
    .map((r) => ({ id: S(r.id), leagueId: '', name: S(r.name), country: S(r.country), tier: 0, teamCount: N(r.n), kind: 'cup' as const, supercup: r.fk === 'supercup' }));
  competitions.push(...cups);
  // estaduais (o do clube do usuário primeiro), na ordem das divisões
  const states = db.prepare(`SELECT c.id, c.name, co.name AS country, (SELECT COUNT(*) FROM json_each(json_extract(c.format_json, '$.seeds'))) AS n,
      EXISTS (SELECT 1 FROM fixtures f WHERE f.competition_id = c.id AND (f.home_club_id = ? OR f.away_club_id = ?)) AS mine
      FROM competitions c JOIN countries co ON co.id = c.country_id WHERE c.kind = 'state' AND ${CURRENT_COMP} ORDER BY mine DESC, c.name`).all(st.clubId, st.clubId)
    .map((r) => ({ id: S(r.id), leagueId: '', name: S(r.name), country: S(r.country), tier: 0, teamCount: N(r.n), kind: 'state' as const, staged: true, mine: N(r.mine) === 1 }));
  competitions.push(...states.map(({ mine: _m, ...c }) => c));
  const mine = db.prepare(
    `SELECT c.id FROM competitions c JOIN clubs cl ON cl.league_id = c.league_id WHERE c.kind = 'league' AND ${CURRENT_COMP} AND cl.id = ?`).get(st.clubId);
  // clube sem divisão: abre no estadual dele
  return { userCompetitionId: mine ? S(mine.id) : states.find((x) => x.mine)?.id ?? null, competitions };
}

function zoneFor(position: number, total: number, rules: LeagueRules): TableZone {
  if (position <= rules.promotionSlots) return 'promotion';
  if (position <= rules.continentalSlots) return 'continental';
  if (rules.relegationSlots > 0 && position > total - rules.relegationSlots) return 'relegation';
  return null;
}

export function getCompetitionTable(db: SqlDb, competitionId: string): CompetitionTableDto {
  const st = getCareerState(db);
  const c = db.prepare(
    `SELECT c.id, c.name, c.league_id, l.tier, l.rules_json, l.country_id, co.name AS country
       FROM competitions c JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = l.country_id WHERE c.id = ?`).get(competitionId);
  if (!c) throw new Error('Competição não encontrada.');
  const rules = JSON.parse(S(c.rules_json)) as LeagueRules;
  // Participantes saem das partidas da competição (não da liga atual do clube, que muda com promoção e rebaixamento).
  const teams = db.prepare(`SELECT id, name FROM clubs WHERE id IN (SELECT home_club_id FROM fixtures WHERE competition_id = ?
    UNION SELECT away_club_id FROM fixtures WHERE competition_id = ?)`).all(competitionId, competitionId);
  const names = new Map(teams.map((t) => [S(t.id), S(t.name)]));
  const results: MatchResult[] = db.prepare(
    "SELECT home_club_id, away_club_id, home_goals, away_goals FROM fixtures WHERE competition_id = ? AND status = 'played' AND (stage IS NULL OR stage = 'f1')").all(competitionId)
    .map((r) => ({ home: S(r.home_club_id), away: S(r.away_club_id), homeGoals: N(r.home_goals), awayGoals: N(r.away_goals) }));
  const table = computeStandings([...names.keys()], results, rules);
  const roundsPlayed = N(db.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT round FROM fixtures WHERE competition_id = ? AND (stage IS NULL OR stage = 'f1') GROUP BY round HAVING SUM(status = 'scheduled') = 0)`).get(competitionId)!.n);
  const totalRounds = N(db.prepare("SELECT COALESCE(MAX(round), 0) AS n FROM fixtures WHERE competition_id = ? AND (stage IS NULL OR stage = 'f1')").get(competitionId)!.n);
  // forma: últimos 5 jogos de cada clube na competição (ordem do calendário)
  const form = new Map<string, Array<'V' | 'E' | 'D'>>();
  for (const m of db.prepare("SELECT home_club_id, away_club_id, home_goals, away_goals FROM fixtures WHERE competition_id = ? AND status = 'played' AND (stage IS NULL OR stage = 'f1') ORDER BY match_date, round, id").all(competitionId)) {
    const h = N(m.home_goals), a = N(m.away_goals);
    for (const [id, d] of [[S(m.home_club_id), h - a], [S(m.away_club_id), a - h]] as const) {
      const l = form.get(id) ?? []; l.push(d > 0 ? 'V' : d < 0 ? 'D' : 'E'); form.set(id, l.slice(-5));
    }
  }
  const rows: StandingRowDto[] = table.map((r) => ({
    position: r.position, clubId: r.teamId, clubName: names.get(r.teamId) ?? '?', played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
    goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDiff: r.goalDiff, points: r.points,
    zone: zoneFor(r.position, table.length, rules), isUserClub: r.teamId === st.clubId, form: form.get(r.teamId) ?? [],
  }));
  const nextRound = db.prepare("SELECT MIN(round) AS r FROM fixtures WHERE competition_id = ? AND status = 'scheduled'").get(competitionId);
  const currentRound = nextRound && nextRound.r != null ? N(nextRound.r) : Math.max(1, totalRounds);
  const neighbour = (tier: number) => { const l = db.prepare('SELECT name FROM leagues WHERE country_id = ? AND tier = ?').get(S(c.country_id), tier); return l ? S(l.name) : null; };
  return {
    competition: { id: S(c.id), leagueId: S(c.league_id), name: S(c.name), country: S(c.country), tier: N(c.tier), teamCount: rows.length, kind: 'league' },
    rows, roundsPlayed, totalRounds, tiebreakers: rules.tiebreakers, currentRound,
    zoneTargets: { promotion: rules.promotionSlots > 0 ? neighbour(N(c.tier) - 1) : null, relegation: rules.relegationSlots > 0 ? neighbour(N(c.tier) + 1) : null },
  };
}

const LEADER_COL = { goals: 'goals', assists: 'assists', cleanSheets: 'clean_sheets' } as const;

/** Líderes de gols, assistências e jogos sem sofrer gols de uma competição (dados públicos: não passam por estimativa). */
export function getCompetitionLeaders(db: SqlDb, competitionId: string, limit = 10): CompetitionLeadersDto {
  if (!db.prepare('SELECT 1 FROM competitions WHERE id = ?').get(competitionId)) throw new Error('Competição não encontrada.');
  const hasStats = !!db.prepare('SELECT 1 FROM player_season_stats WHERE competition_id = ? LIMIT 1').get(competitionId);
  const top = (k: keyof typeof LEADER_COL): LeaderRowDto[] => db.prepare(
    `SELECT s.player_id, p.first_name, p.last_name, s.club_id, cl.name AS club, s.appearances, s.${LEADER_COL[k]} AS v
       FROM player_season_stats s JOIN players p ON p.id = s.player_id JOIN clubs cl ON cl.id = s.club_id
      WHERE s.competition_id = ? AND s.${LEADER_COL[k]} > 0 ORDER BY v DESC, s.appearances ASC, p.last_name, p.id LIMIT ?`).all(competitionId, limit)
    .map((r) => ({ playerId: S(r.player_id), name: `${S(r.first_name)} ${S(r.last_name)}`.trim(), clubId: S(r.club_id), clubName: S(r.club), appearances: N(r.appearances), value: N(r.v) }));
  return { competitionId, hasStats, goals: top('goals'), assists: top('assists'), cleanSheets: top('cleanSheets') };
}

export class ResultError extends UserError {}

/** Grava o placar de uma partida ainda não disputada. NÃO abre transação: use dentro de uma já aberta. */
export function applyResult(db: SqlDb, fixtureId: string, homeGoals: number, awayGoals: number): void {
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0 || homeGoals > 99 || awayGoals > 99) {
    throw new ResultError('Placar inválido: use inteiros entre 0 e 99.');
  }
  const f = db.prepare('SELECT competition_id, status FROM fixtures WHERE id = ?').get(fixtureId);
  if (!f) throw new ResultError('Partida não encontrada.');
  if (S(f.status) !== 'scheduled') throw new ResultError('Esta partida já foi disputada.');
  db.prepare("UPDATE fixtures SET status = 'played', home_goals = ?, away_goals = ? WHERE id = ?").run(homeGoals, awayGoals, fixtureId);
  const left = N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ? AND status = 'scheduled'").get(S(f.competition_id))!.n);
  // copa e campeonato em fases: as fases seguintes só existem depois de definidas; quem os encerra é a final (advanceCups / advanceFormats)
  const comp = db.prepare('SELECT kind, format_json FROM competitions WHERE id = ?').get(S(f.competition_id))!;
  const staged = S(comp.kind) === 'cup' || comp.format_json != null;
  db.prepare('UPDATE competitions SET status = ? WHERE id = ?').run(left === 0 && !staged ? 'finished' : 'in_progress', S(f.competition_id));
}

/** Versão transacional de `applyResult` (usada em testes e ferramentas). */
export function recordResult(db: SqlDb, fixtureId: string, homeGoals: number, awayGoals: number): void {
  withTransaction(db, () => applyResult(db, fixtureId, homeGoals, awayGoals));
}

/** Partidas ainda não disputadas com data até hoje (inclui atrasadas). */
export function countPending(db: SqlDb): number {
  const st = getCareerState(db);
  return N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date <= ?").get(st.gameDate)!.n);
}

export function listRound(db: SqlDb, competitionId: string, round: number): FixtureDto[] {
  return db.prepare(`${FIXTURE_SELECT} WHERE f.competition_id = ? AND f.round = ? ORDER BY f.id`).all(competitionId, round).map(toFixture);
}

/**
 * Único ponto que move o relógio: de `from` (exclusivo) até `to`, dia a dia e sempre na mesma ordem (mercado do dia, depois a
 * cobrança mensal, se for dia 1), de modo que saltar vários dias equivale a avançar um a um. O dia da virada de temporada
 * (1º/jul) fica para `startNextSeason`, que processa esse dia depois de aplicar contratos, promoções e entrada de jovens.
 * NÃO abre transação: chame dentro de uma.
 */
export function moveClock(db: SqlDb, from: string, to: string, now: Date): number {
  const st = getCareerState(db);
  const days = daysBetween(from, to);
  db.prepare('UPDATE career SET game_date = ?, updated_at = ? WHERE id = 1').run(to, now.toISOString());
  const turnover = userSeason(db).turnover; // a virada do país do treinador é ação dele (startNextSeason)
  void st;
  const ff = fastForwarding(db); // meses antes do início da carreira: partidas rápidas, sem condição física a recuperar
  for (let i = 1; i <= days; i++) {
    const d = addDays(from, i);
    if (d >= turnover) break; // o dia da virada é processado por startNextSeason
    processStaffDay(db, d);    // contratos da comissão técnica
    if (!ff) processTrainingDay(db, d); // recuperação de condição, lesões de treino, rotina do preparador
    processConstructionDay(db, d); // obras concluídas
    processTrainingMonth(db, d);   // evolução mensal dos jogadores (dia 1º)
    autoTurnovers(db, d, now);     // viradas dos outros países que viram hoje (ano civil × julho)
    processMarketDay(db, d);   // propostas expiram; a IA negocia dentro das janelas
    processScoutingDay(db, d); // olheiros observam jogadores
    youthIntake(db, d);        // peneira anual (15/mar)
    settleFinances(db, d);     // salários, patrocínios, TV etc. dos meses que começaram até este dia
    processBoardDay(db, d);    // diretoria: confiança, aviso/demissão, vagas e propostas de emprego
    processPromisesDay(db, d); // promessas do treinador a jogadores e à diretoria: cobradas no prazo
    processSocialDay(db, d);   // rede social: prévias de hoje e notícias de ontem (transferências, demissões)
  }
  return days;
}

/**
 * Avança a data do jogo. Nunca passa por cima de partidas ainda não disputadas, e nunca passa do dia da virada de temporada
 * (1º/jul): ali o usuário precisa iniciar a nova temporada.
 */
export function advanceTime(db: SqlDb, mode: AdvanceMode, now: Date = new Date()): AdvanceResultDto {
  if (mode !== 'day' && mode !== 'nextMatchday') throw new ResultError('Modo de avanço inválido.');
  const st = getCareerState(db);
  const today = st.gameDate;
  const turnover = userSeason(db).turnover;
  const blockers = N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date <= ?").get(today)!.n);
  const fail = (reason: 'pending_matches' | 'season_complete', pending: number, message: string): AdvanceResultDto =>
    ({ advanced: false, fromDate: today, toDate: today, daysAdvanced: 0, reason, pendingMatches: pending, message });
  if (blockers > 0) return fail('pending_matches', blockers, `Há ${blockers} partida(s) a disputar hoje ou em datas anteriores. Elas precisam ser simuladas antes de avançar.`);
  if (today >= turnover) return fail('season_complete', 0, 'A temporada terminou. Inicie a nova temporada para continuar.');
  const next = db.prepare("SELECT MIN(match_date) AS d FROM fixtures WHERE status = 'scheduled'").get();
  const nextMatch = next && next.d != null ? S(next.d) : null;
  let target = mode === 'day' ? addDays(today, 1) : nextMatch ?? turnover;
  if (target > turnover) target = turnover;
  const days = withTransaction(db, () => moveClock(db, today, target, now));
  const pendingOnTarget = N(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date = ?").get(target)!.n);
  const message = pendingOnTarget > 0 ? `Dia de jogos: ${pendingOnTarget} partida(s) a disputar.`
    : target === turnover ? `Chegou o dia ${turnover.slice(5) === '01-01' ? '1º de janeiro' : '1º de julho'}: inicie a nova temporada.`
      : nextMatch === null ? `Temporada encerrada: sem partidas até a virada (${turnover.split('-').reverse().join('/')}).` : 'Nada a processar neste dia.';
  return { advanced: true, fromDate: today, toDate: target, daysAdvanced: days, reason: 'ok', pendingMatches: pendingOnTarget, message };
}
