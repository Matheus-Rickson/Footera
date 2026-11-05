import type { SqlDb } from '../types.ts';
import { POS_NAME } from '../../shared/positions.ts';
import { withTransaction } from '../types.ts';
import { createRng, clamp } from '../../game/rng.ts';
import { conditionAfter, simulateMatch } from '../../game/match-engine/engine.ts';
import { commentate } from '../../game/match-engine/commentary.ts';
import { aiTactics, buildSheetDetailed, tacticsForMethodology, toMatchPlayer } from '../../game/match-engine/team-builder.ts';
import { formationLabel } from '../../game/match-engine/formations.ts';
import type { Intervention, MatchConditions, MatchEvent, MatchOutcome, MatchTick, PlayerReport, TeamSheet, TeamTactics } from '../../game/match-engine/types.ts';
import { addDays } from '../../shared/date.ts';
import type { Coach, Player } from '../../shared/types.ts';
import type { LiveInterventionInput, LiveMatchDto, MatchReportDto, MatchSummaryDto, SchemeDto, SimulationSummaryDto } from '../../shared/api.ts';
import { UserError } from '../../shared/errors.ts';
import { getActiveScheme } from './tacticsRepository.ts';
import { makePoster, recordGate, type Poster } from './financeRepository.ts';
import { rowToPlayer } from './worldRepository.ts';
import { applyResult, getCareerState } from './competitionRepository.ts';
import { loadSquad, type Squad, type Status } from './squadRepository.ts';
import { addFamiliarity, ROLE_MATCH_GAIN } from './roleRepository.ts';
import { medicalFactor } from './staffRepository.ts';
import { applyMatchesToBoard } from './boardRepository.ts';
import { processSocialMatchday } from './socialRepository.ts';
import { quickResult, teamStrength } from '../../game/match-engine/quickResult.ts';
import { lightClubIds } from './simLevelRepository.ts';
import { addNews } from './newsRepository.ts';
import { aiCoachAttributes } from './aiCoachRepository.ts';
import type { CoachAttributes } from '../../shared/coachAttributes.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const BALANCED: TeamTactics = { mentality: 'balanced', tempo: 3, width: 3, defensiveLine: 3, pressing: 3, buildUp: 'mixed' };
const COMPACT_TYPES = new Set(['goal', 'yellow_card', 'red_card', 'substitution', 'injury', 'penalty_awarded', 'shootout_kick', 'period_end']);

function clubState(db: SqlDb, clubId: string): { formation: string | null; lineup: string[] | null } {
  const r = db.prepare('SELECT formation, last_lineup_json FROM club_state WHERE club_id = ?').get(clubId);
  return r ? { formation: S(r.formation), lineup: JSON.parse(S(r.last_lineup_json)) as string[] } : { formation: null, lineup: null };
}

const slim = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0 && v !== false && v !== null)) as Partial<T>;

export function conditionsFor(seed: string, fixtureId: string, date: string): MatchConditions {
  const r = createRng(`weather:${seed}:${fixtureId}`);
  const month = Number(date.slice(5, 7));
  const heat = month >= 6 && month <= 8 ? 0.25 : 0.03, cold = month === 12 || month <= 2 ? 0.25 : 0.03, rain = 0.2;
  const roll = r.next();
  const weather: MatchConditions['weather'] = roll < rain ? 'rain' : roll < rain + heat ? 'heat' : roll < rain + heat + cold ? 'cold' : 'clear';
  return { weather, pitch: r.chance(weather === 'rain' ? 0.2 : 0.06) ? 'poor' : 'good' };
}

interface StoredReport {
  v: 1; detail: 'full' | 'compact';
  home: { clubId: string; name: string; formation: string }; away: { clubId: string; name: string; formation: string };
  homeGoals: number; awayGoals: number; decidedIn: MatchOutcome['decidedIn']; shootout: MatchOutcome['shootout']; winner: MatchOutcome['winner'];
  conditions: MatchConditions; duration: number; stats: MatchOutcome['stats']; players: Array<Partial<PlayerReport>>;
  lineups: MatchOutcome['lineups']; events: MatchEvent[]; manOfTheMatch: string | null;
  tactics?: [TeamTactics, TeamTactics];
  /** só nas partidas do usuário (relatório completo); ausente em saves anteriores à lapidação */ timeline?: MatchTick[];
}

