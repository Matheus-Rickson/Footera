/**
 * Objetivos da diretoria por tamanho e fase (v0.8.10; regras puras em `game/board-engine/objectives.ts`, docs/BOARD_JOBS.md).
 * Monta os objetivos no início da temporada (`buildObjectives`), mede o andamento ao vivo (`liveObjectives`) e julga na virada
 * (`judgeObjectives`). Recebe a situação na liga de quem chama (boardRepository), para não depender dele.
 */
import type { SqlDb } from '../types.ts';
import { ageOn } from '../../shared/date.ts';
import { annualEstimate } from '../../game/finance-engine/finance.ts';
import { OBJECTIVE_LABEL, type JudgedObjective, type Objective } from '../../game/board-engine/board.ts';
import {
  clubPhase, clubSize, IMPORTANCE, objectiveProgress, objectiveStatus, PHASE_LABEL, PHASE_TEXT, seasonObjectives, SIZE_LABEL,
  type ClubPhase, type ClubSize, type Importance, type ObjectiveDef, type ObjectiveKind,
} from '../../game/board-engine/objectives.ts';
import type { BoardObjectiveDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { loadClubEcon } from './financeRepository.ts';
import { CURRENT_COMP, countrySeason } from './countrySeasonRepository.ts';
import { formatStateOf } from './formatRepository.ts';
import { stageTables } from '../../game/format-engine/engine.ts';
import { fmtMoney } from '../../shared/money.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);

/** Situação na liga (subconjunto de `LeagueSituation` do boardRepository). */
export interface SitLite { position: number; played: number; teams: number; expected: number; tier: number; competitionId: string }

const balanceOf = (db: SqlDb, id: string) => N(db.prepare('SELECT balance FROM clubs WHERE id = ?').get(id)!.balance);
const payrollOf = (db: SqlDb, id: string) => N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS w FROM players WHERE club_id = ?').get(id)!.w);

/** Idade média dos 18 jogadores mais fortes do clube. */
export function squadAge(db: SqlDb, clubId: string, date: string): number {
  const rows = db.prepare('SELECT birth_date FROM players WHERE club_id = ? ORDER BY overall DESC LIMIT 18').all(clubId);
  return rows.length ? Math.round((rows.reduce((s, r) => s + ageOn(S(r.birth_date), date), 0) / rows.length) * 10) / 10 : 0;
}

/** Posição de força do elenco (média dos 18 mais fortes) entre os clubes da competição. */
function strengthRank(db: SqlDb, clubId: string, competitionId: string): number {
  const clubs = db.prepare('SELECT DISTINCT home_club_id AS id FROM fixtures WHERE competition_id = ? UNION SELECT DISTINCT away_club_id FROM fixtures WHERE competition_id = ?').all(competitionId, competitionId).map((r) => S(r.id));
  const avg = (id: string) => { const r = db.prepare('SELECT AVG(overall) AS a FROM (SELECT overall FROM players WHERE club_id = ? ORDER BY overall DESC LIMIT 18)').get(id); return N(r?.a ?? 0); };
  const mine = avg(clubId);
  return 1 + clubs.filter((id) => id !== clubId && avg(id) > mine).length;
}

/** Copa nacional da temporada em que o clube está inscrito: nome, fases e fase de estreia. */
function nationalCup(db: SqlDb, clubId: string): { id: string; name: string; stages: string[]; entry: number } | null {
  for (const c of db.prepare(`SELECT c.id, c.name, c.format_json FROM competitions c WHERE c.kind = 'cup' AND ${CURRENT_COMP} ORDER BY c.id`).all()) {
    const st = JSON.parse(S(c.format_json)) as { format?: { kind?: string; name?: string; stages?: Array<{ name: string }> }; entry?: Record<string, number> };
    if (st.format?.kind === 'supercup' || !st.format?.stages || !st.entry || st.entry[clubId] === undefined) continue;
    return { id: S(c.id), name: st.format.name ?? S(c.name), stages: st.format.stages.map((x) => x.name), entry: st.entry[clubId]! };
  }
  return null;
}

/** Estadual (Brasil) da temporada do clube. */
function estadual(db: SqlDb, clubId: string): { id: string; name: string; teams: number; relegationSlots: number; position: number | null; played: number; finished: boolean } | null {
  const e = db.prepare(`SELECT c.id, c.name, c.status FROM competitions c WHERE c.kind = 'state' AND c.id LIKE 'est\\_%' ESCAPE '\\' AND ${CURRENT_COMP}
    AND c.id IN (SELECT competition_id FROM fixtures WHERE home_club_id = ? OR away_club_id = ?) LIMIT 1`).get(clubId, clubId);
  if (!e) return null;
  const fs = formatStateOf(db, S(e.id));
  if (!fs) return null;
  const row = fs.state.stages.f1 ? stageTables(fs.def, fs.state, 'f1').overall.find((r) => r.teamId === clubId) : undefined;
  return { id: S(e.id), name: S(e.name), teams: fs.state.seeds.length, relegationSlots: fs.def.relegated?.length ?? 0, position: row?.position ?? null, played: row?.played ?? 0, finished: S(e.status) === 'finished' };
}

/** Tamanho e fase do clube (início da temporada). */
export function classifyClub(db: SqlDb, clubId: string, sit: SitLite | null): { size: ClubSize; phase: ClubPhase } {
  const st = getCareerState(db);
  const c = db.prepare('SELECT reputation, country_id FROM clubs WHERE id = ?').get(clubId)!;
  const rep = N(c.reputation);
  const repRankInCountry = 1 + N(db.prepare('SELECT COUNT(*) AS n FROM clubs WHERE country_id = ? AND reputation > ?').get(S(c.country_id), rep)!.n);
  const tier = sit && sit.tier > 0 ? sit.tier : 5;
  const size = clubSize({ reputation: rep, tier, repRankInCountry });
  const cs = countrySeason(db, S(c.country_id));
  const last = db.prepare('SELECT position, outcome FROM season_results WHERE club_id = ? AND season = ?').get(clubId, cs.season - 1);
  const econ = loadClubEcon(db, clubId), payroll = payrollOf(db, clubId), est = annualEstimate(econ, payroll);
  const phase = clubPhase({
    lastOutcome: last?.outcome == null ? null : (S(last.outcome) as 'champion' | 'promoted' | 'relegated'), lastPosition: last ? N(last.position) : null,
    expected: sit?.expected ?? 1, balance: balanceOf(db, clubId), projectedNet: est.net, annualIncome: est.income,
    squadAge: squadAge(db, clubId, st.gameDate), strengthRank: sit && sit.tier > 0 ? strengthRank(db, clubId, sit.competitionId) : sit?.expected ?? 1, repRank: sit?.expected ?? 1,
  });
  return { size, phase };
}

/**
 * Objetivos da temporada para o clube do usuário (início de temporada ou contratação): grava tamanho, fase e objetivos.
 * `league` = objetivo de liga já decidido (board_state). NÃO abre transação.
 */
export function buildObjectives(db: SqlDb, clubId: string, season: number, sit: SitLite | null, league: { objective: Objective; target: number }, extra: { wageCeiling: number; youthTarget: number }): void {
  const { size, phase } = classifyClub(db, clubId, sit);
  const st = getCareerState(db);
  const cup = nationalCup(db, clubId);
  const est = sit && sit.tier > 0 ? estadual(db, clubId) : null; // clube só de estadual: o estadual já é o objetivo de liga
  const defs = seasonObjectives(size, phase, {
    league: { ...league, label: sit && sit.tier === 0 ? `Estadual: ${OBJECTIVE_LABEL[league.objective].toLowerCase()}` : OBJECTIVE_LABEL[league.objective] },
    cup: cup ? { name: cup.name, stages: cup.stages, entry: cup.entry } : null,
    state: est ? { name: est.name, teams: est.teams, relegationSlots: est.relegationSlots } : null,
    payroll: payrollOf(db, clubId), wageCeiling: extra.wageCeiling, youthTarget: extra.youthTarget, squadAge: squadAge(db, clubId, st.gameDate), tier: sit?.tier ?? 0,
  });
  db.prepare('DELETE FROM board_objectives WHERE club_id = ? AND season = ?').run(clubId, season);
  const ins = db.prepare('INSERT INTO board_objectives (club_id, season, idx, kind, importance, label, target_json) VALUES (?,?,?,?,?,?,?)');
  defs.forEach((d, i) => ins.run(clubId, season, i, d.kind, d.importance, d.label, JSON.stringify(d.target)));
  db.prepare('UPDATE board_state SET size = ?, phase = ? WHERE id = 1').run(size, phase);
}

function storedObjectives(db: SqlDb, clubId: string, season: number): Array<ObjectiveDef & { idx: number; status: string | null }> {
  return db.prepare('SELECT * FROM board_objectives WHERE club_id = ? AND season = ? ORDER BY idx').all(clubId, season).map((r) => ({
    idx: N(r.idx), kind: S(r.kind) as ObjectiveKind, importance: S(r.importance) as Importance, label: S(r.label), target: JSON.parse(S(r.target_json)) as Record<string, number>,
    status: r.status == null ? null : S(r.status),
  }));
}

/** Valores medidos no jogo para os objetivos do clube. */
function actuals(db: SqlDb, clubId: string, sit: SitLite | null) {
  const st = getCareerState(db);
  const b = db.prepare('SELECT youth_promoted FROM board_state WHERE id = 1 AND club_id = ?').get(clubId);
  const cup = nationalCup(db, clubId);
  let cupStage: number | null = null, cupEliminated = false, cupChampion = false;
  if (cup) {
    const last = db.prepare('SELECT stage, winner FROM cup_ties WHERE competition_id = ? AND (club_a = ? OR club_b = ?) ORDER BY stage DESC LIMIT 1').get(cup.id, clubId, clubId);
    if (last) { cupStage = N(last.stage); cupEliminated = last.winner != null && S(last.winner) !== clubId; }
    cupChampion = !!db.prepare('SELECT 1 AS x FROM trophies WHERE competition_id = ? AND club_id = ?').get(cup.id, clubId);
  }
  const est = estadual(db, clubId);
  const stateChampion = est ? !!db.prepare('SELECT 1 AS x FROM trophies WHERE competition_id = ? AND club_id = ?').get(est.id, clubId) : false;
  const youthApps = N(db.prepare(`SELECT COALESCE(SUM(s.appearances), 0) AS n FROM player_season_stats s JOIN competitions c ON c.id = s.competition_id JOIN players p ON p.id = s.player_id
    WHERE s.club_id = ? AND ${CURRENT_COMP} AND p.birth_date > ?`).get(clubId, `${Number(st.gameDate.slice(0, 4)) - 22}${st.gameDate.slice(4)}`)!.n);
  return {
    league: { position: sit && sit.played > 0 ? sit.position : null, played: sit?.played ?? 0 },
    cup: { cupStage, cupEliminated, cupChampion }, cupStages: cup?.stages ?? [],
    state: { position: est?.position ?? null, played: est?.played ?? 0, stateChampion, stateFinished: est?.finished ?? false },
    balance: balanceOf(db, clubId), payroll: payrollOf(db, clubId), youthPromoted: b ? N(b.youth_promoted) : 0, youthAppearances: youthApps, squadAge: squadAge(db, clubId, st.gameDate),
  };
}

const actualFor = (kind: ObjectiveKind, a: ReturnType<typeof actuals>) =>
  kind === 'league' ? a.league : kind === 'cup' ? a.cup : kind === 'state' ? a.state : a;

function detailOf(o: ObjectiveDef, a: ReturnType<typeof actuals>): string {
  switch (o.kind) {
    case 'league': return a.league.position == null ? `Meta: até ${o.target.position}º · ainda sem jogos` : `${a.league.position}º agora · meta até ${o.target.position}º`;
    case 'cup': return a.cup.cupChampion ? 'Campeão' : a.cup.cupStage == null ? 'Estreia ainda não disputada' : `${a.cup.cupEliminated ? 'Eliminado na' : 'Na'} ${(a.cupStages[a.cup.cupStage] ?? '').toLowerCase()}`;
    case 'state': return a.state.stateChampion ? 'Campeão' : a.state.position == null ? 'Ainda sem jogos' : `${a.state.position}º na 1ª fase${a.state.stateFinished ? ' · encerrado' : ''}`;
    case 'finance_black': return `Caixa atual: ${fmtMoney(a.balance)}`;
    case 'payroll_cut': case 'wage_ceiling': return `Folha atual ${fmtMoney(a.payroll)} · meta até ${fmtMoney(o.target.payroll!)}`;
    case 'youth_promote': return `${a.youthPromoted} de ${o.target.count} promovido(s) nesta temporada`;
    case 'youth_minutes': return `${a.youthAppearances} de ${o.target.appearances} jogos de jogadores até 21 anos`;
    case 'squad_age': return `Idade média atual ${a.squadAge.toLocaleString('pt-BR')} · meta até ${o.target.age!.toLocaleString('pt-BR')}`;
  }
}

/** Objetivos da temporada com o andamento de hoje (tela da Diretoria). */
export function liveObjectives(db: SqlDb, clubId: string, season: number, sit: SitLite | null): BoardObjectiveDto[] {
  const list = storedObjectives(db, clubId, season);
  if (!list.length) return [];
  const a = actuals(db, clubId, sit);
  return list.map((o) => {
    const act = actualFor(o.kind, a);
    const status = o.status ? (o.status as 'met' | 'missed') : objectiveStatus(o, act, false);
    const w = IMPORTANCE[o.importance];
    return { kind: o.kind, importance: o.importance, importanceLabel: w.label, label: o.label, status, progress: objectiveProgress(o, act), detail: detailOf(o, a),
      reward: o.kind === 'league' ? { met: 15, missed: -20 } : { met: w.met, missed: w.missed } };
  });
}

/** Julga os objetivos extras na virada (grava cumprido/não cumprido); o de liga fica com `evaluateSeason`. NÃO abre transação. */
export function judgeObjectives(db: SqlDb, clubId: string, season: number, sit: SitLite | null): JudgedObjective[] | undefined {
  const list = storedObjectives(db, clubId, season);
  if (!list.length) return undefined; // save anterior à v0.8.10: avaliação antiga
  const a = actuals(db, clubId, sit);
  const upd = db.prepare('UPDATE board_objectives SET status = ? WHERE club_id = ? AND season = ? AND idx = ?');
  const out: JudgedObjective[] = [];
  for (const o of list) {
    const st = objectiveStatus(o, actualFor(o.kind, a), true);
    const met = st === 'met';
    upd.run(met ? 'met' : 'missed', clubId, season, o.idx);
    if (o.kind === 'league') continue;
    const w = IMPORTANCE[o.importance];
    out.push({ label: o.label, met, delta: met ? w.met : w.missed });
  }
  return out;
}

/** Registra a confiança do dia (dia 1º e avaliação). NÃO abre transação. */
export function logConfidence(db: SqlDb, date: string, clubId: string, confidence: number): void {
  db.prepare('INSERT OR REPLACE INTO board_confidence_log (date, club_id, confidence) VALUES (?,?,?)').run(date, clubId, Math.round(confidence * 10) / 10);
}
export function confidenceHistory(db: SqlDb, clubId: string, limit = 24): Array<{ date: string; confidence: number }> {
  return db.prepare('SELECT date, confidence FROM board_confidence_log WHERE club_id = ? ORDER BY date DESC LIMIT ?').all(clubId, limit).reverse().map((r) => ({ date: S(r.date), confidence: N(r.confidence) }));
}

export const sizePhaseDto = (size: string | null, phase: string | null) => size && phase ? {
  size: size as ClubSize, sizeLabel: SIZE_LABEL[size as ClubSize], phase: phase as ClubPhase, phaseLabel: PHASE_LABEL[phase as ClubPhase], phaseText: PHASE_TEXT[phase as ClubPhase],
} : null;
