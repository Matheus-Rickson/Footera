import type { SqlDb } from '../types.ts';
import { POS_NAME } from '../../shared/positions.ts';
import { withTransaction } from '../types.ts';
import { createRng, clamp } from '../../game/rng.ts';
import { conditionAfter, simulateMatch } from '../../game/match-engine/engine.ts';
import { sharpnessAfterMatch } from '../../game/training-engine/condition.ts';
import { effAcute, effSharp, sharpRateOf } from './fitnessState.ts';
import { MATCH_LOAD } from '../../game/training-engine/sessions.ts';
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
import { applyMatchesToBoard, fastForwarding } from './boardRepository.ts';
import { processSocialMatchday } from './socialRepository.ts';
import { quickKnockout, quickResult, teamStrength } from '../../game/match-engine/quickResult.ts';
import { advanceCups, applyCupCards, cupFixtureRule, cupSuspensions, recordCupResult, serveCupSuspension } from './cupRepository.ts';
import { advanceFormats, formatFixtureRule, recordFormatShootout } from './formatRepository.ts';
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
  /** copas (ausente em partidas de liga e em saves anteriores) */ cup?: MatchReportDto['cup']; extraTime?: boolean;
  conditions: MatchConditions; duration: number; stats: MatchOutcome['stats']; players: Array<Partial<PlayerReport>>;
  lineups: MatchOutcome['lineups']; events: MatchEvent[]; manOfTheMatch: string | null;
  tactics?: [TeamTactics, TeamTactics];
  /** só nas partidas do usuário (relatório completo); ausente em saves anteriores à lapidação */ timeline?: MatchTick[];
}

interface FixtureRow { id: string; competitionId: string; competitionName: string; round: number; date: string; homeId: string; awayId: string; homeName: string; awayName: string; cup?: ReturnType<typeof cupFixtureRule>;
  /** mata-mata de campeonato em fases (Séries C/D, estaduais): desempate do jogo decisivo; os cartões continuam os da liga */ ko?: ReturnType<typeof formatFixtureRule> }

function summaryOf(f: FixtureRow, hg: number, ag: number, userClub: string, hasReport = true): MatchSummaryDto {
  return { fixtureId: f.id, competitionName: f.competitionName, date: f.date, round: f.round, homeName: f.homeName, awayName: f.awayName, homeGoals: hg, awayGoals: ag, involvesUser: f.homeId === userClub || f.awayId === userClub, hasReport };
}

interface Ctx { seed: string; userClub: string; coach: Coach; scheme: SchemeDto | null; notes: string[]; aiCoaches?: Map<string, CoachAttributes> }
/** Decisões do técnico na partida acompanhada ao vivo. `controlUntil` null = o técnico decide a partida toda. */
export interface LiveOptions { interventions: LiveInterventionInput[]; controlUntil: number | null }

/** Monta os dois times (escalação, táticas) exatamente como na simulação definitiva. Só lê o banco. */
function prepareFixture(db: SqlDb, f: FixtureRow, ctx: Ctx) {
  const cupId = f.cup?.competitionId;
  const home = loadSquad(db, f.homeId, f.date, cupId ? cupSuspensions(db, cupId, f.homeId) : undefined), away = loadSquad(db, f.awayId, f.date, cupId ? cupSuspensions(db, cupId, f.awayId) : undefined);
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
    ...(f.cup ? { neutral: f.cup.neutral, ...(f.cup.decider ? { decider: f.cup.decider } : {}) } : {}),
    ...(f.ko ? { neutral: f.ko.neutral, ...(f.ko.decider ? { decider: f.ko.decider } : {}) } : {}),
    ...(live && involves ? { control: { team: side, until: live.controlUntil ?? Number.MAX_SAFE_INTEGER }, interventions: ivs } : {}),
  });
}