interface FixtureRow { id: string; competitionId: string; competitionName: string; round: number; date: string; homeId: string; awayId: string; homeName: string; awayName: string }

function summaryOf(f: FixtureRow, hg: number, ag: number, userClub: string, hasReport = true): MatchSummaryDto {
  return { fixtureId: f.id, competitionName: f.competitionName, date: f.date, round: f.round, homeName: f.homeName, awayName: f.awayName, homeGoals: hg, awayGoals: ag, involvesUser: f.homeId === userClub || f.awayId === userClub, hasReport };
}

interface Ctx { seed: string; userClub: string; coach: Coach; scheme: SchemeDto | null; notes: string[]; aiCoaches?: Map<string, CoachAttributes> }
/** Decisões do técnico na partida acompanhada ao vivo. `controlUntil` null = o técnico decide a partida toda. */
export interface LiveOptions { interventions: LiveInterventionInput[]; controlUntil: number | null }

/** Monta os dois times (escalação, táticas) exatamente como na simulação definitiva. Só lê o banco. */
function prepareFixture(db: SqlDb, f: FixtureRow, ctx: Ctx) {
  const home = loadSquad(db, f.homeId, f.date), away = loadSquad(db, f.awayId, f.date);
  const hs = clubState(db, f.homeId), as = clubState(db, f.awayId);
  const mk = (sq: Squad, id: string, name: string, st: ReturnType<typeof clubState>): TeamSheet => {
    const mine = id === ctx.userClub ? ctx.scheme : null;
    const r = buildSheetDetailed({
      clubId: id, name, squad: sq.available.map(toMatchPlayer), previousFormation: st.formation, previousLineup: st.lineup,
      tactics: mine ? mine.settings : BALANCED, formationId: mine?.formation, preferredLineup: mine?.lineup ?? null, preferredRoles: mine?.roles ?? null,
    });
    for (const x of r.replaced) {
      const wanted = sq.players.find((p) => p.id === x.wantedId);
      const s0 = sq.status.get(x.wantedId);
      const why = s0?.injuryUntil && s0.injuryUntil > f.date ? 'lesionado' : (s0?.suspension ?? 0) > 0 ? 'suspenso' : 'indisponível';
      ctx.notes.push(`Escalação ajustada: ${wanted ? `${wanted.firstName} ${wanted.lastName}` : 'jogador escolhido'} (${why}) foi substituído por ${x.chosen.name} como ${POS_NAME[r.sheet.lineup[x.slotIndex]!.slot].toLowerCase()}.`);
    }
    const coach = id === ctx.userClub ? ctx.coach.attributes : ctx.aiCoaches?.get(id); // técnicos da IA: tática e disciplina valem também
    return coach ? { ...r.sheet, coach } : r.sheet;
  };
  let hSheet = mk(home, f.homeId, f.homeName, hs), aSheet = mk(away, f.awayId, f.awayName, as);
  const rep = (id: string) => db.prepare('SELECT reputation FROM clubs WHERE id = ?').get(id)!.reputation as number;
  const tactics = (own: TeamSheet, opp: TeamSheet, id: string, isHome: boolean): TeamTactics =>
    id === ctx.userClub ? (ctx.scheme ? ctx.scheme.settings : tacticsForMethodology(ctx.coach.methodology)) : aiTactics(own.lineup, opp.lineup, N(rep(id)), isHome);
  const tH = tactics(hSheet, aSheet, f.homeId, true), tA = tactics(aSheet, hSheet, f.awayId, false);
  hSheet = { ...hSheet, tactics: tH }; aSheet = { ...aSheet, tactics: tA };
  return { home, away, hSheet, aSheet, tH, tA };
}

function runFixture(f: FixtureRow, ctx: Ctx, prep: ReturnType<typeof prepareFixture>, live?: LiveOptions): MatchOutcome {
  const involves = f.homeId === ctx.userClub || f.awayId === ctx.userClub;
  const side: 0 | 1 = f.homeId === ctx.userClub ? 0 : 1;
  const ivs: Intervention[] = (live?.interventions ?? []).map((iv) => ({ ...iv, team: side }));
  return simulateMatch(prep.hSheet, prep.aSheet, {
    seed: `${ctx.seed}:${f.id}`, conditions: conditionsFor(ctx.seed, f.id, f.date), timeline: involves,
    ...(live && involves ? { control: { team: side, until: live.controlUntil ?? Number.MAX_SAFE_INTEGER }, interventions: ivs } : {}),
  });
}

