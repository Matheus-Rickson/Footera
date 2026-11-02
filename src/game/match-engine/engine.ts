import { createRng, clamp, type Rng } from '../rng.ts';
import type { Position } from '../../shared/types.ts';
import { effective } from './roles.ts';
import { FORMATIONS } from './formations.ts';
import type {
  ChanceType, EventType, MatchConditions, MatchEvent, MatchOptions, MatchOutcome, MatchPlayer, PlayerReport,
  ShotOutcome, TeamSheet, TeamStats, TeamTactics,
} from './types.ts';

/** Constantes de calibração (ajustadas contra médias reais de futebol — ver docs e testes de calibração). */
export const K = {
  phasesPerMinute: 2.6,
  chance: 0.068,
  counterBoost: 1.55,
  foul: 0.085,
  offside: 0.016,
  injury: 0.00006,
  controlExp: 3,
  homeControl: 0.028,
  homeAttack: 1.11,
};

type Side = 0 | 1;
interface Live {
  p: MatchPlayer; slot: Position; x: number; y: number; fatigue: number; yellow: number; out: boolean; rep: PlayerReport;
}
interface Ratings { att: number; mid: number; def: number; gk: number; pass: number; aggression: number }
interface TeamState {
  idx: Side; sheet: TeamSheet; active: Live[]; all: Live[]; bench: MatchPlayer[]; subsUsed: number;
  stats: TeamStats; held: number; goals: number; r: Ratings;
}

const ZONE: Record<Position, { att: number; mid: number; def: number }> = {
  GK: { att: 0, mid: 0, def: 0 },
  CB: { att: 0, mid: 0, def: 1 },
  LB: { att: 0.1, mid: 0.1, def: 0.9 }, RB: { att: 0.1, mid: 0.1, def: 0.9 },
  DM: { att: 0, mid: 0.75, def: 0.45 },
  CM: { att: 0.1, mid: 1, def: 0.15 },
  AM: { att: 0.55, mid: 0.65, def: 0 },
  LW: { att: 0.85, mid: 0.3, def: 0 }, RW: { att: 0.85, mid: 0.3, def: 0 },
  ST: { att: 1, mid: 0, def: 0 },
};
const REF = (() => {
  const t = { att: 0, mid: 0, def: 0 };
  for (const s of FORMATIONS[0]!.slots) { t.att += ZONE[s.pos].att; t.mid += ZONE[s.pos].mid; t.def += ZONE[s.pos].def; }
  return t;
})();

const SHOOTER_W: Record<Position, number> = { GK: 0, CB: 0.03, LB: 0.1, RB: 0.1, DM: 0.1, CM: 0.28, AM: 0.65, LW: 0.6, RW: 0.6, ST: 1 };
const HEADER_W: Record<Position, number> = { GK: 0, CB: 0.12, LB: 0.05, RB: 0.05, DM: 0.1, CM: 0.2, AM: 0.35, LW: 0.25, RW: 0.25, ST: 1 };
const CORNER_W: Record<Position, number> = { GK: 0, CB: 0.8, LB: 0.2, RB: 0.2, DM: 0.3, CM: 0.3, AM: 0.2, LW: 0.15, RW: 0.15, ST: 1 };
const LONG_W: Record<Position, number> = { GK: 0, CB: 0.05, LB: 0.15, RB: 0.15, DM: 0.5, CM: 0.7, AM: 1, LW: 0.6, RW: 0.6, ST: 0.4 };
const PASSER_W: Record<Position, number> = { GK: 0.05, CB: 0.15, LB: 0.6, RB: 0.6, DM: 0.5, CM: 0.9, AM: 1, LW: 0.9, RW: 0.9, ST: 0.4 };
const FOUL_W: Record<Position, number> = { GK: 0.02, CB: 1, LB: 0.9, RB: 0.9, DM: 1.1, CM: 1, AM: 0.5, LW: 0.45, RW: 0.45, ST: 0.4 };
const VICTIM_W: Record<Position, number> = { GK: 0, CB: 0.15, LB: 0.4, RB: 0.4, DM: 0.5, CM: 0.8, AM: 1, LW: 1, RW: 1, ST: 0.9 };
const TACKLE_W: Record<Position, number> = { GK: 0, CB: 1, LB: 0.9, RB: 0.9, DM: 1.2, CM: 0.8, AM: 0.3, LW: 0.25, RW: 0.25, ST: 0.15 };
const CHANCE_BASE_XG: Record<ChanceType, number> = { buildup: 0.115, cross: 0.075, long: 0.042, counter: 0.19, corner: 0.07, freekick: 0.055, penalty: 0.76 };

