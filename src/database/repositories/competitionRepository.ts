import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { createRng } from '../../game/rng.ts';
import { DEFAULT_CALENDAR, scheduleLeague } from '../../game/competition-engine/schedule.ts';
import { computeStandings, type MatchResult } from '../../game/competition-engine/standings.ts';
import { addDays, daysBetween } from '../../shared/date.ts';
import { turnoverDate } from '../../game/career-engine/contracts.ts';
import { UserError } from '../../shared/errors.ts';
import { getCareerState, type CareerState } from './careerRepository.ts';
import { settleFinances } from './financeRepository.ts';
import { processMarketDay } from './transferRepository.ts';
import type { LeagueRules } from '../../shared/types.ts';
import type {
  AdvanceMode, AdvanceResultDto, CalendarDto, CompetitionInfoDto, CompetitionTableDto, FixtureDto, StandingRowDto, TableZone,
} from '../../shared/api.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);

export { getCareerState };
export type { CareerState };

/**
 * Garante que existam competições e calendário para a temporada. Idempotente e determinístico
 * (semente = semente do universo + temporada + liga). Também "repara" saves criados antes da Fase 3.
 */
export function ensureSeason(db: SqlDb, season: number): { created: number } {
  return withTransaction(db, () => createSeason(db, season));
}

/** Corpo de `ensureSeason` sem transação própria (usado pela virada de temporada, que já é atômica). */
export function createSeason(db: SqlDb, season: number): { created: number } {
  const seed = S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
  let created = 0;
  const insComp = db.prepare('INSERT INTO competitions (id, league_id, season, name) VALUES (?, ?, ?, ?)');
  const insFix = db.prepare('INSERT INTO fixtures (id, competition_id, round, match_date, home_club_id, away_club_id) VALUES (?, ?, ?, ?, ?, ?)');
  for (const lg of db.prepare('SELECT id, name, rules_json FROM leagues ORDER BY rowid').all()) {
    const leagueId = S(lg.id);
    if (db.prepare('SELECT 1 AS x FROM competitions WHERE league_id = ? AND season = ?').get(leagueId, season)) continue;
    const teams = db.prepare('SELECT id FROM clubs WHERE league_id = ? ORDER BY id').all(leagueId).map((r) => S(r.id));
    if (teams.length < 2) continue;
    const rules = JSON.parse(S(lg.rules_json)) as LeagueRules;
    const games = scheduleLeague(teams, rules.rounds, season, rules.calendar ?? DEFAULT_CALENDAR, createRng(`schedule:${seed}:${season}:${leagueId}`));
    const compId = `cmp_${leagueId}_${season}`;
    insComp.run(compId, leagueId, season, `${S(lg.name)} ${season}/${String(season + 1).slice(2)}`);
    const perRound = new Map<number, number>();
    for (const g of games) {
      const idx = (perRound.get(g.round) ?? 0) + 1;
      perRound.set(g.round, idx);
      insFix.run(`${compId}_r${String(g.round).padStart(2, '0')}_m${idx}`, compId, g.round, g.date, g.home, g.away);
    }
    created++;
  }
  return { created };
}