function storedOf(f: FixtureRow, ctx: Ctx, prep: ReturnType<typeof prepareFixture>, out: MatchOutcome): StoredReport {
  const involves = f.homeId === ctx.userClub || f.awayId === ctx.userClub;
  return {
    v: 1, detail: involves ? 'full' : 'compact',
    home: { clubId: f.homeId, name: f.homeName, formation: formationLabel(prep.hSheet.formation) }, away: { clubId: f.awayId, name: f.awayName, formation: formationLabel(prep.aSheet.formation) },
    homeGoals: out.homeGoals, awayGoals: out.awayGoals, decidedIn: out.decidedIn, shootout: out.shootout, winner: out.winner,
    conditions: out.conditions, duration: out.duration, stats: out.stats,
    players: out.players.map((p) => ({ ...slim(p), id: p.id, name: p.name, team: p.team, slot: p.slot, position: p.position, rating: p.rating, minutes: p.minutes })),
    lineups: out.lineups, events: involves ? out.events : out.events.filter((e) => COMPACT_TYPES.has(e.type)), manOfTheMatch: out.manOfTheMatch,
    tactics: [prep.tH, prep.tA], ...(involves && out.timeline ? { timeline: out.timeline } : {}),
  };
}

function simulateOne(db: SqlDb, f: FixtureRow, ctx: Ctx & { post: Poster }, live?: LiveOptions): MatchSummaryDto {
  const prep = prepareFixture(db, f, ctx);
  const { home, away, hSheet, aSheet } = prep;
  const out = runFixture(f, ctx, prep, live);

  applyResult(db, f.id, out.homeGoals, out.awayGoals);
  const report = storedOf(f, ctx, prep, out);
  db.prepare('INSERT INTO matches (fixture_id, seed, played_on, home_goals, away_goals, decided_in, detail, report_json) VALUES (?,?,?,?,?,?,?,?)')
    .run(f.id, `${ctx.seed}:${f.id}`, f.date, out.homeGoals, out.awayGoals, out.decidedIn, report.detail, JSON.stringify(report));
  recordGate(db, ctx.post, { id: f.id, date: f.date, homeId: f.homeId, awayId: f.awayId, awayName: f.awayName }, out.conditions.weather, ctx.seed);

  // ---- consequências nos jogadores ----
  const byId = new Map([...home.players, ...away.players].map((p) => [p.id, p]));
  const statusOf = (sq: Squad, id: string): Status => sq.status.get(id) ?? { injuryUntil: null, suspension: 0, yellows: 0 };
  const redKind = new Map(out.events.filter((e) => e.type === 'red_card').map((e) => [e.player!, e.detail === 'second_yellow' ? 1 : 2]));
  const upStatus = db.prepare(`INSERT INTO player_status (player_id, injury_until, injury_note, suspension_matches, yellow_cards) VALUES (?,?,?,?,?)
    ON CONFLICT(player_id) DO UPDATE SET injury_until = excluded.injury_until, injury_note = excluded.injury_note, suspension_matches = excluded.suspension_matches, yellow_cards = excluded.yellow_cards`);
  const upPlayer = db.prepare('UPDATE players SET condition_pct = ?, form = ?, morale = ? WHERE id = ?');
  const upStats = db.prepare(`INSERT INTO player_season_stats (player_id, competition_id, club_id, appearances, minutes, goals, assists, yellow_cards, red_cards, rating_sum)
    VALUES (?,?,?,1,?,?,?,?,?,?) ON CONFLICT(player_id, competition_id) DO UPDATE SET appearances = appearances + 1, minutes = minutes + excluded.minutes,
    goals = goals + excluded.goals, assists = assists + excluded.assists, yellow_cards = yellow_cards + excluded.yellow_cards, red_cards = red_cards + excluded.red_cards, rating_sum = rating_sum + excluded.rating_sum`);

  const medical = new Map([[f.homeId, medicalFactor(db, f.homeId)], [f.awayId, medicalFactor(db, f.awayId)]]);
  for (const r of out.players) {
    const p = byId.get(r.id)!;
    const sq = r.team === 0 ? home : away, clubId = r.team === 0 ? f.homeId : f.awayId;
    const result = (r.team === 0 ? out.homeGoals - out.awayGoals : out.awayGoals - out.homeGoals);
    upPlayer.run(conditionAfter(p.condition, p.attributes.physical.stamina, r.minutes, out.conditions.weather),
      Math.round(clamp(0.7 * p.form + 0.3 * (50 + (r.rating - 6) * 15), 0, 100) * 10) / 10,
      clamp(p.morale + (result > 0 ? 3 : result < 0 ? -3 : 0), 10, 100), p.id);
    upStats.run(p.id, f.competitionId, clubId, r.minutes, r.goals, r.assists, r.yellow, r.red, r.rating);
    if (r.role && r.minutes > 0) addFamiliarity(db, p, r.role, (ROLE_MATCH_GAIN * r.minutes) / 90); // aprende a função jogando
    const st = statusOf(sq, p.id);
    let y = st.yellows + r.yellow, susp = st.suspension;
    if (r.red > 0) susp += redKind.get(p.id) ?? 1;
    if (y >= 5) { susp += 1; y -= 5; }
    // quem estava suspenso e jogou (escalação de emergência) cumpre a suspensão
    if (st.suspension > 0 && sq.suspendedOut.indexOf(p.id) < 0) susp = Math.max(0, susp - 1);
    const injuredDays = r.injuredDays > 0 ? Math.max(1, Math.round(r.injuredDays * medical.get(clubId)!)) : 0; // médico e departamento médico encurtam
    const injuryUntil = injuredDays > 0 ? addDays(f.date, injuredDays) : st.injuryUntil;
    if (y !== st.yellows || susp !== st.suspension || injuryUntil !== st.injuryUntil) {
      upStatus.run(p.id, injuryUntil, injuredDays > 0 ? `Lesão (${injuredDays} dias)` : null, susp, y);
    }
    if (clubId === ctx.userClub) {
      const name = `${p.firstName} ${p.lastName}`, opp = clubId === f.homeId ? f.awayName : f.homeName;
      if (injuredDays > 0) addNews(db, f.date, 'medical', `Lesão: ${name} fora por ${injuredDays} dias`,
        `${name} (${POS_NAME[p.position].toLowerCase()}) se lesionou na partida contra o ${opp}. Previsão de retorno: ${injuryUntil!.split('-').reverse().join('/')} (${injuredDays} dias), já considerando o trabalho do departamento médico.\n\nAté lá ele fica fora das partidas. Revise a escalação e a função da vaga dele em Táticas.`,
        { actionLabel: 'Ajustar a escalação em Táticas' });
      if (susp > st.suspension && sq.suspendedOut.indexOf(p.id) < 0) addNews(db, f.date, 'squad', `Suspensão: ${name} cumpre ${susp} jogo(s)`,
        `${name} ${r.red > 0 ? 'foi expulso' : 'recebeu o quinto cartão amarelo'} na partida contra o ${opp} e está suspenso por ${susp} jogo(s).\n\nEle não pode ser escalado na(s) próxima(s) partida(s). Defina o substituto em Táticas.`,
        { actionLabel: 'Ajustar a escalação em Táticas' });
    }
  }
  // a conversa no vestiário vale só durante esta partida (out.moraleDelta não é gravado)
  for (const [sq, id] of [[home, f.homeId], [away, f.awayId]] as const) {
    for (const pid of sq.suspendedOut) { const st = statusOf(sq, pid); upStatus.run(pid, st.injuryUntil, null, Math.max(0, st.suspension - 1), st.yellows); }
    const sheet = id === f.homeId ? hSheet : aSheet;
    db.prepare('INSERT INTO club_state (club_id, formation, last_lineup_json) VALUES (?,?,?) ON CONFLICT(club_id) DO UPDATE SET formation = excluded.formation, last_lineup_json = excluded.last_lineup_json')
      .run(id, sheet.formation, JSON.stringify(sheet.lineup.map((l) => l.player.id)));
  }
  return summaryOf(f, out.homeGoals, out.awayGoals, ctx.userClub);
}

