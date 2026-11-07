import type { SqlDb } from '../types.ts';
import { posLabel } from '../../shared/positions.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng, type Rng } from '../../game/rng.ts';
import { ageOn } from '../../shared/date.ts';
import { prizeMoney, retirementChance, reviseEstimate } from '../../game/career-engine/development.ts';
import {
  AI_RENEW_CHANCE, aiRenewalWage, contractBaseYear, contractEndFor, expiresAt, maxContractYears, renewalDecision, renewalDemand, turnoverDate,
} from '../../game/career-engine/contracts.ts';
import { groupOf, SQUAD_MAX, type PositionGroup } from '../../game/transfer-engine/transfer.ts';
import type { LeagueRules, Player, Position } from '../../shared/types.ts';
import type {
  ContractRowDto, HistoryRowDto, NewSeasonReportDto, RenewInput, RenewResultDto, SeasonStatusDto, TrophyDto, TrophyRoomDto,
} from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { createSeason, getCompetitionTable, listCompetitions } from './competitionRepository.ts';
import { makePoster, settleFinances, type Poster } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';
import { aiSignFreeAgents, neededGroup, processMarketDay, releasePlayer } from './transferRepository.ts';
import { rowToPlayer } from './worldRepository.ts';
import { GROUP_POSITIONS, playerFactory, promoteBestOfGroup, youthTurnover } from './youthRepository.ts';
import { processScoutingDay } from './scoutRepository.ts';
import { processTrainingDay, processTrainingMonth, developLightPlayers } from './trainingRepository.ts';
import { processStaffDay } from './staffRepository.ts';
import { processConstructionDay } from './infrastructureRepository.ts';
import { boardVeto, coachOf, reviewSeason, startBoardSeason } from './boardRepository.ts';
import { negotiationMultiplier } from '../../game/coach-engine/coach.ts';
import { fmtMoney } from '../../shared/money.ts';
import { boardBrief, squadSize } from './newsRepository.ts';
import { reviewAiCoaches } from './aiCoachRepository.ts';
import { formatMetaOf, formatOutcomesOf, rebuildSerieD } from './formatRepository.ts';
import { advanceCountrySeason, countrySeason, CURRENT_COMP, followCountry, userCountry, userSeason } from './countrySeasonRepository.ts';
import { contractEndIn, renewedEnd, seasonLabelFor, type SeasonStart } from '../../game/career-engine/calendar.ts';
import { addDays } from '../../shared/date.ts';

