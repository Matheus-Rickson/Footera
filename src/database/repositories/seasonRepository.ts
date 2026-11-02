import type { SqlDb } from '../types.ts';
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
import { processTrainingDay, processTrainingMonth } from './trainingRepository.ts';
import { processStaffDay } from './staffRepository.ts';
import { processConstructionDay } from './infrastructureRepository.ts';

export class SeasonError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const fmt = (n: number) => n.toLocaleString('pt-BR');
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
export function isSeasonComplete(db: SqlDb): boolean {
  const st = getCareerState(db);
  const left = N(db.prepare("SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.season = ? AND f.status = 'scheduled'").get(st.season)!.n);
  return left === 0;
}

function contractRow(p: Player, date: string, turnover: string): ContractRowDto {
  const age = ageOn(p.birthDate, date);
  const left = monthsLeft(date, p.contractEnd);
  return {
    id: p.id, name: nameOf(p), position: p.position, age, overall: p.overall, salary: p.salary, contractEnd: p.contractEnd,
    monthsLeft: left, expiresThisSeason: expiresAt(p.contractEnd, turnover), canRenew: left <= RENEW_WINDOW_MONTHS, maxYears: maxContractYears(age), renewBaseYear: contractBaseYear(p.contractEnd),
  };
}

export function getContracts(db: SqlDb): ContractRowDto[] {
  const st = getCareerState(db);
  const turnover = turnoverDate(st.season);
  return squadOf(db, st.clubId).map((p) => contractRow(p, st.gameDate, turnover))
    .sort((a, b) => a.contractEnd.localeCompare(b.contractEnd) || b.overall - a.overall);
}