/**
 * Partida de país com simulação simplificada: só o placar, pela força dos elencos (sem relatório, sem efeitos nos jogadores, sem bilheteria).
 * A classificação continua derivada das partidas (regra 4).
 */
function simulateLight(db: SqlDb, f: FixtureRow, ctx: Ctx, strengthOf: (clubId: string) => number): MatchSummaryDto {
  const r = quickResult(strengthOf(f.homeId), strengthOf(f.awayId), createRng(`quick:${ctx.seed}:${f.id}`));
  applyResult(db, f.id, r.homeGoals, r.awayGoals);
  return summaryOf(f, r.homeGoals, r.awayGoals, ctx.userClub, false);
}

function pendingFixtures(db: SqlDb, date: string): FixtureRow[] {
  return db.prepare(
    `SELECT f.id, f.competition_id, c.name AS competition_name, f.round, f.match_date, f.home_club_id, f.away_club_id, h.name AS home_name, a.name AS away_name
       FROM fixtures f JOIN competitions c ON c.id = f.competition_id JOIN clubs h ON h.id = f.home_club_id JOIN clubs a ON a.id = f.away_club_id
      WHERE f.status = 'scheduled' AND f.match_date <= ? ORDER BY f.match_date, f.id`).all(date)
    .map((r): FixtureRow => ({ id: S(r.id), competitionId: S(r.competition_id), competitionName: S(r.competition_name), round: N(r.round), date: S(r.match_date),
      homeId: S(r.home_club_id), awayId: S(r.away_club_id), homeName: S(r.home_name), awayName: S(r.away_name) }));
}
function contextOf(db: SqlDb): Ctx {
  return {
    seed: S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value),
    coach: JSON.parse(S(db.prepare('SELECT coach_json FROM career WHERE id = 1').get()!.coach_json)) as Coach,
    userClub: getCareerState(db).clubId, scheme: getActiveScheme(db), notes: [], aiCoaches: aiCoachAttributes(db),
  };
}