export class SeasonError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const fmt = fmtMoney; // dinheiro nas mensagens (moeda única: euro)
const br = (d: string) => d.split('-').reverse().join('/');
const nameOf = (p: Pick<Player, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;
const seasonLabel = (s: number) => `${s}/${String(s + 1).slice(2)}`;
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const monthsLeft = (date: string, end: string) => Math.max(0, (Number(end.slice(0, 4)) - Number(date.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(date.slice(5, 7)));
const squadOf = (db: SqlDb, clubId: string): Player[] => db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY id').all(clubId).map(rowToPlayer);

/** Meses restantes de contrato a partir dos quais a renovação é permitida. */
export const RENEW_WINDOW_MONTHS = 24;
/** A IA mantém no máximo este número de jogadores depois da virada (abre espaço para o mercado). */
const AI_SQUAD_CAP = 28;

// ---------------------------------------------------------------- consultas
/** Partidas ainda a disputar na temporada corrente dos países que viram junto com o do treinador. */
function matchesLeftForUser(db: SqlDb): number {
  const turnover = userSeason(db).turnover;
  return N(db.prepare(`SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id
    WHERE ${CURRENT_COMP} AND f.status = 'scheduled' AND c.country_id IN (SELECT country_id FROM country_seasons WHERE turnover = ?)`).get(turnover)!.n);
}
export function isSeasonComplete(db: SqlDb): boolean { return matchesLeftForUser(db) === 0; }

function contractRow(p: Player, date: string, turnover: string, start: SeasonStart): ContractRowDto {
  const age = ageOn(p.birthDate, date);
  const left = monthsLeft(date, p.contractEnd);
  return {
    id: p.id, name: nameOf(p), position: p.position, age, overall: p.overall, salary: p.salary, contractEnd: p.contractEnd,
    monthsLeft: left, expiresThisSeason: expiresAt(p.contractEnd, turnover), canRenew: left <= RENEW_WINDOW_MONTHS, maxYears: maxContractYears(age), renewBaseYear: contractBaseYear(p.contractEnd),
    renewEnds: [1, 2, 3, 4, 5].map((y) => renewedEnd(p.contractEnd, y, start)),
  };
}

export function getContracts(db: SqlDb): ContractRowDto[] {
  const st = getCareerState(db);
  const us = userSeason(db);
  return squadOf(db, st.clubId).map((p) => contractRow(p, st.gameDate, us.turnover, us.start))
    .sort((a, b) => a.contractEnd.localeCompare(b.contractEnd) || b.overall - a.overall);
}

export function getSeasonStatus(db: SqlDb): SeasonStatusDto {
  const st = getCareerState(db);
  const us = userSeason(db);
  const turnover = us.turnover;
  const matchesLeft = matchesLeftForUser(db);
  const comps = listCompetitions(db);
  const leagues = comps.competitions.filter((c) => c.kind === 'league').map((c) => {
    const t = getCompetitionTable(db, c.id);
    return { competitionId: c.id, name: c.name, country: c.country, tier: c.tier, leader: t.roundsPlayed > 0 ? t.rows[0]?.clubName ?? null : null, roundsPlayed: t.roundsPlayed, totalRounds: t.totalRounds };
  });
  let user: SeasonStatusDto['user'] = null;
  if (comps.userCompetitionId) {
    const t = getCompetitionTable(db, comps.userCompetitionId);
    const row = t.rows.find((r) => r.isUserClub);
    const econ = N(db.prepare('SELECT co.economy FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(st.clubId)!.economy);
    if (row) {
      user = {
        competitionId: t.competition.id, competitionName: t.competition.name, position: row.position, teamCount: t.rows.length, points: row.points, played: row.played,
        zone: row.zone, prizeIfEndedNow: prizeMoney(econ, t.competition.tier, row.position, t.rows.length),
      };
    }
  }
  const complete = matchesLeft === 0;
  return {
    season: us.season, label: us.label, nextLabel: seasonLabelFor(us.transition ? Number(us.turnover.slice(0, 4)) : us.season + 1, us.start), gameDate: st.gameDate, turnoverDate: turnover, matchesLeft, complete,
    canStart: complete && st.gameDate >= turnover, user, leagues, expiring: getContracts(db).filter((c) => c.expiresThisSeason),
  };
}

// ---------------------------------------------------------------- renovação (só o usuário; a IA renova na virada)
export function renewContract(db: SqlDb, input: RenewInput): RenewResultDto {
  const st = getCareerState(db);
  if (![input.wage, input.years].every(Number.isInteger) || input.wage <= 0 || input.years < 1 || input.years > 5) throw new SeasonError('Proposta inválida: salário inteiro positivo e de 1 a 5 temporadas.');
  const row = db.prepare('SELECT * FROM players WHERE id = ? AND club_id = ?').get(input.playerId, st.clubId);
  if (!row) throw new SeasonError('Só é possível renovar contratos de jogadores do seu clube.');
  const p = rowToPlayer(row);
  if (monthsLeft(st.gameDate, p.contractEnd) > RENEW_WINDOW_MONTHS) throw new SeasonError(`O contrato de ${nameOf(p)} ainda é longo: a renovação só é possível com até ${RENEW_WINDOW_MONTHS} meses restantes.`);
  const age = ageOn(p.birthDate, st.gameDate);
  const demand = Math.round(renewalDemand({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition, loyalty: p.personality.loyalty }) * negotiationMultiplier(coachOf(db).attributes));
  const d = renewalDecision(input.wage, input.years, demand, age);
  if (d.kind === 'too_long') return { outcome: 'rejected', message: `Aos ${age} anos, ${nameOf(p)} aceita assinar por no máximo ${d.maxYears} temporada(s).` };
  if (d.kind === 'reject') return { outcome: 'rejected', message: `${nameOf(p)} recusou: o salário oferecido está muito abaixo do que ele espera.` };
  if (d.kind === 'counter') return { outcome: 'counter', counterWage: d.wage, message: `${nameOf(p)} renova se o salário for de ${fmt(d.wage)} por mês.` };
  const veto = boardVeto(db, { fee: 0, wage: input.wage, marketValue: p.marketValue, replacesSalary: p.salary });
  if (veto) return { outcome: 'rejected', message: veto };
  const end = renewedEnd(p.contractEnd, input.years, userSeason(db).start);
  withTransaction(db, () => {
    db.prepare('UPDATE players SET salary = ?, contract_end = ? WHERE id = ?').run(input.wage, end, p.id);
    addNews(db, st.gameDate, 'contract', `Renovação: ${nameOf(p)} assina até ${br(end)}`, `${nameOf(p)} (${age} anos) renovou o contrato por ${input.years} temporada(s), até ${br(end)}.\n\nSalário: de ${fmt(p.salary)} para ${fmt(input.wage)} por mês (${input.wage >= p.salary ? '+' : '−'}${fmt(Math.abs(input.wage - p.salary))}). A nova folha já vale a partir deste mês.`);
  });
  return { outcome: 'accepted', contractEnd: end, message: `${nameOf(p)} renovou até ${br(end)} com salário de ${fmt(input.wage)} por mês.` };
}

// ---------------------------------------------------------------- virada de temporada
interface CompRow { id: string; name: string; leagueId: string; tier: number; countryId: string; country: string; economy: number; rules: LeagueRules }

/** Elenco do usuário sem o mínimo para jogar (tamanho, 2 goleiros e profundidade por setor)? Devolve o setor que falta. */
function userShortage(squad: Player[]): PositionGroup | null {
  const count = (g: PositionGroup) => squad.filter((p) => groupOf(p.position) === g).length;
  if (count('GK') < 2) return 'GK';
  if (count('DEF') < 6) return 'DEF';
  if (count('MID') < 4) return 'MID';
  if (count('ATT') < 3) return 'ATT';
  if (squad.length < 18) return (['DEF', 'MID', 'ATT'] as PositionGroup[]).sort((a, b) => count(a) - count(b))[0]!;
  return null;
}

/**
 * Virada de temporada do país do treinador (ação do usuário na data da virada: 1º/jul ou 1º/jan), atômica. Os países que viram no
 * mesmo dia viram juntos. O dia começa pelo treino (a evolução do mês que termina pertence à temporada que termina), depois o balanço
 * (`runTurnover`), e por fim o mercado e o fechamento mensal do dia. `opts.quiet`: virada automática do início da carreira (sem
 * avaliação da diretoria — o treinador ainda não comandava o clube).
 */
export function startNextSeason(db: SqlDb, now: Date = new Date(), opts: { quiet?: boolean } = {}): NewSeasonReportDto {
  const st = getCareerState(db);
  if (!isSeasonComplete(db)) throw new SeasonError('A temporada ainda não terminou: há partidas a disputar.');
  const date = userSeason(db).turnover;
  if (st.gameDate < date) throw new SeasonError(`A nova temporada começa em ${br(date)}. Avance o calendário até lá.`);
  return withTransaction(db, () => {
    processStaffDay(db, date);
    processTrainingDay(db, date);
    processConstructionDay(db, date);
    processTrainingMonth(db, date);
    const report = runTurnover(db, date, countriesTurningOn(db, date), { user: true, quiet: !!opts.quiet, now });
    processMarketDay(db, date);
    processScoutingDay(db, date);
    settleFinances(db, date);
    return report;
  });
}

/** Países cuja temporada vira na data. */
export const countriesTurningOn = (db: SqlDb, date: string): string[] =>
  db.prepare('SELECT country_id FROM country_seasons WHERE turnover = ? ORDER BY country_id').all(date).map((r) => S(r.country_id));

/**
 * Viradas automáticas do dia (países que não são o do treinador), chamadas por `moveClock` depois do treino do dia e antes do mercado.
 * Exigem a temporada desses países encerrada; senão a virada espera (fica para o dia seguinte). NÃO abre transação.
 */
export function autoTurnovers(db: SqlDb, date: string, now: Date): number {
  const mine = userCountry(db);
  const due = countriesTurningOn(db, date).filter((c) => c !== mine);
  const ready = due.filter((c) => N(db.prepare(`SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE ${CURRENT_COMP} AND c.country_id = ? AND f.status = 'scheduled'`).get(c)!.n) === 0);
  for (const c of due.filter((x) => !ready.includes(x))) db.prepare('UPDATE country_seasons SET turnover = ? WHERE country_id = ?').run(addDays(date, 1), c);
  if (ready.length) runTurnover(db, date, ready, { user: false, quiet: true, now });
  return ready.length;
}

/**
 * Balanço e virada de um grupo de países (mesma data): resultados → prêmios → promoção/rebaixamento → aposentadorias → contratos →
 * revisão do potencial → jovens → reposição dos elencos da IA → zera suspensões → diretoria e técnicos → temporada seguinte do país →
 * calendário novo (ligas, copas, supercopa). Só mexe em clubes e jogadores desses países (livres: os da nacionalidade). NÃO abre transação.
 */
function runTurnover(db: SqlDb, date: string, countryIds: readonly string[], opts: { user: boolean; quiet: boolean; now: Date }): NewSeasonReportDto {
  const st = getCareerState(db);
  const rng = createRng(`season:${seedOf(db)}:${date}:${countryIds.join(',')}`);
  const post: Poster = makePoster(db, st.clubId);
  const inBatch = new Set(countryIds);
  const ph = countryIds.map(() => '?').join(',');
  const clubIds = new Set(db.prepare(`SELECT id FROM clubs WHERE country_id IN (${ph})`).all(...countryIds).map((r) => S(r.id)));
  // livres: pela nacionalidade (sem país no universo: com os de julho)
  const codes = new Set(db.prepare(`SELECT code FROM countries WHERE id IN (${ph})`).all(...countryIds).map((r) => S(r.code)));
  const known = new Set(db.prepare('SELECT code FROM countries').all().map((r) => S(r.code)));
  const julyBatch = date.slice(5) === '07-01';
  const freeInBatch = (nat: string) => codes.has(nat) || (julyBatch && !known.has(nat));
  const userInBatch = !!st.clubId && clubIds.has(st.clubId);
  const cur = new Map(countryIds.map((c) => [c, countrySeason(db, c)] as const));
  const userCs = opts.user ? userSeason(db) : null;
  developLightPlayers(db, date, clubIds); // países simplificados: a evolução da temporada inteira de uma vez
  const clubName = (id: string) => S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)!.name);
  const nextLabel = userCs ? seasonLabelFor(userCs.transition ? Number(userCs.turnover.slice(0, 4)) : userCs.season + 1, userCs.start) : '';
  const report: NewSeasonReportDto = {
    season: userCs ? (userCs.transition ? Number(userCs.turnover.slice(0, 4)) : userCs.season + 1) : 0, label: nextLabel, previous: null, newLeague: '', champions: [], movements: [],
    retiredUser: [], retiredTotal: 0, releasedUser: [], youthReleased: [], autoPromoted: [], aiRenewed: 0, aiReleased: 0, board: null,
  };

    // 1. resultados finais (derivados das partidas) e trocas de divisão por país
    const comps: CompRow[] = db.prepare(
      `SELECT c.id, c.name, c.league_id, l.tier, l.country_id, l.rules_json, co.name AS country, co.economy FROM competitions c
         JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = l.country_id WHERE c.kind = 'league' AND ${CURRENT_COMP} AND c.country_id IN (${ph}) ORDER BY co.rowid, l.tier`).all(...countryIds)
      .map((r) => ({ id: S(r.id), name: S(r.name), leagueId: S(r.league_id), tier: N(r.tier), countryId: S(r.country_id), country: S(r.country), economy: N(r.economy), rules: JSON.parse(S(r.rules_json)) as LeagueRules }));
    // classificação final: tabela (pontos corridos) ou, num campeonato em fases (Séries C/D), quem foi mais longe (game/format-engine)
    const fmtOut = new Map(comps.map((c) => [c.id, formatOutcomesOf(db, c.id)]));
    const tables = new Map(comps.map((c) => {
      const f = fmtOut.get(c.id);
      if (!f) return [c.id, getCompetitionTable(db, c.id).rows.map((r) => ({ clubId: r.clubId, clubName: r.clubName, position: r.position }))];
      return [c.id, f.ranking.map((id, i) => ({ clubId: id, clubName: clubName(id), position: i + 1 }))];
    }));
    const outcome = new Map<string, 'champion' | 'promoted' | 'relegated'>();
    const direction = new Map<string, 'promoted' | 'relegated'>(); // o campeão da 2ª divisão também sobe
    const moves: Array<{ clubId: string; toLeague: string }> = [];
    for (const upper of comps) {
      if (cur.get(upper.countryId)!.transition) continue; // torneio de transição: sem acesso nem rebaixamento (divisões da base intactas)
      const lower = comps.find((c) => c.countryId === upper.countryId && c.tier === upper.tier + 1);
      if (!lower) continue;
      const up = tables.get(upper.id)!, down = tables.get(lower.id)!;
      const fu = fmtOut.get(upper.id), fl = fmtOut.get(lower.id);
      let relegated: string[], promoted: string[];
      if (fu || fl) { // campeonato em fases: o formato diz quem cai e quem sobe (as divisões podem mudar de tamanho: Série C 20 → 24 → 28)
        relegated = fu ? fu.relegated : up.slice(-Math.min(upper.rules.relegationSlots, up.length)).map((r) => r.clubId);
        promoted = fl ? fl.promoted : down.slice(0, Math.min(lower.rules.promotionSlots, down.length)).map((r) => r.clubId);
      } else {
        const k = Math.min(upper.rules.relegationSlots, lower.rules.promotionSlots, up.length, down.length);
        if (k <= 0) continue;
        relegated = up.slice(-k).map((r) => r.clubId); promoted = down.slice(0, k).map((r) => r.clubId);
      }
      if (!relegated.length && !promoted.length) continue;
      for (const id of relegated) { outcome.set(id, 'relegated'); direction.set(id, 'relegated'); moves.push({ clubId: id, toLeague: lower.leagueId }); }
      for (const id of promoted) { outcome.set(id, 'promoted'); direction.set(id, 'promoted'); moves.push({ clubId: id, toLeague: upper.leagueId }); }
      report.movements.push({ country: upper.country, promoted: promoted.map(clubName), relegated: relegated.map(clubName) });
    }

    // 2. prêmios, registro oficial e troféus
    const insResult = db.prepare('INSERT INTO season_results (season, club_id, competition_id, position, outcome, prize) VALUES (?,?,?,?,?,?)');
    for (const c of comps) {
      const rows = tables.get(c.id)!;
      for (const r of rows) {
        const prize = prizeMoney(c.economy, c.tier, r.position, rows.length);
        if (r.position === 1) outcome.set(r.clubId, 'champion'); // título prevalece sobre o acesso no registro
        post(r.clubId, date, 'prize', prize, `Premiação: ${r.position}º lugar — ${c.name}`);
        const season = cur.get(c.countryId)!.season;
        insResult.run(season, r.clubId, c.id, r.position, outcome.get(r.clubId) ?? null, prize);
        if (r.clubId === st.clubId) report.previous = { season, competitionName: c.name, position: r.position, teamCount: rows.length, outcome: outcome.get(r.clubId) ?? null, prize };
      }
      const champ = rows[0];
      if (champ) {
        db.prepare('INSERT INTO trophies (season, club_id, competition_id, won_by_user) VALUES (?,?,?,?)').run(cur.get(c.countryId)!.season, champ.clubId, c.id, champ.clubId === st.clubId ? 1 : 0);
        report.champions.push({ competitionName: c.name, country: c.country, clubName: champ.clubName });
        if (champ.clubId === st.clubId) addNews(db, date, 'trophy', `CAMPEÃO! ${champ.clubName} conquista a ${c.name}`, `Parabéns, professor! O ${champ.clubName} é campeão da ${c.name}. Uma conquista histórica para o clube e para a sua carreira.\n\nO troféu já está na Sala de troféus. Títulos aumentam a reputação do clube e a sua, e contam na avaliação da diretoria.`);
      }
    }
    for (const m of moves) {
      db.prepare('UPDATE clubs SET league_id = ?, reputation = MAX(1, MIN(99, reputation + ?)) WHERE id = ?').run(m.toLeague, direction.get(m.clubId) === 'relegated' ? -3 : 3, m.clubId);
    }
    // Série D: não é divisão fixa; é remontada para a temporada seguinte (rebaixados da C, vagas dos estados, melhores da D, ranking)
    for (const c of comps) {
      const f = fmtOut.get(c.id);
      if (f && formatMetaOf(db, c.id)?.formatId === 'bra-serie-d') {
        rebuildSerieD(db, c.countryId, c.leagueId, f.ranking, new Set(f.promoted), moves.filter((m) => m.toLeague === c.leagueId).map((m) => m.clubId));
      }
    }
    for (const c of comps) { const champ = tables.get(c.id)![0]; if (champ) db.prepare('UPDATE clubs SET reputation = MIN(99, reputation + 2) WHERE id = ?').run(champ.clubId); }
    const prev = report.previous;
    if (prev && !opts.quiet) {
      const o = direction.get(st.clubId);
      const label = userCs ? userCs.label : seasonLabel(prev.season);
      addNews(db, date, 'season', `Fim da temporada ${label}: ${prev.position}º lugar na ${prev.competitionName}`,
        `A temporada ${label} terminou: ${prev.position}º lugar na ${prev.competitionName}.${o === 'promoted' ? ' O clube conquistou o ACESSO à divisão superior!' : o === 'relegated' ? ' O clube foi REBAIXADO.' : ''}\n\nA premiação pela campanha foi de ${fmt(prev.prize)}, já creditada no caixa. A avaliação da diretoria chega em seguida.`);
    }

    // 3. aposentadorias (inclui jogadores livres)
    const inScope = (r: Record<string, unknown>) => {
      const club = r.club_id ?? r.youth_club_id;
      return club != null ? clubIds.has(S(club)) : freeInBatch(S(r.nationality));
    };
    for (const r of db.prepare('SELECT * FROM players WHERE retired = 0 ORDER BY id').all()) {
      if (!inScope(r)) continue;
      const p = rowToPlayer(r);
      if (!rng.chance(retirementChance(ageOn(p.birthDate, date), p.overall, p.clubId === null && r.youth_club_id == null))) continue;
      releasePlayer(db, p.id, date, true);
      report.retiredTotal++;
      if (p.clubId === st.clubId) report.retiredUser.push(nameOf(p));
    }
    if (report.retiredUser.length) addNews(db, date, 'retirement', `Aposentadoria: ${report.retiredUser.join(', ')}`, `${report.retiredUser.join(', ')} ${report.retiredUser.length > 1 ? 'encerraram' : 'encerrou'} a carreira e ${report.retiredUser.length > 1 ? 'deixaram' : 'deixou'} o elenco.\n\nO elenco principal agora tem ${squadSize(db, st.clubId)} jogadores. Confira se algum setor ficou desfalcado e reforce no mercado ou na base.`);

    // 4. contratos que vencem: a IA renova a maioria; o usuário perde quem não renovou
    const expiring = db.prepare('SELECT * FROM players WHERE club_id IS NOT NULL AND contract_end <= ? ORDER BY id').all(date).map(rowToPlayer).filter((p) => clubIds.has(p.clubId!));
    const startOf = new Map(db.prepare(`SELECT id, season_start FROM countries WHERE id IN (${ph})`).all(...countryIds).map((r) => [S(r.id), S(r.season_start) as SeasonStart]));
    const clubStart = (clubId: string) => startOf.get(S(db.prepare('SELECT country_id FROM clubs WHERE id = ?').get(clubId)!.country_id)) ?? '07-01';
    const coreOf = new Map<string, Set<string>>();
    for (const p of expiring) {
      if (p.clubId === st.clubId) { releasePlayer(db, p.id, date, false); report.releasedUser.push(nameOf(p)); continue; }
      if (!coreOf.has(p.clubId!)) coreOf.set(p.clubId!, new Set(squadOf(db, p.clubId!).sort((a, b) => b.overall - a.overall).slice(0, 14).map((x) => x.id)));
      const age = ageOn(p.birthDate, date);
      if (rng.chance(coreOf.get(p.clubId!)!.has(p.id) ? AI_RENEW_CHANCE.core : AI_RENEW_CHANCE.other)) {
        const years = Math.min(maxContractYears(age), rng.int(1, 3));
        const wage = aiRenewalWage({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition, loyalty: p.personality.loyalty });
        db.prepare('UPDATE players SET salary = ?, contract_end = ? WHERE id = ?').run(wage, contractEndIn(date, years, clubStart(p.clubId!)), p.id);
        report.aiRenewed++;
      } else { releasePlayer(db, p.id, date, false); report.aiReleased++; }
    }
    if (report.releasedUser.length) addNews(db, date, 'contract', `Fim de contrato: ${report.releasedUser.join(', ')}`, `${report.releasedUser.join(', ')} ${report.releasedUser.length > 1 ? 'saíram' : 'saiu'} de graça porque o contrato terminou sem renovação.\n\nO elenco principal agora tem ${squadSize(db, st.clubId)} jogadores. Para não perder jogadores assim, renove na aba Contratos quando faltarem até 12 meses.`, { action: 'squad', actionLabel: 'Ver o elenco' });

    // 5. balanço da temporada (a evolução agora é mensal, pelo treino) e revisão anual do potencial estimado visível
    const minutes = new Map(db.prepare(`SELECT pss.player_id, SUM(pss.minutes) AS m FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id WHERE ${CURRENT_COMP} AND c.country_id IN (${ph}) GROUP BY pss.player_id`)
      .all(...countryIds).map((r) => [S(r.player_id), N(r.m)]));
    // um jogador que trocou de país pode cair duas vezes na mesma numeração de temporada: vale o primeiro registro
    const insDev = db.prepare('INSERT OR IGNORE INTO player_development (player_id, season, club_id, age, overall_before, overall_after, minutes) VALUES (?,?,?,?,?,?,?)');
    const upEst = db.prepare('UPDATE players SET potential_estimated = ?, season_start_overall = overall WHERE id = ?');
    const anySeason = cur.values().next().value!.season;
    for (const r of db.prepare('SELECT * FROM players WHERE retired = 0 ORDER BY id').all()) {
      if (!inScope(r)) continue;
      const p = rowToPlayer(r);
      insDev.run(p.id, anySeason, p.clubId, ageOn(p.birthDate, date), N(r.season_start_overall ?? p.overall), p.overall, minutes.get(p.id) ?? 0);
      upEst.run(reviseEstimate(p.potentialEstimated, p.potentialHidden, p.overall, rng.fork(`est:${p.id}`)), p.id);
    }

    // 6. categorias de base: a IA promove os jovens prontos; quem chega aos 19 sem ser promovido deixa a base
    const generate = playerFactory(db, `s${date}:${countryIds.join(',')}`, date);
    const clubs = db.prepare('SELECT id FROM clubs ORDER BY rowid').all().map((r) => S(r.id)).filter((id) => clubIds.has(id));
    report.youthReleased = youthTurnover(db, date, st.clubId, AI_SQUAD_CAP - 2, clubIds); // promove até 26: deixa espaço para o mercado
    if (report.youthReleased.length && !opts.quiet) addNews(db, date, 'youth', `Base: ${report.youthReleased.join(', ')} deixa(m) o clube`, 'Completaram 19 anos sem ser promovidos ao elenco principal e ficaram livres.');

    // 7. elencos da IA: enxuga os inchados (veteranos mais fracos primeiro) e completa os desfalcados (livres; se faltar, jovens)
    for (const clubId of clubs) {
      if (clubId === st.clubId) continue;
      const squad = squadOf(db, clubId);
      const surplus = squad.length - AI_SQUAD_CAP;
      if (surplus <= 0) continue;
      const cut = [...squad].sort((a, b) => (ageOn(b.birthDate, date) >= 29 ? 1 : 0) - (ageOn(a.birthDate, date) >= 29 ? 1 : 0) || a.overall - b.overall || a.id.localeCompare(b.id));
      let removed = 0;
      for (const p of cut) {
        if (removed >= surplus) break;
        const rest = squad.filter((x) => x.id !== p.id);
        if (neededGroup(rest)) continue; // não abre carência
        squad.splice(squad.indexOf(p), 1);
        releasePlayer(db, p.id, date, false);
        removed++; report.aiReleased++;
      }
    }
    const unmet = aiSignFreeAgents(db, post, rng.fork('fill'), date, st.clubId, true, clubIds);
    for (const clubId of [...new Set(unmet.map((u) => u.clubId))]) {
      const squad = squadOf(db, clubId);
      const fillRng = rng.fork(`fill:${clubId}`);
      for (let g = neededGroup(squad), guard = 0; g && guard < 15; g = neededGroup(squad), guard++) {
        squad.push(promoteBestOfGroup(db, clubId, g, date) ?? generate(fillRng, clubId, fillRng.pick(GROUP_POSITIONS[g]), fillRng.int(17, 19), false));
      }
    }
    // elenco do usuário abaixo do mínimo para jogar: promove o melhor jovem da base no setor (ou gera um, se a base não tiver), avisando nas notícias
    const mine = userInBatch ? squadOf(db, st.clubId) : [];
    const autoRng = rng.fork('auto-user');
    for (let g = userInBatch ? userShortage(mine) : null, guard = 0; g && guard < 20; g = userShortage(mine), guard++) {
      const p = promoteBestOfGroup(db, st.clubId, g, date) ?? generate(autoRng, st.clubId, autoRng.pick(GROUP_POSITIONS[g]), autoRng.int(17, 18), false);
      mine.push(p);
      report.autoPromoted.push(`${nameOf(p)} (${posLabel(p.position)})`);
    }
    if (report.autoPromoted.length) addNews(db, date, 'youth', 'Elenco incompleto: jovens promovidos às pressas', `Para ter o mínimo de jogadores por setor: ${report.autoPromoted.join(', ')}.`);

    // 8. suspensões e cartões não passam de uma temporada para a outra (lesões continuam)
    db.prepare(`UPDATE player_status SET suspension_matches = 0, yellow_cards = 0 WHERE player_id IN (SELECT id FROM players WHERE club_id IS NULL OR club_id IN (SELECT id FROM clubs WHERE country_id IN (${ph})))`).run(...countryIds);

    // avaliação da diretoria (pode demitir o treinador) e vagas em clubes rebaixados da IA
    const relegatedIds = [...direction].filter(([, d]) => d === 'relegated').map(([id]) => id);
    const userRow = userInBatch ? [...tables.values()].flat().find((r) => r.clubId === st.clubId) : undefined;
    // a diretoria avalia o treinador na virada do país dele (não no início da carreira, quando ele ainda não comandava o clube)
    const review = opts.user ? reviewSeason(db, date, userRow && !opts.quiet ? { position: userRow.position, champion: userRow.position === 1, promoted: direction.get(st.clubId) === 'promoted', relegated: direction.get(st.clubId) === 'relegated' } : null, relegatedIds)
      : reviewSeason(db, date, null, relegatedIds);
    if (review) report.board = { met: review.verdict.met, lines: review.verdict.lines, sacked: review.sacked };
    reviewAiCoaches(db, comps.map((c) => c.id), date, new Set(relegatedIds), julyBatch); // técnicos da IA: reputação e aposentadoria

    // 9. temporada seguinte dos países e calendário novo (ligas, copas, supercopa)
    for (const c of countryIds) advanceCountrySeason(db, c);
    if (opts.user) followCountry(db, userCountry(db));
    db.prepare('UPDATE career SET updated_at = ? WHERE id = 1').run(opts.now.toISOString());
    createSeason(db, undefined, countryIds);
    if (opts.user) startBoardSeason(db); // objetivos e orçamentos da temporada nova
    if (!opts.user) return report;
    const coachClub = getCareerState(db).clubId; // vazio se o treinador foi demitido na avaliação
    report.newLeague = coachClub ? S(db.prepare(`SELECT c.name FROM competitions c JOIN clubs cl ON cl.league_id = c.league_id WHERE c.kind = 'league' AND ${CURRENT_COMP} AND cl.id = ?`).get(coachClub)?.name ?? '') : '';
    const window = report.label && date.slice(5) === '01-01' ? 'A janela de transferências de janeiro está aberta.' : 'A janela de transferências de verão está aberta até 31/08.';
    if (!opts.quiet) addNews(db, date, 'season', `Começa a temporada ${report.label}`, coachClub ? `Começa a temporada ${report.label}: o ${clubName(coachClub)} disputa a ${report.newLeague}.\n\n${boardBrief(db)}\n\n${window} Bom momento para ajustar o elenco, renovar contratos e definir os esquemas táticos.` : 'O treinador está sem clube: aguarde propostas de emprego na Diretoria.');
    return report;
}

// ---------------------------------------------------------------- histórico e troféus
export function getHistory(db: SqlDb): HistoryRowDto[] {
  const st = getCareerState(db);
  const rows: HistoryRowDto[] = [];
  const recorded = db.prepare(`SELECT sr.season, sr.competition_id, sr.position, sr.outcome, sr.prize, l.tier FROM season_results sr
    JOIN competitions c ON c.id = sr.competition_id JOIN leagues l ON l.id = c.league_id WHERE sr.club_id = ? ORDER BY sr.season DESC`).all(st.clubId);
  const current = listCompetitions(db).userCompetitionId;
  const entries = [
    ...(current ? [{ season: st.season, compId: current, outcome: null, prize: 0, current: true }] : []),
    ...recorded.map((r) => ({ season: N(r.season), compId: S(r.competition_id), outcome: (r.outcome == null ? null : S(r.outcome)) as HistoryRowDto['outcome'], prize: N(r.prize), current: false })),
  ];
  for (const e of entries) {
    const t = getCompetitionTable(db, e.compId);
    const row = t.rows.find((r) => r.clubId === st.clubId);
    if (!row) continue;
    rows.push({
      season: e.season, current: e.current, competitionName: t.competition.name, tier: t.competition.tier, position: row.position, teamCount: t.rows.length,
      played: row.played, won: row.won, drawn: row.drawn, lost: row.lost, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst, points: row.points,
      outcome: e.outcome, prize: e.prize,
    });
  }
  return rows;
}

export function getTrophies(db: SqlDb): TrophyRoomDto {
  // ligas e copas (copa depois das divisões do país)
  const all: TrophyDto[] = db.prepare(`SELECT t.season, c.name AS comp, co.name AS country, cl.name AS club, t.won_by_user FROM trophies t
    JOIN competitions c ON c.id = t.competition_id LEFT JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = COALESCE(l.country_id, c.country_id) JOIN clubs cl ON cl.id = t.club_id
    ORDER BY t.season DESC, co.rowid, COALESCE(l.tier, 99)`).all()
    .map((r) => ({ season: N(r.season), competitionName: S(r.comp), country: S(r.country), clubName: S(r.club), wonByUser: N(r.won_by_user) === 1 }));
  return { mine: all.filter((t) => t.wonByUser), champions: all };
}