export function getSeasonStatus(db: SqlDb): SeasonStatusDto {
  const st = getCareerState(db);
  const turnover = turnoverDate(st.season);
  const matchesLeft = N(db.prepare("SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.season = ? AND f.status = 'scheduled'").get(st.season)!.n);
  const comps = listCompetitions(db);
  const leagues = comps.competitions.map((c) => {
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
    season: st.season, label: seasonLabel(st.season), gameDate: st.gameDate, turnoverDate: turnover, matchesLeft, complete,
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
  const demand = renewalDemand({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition, loyalty: p.personality.loyalty });
  const d = renewalDecision(input.wage, input.years, demand, age);
  if (d.kind === 'too_long') return { outcome: 'rejected', message: `Aos ${age} anos, ${nameOf(p)} aceita assinar por no máximo ${d.maxYears} temporada(s).` };
  if (d.kind === 'reject') return { outcome: 'rejected', message: `${nameOf(p)} recusou: o salário oferecido está muito abaixo do que ele espera.` };
  if (d.kind === 'counter') return { outcome: 'counter', counterWage: d.wage, message: `${nameOf(p)} renova se o salário for de ${fmt(d.wage)} por mês.` };
  const end = `${contractBaseYear(p.contractEnd) + input.years}-06-30`;
  withTransaction(db, () => {
    db.prepare('UPDATE players SET salary = ?, contract_end = ? WHERE id = ?').run(input.wage, end, p.id);
    addNews(db, st.gameDate, 'contract', `Renovação: ${nameOf(p)} assina até ${br(end)}`, `Novo salário: ${fmt(input.wage)} por mês.`);
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
 * Virada de temporada (ação do usuário em 1º/jul), atômica: resultados → prêmios → promoção/rebaixamento → aposentadorias →
 * contratos → desenvolvimento → jovens → reposição dos elencos da IA → zera suspensões → temporada + 1 → calendário novo →
 * mercado e fechamento mensal do dia.
 */
export function startNextSeason(db: SqlDb, now: Date = new Date()): NewSeasonReportDto {
  const st = getCareerState(db);
  if (!isSeasonComplete(db)) throw new SeasonError('A temporada ainda não terminou: há partidas a disputar.');
  const date = turnoverDate(st.season);
  if (st.gameDate < date) throw new SeasonError(`A nova temporada começa em ${br(date)}. Avance o calendário até lá.`);
  const newSeason = st.season + 1;
  const rng = createRng(`season:${seedOf(db)}:${st.season}`);

  return withTransaction(db, () => {
    const post: Poster = makePoster(db, st.clubId);
    // o dia 1º/jul começa pelo treino (a evolução de junho pertence à temporada que termina), antes do balanço da temporada
    processStaffDay(db, date);
    processTrainingDay(db, date);
    processConstructionDay(db, date);
    processTrainingMonth(db, date);
    const clubName = (id: string) => S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)!.name);
    const report: NewSeasonReportDto = {
      season: newSeason, label: seasonLabel(newSeason), previous: null, newLeague: '', champions: [], movements: [],
      retiredUser: [], retiredTotal: 0, releasedUser: [], youthReleased: [], autoPromoted: [], aiRenewed: 0, aiReleased: 0,
    };

    // 1. resultados finais (derivados das partidas) e trocas de divisão por país
    const comps: CompRow[] = db.prepare(
      `SELECT c.id, c.name, c.league_id, l.tier, l.country_id, l.rules_json, co.name AS country, co.economy FROM competitions c
         JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = l.country_id WHERE c.season = ? ORDER BY co.rowid, l.tier`).all(st.season)
      .map((r) => ({ id: S(r.id), name: S(r.name), leagueId: S(r.league_id), tier: N(r.tier), countryId: S(r.country_id), country: S(r.country), economy: N(r.economy), rules: JSON.parse(S(r.rules_json)) as LeagueRules }));
    const tables = new Map(comps.map((c) => [c.id, getCompetitionTable(db, c.id).rows]));
    const outcome = new Map<string, 'champion' | 'promoted' | 'relegated'>();
    const direction = new Map<string, 'promoted' | 'relegated'>(); // o campeão da 2ª divisão também sobe
    const moves: Array<{ clubId: string; toLeague: string }> = [];
    for (const upper of comps) {
      const lower = comps.find((c) => c.countryId === upper.countryId && c.tier === upper.tier + 1);
      if (!lower) continue;
      const up = tables.get(upper.id)!, down = tables.get(lower.id)!;
      const k = Math.min(upper.rules.relegationSlots, lower.rules.promotionSlots, up.length, down.length);
      if (k <= 0) continue;
      const relegated = up.slice(-k).map((r) => r.clubId), promoted = down.slice(0, k).map((r) => r.clubId);
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
        insResult.run(st.season, r.clubId, c.id, r.position, outcome.get(r.clubId) ?? null, prize);
        if (r.clubId === st.clubId) report.previous = { season: st.season, competitionName: c.name, position: r.position, teamCount: rows.length, outcome: outcome.get(r.clubId) ?? null, prize };
      }
      const champ = rows[0];
      if (champ) {
        db.prepare('INSERT INTO trophies (season, club_id, competition_id, won_by_user) VALUES (?,?,?,?)').run(st.season, champ.clubId, c.id, champ.clubId === st.clubId ? 1 : 0);
        report.champions.push({ competitionName: c.name, country: c.country, clubName: champ.clubName });
        if (champ.clubId === st.clubId) addNews(db, date, 'trophy', `CAMPEÃO! ${champ.clubName} conquista a ${c.name}`, 'O troféu já está na sala de troféus.');
      }
    }
    for (const m of moves) {
      db.prepare('UPDATE clubs SET league_id = ?, reputation = MAX(1, MIN(99, reputation + ?)) WHERE id = ?').run(m.toLeague, direction.get(m.clubId) === 'relegated' ? -3 : 3, m.clubId);
    }
    db.prepare('UPDATE clubs SET reputation = MIN(99, reputation + 2) WHERE id IN (SELECT club_id FROM trophies WHERE season = ?)').run(st.season);
    const prev = report.previous;
    if (prev) {
      const o = direction.get(st.clubId);
      addNews(db, date, 'season', `Fim da temporada ${seasonLabel(st.season)}: ${prev.position}º lugar na ${prev.competitionName}`,
        `Premiação de ${fmt(prev.prize)}.${o === 'promoted' ? ' O clube conquistou o ACESSO à divisão superior!' : o === 'relegated' ? ' O clube foi REBAIXADO.' : ''}`);
    }

    // 3. aposentadorias (inclui jogadores livres)
    for (const r of db.prepare('SELECT * FROM players WHERE retired = 0 ORDER BY id').all()) {
      const p = rowToPlayer(r);
      if (!rng.chance(retirementChance(ageOn(p.birthDate, date), p.overall, p.clubId === null && r.youth_club_id == null))) continue;
      releasePlayer(db, p.id, date, true);
      report.retiredTotal++;
      if (p.clubId === st.clubId) report.retiredUser.push(nameOf(p));
    }
    if (report.retiredUser.length) addNews(db, date, 'retirement', `Aposentadoria: ${report.retiredUser.join(', ')}`, 'Encerraram a carreira e deixaram o elenco.');

    // 4. contratos que vencem: a IA renova a maioria; o usuário perde quem não renovou
    const expiring = db.prepare('SELECT * FROM players WHERE club_id IS NOT NULL AND contract_end <= ? ORDER BY id').all(date).map(rowToPlayer);
    const coreOf = new Map<string, Set<string>>();
    for (const p of expiring) {
      if (p.clubId === st.clubId) { releasePlayer(db, p.id, date, false); report.releasedUser.push(nameOf(p)); continue; }
      if (!coreOf.has(p.clubId!)) coreOf.set(p.clubId!, new Set(squadOf(db, p.clubId!).sort((a, b) => b.overall - a.overall).slice(0, 14).map((x) => x.id)));
      const age = ageOn(p.birthDate, date);
      if (rng.chance(coreOf.get(p.clubId!)!.has(p.id) ? AI_RENEW_CHANCE.core : AI_RENEW_CHANCE.other)) {
        const years = Math.min(maxContractYears(age), rng.int(1, 3));
        const wage = aiRenewalWage({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition, loyalty: p.personality.loyalty });
        db.prepare('UPDATE players SET salary = ?, contract_end = ? WHERE id = ?').run(wage, contractEndFor(date, years), p.id);
        report.aiRenewed++;
      } else { releasePlayer(db, p.id, date, false); report.aiReleased++; }
    }
    if (report.releasedUser.length) addNews(db, date, 'contract', `Fim de contrato: ${report.releasedUser.join(', ')}`, 'Saíram de graça porque o contrato não foi renovado.');

    // 5. balanço da temporada (a evolução agora é mensal, pelo treino) e revisão anual do potencial estimado visível
    const minutes = new Map(db.prepare('SELECT pss.player_id, SUM(pss.minutes) AS m FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id WHERE c.season = ? GROUP BY pss.player_id')
      .all(st.season).map((r) => [S(r.player_id), N(r.m)]));
    const insDev = db.prepare('INSERT INTO player_development (player_id, season, club_id, age, overall_before, overall_after, minutes) VALUES (?,?,?,?,?,?,?)');
    const upEst = db.prepare('UPDATE players SET potential_estimated = ?, season_start_overall = overall WHERE id = ?');
    for (const r of db.prepare('SELECT * FROM players WHERE retired = 0 ORDER BY id').all()) {
      const p = rowToPlayer(r);
      insDev.run(p.id, st.season, p.clubId, ageOn(p.birthDate, date), N(r.season_start_overall ?? p.overall), p.overall, minutes.get(p.id) ?? 0);
      upEst.run(reviseEstimate(p.potentialEstimated, p.potentialHidden, p.overall, rng.fork(`est:${p.id}`)), p.id);
    }

    // 6. categorias de base: a IA promove os jovens prontos; quem chega aos 19 sem ser promovido deixa a base
    const generate = playerFactory(db, `s${newSeason}`, date);
    const clubs = db.prepare('SELECT id FROM clubs ORDER BY rowid').all().map((r) => S(r.id));
    report.youthReleased = youthTurnover(db, date, st.clubId, AI_SQUAD_CAP - 2); // promove até 26: deixa espaço para o mercado
    if (report.youthReleased.length) addNews(db, date, 'youth', `Base: ${report.youthReleased.join(', ')} deixa(m) o clube`, 'Completaram 19 anos sem ser promovidos ao elenco principal e ficaram livres.');

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
    const unmet = aiSignFreeAgents(db, post, rng.fork('fill'), date, st.clubId, true);
    for (const clubId of [...new Set(unmet.map((u) => u.clubId))]) {
      const squad = squadOf(db, clubId);
      const fillRng = rng.fork(`fill:${clubId}`);
      for (let g = neededGroup(squad), guard = 0; g && guard < 15; g = neededGroup(squad), guard++) {
        squad.push(promoteBestOfGroup(db, clubId, g, date) ?? generate(fillRng, clubId, fillRng.pick(GROUP_POSITIONS[g]), fillRng.int(17, 19), false));
      }
    }
    // elenco do usuário abaixo do mínimo para jogar: promove o melhor jovem da base no setor (ou gera um, se a base não tiver), avisando nas notícias
    const mine = squadOf(db, st.clubId);
    const autoRng = rng.fork('auto-user');
    for (let g = userShortage(mine), guard = 0; g && guard < 20; g = userShortage(mine), guard++) {
      const p = promoteBestOfGroup(db, st.clubId, g, date) ?? generate(autoRng, st.clubId, autoRng.pick(GROUP_POSITIONS[g]), autoRng.int(17, 18), false);
      mine.push(p);
      report.autoPromoted.push(`${nameOf(p)} (${p.position})`);
    }
    if (report.autoPromoted.length) addNews(db, date, 'youth', 'Elenco incompleto: jovens promovidos às pressas', `Para ter o mínimo de jogadores por setor: ${report.autoPromoted.join(', ')}.`);

    // 8. suspensões e cartões não passam de uma temporada para a outra (lesões continuam)
    db.exec('UPDATE player_status SET suspension_matches = 0, yellow_cards = 0');

    // 9. temporada nova, calendário, e o dia 1º/jul (mercado de verão abre; cobrança de julho)
    db.prepare('UPDATE career SET season = ?, updated_at = ? WHERE id = 1').run(newSeason, now.toISOString());
    createSeason(db, newSeason);
    processMarketDay(db, date);
    processScoutingDay(db, date);
    settleFinances(db, date);
    report.newLeague = S(db.prepare('SELECT c.name FROM competitions c JOIN clubs cl ON cl.league_id = c.league_id WHERE c.season = ? AND cl.id = ?').get(newSeason, st.clubId)?.name ?? '');
    addNews(db, date, 'season', `Começa a temporada ${seasonLabel(newSeason)}`, `${clubName(st.clubId)} disputa a ${report.newLeague}. A janela de transferências de verão está aberta.`);
    return report;
  });
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
  const all: TrophyDto[] = db.prepare(`SELECT t.season, c.name AS comp, co.name AS country, cl.name AS club, t.won_by_user FROM trophies t
    JOIN competitions c ON c.id = t.competition_id JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = l.country_id JOIN clubs cl ON cl.id = t.club_id
    ORDER BY t.season DESC, co.rowid, l.tier`).all()
    .map((r) => ({ season: N(r.season), competitionName: S(r.comp), country: S(r.country), clubName: S(r.club), wonByUser: N(r.won_by_user) === 1 }));
  return { mine: all.filter((t) => t.wonByUser), champions: all };
}