/**
 * Simula TODAS as partidas pendentes até a data atual do jogo, de forma atômica (tudo ou nada).
 * `live`: decisões do técnico na partida do usuário acompanhada ao vivo (as outras partidas não mudam).
 */
export function simulateMatchday(db: SqlDb, live?: LiveOptions): SimulationSummaryDto {
  const st = getCareerState(db);
  const rows = pendingFixtures(db, st.gameDate);
  const ctx = contextOf(db), notes = ctx.notes;
  const light = lightClubIds(db);
  const strength = new Map<string, number>();
  const strengthOf = (clubId: string) => {
    let s = strength.get(clubId);
    if (s === undefined) { s = teamStrength(db.prepare('SELECT overall FROM players WHERE club_id = ?').all(clubId).map((r) => N(r.overall))); strength.set(clubId, s); }
    return s;
  };
  const results = withTransaction(db, () => {
    const post = makePoster(db, st.clubId);
    const out = rows.map((f) => (light.has(f.homeId) && light.has(f.awayId) ? simulateLight(db, f, ctx, strengthOf) : simulateOne(db, f, { ...ctx, post }, live)));
    applyMatchesToBoard(db, out); // a partida do clube do usuário mexe na confiança da diretoria
    processSocialMatchday(db, st.gameDate, out.map((r) => r.fixtureId)); // rede social: resultados, zebras, hat-tricks, lesões, rodada
    return out;
  });
  return { date: st.gameDate, simulated: results.length, userMatch: results.find((r) => r.involvesUser) ?? null, results, notes };
}