function storedOf(f: FixtureRow, ctx: Ctx, prep: ReturnType<typeof prepareFixture>, out: MatchOutcome): StoredReport {
  const involves = f.homeId === ctx.userClub || f.awayId === ctx.userClub;
  return {
    v: 1, detail: involves ? 'full' : 'compact',
    home: { clubId: f.homeId, name: f.homeName, formation: formationLabel(prep.hSheet.formation) }, away: { clubId: f.awayId, name: f.awayName, formation: formationLabel(prep.aSheet.formation) },
    homeGoals: out.homeGoals, awayGoals: out.awayGoals, decidedIn: out.decidedIn, shootout: out.shootout, winner: out.winner,
    extraTime: out.events.some((e) => e.type === 'period_end' && e.detail === 'extra1'),
    ...(f.cup ? { cup: { stage: f.cup.stageName, leg: f.cup.leg, aggregate: out.aggregate, neutral: f.cup.neutral } } : {}),
    ...(f.ko ? { cup: { stage: f.ko.stageName, leg: f.ko.leg, aggregate: out.aggregate, neutral: f.ko.neutral } } : {}),
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
  if (f.cup) recordCupResult(db, f.id, out, ctx.post);
  if (f.ko) recordFormatShootout(db, f.id, out);
  const report = storedOf(f, ctx, prep, out);
  db.prepare('INSERT INTO matches (fixture_id, seed, played_on, home_goals, away_goals, decided_in, detail, report_json) VALUES (?,?,?,?,?,?,?,?)')
    .run(f.id, `${ctx.seed}:${f.id}`, f.date, out.homeGoals, out.awayGoals, out.decidedIn, report.detail, JSON.stringify(report));
  // campo neutro: a renda é do organizador (final da Copa do Brasil, Copa Argentina), não de um dos clubes
  if (!f.cup?.neutral) recordGate(db, ctx.post, { id: f.id, date: f.date, homeId: f.homeId, awayId: f.awayId, awayName: f.awayName }, out.conditions.weather, ctx.seed);

  // ---- consequências nos jogadores ----
  const byId = new Map([...home.players, ...away.players].map((p) => [p.id, p]));
  const statusOf = (sq: Squad, id: string): Status => sq.status.get(id) ?? { injuryUntil: null, suspension: 0, yellows: 0 };
  const redKind = new Map(out.events.filter((e) => e.type === 'red_card').map((e) => [e.player!, e.detail === 'second_yellow' ? 1 : 2]));
  const upStatus = db.prepare(`INSERT INTO player_status (player_id, injury_until, injury_note, suspension_matches, yellow_cards) VALUES (?,?,?,?,?)
    ON CONFLICT(player_id) DO UPDATE SET injury_until = excluded.injury_until, injury_note = excluded.injury_note, suspension_matches = excluded.suspension_matches, yellow_cards = excluded.yellow_cards`);
  // ritmo de jogo e carga aguda (v0.8.12): jogar dá ritmo (+12 por 90 minutos) e soma à carga dos últimos dias
  // (valores preguiçosos: o do dia sai da fórmula a partir do gravado; o jogo grava o novo valor com a data — fitnessState.ts)
  const upPlayer = db.prepare(`UPDATE players SET condition_pct = ?, form = ?, morale = ?, sharpness = ?, sharp_on = ?, acute_load = ?, acute_on = ?,
    last_played = CASE WHEN ? > 0 THEN ? ELSE last_played END WHERE id = ?`);
  const fitRow = db.prepare('SELECT sharpness, sharp_on, last_played, acute_load, acute_on FROM players WHERE id = ?');
  const rates = new Map([[f.homeId, sharpRateOf(db, f.homeId)], [f.awayId, sharpRateOf(db, f.awayId)]]);
  const upStats = db.prepare(`INSERT INTO player_season_stats (player_id, competition_id, club_id, appearances, minutes, goals, assists, yellow_cards, red_cards, rating_sum, clean_sheets)
    VALUES (?,?,?,1,?,?,?,?,?,?,?) ON CONFLICT(player_id, competition_id) DO UPDATE SET appearances = appearances + 1, minutes = minutes + excluded.minutes,
    goals = goals + excluded.goals, assists = assists + excluded.assists, yellow_cards = yellow_cards + excluded.yellow_cards, red_cards = red_cards + excluded.red_cards, rating_sum = rating_sum + excluded.rating_sum,
    clean_sheets = clean_sheets + excluded.clean_sheets`);

  const medical = new Map([[f.homeId, medicalFactor(db, f.homeId)], [f.awayId, medicalFactor(db, f.awayId)]]);
  for (const r of out.players) {
    const p = byId.get(r.id)!;
    const sq = r.team === 0 ? home : away, clubId = r.team === 0 ? f.homeId : f.awayId;
    const result = (r.team === 0 ? out.homeGoals - out.awayGoals : out.awayGoals - out.homeGoals);
    const fr = fitRow.get(p.id)!;
    upPlayer.run(conditionAfter(p.condition, r.fatigue ?? 0, r.minutes),
      Math.round(clamp(0.7 * p.form + 0.3 * (50 + (r.rating - 6) * 15), 0, 100) * 10) / 10,
      clamp(p.morale + (result > 0 ? 3 : result < 0 ? -3 : 0), 10, 100),
      sharpnessAfterMatch(effSharp(fr, f.date, rates.get(clubId)!), r.minutes), f.date,
      Math.round((effAcute(fr, f.date) + (MATCH_LOAD * r.minutes) / 90) * 10) / 10, f.date, r.minutes, f.date, p.id);
    const conceded = r.team === 0 ? out.awayGoals : out.homeGoals;
    // jogo sem sofrer gol: o goleiro que ficou ao menos 60 minutos no gol
    upStats.run(p.id, f.competitionId, clubId, r.minutes, r.goals, r.assists, r.yellow, r.red, r.rating, r.slot === 'GK' && r.minutes >= 60 && conceded === 0 ? 1 : 0);
    if (r.role && r.minutes > 0) addFamiliarity(db, p, r.role, (ROLE_MATCH_GAIN * r.minutes) / 90); // aprende a função jogando
    const st = statusOf(sq, p.id);
    const LEAGUE_YELLOWS = 5;
    let y = st.yellows, susp = st.suspension, cupSusp: { before: number; after: number; byYellow: boolean } | null = null;
    if (f.cup) { // copa: cartões e suspensões valem só nela, com o limite do regulamento
      const before = st.suspension;
      const res = applyCupCards(db, f.cup.competitionId, p.id, r.yellow, r.red > 0 ? ((redKind.get(p.id) ?? 1) as 1 | 2) : 0, before > 0 && sq.suspendedOut.indexOf(p.id) < 0, f.cup.yellowLimit);
      cupSusp = { before, after: res.suspension, byYellow: res.byYellow };
      const ps = db.prepare('SELECT yellow_cards, suspension_matches FROM player_status WHERE player_id = ?').get(p.id);
      y = N(ps?.yellow_cards ?? 0); susp = N(ps?.suspension_matches ?? 0);
    } else {
      y += r.yellow;
      if (r.red > 0) susp += redKind.get(p.id) ?? 1;
      if (y >= LEAGUE_YELLOWS) { susp += 1; y -= LEAGUE_YELLOWS; }
      // quem estava suspenso e jogou (escalação de emergência) cumpre a suspensão
      if (st.suspension > 0 && sq.suspendedOut.indexOf(p.id) < 0) susp = Math.max(0, susp - 1);
    }
    const leagueStatus = f.cup ? { yellows: y, suspension: susp } : st;
    const injuredDays = r.injuredDays > 0 ? Math.max(1, Math.round(r.injuredDays * medical.get(clubId)!)) : 0; // médico e departamento médico encurtam
    const injuryUntil = injuredDays > 0 ? addDays(f.date, injuredDays) : st.injuryUntil;
    if (y !== leagueStatus.yellows || susp !== leagueStatus.suspension || injuryUntil !== st.injuryUntil || (f.cup && injuredDays > 0)) {
      upStatus.run(p.id, injuryUntil, injuredDays > 0 ? `Lesão (${injuredDays} dias)` : null, susp, y);
    }
    if (clubId === ctx.userClub) {
      const name = `${p.firstName} ${p.lastName}`, opp = clubId === f.homeId ? f.awayName : f.homeName;
      if (injuredDays > 0) addNews(db, f.date, 'medical', `Lesão: ${name} fora por ${injuredDays} dias`,
        `${name} (${POS_NAME[p.position].toLowerCase()}) se lesionou na partida contra o ${opp}. Previsão de retorno: ${injuryUntil!.split('-').reverse().join('/')} (${injuredDays} dias), já considerando o trabalho do departamento médico.\n\nAté lá ele fica fora das partidas. Revise a escalação e a função da vaga dele em Táticas.`,
        { actionLabel: 'Ajustar a escalação em Táticas' });
      const newSusp = cupSusp ? (cupSusp.after > Math.max(0, cupSusp.before - 1) ? cupSusp.after : 0) : susp > st.suspension && sq.suspendedOut.indexOf(p.id) < 0 ? susp : 0;
      if (newSusp > 0) addNews(db, f.date, 'squad', `Suspensão: ${name} cumpre ${newSusp} jogo(s)${cupSusp ? ` na ${f.competitionName}` : ''}`,
        `${name} ${r.red > 0 ? 'foi expulso' : `atingiu o limite de cartões amarelos (${cupSusp ? f.cup!.yellowLimit : LEAGUE_YELLOWS})`} na partida contra o ${opp} e está suspenso por ${newSusp} jogo(s)${cupSusp ? ` da ${f.competitionName} (a suspensão vale só nesta copa)` : ''}.\n\nEle não pode ser escalado na(s) próxima(s) partida(s)${cupSusp ? ' desta competição' : ''}. Defina o substituto em Táticas.`,
        { actionLabel: 'Ajustar a escalação em Táticas' });
    }
  }
  // a conversa no vestiário vale só durante esta partida (out.moraleDelta não é gravado)
  for (const [sq, id] of [[home, f.homeId], [away, f.awayId]] as const) {
    for (const pid of sq.suspendedOut) {
      if (f.cup) { serveCupSuspension(db, f.cup.competitionId, pid); continue; } // cumpriu a suspensão da copa (a da liga continua)
      const st = statusOf(sq, pid); upStatus.run(pid, st.injuryUntil, null, Math.max(0, st.suspension - 1), st.yellows);
    }
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
function simulateLight(db: SqlDb, f: FixtureRow, ctx: Ctx & { post: Poster }, strengthOf: (clubId: string) => number): MatchSummaryDto {
  const rng = createRng(`quick:${ctx.seed}:${f.id}`);
  // copa: mesma regra de desempate e de campo neutro das partidas completas
  if (f.cup?.decider) {
    const k = quickKnockout(strengthOf(f.homeId), strengthOf(f.awayId), rng, f.cup.decider, f.cup.neutral);
    applyResult(db, f.id, k.homeGoals, k.awayGoals);
    recordCupResult(db, f.id, k, ctx.post);
    return summaryOf(f, k.homeGoals, k.awayGoals, ctx.userClub, false);
  }
  if (f.ko?.decider) {
    const k = quickKnockout(strengthOf(f.homeId), strengthOf(f.awayId), rng, f.ko.decider, f.ko.neutral);
    applyResult(db, f.id, k.homeGoals, k.awayGoals);
    recordFormatShootout(db, f.id, k);
    return summaryOf(f, k.homeGoals, k.awayGoals, ctx.userClub, false);
  }
  const r = quickResult(strengthOf(f.homeId), strengthOf(f.awayId), rng);
  applyResult(db, f.id, r.homeGoals, r.awayGoals);
  if (f.cup) recordCupResult(db, f.id, { winner: null, decidedIn: 'regular', shootout: null }, ctx.post); // ida: só a cota
  return summaryOf(f, r.homeGoals, r.awayGoals, ctx.userClub, false);
}

function pendingFixtures(db: SqlDb, date: string): FixtureRow[] {
  return db.prepare(
    `SELECT f.id, f.competition_id, c.name AS competition_name, f.round, f.match_date, f.home_club_id, f.away_club_id, h.name AS home_name, a.name AS away_name
       FROM fixtures f JOIN competitions c ON c.id = f.competition_id JOIN clubs h ON h.id = f.home_club_id JOIN clubs a ON a.id = f.away_club_id
      WHERE f.status = 'scheduled' AND f.match_date <= ? ORDER BY f.match_date, f.id`).all(date)
    .map((r): FixtureRow => ({ id: S(r.id), competitionId: S(r.competition_id), competitionName: S(r.competition_name), round: N(r.round), date: S(r.match_date),
      homeId: S(r.home_club_id), awayId: S(r.away_club_id), homeName: S(r.home_name), awayName: S(r.away_name), cup: cupFixtureRule(db, S(r.id)), ko: formatFixtureRule(db, S(r.id)) }));
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
  // meses anteriores ao início da carreira (clube de ano civil): todo o mundo pelo resultado rápido, por força
  const allLight = fastForwarding(db);
  const strength = new Map<string, number>();
  const strengthOf = (clubId: string) => {
    let s = strength.get(clubId);
    if (s === undefined) { s = teamStrength(db.prepare('SELECT overall FROM players WHERE club_id = ?').all(clubId).map((r) => N(r.overall))); strength.set(clubId, s); }
    return s;
  };
  const results = withTransaction(db, () => {
    const post = makePoster(db, st.clubId);
    const out = rows.map((f) => (allLight || (light.has(f.homeId) && light.has(f.awayId)) ? simulateLight(db, f, { ...ctx, post }, strengthOf) : simulateOne(db, f, { ...ctx, post }, live)));
    advanceCups(db, st.gameDate); // copas: fase encerrada → sorteio da próxima (ou título), na mesma transação
    advanceFormats(db, st.gameDate); // campeonatos em fases (Séries C/D): fase definida → jogos da próxima, na mesma transação
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
  const comp = db.prepare("SELECT c.kind, c.league_id, json_extract(c.format_json, '$.format.id') AS fid FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE f.id = ?").get(meta.fixtureId);
  const logo: MatchReportDto['logo'] = !comp ? null : comp.kind === 'cup' ? (comp.fid == null ? null : { kind: 'cups', id: S(comp.fid) }) : comp.league_id == null ? null : { kind: 'leagues', id: S(comp.league_id) };
  const levels: Record<string, number> = {};
  for (const row of db.prepare('SELECT id, overall FROM players WHERE club_id = ?').all(userClub)) if (names.has(S(row.id))) levels[S(row.id)] = N(row.overall);
  return {
    ...meta, detail: r.detail, home: r.home, away: r.away,
    homeGoals: r.homeGoals, awayGoals: r.awayGoals, decidedIn: r.decidedIn, shootout: r.shootout, conditions: r.conditions, duration: r.duration,
    extraTime: r.extraTime ?? r.decidedIn !== 'regular', cup: r.cup ?? null, logo,
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
    side, subsMax: f.cup?.decider?.extraTimeSub ? 6 : 5, notes: ctx.notes,
    bench: mine.bench.map((p) => ({ id: p.id, name: p.name, position: p.position, overall: overall.get(p.id) ?? 0, condition: Math.round(p.condition) })),
    morale: Object.fromEntries(squad.map((p) => [p.id, { before: Math.round(p.morale), delta: out.moraleDelta[p.id] ?? 0 }])),
    suggestions: out.suggestions.map(({ team: _t, ...s }) => s),
  };
}