export const FIXTURE_SELECT = `
  SELECT f.id, f.competition_id, c.name AS competition_name, f.round, f.match_date, f.home_club_id, h.name AS home_name,
         f.away_club_id, a.name AS away_name, f.status, f.home_goals, f.away_goals
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
  };
}

export function getClubCalendar(db: SqlDb): CalendarDto {
  const st = getCareerState(db);
  const rows = db.prepare(`${FIXTURE_SELECT} WHERE c.season = ? AND (f.home_club_id = ? OR f.away_club_id = ?) ORDER BY f.match_date, f.round`)
    .all(st.season, st.clubId, st.clubId);
  return { season: st.season, gameDate: st.gameDate, clubId: st.clubId, fixtures: rows.map(toFixture) };
}

export function getNextFixture(db: SqlDb): FixtureDto | null {
  const st = getCareerState(db);
  const r = db.prepare(`${FIXTURE_SELECT} WHERE c.season = ? AND f.status = 'scheduled' AND (f.home_club_id = ? OR f.away_club_id = ?)
                         ORDER BY f.match_date, f.round LIMIT 1`).get(st.season, st.clubId, st.clubId);
  return r ? toFixture(r) : null;
}

export function listCompetitions(db: SqlDb): { userCompetitionId: string | null; competitions: CompetitionInfoDto[] } {
  const st = getCareerState(db);
  const competitions = db.prepare(
    `SELECT c.id, c.name, l.tier, l.team_count, co.name AS country
       FROM competitions c JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = l.country_id
      WHERE c.season = ? ORDER BY co.name, l.tier`).all(st.season)
    .map((r) => ({ id: S(r.id), name: S(r.name), country: S(r.country), tier: N(r.tier), teamCount: N(r.team_count) }));
  const mine = db.prepare(
    'SELECT c.id FROM competitions c JOIN clubs cl ON cl.league_id = c.league_id WHERE c.season = ? AND cl.id = ?').get(st.season, st.clubId);
  return { userCompetitionId: mine ? S(mine.id) : null, competitions };
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
    `SELECT c.id, c.name, c.league_id, l.tier, l.rules_json, co.name AS country
       FROM competitions c JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = l.country_id WHERE c.id = ?`).get(competitionId);
  if (!c) throw new Error('Competição não encontrada.');
  const rules = JSON.parse(S(c.rules_json)) as LeagueRules;
  // Participantes saem das partidas da competição (não da liga atual do clube, que muda com promoção e rebaixamento).
  const teams = db.prepare(`SELECT id, name FROM clubs WHERE id IN (SELECT home_club_id FROM fixtures WHERE competition_id = ?
    UNION SELECT away_club_id FROM fixtures WHERE competition_id = ?)`).all(competitionId, competitionId);
  const names = new Map(teams.map((t) => [S(t.id), S(t.name)]));
  const results: MatchResult[] = db.prepare(
    "SELECT home_club_id, away_club_id, home_goals, away_goals FROM fixtures WHERE competition_id = ? AND status = 'played'").all(competitionId)
    .map((r) => ({ home: S(r.home_club_id), away: S(r.away_club_id), homeGoals: N(r.home_goals), awayGoals: N(r.away_goals) }));
  const table = computeStandings([...names.keys()], results, rules);
  const roundsPlayed = N(db.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT round FROM fixtures WHERE competition_id = ? GROUP BY round HAVING SUM(status = 'scheduled') = 0)`).get(competitionId)!.n);
  const totalRounds = N(db.prepare('SELECT COALESCE(MAX(round), 0) AS n FROM fixtures WHERE competition_id = ?').get(competitionId)!.n);
  const rows: StandingRowDto[] = table.map((r) => ({
    position: r.position, clubId: r.teamId, clubName: names.get(r.teamId) ?? '?', played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
    goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDiff: r.goalDiff, points: r.points,
    zone: zoneFor(r.position, table.length, rules), isUserClub: r.teamId === st.clubId,
  }));
  return {
    competition: { id: S(c.id), name: S(c.name), country: S(c.country), tier: N(c.tier), teamCount: rows.length },
    rows, roundsPlayed, totalRounds, tiebreakers: rules.tiebreakers,
  };
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
  db.prepare('UPDATE competitions SET status = ? WHERE id = ?').run(left === 0 ? 'finished' : 'in_progress', S(f.competition_id));
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
  db.prepare('UPDATE players SET condition_pct = MIN(100, condition_pct + ?) WHERE condition_pct < 100').run(6 * days); // recuperação diária
  const turnover = turnoverDate(st.season);
  for (let i = 1; i <= days; i++) {
    const d = addDays(from, i);
    if (d >= turnover) break; // o dia da virada é processado por startNextSeason
    processMarketDay(db, d); // propostas expiram; a IA negocia dentro das janelas
    settleFinances(db, d);   // salários, patrocínios, TV etc. dos meses que começaram até este dia
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
  const turnover = turnoverDate(st.season);
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
    : target === turnover ? 'Chegou o dia 1º de julho: inicie a nova temporada.'
      : nextMatch === null ? 'Temporada encerrada: sem partidas até a virada (1º de julho).' : 'Nada a processar neste dia.';
  return { advanced: true, fromDate: today, toDate: target, daysAdvanced: days, reason: 'ok', pendingMatches: pendingOnTarget, message };
}