export function getMatchReport(db: SqlDb, fixtureId: string): MatchReportDto {
  const m = db.prepare(`SELECT m.report_json, m.attendance, m.gate_revenue, (SELECT st.capacity FROM clubs h JOIN stadiums st ON st.id = h.stadium_id WHERE h.id = f.home_club_id) AS capacity,
    f.match_date, f.round, c.name AS competition_name FROM matches m JOIN fixtures f ON f.id = m.fixture_id
    JOIN competitions c ON c.id = f.competition_id WHERE m.fixture_id = ?`).get(fixtureId);
  if (!m) throw new Error('Relatório não encontrado: a partida ainda não foi disputada.');
  const r = JSON.parse(S(m.report_json)) as StoredReport;
  return dtoFromStored(db, r, { fixtureId, competitionName: S(m.competition_name), date: S(m.match_date), round: N(m.round),
    attendance: m.attendance == null ? null : { attendance: N(m.attendance), capacity: N(m.capacity), revenue: N(m.gate_revenue) } });
}

function dtoFromStored(db: SqlDb, r: StoredReport, meta: Pick<MatchReportDto, 'fixtureId' | 'competitionName' | 'date' | 'round' | 'attendance'>): MatchReportDto {
  const zero = { starter: false, subbedInAt: null, subbedOutAt: null, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, passes: 0, passesCompleted: 0, keyPasses: 0, tackles: 0, interceptions: 0, fouls: 0, yellow: 0, red: 0, saves: 0, goalsConceded: 0, xg: 0, injuredDays: 0 };
  const players = r.players.map((p) => ({ ...zero, ...p })) as PlayerReport[];
  const names = new Map(players.map((p) => [p.id, p.name]));
  const commentary = commentate(r.events, { teamNames: [r.home.name, r.away.name], playerName: (id) => (id ? names.get(id) ?? 'Jogador' : 'Jogador') });
  const mom = r.manOfTheMatch ? { id: r.manOfTheMatch, name: names.get(r.manOfTheMatch) ?? '' } : null;
  // força atual só dos jogadores do clube do usuário (de outros clubes o usuário só vê estimativas)
  const userClub = getCareerState(db).clubId;
  const levels: Record<string, number> = {};
  for (const row of db.prepare('SELECT id, overall FROM players WHERE club_id = ?').all(userClub)) if (names.has(S(row.id))) levels[S(row.id)] = N(row.overall);
  return {
    ...meta, detail: r.detail, home: r.home, away: r.away,
    homeGoals: r.homeGoals, awayGoals: r.awayGoals, decidedIn: r.decidedIn, shootout: r.shootout, conditions: r.conditions, duration: r.duration,
    stats: r.stats, players, lineups: r.lineups, commentary, manOfTheMatch: mom, tactics: r.tactics ?? null, timeline: r.timeline ?? null, levels, userClubId: userClub,
  };
}

/**
 * Prévia da partida do usuário de hoje com as decisões do técnico até agora. NÃO grava nada: a partida só é gravada
 * (com a rodada inteira, de forma atômica) por `simulateMatchday(db, live)` com as mesmas decisões — e o resultado é idêntico.
 */
export function previewUserMatch(db: SqlDb, live: LiveOptions): LiveMatchDto {
  const st = getCareerState(db);
  const f = pendingFixtures(db, st.gameDate).find((x) => x.homeId === st.clubId || x.awayId === st.clubId);
  if (!f) throw new UserError('Não há partida do seu clube para acompanhar hoje.');
  const ctx = contextOf(db);
  const prep = prepareFixture(db, f, ctx);
  const out = runFixture(f, ctx, prep, live);
  const side: 0 | 1 = f.homeId === st.clubId ? 0 : 1;
  const mine = side === 0 ? prep.hSheet : prep.aSheet;
  const overall = new Map(db.prepare('SELECT id, overall FROM players WHERE club_id = ?').all(st.clubId).map((r) => [S(r.id), N(r.overall)] as const));
  const squad = [...mine.lineup.map((l) => l.player), ...mine.bench];
  return {
    report: dtoFromStored(db, storedOf(f, ctx, prep, out), { fixtureId: f.id, competitionName: f.competitionName, date: f.date, round: f.round, attendance: null }),
    side, subsMax: 5, notes: ctx.notes,
    bench: mine.bench.map((p) => ({ id: p.id, name: p.name, position: p.position, overall: overall.get(p.id) ?? 0, condition: Math.round(p.condition) })),
    morale: Object.fromEntries(squad.map((p) => [p.id, { before: Math.round(p.morale), delta: out.moraleDelta[p.id] ?? 0 }])),
    suggestions: out.suggestions.map(({ team: _t, ...s }) => s),
  };
}