const emptyStats = (): TeamStats => ({
  possession: 0, shots: 0, shotsOnTarget: 0, shotsBlocked: 0, chancesCreated: 0, xg: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0,
  offsides: 0, passes: 0, passesCompleted: 0, tackles: 0, interceptions: 0, saves: 0,
});

const a20 = (v: number) => v / 20;

function newReport(p: MatchPlayer, team: Side, slot: Position, starter: boolean, at: number): PlayerReport {
  return {
    id: p.id, name: p.name, team, slot, position: p.position, starter, minutes: 0, subbedInAt: starter ? null : at, subbedOutAt: null, rating: 6,
    goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, passes: 0, passesCompleted: 0, keyPasses: 0, tackles: 0, interceptions: 0, fouls: 0,
    yellow: 0, red: 0, saves: 0, goalsConceded: 0, xg: 0, injuredDays: 0,
  };
}

export function simulateMatch(home: TeamSheet, away: TeamSheet, opts: MatchOptions): MatchOutcome {
  const rng: Rng = createRng(`match:${opts.seed}`);
  const conditions: MatchConditions = opts.conditions ?? { weather: 'clear', pitch: 'good' };
  const hAdv = opts.neutral ? 0 : 1;
  const events: MatchEvent[] = [];
  const clock = { minute: 0, label: "0'" };

  const mk = (sheet: TeamSheet, idx: Side): TeamState => {
    const all = sheet.lineup.map((l) => ({
      p: l.player, slot: l.slot, x: l.x, y: l.y, fatigue: 0, yellow: 0, out: false, rep: newReport(l.player, idx, l.slot, true, 0),
    }));
    return {
      idx, sheet, active: [...all], all, bench: [...sheet.bench], subsUsed: 0, stats: emptyStats(), held: 0, goals: 0,
      r: { att: 0, mid: 0, def: 0, gk: 0, pass: 0, aggression: 0 },
    };
  };
  const T: [TeamState, TeamState] = [mk(home, 0), mk(away, 1)];
  // Forma do dia (evento aleatório controlado): ±8% no máximo, independente por equipe e constante na partida.
  const dayForm: [number, number] = [clamp(rng.normal(1, 0.04), 0.92, 1.08), clamp(rng.normal(1, 0.04), 0.92, 1.08)];

  const emit = (type: EventType, team: Side, extra: Partial<MatchEvent> = {}): MatchEvent => {
    const e: MatchEvent = { i: events.length, minute: clock.minute, label: clock.label, type, team, ...extra };
    events.push(e);
    return e;
  };

  const fatigueMul = (l: Live) => 1 - 0.0035 * l.fatigue;

  // ---------- ratings ----------
  const refresh = (t: TeamState, o: TeamState): void => {
    const sum = { att: 0, mid: 0, def: 0 }, w = { att: 0, mid: 0, def: 0 };
    let gk = 45, pass = 0, passN = 0, aggr = 0;
    for (const l of t.active) {
      const eff = effective(l.p, l.slot) * fatigueMul(l);
      const z = ZONE[l.slot];
      for (const k of ['att', 'mid', 'def'] as const) { sum[k] += z[k] * eff; w[k] += z[k]; }
      if (l.slot === 'GK') gk = eff;
      else {
        const a = l.p.attributes;
        pass += ((a.technical.passing * 0.5 + a.mental.vision * 0.25 + a.technical.firstTouch * 0.25) / 20) * 100 * fatigueMul(l);
        passN++;
      }
      aggr += a20(l.p.attributes.mental.aggression);
    }
    const zone = (k: 'att' | 'mid' | 'def') => (w[k] > 0 ? (sum[k] / w[k]) * Math.pow(Math.max(w[k], 0.5) / REF[k], 0.5) : 20);
    const tac = t.sheet.tactics;
    const lead = t.goals - o.goals;
    const late = clock.minute >= 70 ? (clock.minute - 60) / 30 : 0; // urgência cresce no fim
    const urgency = lead < 0 ? 1 + 0.05 * late * Math.min(-lead, 2) : lead > 0 ? 1 - 0.04 * late : 1;
    const ment = tac.mentality === 'attacking' ? { a: 1.06, d: 0.965 } : tac.mentality === 'defensive' ? { a: 0.94, d: 1.05 } : { a: 1, d: 1 };
    t.r = {
      att: zone('att') * ment.a * urgency * t.sheet.cohesion * dayForm[t.idx] * (t.idx === 0 ? Math.pow(K.homeAttack, hAdv) : 1),
      mid: zone('mid') * t.sheet.cohesion * dayForm[t.idx] * (1 + 0.012 * (tac.defensiveLine - 3)),
      def: zone('def') * ment.d / Math.sqrt(urgency) * t.sheet.cohesion * dayForm[t.idx],
      gk, pass: passN ? pass / passN : 40, aggression: t.active.length ? aggr / t.active.length : 0.5,
    };
  };

  // ---------- helpers ----------
  const pickLive = (t: TeamState, weight: (l: Live) => number, exclude?: Live): Live | null => {
    const cands = t.active.filter((l) => l !== exclude);
    if (!cands.length) return null;
    const ws = cands.map((l) => Math.max(weight(l), 0.0001));
    return rng.weighted(cands, ws);
  };

  const removeFromPitch = (t: TeamState, l: Live): void => {
    l.out = true;
    t.active = t.active.filter((x) => x !== l);
  };

  const ensureGoalkeeper = (t: TeamState): void => {
    if (t.active.some((l) => l.slot === 'GK') || t.active.length === 0) return;
    const gkBench = t.bench.filter((b) => b.position === 'GK');
    if (gkBench.length && t.subsUsed < 5) {
      const victim = [...t.active].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0]!;
      doSub(t, victim, gkBench[0]!, 'GK', 'gk_replacement');
      return;
    }
    const emergency = [...t.active].sort((a, b) => b.p.attributes.technical.goalkeeping - a.p.attributes.technical.goalkeeping)[0]!;
    emergency.slot = 'GK';
  };

  const doSub = (t: TeamState, out: Live, inP: MatchPlayer, slot: Position, detail?: string): void => {
    const m = clock.minute;
    out.rep.subbedOutAt = m;
    removeFromPitch(t, out);
    t.bench = t.bench.filter((b) => b.id !== inP.id);
    t.subsUsed++;
    const live: Live = { p: inP, slot, x: out.x, y: out.y, fatigue: 0, yellow: 0, out: false, rep: newReport(inP, t.idx, slot, false, m) };
    t.active.push(live); t.all.push(live);
    emit('substitution', t.idx, { player: inP.id, player2: out.p.id, detail });
  };

  const bestBenchFor = (t: TeamState, slot: Position): MatchPlayer | null => {
    const pool = t.bench.filter((b) => (slot === 'GK' ? b.position === 'GK' : b.position !== 'GK'));
    if (!pool.length) return null;
    return [...pool].sort((a, b) => effective(b, slot) - effective(a, slot))[0]!;
  };

  // ---------- eventos básicos ----------
  const attrScore = (p: MatchPlayer, kind: 'finish' | 'header' | 'long' | 'pass'): number => {
    const a = p.attributes;
    if (kind === 'finish') return a20(a.technical.finishing) * 0.6 + a20(a.mental.composure) * 0.2 + a20(a.mental.positioning) * 0.2;
    if (kind === 'header') return a20(a.technical.heading) * 0.6 + a20(a.physical.jumping) * 0.4;
    if (kind === 'long') return a20(a.technical.longShots) * 0.6 + a20(a.technical.passing) * 0.2 + a20(a.mental.composure) * 0.2;
    return a20(a.technical.passing) * 0.5 + a20(a.mental.vision) * 0.5;
  };

  const handleInjury = (t: TeamState, l: Live): void => {
    const days = rng.weighted([2, 5, 10, 21, 45, 90], [30, 28, 20, 12, 7, 3]);
    l.rep.injuredDays = days;
    emit('injury', t.idx, { player: l.p.id, days });
    const wasGk = l.slot === 'GK';
    const repl = bestBenchFor(t, l.slot);
    if (repl && t.subsUsed < 5) doSub(t, l, repl, l.slot, 'injury');
    else { l.rep.subbedOutAt = clock.minute; removeFromPitch(t, l); if (wasGk) ensureGoalkeeper(t); }
  };

  const giveCard = (t: TeamState, l: Live, force?: 'red'): void => {
    const o = T[1 - t.idx as Side];
    if (!force) {
      l.yellow++;
      l.rep.yellow++; t.stats.yellowCards++;
      emit('yellow_card', t.idx, { player: l.p.id });
      if (l.yellow < 2) return;
      if (t.active.length <= 7) { l.yellow = 1; return; } // nunca abaixo de 7 jogadores
      emit('red_card', t.idx, { player: l.p.id, detail: 'second_yellow' });
    } else emit('red_card', t.idx, { player: l.p.id, detail: 'straight' });
    l.rep.red++; t.stats.redCards++;
    l.rep.subbedOutAt = clock.minute;
    const wasGk = l.slot === 'GK';
    removeFromPitch(t, l);
    if (wasGk) ensureGoalkeeper(t);
    refresh(t, o); refresh(o, t);
  };

  // ---------- finalizações ----------
  const afterShotCorner = (att: TeamState, def: TeamState, p: number): void => {
    if (!rng.chance(p)) return;
    att.stats.corners++;
    emit('corner', att.idx);
    if (rng.chance(0.2)) shoot(att, def, 'corner');
  };

  const registerGoal = (att: TeamState, shooter: Live, passer: Live | null, chance: ChanceType, xg: number, def: TeamState): void => {
    att.goals++;
    shooter.rep.goals++;
    if (passer) passer.rep.assists++;
    const gk = def.active.find((l) => l.slot === 'GK');
    if (gk) gk.rep.goalsConceded++;
    emit('goal', att.idx, { player: shooter.p.id, player2: passer?.p.id, chance, outcome: 'goal', xg: Math.round(xg * 100) / 100 });
    refresh(att, def); refresh(def, att);
  };

  const shoot = (att: TeamState, def: TeamState, type: ChanceType): void => {
    const weights = type === 'cross' ? HEADER_W : type === 'corner' ? CORNER_W : type === 'long' || type === 'freekick' ? LONG_W : SHOOTER_W;
    const kind = type === 'cross' || type === 'corner' ? 'header' : type === 'long' || type === 'freekick' ? 'long' : 'finish';
    const shooter = pickLive(att, (l) => weights[l.slot] * Math.pow(0.3 + attrScore(l.p, kind), 2));
    if (!shooter) return;
    const passer = type === 'buildup' || type === 'cross' || type === 'counter'
      ? pickLive(att, (l) => PASSER_W[l.slot] * Math.pow(0.3 + attrScore(l.p, 'pass'), 2), shooter) : null;
    const skill = attrScore(shooter.p, kind) * fatigueMul(shooter);
    const finishMod = 0.55 + 0.9 * skill;
    const ctxMod = clamp(Math.pow(att.r.att / Math.max(def.r.def, 1), 0.55), 0.65, 1.5);
    const gkMod = clamp(Math.pow(60 / Math.max(def.r.gk, 15), 0.9), 0.75, 2.2); // jogador de linha no gol sofre muito mais
    const wx = conditions.weather === 'rain' ? 0.95 : 1;
    const xg = clamp(CHANCE_BASE_XG[type] * finishMod * ctxMod * gkMod * wx, 0.01, 0.85);
    const pBlock = clamp((type === 'freekick' ? 0.28 : type === 'long' ? 0.14 : type === 'counter' ? 0.1 : 0.2) * Math.pow(clamp(def.r.def / att.r.att, 0.7, 1.4), 0.8), 0.04, 0.4);
    const pOff = clamp(0.58 - 0.25 * (skill - 0.5), 0.4, 0.7);
    const pOn = (1 - pBlock) * (1 - pOff);
    const g = clamp(xg / pOn, 0.01, 0.97);

    att.stats.shots++; att.stats.xg += xg; shooter.rep.shots++; shooter.rep.xg += xg;
    if (passer) { passer.rep.keyPasses++; att.stats.chancesCreated++; }
    let outcome: ShotOutcome;
    const r = rng.next();
    if (r < pBlock) { outcome = 'blocked'; att.stats.shotsBlocked++; }
    else if (rng.next() < pOff) outcome = rng.chance(0.07) ? 'post' : 'off_target';
    else {
      att.stats.shotsOnTarget++; shooter.rep.shotsOnTarget++;
      outcome = rng.next() < g ? 'goal' : 'saved';
    }
    if (outcome === 'goal') { registerGoal(att, shooter, rng.chance(0.85) ? passer : null, type, xg, def); return; }
    const keeper = def.active.find((l) => l.slot === 'GK');
    if (outcome === 'saved' && keeper) { keeper.rep.saves++; def.stats.saves++; }
    emit('shot', att.idx, { player: shooter.p.id, player2: outcome === 'saved' ? keeper?.p.id : undefined, chance: type, outcome, xg: Math.round(xg * 100) / 100 });
    lastHolder = null;
    afterShotCorner(att, def, outcome === 'saved' ? 0.42 : outcome === 'blocked' ? 0.45 : outcome === 'post' ? 0.5 : 0.1);
  };

  const penalty = (att: TeamState, def: TeamState, fouled: Live | null): void => {
    emit('penalty_awarded', att.idx, { player2: fouled?.p.id });
    const taker = pickLive(att, (l) => (l.slot === 'GK' ? 0 : Math.pow(0.2 + attrScore(l.p, 'finish') + a20(l.p.attributes.mental.composure) * 0.3, 3)));
    const keeper = def.active.find((l) => l.slot === 'GK');
    if (!taker) return;
    const skill = attrScore(taker.p, 'finish') * 0.7 + a20(taker.p.attributes.mental.composure) * 0.3;
    const pGoal = clamp(0.74 + 0.2 * (skill - 0.5) - 0.12 * ((def.r.gk - 60) / 40), 0.55, 0.9);
    att.stats.shots++; att.stats.xg += 0.76; taker.rep.shots++; taker.rep.xg += 0.76;
    const r = rng.next();
    if (r < pGoal) { att.stats.shotsOnTarget++; taker.rep.shotsOnTarget++; registerGoal(att, taker, null, 'penalty', 0.76, def); }
    else if (r < pGoal + (1 - pGoal) * 0.62) {
      att.stats.shotsOnTarget++; taker.rep.shotsOnTarget++;
      if (keeper) { keeper.rep.saves++; def.stats.saves++; }
      emit('shot', att.idx, { player: taker.p.id, player2: keeper?.p.id, chance: 'penalty', outcome: 'saved', xg: 0.76 });
    } else emit('shot', att.idx, { player: taker.p.id, chance: 'penalty', outcome: rng.chance(0.3) ? 'post' : 'off_target', xg: 0.76 });
    lastHolder = null;
  };

  const foul = (att: TeamState, def: TeamState): void => {
    const fouler = pickLive(def, (l) => FOUL_W[l.slot] * (0.4 + a20(l.p.attributes.mental.aggression)) * (l.yellow > 0 ? 0.3 : 1));
    const victim = pickLive(att, (l) => VICTIM_W[l.slot] * (0.4 + a20(l.p.attributes.technical.dribbling)));
    if (!fouler) return;
    def.stats.fouls++; fouler.rep.fouls++;
    emit('foul', def.idx, { player: fouler.p.id, player2: victim?.p.id });
    const inBox = rng.chance(0.014 * clamp(att.r.att / Math.max(def.r.def, 1), 0.6, 1.6));
    const aggr = a20(fouler.p.attributes.mental.aggression);
    const pYellow = clamp(0.065 + 0.125 * aggr + (inBox ? 0.12 : 0), 0.03, 0.5);
    const pRed = 0.0012 + 0.0026 * aggr;
    const canRed = def.active.length > 8;
    const rc = rng.next();
    if (canRed && rc < pRed) giveCard(def, fouler, 'red');
    else if (rc < pRed + pYellow) giveCard(def, fouler);
    lastHolder = null;
    if (inBox) penalty(att, def, victim);
    else if (rng.chance(0.16)) shoot(att, def, 'freekick');
  };

  const offside = (att: TeamState): void => {
    const p = pickLive(att, (l) => (l.slot === 'ST' ? 1 : l.slot === 'LW' || l.slot === 'RW' ? 0.8 : l.slot === 'AM' ? 0.4 : 0.05) * (0.3 + a20(l.p.attributes.physical.pace)));
    if (!p) return;
    att.stats.offsides++;
    emit('offside', att.idx, { player: p.p.id });
    lastHolder = null;
  };

  // ---------- fases de posse ----------
  let lastHolder: Side | null = null;
  let pHome = 0.5;

  const passing = (att: TeamState, def: TeamState): void => {
    const tac = att.sheet.tactics;
    const dtac = def.sheet.tactics;
    const style = tac.buildUp === 'short' ? 1.12 : tac.buildUp === 'long' ? 0.8 : 1;
    const n = clamp(Math.round(rng.normal(3.4 * style * (1 + 0.06 * (tac.tempo - 3)), 1.2)), 1, 9);
    let acc = 0.58 + 0.42 * (att.r.pass / 100);
    acc -= 0.018 * (dtac.pressing - 3);
    acc += tac.buildUp === 'short' ? 0.03 : tac.buildUp === 'long' ? -0.08 : 0;
    acc -= (conditions.weather === 'rain' ? 0.025 : 0) + (conditions.pitch === 'poor' ? 0.02 : 0);
    acc = clamp(acc, 0.5, 0.94);
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const who = pickLive(att, (l) => PASSER_W[l.slot] + 0.1);
      const success = rng.next() < acc;
      if (who) { who.rep.passes++; if (success) who.rep.passesCompleted++; }
      if (success) ok++;
    }
    att.stats.passes += n; att.stats.passesCompleted += ok;
  };

  const phase = (): void => {
    const h: Side = rng.next() < pHome ? 0 : 1;
    const att = T[h], def = T[1 - h as Side];
    att.held++;
    const counter = lastHolder !== null && lastHolder !== h;
    if (counter && rng.chance(0.54)) {
      const tackle = rng.chance(0.6);
      const who = pickLive(att, (l) => TACKLE_W[l.slot] * (0.3 + a20(tackle ? l.p.attributes.technical.tackling : l.p.attributes.mental.positioning)));
      if (who) {
        if (tackle) { who.rep.tackles++; att.stats.tackles++; } else { who.rep.interceptions++; att.stats.interceptions++; }
      }
    }
    lastHolder = h;
    passing(att, def);

    const atac = att.sheet.tactics, dtac = def.sheet.tactics;
    const pFoul = K.foul * (0.75 + 0.5 * def.r.aggression) * (1 + 0.06 * (dtac.pressing - 3));
    const pOffside = K.offside * (1 + 0.18 * (dtac.defensiveLine - 3));
    const ratio = clamp(Math.pow(att.r.att / Math.max(def.r.def, 1), 1.6), 0.4, 2.4);
    const mentMod = atac.mentality === 'attacking' ? 1.1 : atac.mentality === 'defensive' ? 0.88 : 1;
    const pChance = K.chance * ratio * mentMod * (counter ? K.counterBoost * (1 + 0.12 * (dtac.defensiveLine - 3)) : 1);
    const r = rng.next();
    if (r < pFoul) foul(att, def);
    else if (r < pFoul + pOffside) offside(att);
    else if (r < pFoul + pOffside + pChance) {
      const wc = atac.buildUp === 'long';
      const type = rng.weighted<ChanceType>(
        ['buildup', 'cross', 'long', 'counter'],
        [0.48 + (atac.buildUp === 'short' ? 0.12 : wc ? -0.1 : 0), 0.22 + 0.04 * (atac.width - 3) + (wc ? 0.06 : 0),
          0.18 - 0.02 * (atac.width - 3) + (wc ? 0.04 : 0), counter ? 0.8 : 0.0001],
      );
      shoot(att, def, type);
    } else if (r < pFoul + pOffside + pChance + 0.018 * ratio) {
      att.stats.corners++;
      emit('corner', att.idx);
      lastHolder = null;
      if (rng.chance(0.2)) shoot(att, def, 'corner');
    }
  };

  // ---------- tempo ----------
  const addFatigue = (t: TeamState, intensity: number): void => {
    const tac = t.sheet.tactics;
    const heat = conditions.weather === 'heat' ? 0.06 : conditions.weather === 'cold' ? -0.02 : 0;
    const load = (0.3 + 0.05 * (tac.tempo - 3) + 0.06 * (tac.pressing - 3) + heat) * intensity;
    for (const l of t.active) {
      const sta = 1.5 - a20(l.p.attributes.physical.stamina) * 0.9 - (a20(l.p.attributes.physical.naturalFitness) - 0.5) * 0.2;
      l.fatigue += Math.max(load * sta, 0.05);
    }
  };

  const aiSubs = (t: TeamState, minute: number): void => {
    if (t.subsUsed >= 5 || !t.bench.length) return;
    const o = T[1 - t.idx as Side];
    const lead = t.goals - o.goals;
    let limit = minute <= 62 ? 1 : 2;
    const outfield = t.active.filter((l) => l.slot !== 'GK');
    if (minute >= 66 && lead < 0) {
      const out = [...outfield.filter((l) => ZONE[l.slot].def > 0 || l.slot === 'DM')].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const inP = t.bench.filter((b) => b.position === 'ST' || b.position === 'LW' || b.position === 'RW' || b.position === 'AM').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (out && inP) { doSub(t, out, inP, inP.position); limit--; refresh(t, o); }
    } else if (minute >= 74 && lead > 0) {
      const out = [...outfield.filter((l) => ZONE[l.slot].att >= 0.85)].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const inP = t.bench.filter((b) => b.position === 'CB' || b.position === 'DM' || b.position === 'LB' || b.position === 'RB').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (out && inP) { doSub(t, out, inP, inP.position); limit--; refresh(t, o); }
    }
    while (limit > 0 && t.subsUsed < 5 && t.bench.length) {
      const cands = t.active.filter((l) => l.slot !== 'GK')
        .map((l) => ({ l, cur: effective(l.p, l.slot) * fatigueMul(l), bench: bestBenchFor(t, l.slot) }))
        .filter((c) => c.bench && effective(c.bench, c.l.slot) > c.cur * 1.02)
        .sort((a, b) => a.cur / effective(a.bench!, a.l.slot) - b.cur / effective(b.bench!, b.l.slot));
      const pick = cands[0];
      if (!pick) break;
      doSub(t, pick.l, pick.bench!, pick.l.slot);
      limit--;
    }
  };

  const SUB_MINUTES = new Set([58, 66, 74, 82]);
  const tick = (minute: number, label: string, etFactor: number, added: boolean): void => {
    clock.minute = minute; clock.label = label;
    refresh(T[0], T[1]); refresh(T[1], T[0]);
    for (const t of T) addFatigue(t, etFactor > 1 ? 1.15 : 1);
    for (const t of T) {
      for (const l of [...t.active]) {
        const nf = a20(l.p.attributes.physical.naturalFitness);
        const p = K.injury * (1 + (1 - nf) * 0.8) * (1 + l.fatigue / 60);
        if (rng.next() < p) { handleInjury(t, l); refresh(T[0], T[1]); refresh(T[1], T[0]); }
      }
    }
    if (!added && SUB_MINUTES.has(minute % 90 === 0 ? 90 : minute)) { aiSubs(T[0], minute); aiSubs(T[1], minute); refresh(T[0], T[1]); refresh(T[1], T[0]); }
    const cA = Math.pow(T[0].r.mid * (1 + 0.01 * (T[0].sheet.tactics.tempo - 3)) * (1 - 0.018 * (T[1].sheet.tactics.pressing - 3)), K.controlExp);
    const cB = Math.pow(T[1].r.mid * (1 + 0.01 * (T[1].sheet.tactics.tempo - 3)) * (1 - 0.018 * (T[0].sheet.tactics.pressing - 3)), K.controlExp);
    pHome = clamp(cA / (cA + cB) + K.homeControl * hAdv, 0.22, 0.78);
    const mean = K.phasesPerMinute * (1 + 0.05 * ((T[0].sheet.tactics.tempo + T[1].sheet.tactics.tempo) / 2 - 3)) * (etFactor > 1 ? 0.9 : 1);
    const n = Math.floor(mean) + (rng.next() < mean - Math.floor(mean) ? 1 : 0);
    for (let i = 0; i < n; i++) phase();
  };

  const stoppage = (from: number): number => {
    let score = 0;
    for (const e of events.slice(from)) {
      if (e.type === 'goal') score += 0.8;
      else if (e.type === 'substitution') score += 0.5;
      else if (e.type === 'injury') score += 1.5;
      else if (e.type === 'yellow_card' || e.type === 'red_card') score += 0.3;
      else if (e.type === 'foul') score += 0.08;
      else if (e.type === 'penalty_awarded') score += 0.8;
    }
    return clamp(1 + Math.round(score + rng.float(-0.6, 0.6)), 1, 8);
  };

  let lastMinute = 0;
  const runPeriod = (from: number, to: number, tag: string, etFactor: number): void => {
    const start = events.length;
    for (let m = from; m <= to; m++) tick(m, `${m}'`, etFactor, false);
    const extra = etFactor > 1 ? clamp(Math.round(stoppage(start) / 2), 1, 3) : stoppage(start);
    for (let k = 1; k <= extra; k++) tick(to, `${to}+${k}'`, etFactor, true);
    clock.minute = to; clock.label = `${to}+${extra}'`;
    emit('period_end', 0, { detail: tag });
    lastMinute = to + extra;
  };

  runPeriod(1, 45, 'halftime', 1);
  runPeriod(46, 90, 'fulltime', 1);
  let decidedIn: MatchOutcome['decidedIn'] = 'regular';
  let shootout: MatchOutcome['shootout'] = null;
  let winner: 0 | 1 | null = T[0].goals > T[1].goals ? 0 : T[1].goals > T[0].goals ? 1 : null;
  let endMinute = 90;

  if (winner === null && opts.knockout) {
    decidedIn = 'extra_time';
    runPeriod(91, 105, 'extra1', 1.3);
    runPeriod(106, 120, 'extra2', 1.3);
    endMinute = 120;
    winner = T[0].goals > T[1].goals ? 0 : T[1].goals > T[0].goals ? 1 : null;
    if (winner === null) {
      decidedIn = 'penalties';
      const res = { 0: 0, 1: 0 } as Record<Side, number>;
      const order = ([0, 1] as Side[]).map((s) => {
        const takers = T[s].active.filter((l) => l.slot !== 'GK')
          .sort((a, b) => (attrScore(b.p, 'finish') + a20(b.p.attributes.mental.composure)) - (attrScore(a.p, 'finish') + a20(a.p.attributes.mental.composure)));
        const gk = T[s].active.find((l) => l.slot === 'GK');
        return { takers: takers.length ? takers : T[s].active, gk };
      });
      const kick = (s: Side, n: number): boolean => {
        const takers = order[s]!.takers;
        const taker = takers[n % takers.length]!;
        const gk = order[1 - s]!.gk;
        const skill = attrScore(taker.p, 'finish') * 0.5 + a20(taker.p.attributes.mental.composure) * 0.5;
        const gkSkill = gk ? effective(gk.p, 'GK') / 100 : 0.4;
        const pg = clamp(0.74 + 0.22 * (skill - 0.5) - 0.12 * (gkSkill - 0.6), 0.5, 0.92);
        const scored = rng.next() < pg;
        if (scored) res[s]++;
        emit('shootout_kick', s, { player: taker.p.id, scored });
        return scored;
      };
      let round = 0;
      for (; round < 5; round++) {
        kick(0, round); kick(1, round);
        const left0 = 5 - round - 1, left1 = left0;
        if (res[0] > res[1] + left1 || res[1] > res[0] + left0) break;
      }
      for (let n = 5; res[0] === res[1] && n < 60; n++) { kick(0, n); kick(1, n); }
      if (res[0] === res[1]) res[rng.chance(0.5) ? 0 : 1]++;
      shootout = { home: res[0], away: res[1] };
      winner = res[0] > res[1] ? 0 : 1;
    }
  }

  // ---------- fechamento: minutos, estatísticas e notas ----------
  const totalHeld = T[0].held + T[1].held || 1;
  for (const t of T) t.stats.possession = Math.round((t.held / totalHeld) * 1000) / 10;
  for (const t of T) for (const l of t.all) {
    const from = l.rep.subbedInAt ?? 0, to = l.rep.subbedOutAt ?? endMinute;
    l.rep.minutes = clamp(to - from, 0, 120);
  }
  const reports: PlayerReport[] = [];
  for (const t of T) {
    const o = T[1 - t.idx as Side];
    const result = t.goals > o.goals ? 0.3 : t.goals < o.goals ? -0.3 : 0;
    for (const l of t.all) {
      const r = l.rep;
      const defender = ['CB', 'LB', 'RB'].includes(r.slot);
      let rating = 6 + result
        + Math.min(r.goals, 3) * 1.1 + Math.min(r.assists, 3) * 0.7 + Math.min(r.keyPasses, 4) * 0.12
        + Math.min(r.tackles, 5) * 0.12 + Math.min(r.interceptions, 5) * 0.1
        + (r.slot === 'GK' ? r.saves * 0.28 - r.goalsConceded * 0.3 : defender ? -0.18 * o.goals * (r.minutes / 90) : 0)
        + (o.goals === 0 && (defender || r.slot === 'GK' || r.slot === 'DM') ? 0.45 * (r.minutes / 90) : 0)
        - 0.05 * Math.max(r.shots - r.shotsOnTarget - r.goals, 0) - 0.3 * r.yellow - 1.5 * r.red - 0.08 * Math.max(r.fouls - 2, 0)
        + (r.passes >= 10 ? (r.passesCompleted / r.passes - 0.8) * 1.5 : 0);
      if (r.minutes < 25) rating = 6 + (rating - 6) * (r.minutes / 25);
      r.rating = Math.round(clamp(rating, 3, 10) * 10) / 10;
      reports.push(r);
    }
  }
  const best = [...reports].filter((r) => r.minutes >= 45).sort((a, b) => b.rating - a.rating || b.goals - a.goals)[0];

  return {
    seed: opts.seed, homeGoals: T[0].goals, awayGoals: T[1].goals, decidedIn, shootout, winner, events,
    stats: [T[0].stats, T[1].stats], players: reports,
    lineups: T.map((t) => ({
      clubId: t.sheet.clubId, name: t.sheet.name, formation: t.sheet.formation,
      slots: t.sheet.lineup.map((l) => ({ slot: l.slot, x: l.x, y: l.y, playerId: l.player.id })),
    })),
    conditions, duration: lastMinute, manOfTheMatch: best?.id ?? null,
  };
}

export type { TeamTactics };
