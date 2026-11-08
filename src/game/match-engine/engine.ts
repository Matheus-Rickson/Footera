import { createRng, clamp, type Rng } from '../rng.ts';
import type { Position } from '../../shared/types.ts';
import { effective } from './roles.ts';
import { FORMATIONS, formationLabel } from './formations.ts';
import type {
  ChanceType, EventType, MatchConditions, MatchEvent, MatchOptions, MatchOutcome, MatchPlayer, MatchTick, PlayerReport,
  ShotOutcome, TeamSheet, TeamStats, TeamTactics,
} from './types.ts';
import { TICK_STATS } from './types.ts';
import type { Intervention } from './types.ts';
import { talkDelta } from './teamTalk.ts';
import { cardMultiplier, inGameMultiplier, tacticsMultiplier, talkWithMotivation } from '../coach-engine/coach.ts';
import type { SubSuggestion } from './types.ts';
import { POS_NAME } from '../../shared/positions.ts';
import { bestRole, roleById, roleFactor, type RoleDef } from './playerRoles.ts';
import { overallFor } from '../world/overall.ts';
import { UserError } from '../../shared/errors.ts';

/** Decisão do técnico impossível naquele momento (jogador já saiu, banco esgotado…). */
export class MatchInterventionError extends UserError {}

/** Constantes de calibração (ajustadas contra médias reais de futebol — ver docs e testes de calibração). */
export const K = {
  phasesPerMinute: 2.6,
  chance: 0.070, // 0,068 até a v0.8.5; 0,080 com a normalização das zonas; 0,070 com ZONE_EXP 0,35 (funções táticas e SA/CA)
  counterBoost: 1.55,
  foul: 0.085,
  offside: 0.016,
  injury: 0.00006,
  controlExp: 3,
  homeControl: 0.028,
  homeAttack: 1.11,
  /**
   * Limites da razão ataque/defesa na criação de chances e do controle do jogo (posse). Bateria de 08/11/2026 (73 mil jogos): com 0,4–2,4 e
   * 0,22–0,78, grande contra pequeno chegava a 19x0 e o mais fraco quase nunca vencia com 14+ pontos de diferença; estreitados nos extremos.
   */
  ratioMin: 0.5, ratioMax: 1.9, controlMin: 0.27, controlMax: 0.73,
  /** quanto o peso de um setor (em relação à referência) amplifica a força dele: retornos decrescentes (ver ZONE_SHAPE) */
  zoneExp: 0.35,
  /** desvio da forma do dia de cada time (limite: 1 ± 2 desvios); era 0,04 */
  dayFormSd: 0.08,
  /** quem vence por 3+ gols tira o pé: o ataque é multiplicado por leadEase^(vantagem − 2) (3 gols: ×0,7; 4: ×0,49…); 1 = desligado */
  leadEase: 0.7,
  /**
   * Mentalidade: ataque (a), defesa (d) e frequência de chances (chance). A defensiva era a pior escolha mesmo para segurar resultado
   * (−0,19 ponto/jogo: perdia ataque sem ganhar defesa suficiente); a ofensiva, a melhor. Rebalanceadas para empatar em pontos e mudar o estilo.
   */
  ment: { attacking: { a: 1.06, d: 0.93, chance: 1.1 }, balanced: { a: 1, d: 1, chance: 1 }, defensive: { a: 0.94, d: 1.12, chance: 0.9 } },
};

/**
 * Saturação suave em torno de `mid`: igual a x perto do centro e se aproxima de `lo`/`hi` sem nunca chegar (tanh). Ao contrário de um
 * limite rígido, uma melhora (substituição, tática, treinador) sempre conta, mesmo num jogo muito desigual.
 */
export function soft(x: number, mid: number, lo: number, hi: number): number {
  return x >= mid ? mid + (hi - mid) * Math.tanh((x - mid) / (hi - mid)) : mid - (mid - lo) * Math.tanh((mid - x) / (mid - lo));
}

type Side = 0 | 1;
interface Live {
  p: MatchPlayer; slot: Position; x: number; y: number; fatigue: number; yellow: number; out: boolean; rep: PlayerReport;
  /** função exercida, multiplicador de rendimento nela e peso de zona (perfil da posição inclinado pela função, mesmo total) */
  role: RoleDef; roleK: number; zone: { att: number; mid: number; def: number };
}
interface Ratings { att: number; mid: number; def: number; gk: number; pass: number; aggression: number }
interface TeamState {
  idx: Side; sheet: TeamSheet; active: Live[]; all: Live[]; bench: MatchPlayer[]; subsUsed: number; formation: string;
  /** efeitos de equipe das funções em campo: saída de bola, risco nas costas, goleiro que cobre a profundidade */ fx: { build: number; risk: number; sweep: number };
  stats: TeamStats; held: number; goals: number; r: Ratings;
}

/**
 * Perfil de cada função (quanto contribui para ataque, meio e defesa). Antes de usar, todas as funções de linha são normalizadas
 * para o MESMO peso total (ZONE_TOTAL): assim nenhuma formação ganha força "de graça" por usar funções que somavam mais
 * (a bateria de 5.880 jogos mostrou 0,34 ponto/jogo de diferença entre formações por causa disso). Jogar com um a menos
 * continua pesando, porque o total do time cai.
 */
const ZONE_SHAPE: Record<Position, { att: number; mid: number; def: number }> = {
  GK: { att: 0, mid: 0, def: 0 },
  CB: { att: 0, mid: 0, def: 1 },
  LB: { att: 0.1, mid: 0.1, def: 0.9 }, RB: { att: 0.1, mid: 0.1, def: 0.9 },
  // ala: corredor inteiro (defende e ataca); meia aberto: meio-campo pelo lado, recompõe
  LWB: { att: 0.35, mid: 0.35, def: 0.6 }, RWB: { att: 0.35, mid: 0.35, def: 0.6 },
  LM: { att: 0.45, mid: 0.75, def: 0.2 }, RM: { att: 0.45, mid: 0.75, def: 0.2 },
  DM: { att: 0, mid: 0.75, def: 0.45 },
  CM: { att: 0.1, mid: 1, def: 0.15 },
  AM: { att: 0.55, mid: 0.65, def: 0 },
  LW: { att: 0.85, mid: 0.3, def: 0 }, RW: { att: 0.85, mid: 0.3, def: 0 },
  SS: { att: 0.9, mid: 0.25, def: 0 },
  CF: { att: 1, mid: 0, def: 0 },
  ST: { att: 1, mid: 0, def: 0 },
};
const ZONE_TOTAL = 1.15;
/** quanto o peso de um setor (em relação à referência) amplifica a força dele: retornos decrescentes */
const ZONE_EXP = 0.35;
const ZONE = Object.fromEntries(Object.entries(ZONE_SHAPE).map(([k, z]) => {
  const t = z.att + z.mid + z.def;
  return [k, t > 0 ? { att: (z.att * ZONE_TOTAL) / t, mid: (z.mid * ZONE_TOTAL) / t, def: (z.def * ZONE_TOTAL) / t } : z];
})) as Record<Position, { att: number; mid: number; def: number }>;
/** Peso de zona de quem joga na posição com a função: o perfil é inclinado pela função e renormalizado (mesmo total). */
export function zoneWithRole(pos: Position, role: RoleDef | undefined): { att: number; mid: number; def: number } {
  const b = ZONE[pos], t = role?.fx.tilt;
  if (!t) return { ...b };
  const z = { att: Math.max(0, b.att + (t.att ?? 0)), mid: Math.max(0, b.mid + (t.mid ?? 0)), def: Math.max(0, b.def + (t.def ?? 0)) };
  const tot = z.att + z.mid + z.def, base = b.att + b.mid + b.def;
  return tot > 0 && base > 0 ? { att: (z.att * base) / tot, mid: (z.mid * base) / tot, def: (z.def * base) / tot } : { ...b };
}
/** Peso de zona efetivo de uma função (para testes e diagnóstico). */
export const zoneProfile = (pos: Position): { att: number; mid: number; def: number } => ({ ...ZONE[pos] });
const REF = (() => {
  const t = { att: 0, mid: 0, def: 0 };
  // referência fixa (4-4-2 clássico com pontas): não depende das pré-definições, senão mudar uma formação recalibraria todos os times
  for (const pos of ['GK', 'LB', 'CB', 'CB', 'RB', 'LW', 'CM', 'CM', 'RW', 'ST', 'ST'] as Position[]) { t.att += ZONE[pos].att; t.mid += ZONE[pos].mid; t.def += ZONE[pos].def; }
  return t;
})();

const SHOOTER_W: Record<Position, number> = { GK: 0, CB: 0.03, LB: 0.1, RB: 0.1, DM: 0.1, CM: 0.28, AM: 0.65, LW: 0.6, RW: 0.6, ST: 1, LWB: 0.12, RWB: 0.12, LM: 0.35, RM: 0.35, SS: 0.8, CF: 1 };
const HEADER_W: Record<Position, number> = { GK: 0, CB: 0.12, LB: 0.05, RB: 0.05, DM: 0.1, CM: 0.2, AM: 0.35, LW: 0.25, RW: 0.25, ST: 1, LWB: 0.1, RWB: 0.1, LM: 0.15, RM: 0.15, SS: 0.5, CF: 1.1 };
const CORNER_W: Record<Position, number> = { GK: 0, CB: 0.8, LB: 0.2, RB: 0.2, DM: 0.3, CM: 0.3, AM: 0.2, LW: 0.15, RW: 0.15, ST: 1, LWB: 0.15, RWB: 0.15, LM: 0.15, RM: 0.15, SS: 0.5, CF: 1.1 };
const LONG_W: Record<Position, number> = { GK: 0, CB: 0.05, LB: 0.15, RB: 0.15, DM: 0.5, CM: 0.7, AM: 1, LW: 0.6, RW: 0.6, ST: 0.4, LWB: 0.2, RWB: 0.2, LM: 0.55, RM: 0.55, SS: 0.7, CF: 0.35 };
/** Quem faz o cruzamento nos lances de cruzamento: jogadores de corredor. */
const CROSSER_W: Record<Position, number> = { GK: 0, CB: 0.05, LB: 0.8, RB: 0.8, LWB: 1, RWB: 1, DM: 0.2, CM: 0.35, LM: 1, RM: 1, AM: 0.4, LW: 0.9, RW: 0.9, ST: 0.1, SS: 0.15, CF: 0.05 };
const PASSER_W: Record<Position, number> = { GK: 0.05, CB: 0.15, LB: 0.6, RB: 0.6, DM: 0.5, CM: 0.9, AM: 1, LW: 0.9, RW: 0.9, ST: 0.4, LWB: 0.75, RWB: 0.75, LM: 0.95, RM: 0.95, SS: 0.7, CF: 0.35 };
const FOUL_W: Record<Position, number> = { GK: 0.02, CB: 1, LB: 0.9, RB: 0.9, DM: 1.1, CM: 1, AM: 0.5, LW: 0.45, RW: 0.45, ST: 0.4, LWB: 0.85, RWB: 0.85, LM: 0.7, RM: 0.7, SS: 0.4, CF: 0.45 };
const VICTIM_W: Record<Position, number> = { GK: 0, CB: 0.15, LB: 0.4, RB: 0.4, DM: 0.5, CM: 0.8, AM: 1, LW: 1, RW: 1, ST: 0.9, LWB: 0.6, RWB: 0.6, LM: 0.9, RM: 0.9, SS: 0.95, CF: 0.9 };
const TACKLE_W: Record<Position, number> = { GK: 0, CB: 1, LB: 0.9, RB: 0.9, DM: 1.2, CM: 0.8, AM: 0.3, LW: 0.25, RW: 0.25, ST: 0.15, LWB: 0.8, RWB: 0.8, LM: 0.55, RM: 0.55, SS: 0.2, CF: 0.15 };
const CHANCE_BASE_XG: Record<ChanceType, number> = { buildup: 0.115, cross: 0.075, long: 0.042, counter: 0.19, corner: 0.07, freekick: 0.055, penalty: 0.76 };

const emptyStats = (): TeamStats => ({
  possession: 0, shots: 0, shotsOnTarget: 0, shotsBlocked: 0, chancesCreated: 0, xg: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0,
  offsides: 0, passes: 0, passesCompleted: 0, tackles: 0, interceptions: 0, saves: 0,
});

const a20 = (v: number) => v / 20;

/** Condição física depois de `minutes` em campo (a mesma fórmula grava a condição no fim do jogo). */
export function conditionAfter(condition: number, stamina: number, minutes: number, weather: MatchConditions['weather']): number {
  const sta = stamina / 20;
  const loss = (minutes / 90) * (12 + (1 - sta) * 10) + (weather === 'heat' ? 2 * (minutes / 90) : 0);
  return Math.round(clamp(condition - loss, 30, 100) * 10) / 10;
}

/** Nota do jogador (3..10) com o placar e os minutos informados: usada no fim do jogo e, parcial, a cada minuto. */
export function rateReport(r: PlayerReport, minutes: number, ownGoals: number, oppGoals: number): number {
  const result = ownGoals > oppGoals ? 0.3 : ownGoals < oppGoals ? -0.3 : 0;
  const defender = ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(r.slot);
  let rating = 6 + result
    + Math.min(r.goals, 3) * 1.1 + Math.min(r.assists, 3) * 0.7 + Math.min(r.keyPasses, 4) * 0.12
    + Math.min(r.tackles, 5) * 0.12 + Math.min(r.interceptions, 5) * 0.1
    + (r.slot === 'GK' ? r.saves * 0.28 - r.goalsConceded * 0.3 : defender ? -0.18 * oppGoals * (minutes / 90) : 0)
    + (oppGoals === 0 && (defender || r.slot === 'GK' || r.slot === 'DM') ? 0.45 * (minutes / 90) : 0)
    - 0.05 * Math.max(r.shots - r.shotsOnTarget - r.goals, 0) - 0.3 * r.yellow - 1.5 * r.red - 0.08 * Math.max(r.fouls - 2, 0)
    + (r.passes >= 10 ? (r.passesCompleted / r.passes - 0.8) * 1.5 : 0);
  if (minutes < 25) rating = 6 + (rating - 6) * (minutes / 25);
  return Math.round(clamp(rating, 3, 10) * 10) / 10;
}

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
  // regra de desempate: `decider` explícito, ou o padrão antigo do mata-mata (prorrogação + pênaltis)
  const decider = opts.decider ?? (opts.knockout ? { extraTime: true, penalties: true } : null);
  const first = decider?.firstLeg ?? [0, 0];
  /** limite de substituições (5; 6 na prorrogação quando a competição permite) */
  const subCap = (): number => (clock.minute > 90 && decider?.extraTimeSub ? 6 : 5);

  const mk = (sheet: TeamSheet, idx: Side): TeamState => {
    const all = sheet.lineup.map((l) => {
      const live = { p: { ...l.player }, slot: l.slot, x: l.x, y: l.y, fatigue: 0, yellow: 0, out: false, rep: newReport(l.player, idx, l.slot, true, 0) } as Live;
      setRole(live, l.role);
      return live;
    });
    return {
      idx, sheet, active: [...all], all, bench: sheet.bench.map((b) => ({ ...b })), subsUsed: 0, formation: formationLabel(sheet.formation), fx: { build: 0, risk: 0, sweep: 0 }, stats: emptyStats(), held: 0, goals: 0,
      r: { att: 0, mid: 0, def: 0, gk: 0, pass: 0, aggression: 0 },
    };
  };
  /** Define a função do jogador na vaga (a escolhida, se servir para a posição; senão, a melhor para ele). */
  function setRole(l: Live, roleId?: string | null): void {
    const rating = overallFor(l.p.attributes, l.slot);
    const chosen = roleById(roleId);
    const role = chosen && chosen.positions.includes(l.slot) ? chosen : bestRole(l.p, l.slot, rating);
    l.role = role; l.roleK = roleFactor(l.p, role, rating); l.zone = zoneWithRole(l.slot, role); l.rep.role = role.id;
  }
  const T: [TeamState, TeamState] = [mk(home, 0), mk(away, 1)];
  // Forma do dia (evento aleatório controlado): ±8% no máximo, independente por equipe e constante na partida.
  const dayForm: [number, number] = [clamp(rng.normal(1, K.dayFormSd), 1 - 2 * K.dayFormSd, 1 + 2 * K.dayFormSd), clamp(rng.normal(1, K.dayFormSd), 1 - 2 * K.dayFormSd, 1 + 2 * K.dayFormSd)];

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
    t.fx = { build: 0, risk: 0, sweep: 0 };
    for (const l of t.active) {
      const eff = effective(l.p, l.slot) * l.roleK * fatigueMul(l);
      const z = l.zone;
      t.fx.build += l.role.fx.build ?? 0; t.fx.risk += l.role.fx.risk ?? 0; t.fx.sweep += l.role.fx.sweep ?? 0;
      for (const k of ['att', 'mid', 'def'] as const) { sum[k] += z[k] * eff; w[k] += z[k]; }
      if (l.slot === 'GK') gk = eff;
      else {
        const a = l.p.attributes;
        pass += ((a.technical.passing * 0.5 + a.mental.vision * 0.25 + a.technical.firstTouch * 0.25) / 20) * 100 * fatigueMul(l);
        passN++;
      }
      aggr += a20(l.p.attributes.mental.aggression);
    }
    // retornos decrescentes por setor: 0,35 (era 0,5, que punia demais formações desbalanceadas — 5-3-2, 4-1-4-1 — com SA/CA e funções)
    const zone = (k: 'att' | 'mid' | 'def') => (w[k] > 0 ? (sum[k] / w[k]) * Math.pow(Math.max(w[k], 0.5) / REF[k], K.zoneExp) : 20);
    const tac = t.sheet.tactics;
    const lead = t.goals - o.goals;
    const late = clock.minute >= 70 ? (clock.minute - 60) / 30 : 0; // urgência cresce no fim
    const urgency = lead < 0 ? 1 + 0.05 * late * Math.min(-lead, 2) : lead > 0 ? 1 - 0.04 * late : 1;
    const ment = K.ment[tac.mentality];
    const ease = lead >= 3 ? Math.pow(K.leadEase, lead - 2) : 1;
    const coh = t.sheet.cohesion * tacticsMultiplier(t.sheet.coach); // conhecimento tático do treinador soma ao entrosamento
    t.r = {
      att: zone('att') * ment.a * ease * urgency * coh * dayForm[t.idx] * (t.idx === 0 ? Math.pow(K.homeAttack, hAdv) : 1),
      mid: zone('mid') * coh * dayForm[t.idx] * (1 + 0.012 * (tac.defensiveLine - 3)),
      def: zone('def') * ment.d / Math.sqrt(urgency) * coh * dayForm[t.idx],
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
    if (gkBench.length && t.subsUsed < subCap() && controlled(t)) {
      // o técnico decide: alguém de linha vai para o gol improvisado e o auxiliar sugere pôr o goleiro reserva
      const emergency = [...t.active].sort((a, b) => b.p.attributes.technical.goalkeeping - a.p.attributes.technical.goalkeeping)[0]!;
      emergency.slot = 'GK'; setRole(emergency);
      suggestions.push(suggestion(t, emergency, gkBench[0]!, 'GK', 'goalkeeper'));
      return;
    }
    if (gkBench.length && t.subsUsed < subCap()) {
      const victim = [...t.active].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0]!;
      doSub(t, victim, gkBench[0]!, 'GK', 'gk_replacement');
      return;
    }
    const emergency = [...t.active].sort((a, b) => b.p.attributes.technical.goalkeeping - a.p.attributes.technical.goalkeeping)[0]!;
    emergency.slot = 'GK'; setRole(emergency);
  };

  const doSub = (t: TeamState, out: Live, inP: MatchPlayer, slot: Position, detail?: string, roleId?: string): void => {
    const m = clock.minute;
    out.rep.subbedOutAt = m;
    removeFromPitch(t, out);
    t.bench = t.bench.filter((b) => b.id !== inP.id);
    t.subsUsed++;
    const live = { p: inP, slot, x: out.x, y: out.y, fatigue: 0, yellow: 0, out: false, rep: newReport(inP, t.idx, slot, false, m) } as Live;
    setRole(live, roleId);
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
    if (repl && t.subsUsed < subCap() && controlled(t)) suggestions.push(suggestion(t, l, repl, l.slot, 'injury', days));
    if (repl && t.subsUsed < subCap() && !controlled(t)) doSub(t, l, repl, l.slot, 'injury');
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
    const fxKey = type === 'cross' || type === 'corner' ? 'head' : type === 'long' || type === 'freekick' ? 'long' : 'shoot';
    const shooter = pickLive(att, (l) => weights[l.slot] * (l.role.fx[fxKey] ?? 1) * Math.pow(0.3 + attrScore(l.p, kind), 2));
    if (!shooter) return;
    const passer = type === 'buildup' || type === 'cross' || type === 'counter'
      ? pickLive(att, (l) => (type === 'cross' ? CROSSER_W[l.slot] * (l.role.fx.cross ?? 1) * Math.pow(0.3 + a20(l.p.attributes.technical.crossing), 2) : PASSER_W[l.slot] * (l.role.fx.pass ?? 1) * Math.pow(0.3 + attrScore(l.p, 'pass'), 2)), shooter) : null;
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
    const fouler = pickLive(def, (l) => FOUL_W[l.slot] * (l.role.fx.foul ?? 1) * (0.4 + a20(l.p.attributes.mental.aggression)) * (l.yellow > 0 ? 0.3 : 1));
    const victim = pickLive(att, (l) => VICTIM_W[l.slot] * (l.role.fx.victim ?? 1) * (0.4 + a20(l.p.attributes.technical.dribbling)));
    if (!fouler) return;
    def.stats.fouls++; fouler.rep.fouls++;
    emit('foul', def.idx, { player: fouler.p.id, player2: victim?.p.id });
    const inBox = rng.chance(0.014 * clamp(att.r.att / Math.max(def.r.def, 1), 0.6, 1.6));
    const aggr = a20(fouler.p.attributes.mental.aggression);
    const disc = cardMultiplier(def.sheet.coach); // disciplina do treinador
    const pYellow = clamp(0.065 + 0.125 * aggr + (inBox ? 0.12 : 0), 0.03, 0.5) * disc;
    const pRed = (0.0012 + 0.0026 * aggr) * disc;
    const canRed = def.active.length > 8;
    const rc = rng.next();
    if (canRed && rc < pRed) giveCard(def, fouler, 'red');
    else if (rc < pRed + pYellow) giveCard(def, fouler);
    lastHolder = null;
    if (inBox) penalty(att, def, victim);
    else if (rng.chance(0.16)) shoot(att, def, 'freekick');
  };

  const offside = (att: TeamState): void => {
    const p = pickLive(att, (l) => (l.slot === 'ST' || l.slot === 'CF' ? 1 : l.slot === 'SS' ? 0.8 : l.slot === 'LW' || l.slot === 'RW' ? 0.8 : l.slot === 'AM' || l.slot === 'LM' || l.slot === 'RM' ? 0.4 : l.slot === 'LWB' || l.slot === 'RWB' ? 0.15 : 0.05) * (l.role.fx.offside ?? 1) * (0.3 + a20(l.p.attributes.physical.pace)));
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
    acc += 0.006 * att.fx.build; // funções de saída de bola (goleiro/zagueiro/volante construtor, organizador…)
    acc = clamp(acc, 0.5, 0.94);
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const who = pickLive(att, (l) => (PASSER_W[l.slot] + 0.1) * (l.role.fx.pass ?? 1));
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
      const who = pickLive(att, (l) => TACKLE_W[l.slot] * (l.role.fx.tackle ?? 1) * (0.3 + a20(tackle ? l.p.attributes.technical.tackling : l.p.attributes.mental.positioning)));
      if (who) {
        if (tackle) { who.rep.tackles++; att.stats.tackles++; } else { who.rep.interceptions++; att.stats.interceptions++; }
      }
    }
    lastHolder = h;
    passing(att, def);

    const atac = att.sheet.tactics, dtac = def.sheet.tactics;
    const pFoul = K.foul * (0.75 + 0.5 * def.r.aggression) * (1 + 0.06 * (dtac.pressing - 3));
    const pOffside = K.offside * (1 + 0.18 * (dtac.defensiveLine - 3));
    const ratio = soft(Math.pow(att.r.att / Math.max(def.r.def, 1), 1.6), 1, K.ratioMin, K.ratioMax);
    const mentMod = K.ment[atac.mentality].chance;
    // contra-ataque: funções que deixam espaço nas costas aumentam; goleiro líbero cobrindo a profundidade reduz
    const exposure = clamp(1 + 0.05 * def.fx.risk - 0.12 * def.fx.sweep, 0.7, 1.4);
    const pChance = K.chance * ratio * mentMod * (counter ? K.counterBoost * (1 + 0.12 * (dtac.defensiveLine - 3)) * exposure : 1);
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
      l.fatigue += Math.max(load * sta, 0.05) * (l.slot === 'LWB' || l.slot === 'RWB' ? 1.15 : l.slot === 'LM' || l.slot === 'RM' ? 1.05 : 1) * (l.role.fx.fatigue ?? 1);
    }
  };

  const aiSubs = (t: TeamState, minute: number): void => {
    if (controlled(t)) { suggestions.push(...suggestFor(t, minute)); return; } // o técnico decide: o auxiliar só sugere
    if (t.subsUsed >= subCap() || !t.bench.length) return;
    const o = T[1 - t.idx as Side];
    const lead = t.goals - o.goals;
    let limit = minute <= 62 ? 1 : 2;
    const outfield = t.active.filter((l) => l.slot !== 'GK');
    if (minute >= 66 && lead < 0) {
      const out = [...outfield.filter((l) => ZONE[l.slot].def > 0 || l.slot === 'DM')].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const inP = t.bench.filter((b) => b.position === 'ST' || b.position === 'CF' || b.position === 'SS' || b.position === 'LW' || b.position === 'RW' || b.position === 'AM').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (out && inP) { doSub(t, out, inP, inP.position); limit--; refresh(t, o); }
    } else if (minute >= 74 && lead > 0) {
      const out = [...outfield.filter((l) => ZONE[l.slot].att >= 0.85)].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const inP = t.bench.filter((b) => b.position === 'CB' || b.position === 'DM' || b.position === 'LB' || b.position === 'RB' || b.position === 'LWB' || b.position === 'RWB').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (out && inP) { doSub(t, out, inP, inP.position); limit--; refresh(t, o); }
    }
    while (limit > 0 && t.subsUsed < subCap() && t.bench.length) {
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

  /** As mesmas escolhas de `aiSubs`, calculadas sem executar (não muda nada no jogo), com o motivo para o técnico. */
  /**
   * Formação que melhor acomoda o time em campo (já com quem entra): entre as formações conhecidas, a que exige a menor perda
   * de rendimento de quem precisa mudar de função. Quem já tem lugar na formação fica; os demais vão para as vagas restantes.
   * Só lê o estado (usada na sugestão e, se o técnico aceitar, para aplicar).
   */
  const planReshape = (players: Array<{ id: string; p: MatchPlayer; slot: Position; x: number }>, current: string, keepFirst: string) => {
    const outfield = players.filter((x) => x.slot !== 'GK');
    if (outfield.length !== 10) return null; // com expulsos, não reorganiza
    let best: { id: string; cost: number; moved: number; assign: Map<string, { slot: Position; x: number; y: number }> } | null = null;
    for (const f of FORMATIONS) {
      const slots = f.slots.filter((s) => s.pos !== 'GK').map((s) => ({ ...s }));
      const order = [...outfield].sort((a, b) => (a.id === keepFirst ? -1 : b.id === keepFirst ? 1 : 0));
      const kept: Array<[typeof outfield[number], typeof slots[number]]> = [], left: typeof outfield = [];
      for (const pl of order) { const k = slots.findIndex((s) => s.pos === pl.slot); if (k >= 0) kept.push([pl, slots.splice(k, 1)[0]!]); else left.push(pl); }
      if (outfield.some((x) => x.id === keepFirst) && !kept.some(([pl]) => pl.id === keepFirst)) continue; // quem entra joga na posição dele
      // vagas restantes: tenta todas as combinações (poucas pessoas) e fica com a de menor perda
      let bestLeft: { cost: number; pairs: Array<[typeof outfield[number], typeof slots[number]]> } | null = null;
      const permute = (i: number, rest: typeof slots, acc: Array<[typeof outfield[number], typeof slots[number]]>, cost: number) => {
        if (bestLeft && cost >= bestLeft.cost) return;
        if (i === left.length) { bestLeft = { cost, pairs: [...acc] }; return; }
        rest.forEach((s, k) => { const pl = left[i]!; permute(i + 1, rest.filter((_, j) => j !== k), [...acc, [pl, s]], cost + effective(pl.p, pl.slot) - effective(pl.p, s.pos)); });
      };
      if (left.length > 5) continue;
      permute(0, slots, [], 0);
      if (!bestLeft) continue;
      const bl = bestLeft as { cost: number; pairs: Array<[typeof outfield[number], typeof slots[number]]> };
      const all = [...kept, ...bl.pairs];
      // mesma função: preserva a ordem esquerda→direita
      const assign = new Map<string, { slot: Position; x: number; y: number }>();
      for (const pos of new Set(all.map(([, s]) => s.pos))) {
        const ps = all.filter(([, s]) => s.pos === pos).map(([pl]) => pl).sort((a, b) => a.x - b.x);
        const ss = all.filter(([, s]) => s.pos === pos).map(([, s]) => s).sort((a, b) => a.x - b.x);
        ps.forEach((pl, k) => assign.set(pl.id, { slot: pos, x: ss[k]!.x, y: ss[k]!.y }));
      }
      const cost = bl.cost, moved = bl.pairs.length;
      const better = !best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && (f.id === current || (best.id !== current && moved < best.moved)));
      if (better) best = { id: f.id, cost, moved, assign };
    }
    return best;
  };

  const suggestFor = (t: TeamState, minute: number): SubSuggestion[] => {
    const out: SubSuggestion[] = [];
    if (t.subsUsed >= subCap() || !t.bench.length) return out;
    const lead = t.goals - T[1 - t.idx as Side].goals;
    let limit = minute <= 62 ? 1 : 2, used = t.subsUsed;
    const active = [...t.active], bench = [...t.bench];
    const take = (l: Live, b: MatchPlayer, slot: Position, kind: SubSuggestion['kind']) => {
      active.splice(active.indexOf(l), 1); bench.splice(bench.indexOf(b), 1); used++; limit--;
      out.push(suggestion(t, l, b, slot, kind));
    };
    const outfield = active.filter((l) => l.slot !== 'GK');
    if (minute >= 66 && lead < 0) {
      const o = [...outfield.filter((l) => ZONE[l.slot].def > 0 || l.slot === 'DM')].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const i = bench.filter((b) => b.position === 'ST' || b.position === 'CF' || b.position === 'SS' || b.position === 'LW' || b.position === 'RW' || b.position === 'AM').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (o && i) take(o, i, i.position, 'chase');
    } else if (minute >= 74 && lead > 0) {
      const o = [...outfield.filter((l) => ZONE[l.slot].att >= 0.85)].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const i = bench.filter((b) => b.position === 'CB' || b.position === 'DM' || b.position === 'LB' || b.position === 'RB' || b.position === 'LWB' || b.position === 'RWB').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (o && i) take(o, i, i.position, 'protect');
    }
    const best = (slot: Position) => [...bench.filter((b) => (slot === 'GK' ? b.position === 'GK' : b.position !== 'GK'))].sort((a, b) => effective(b, slot) - effective(a, slot))[0] ?? null;
    while (limit > 0 && used < 5 && bench.length) {
      const pick = active.filter((l) => l.slot !== 'GK')
        .map((l) => ({ l, cur: effective(l.p, l.slot) * fatigueMul(l), bench: best(l.slot) }))
        .filter((c) => c.bench && effective(c.bench, c.l.slot) > c.cur * 1.02)
        .sort((a, b) => a.cur / effective(a.bench!, a.l.slot) - b.cur / effective(b.bench!, b.l.slot))[0];
      if (!pick) break;
      take(pick.l, pick.bench!, pick.l.slot, 'fresh');
    }
    return out;
  };
  /** Sugestão com a justificativa do auxiliar, a partir do estado real do jogo (placar, condição, nota, posição). */
  function suggestion(t: TeamState, l: Live, b: MatchPlayer, slot: Position, kind: SubSuggestion['kind'], injuryDays = 0): SubSuggestion {
    const o = T[1 - t.idx as Side], lead = t.goals - o.goals;
    const mins = clamp(clock.minute - (l.rep.subbedInAt ?? 0), 0, 120);
    const cond = Math.round(conditionAfter(l.p.condition, l.p.attributes.physical.stamina, mins, conditions.weather));
    const rating = rateReport(l.rep, mins, t.goals, o.goals).toFixed(1).replace('.', ',');
    const pos = (p: Position) => POS_NAME[p].toLowerCase();
    const reason = kind === 'goalkeeper' ? `Ficamos sem goleiro e ${l.p.name} foi para o gol improvisado. Sugiro tirá-lo e colocar o goleiro ${b.name}.`
      : kind === 'injury' ? `${l.p.name} se lesionou (cerca de ${injuryDays} dia(s) fora) e não tem condição de continuar. ${b.name} é a melhor opção do banco para jogar como ${pos(slot)}.`
      : kind === 'chase' ? `Estamos perdendo por ${-lead}. Sugiro tirar ${l.p.name} (${pos(l.slot)}, nota ${rating}) e colocar ${b.name}, ${pos(b.position)}, para ter mais força no ataque e buscar o resultado.`
      : kind === 'protect' ? `Estamos vencendo por ${lead}. Para segurar o resultado, ${b.name} (${pos(b.position)}) pode entrar no lugar de ${l.p.name}, que é mais ofensivo.`
      : fatigueMul(l) < 0.93 ? `${l.p.name} está cansado (condição ${cond}%, nota ${rating}) e o rendimento caiu. ${b.name} entra descansado para jogar como ${pos(slot)}.`
      : `${b.name} deve render mais que ${l.p.name} (nota ${rating}, condição ${cond}%) como ${pos(slot)} neste momento do jogo.`;
    let reshape: SubSuggestion['reshape'] = null, extra = '';
    if (slot !== l.slot) {
      const after = [...t.active.filter((x) => x !== l).map((x) => ({ id: x.p.id, p: x.p, slot: x.slot, x: x.x })), { id: b.id, p: b, slot, x: l.x }];
      const plan = planReshape(after, t.formation, b.id);
      if (plan) {
        const changes = after.filter((x) => x.slot !== 'GK' && plan.assign.get(x.id)!.slot !== x.slot && x.id !== b.id).map((x) => ({ id: x.id, from: x.slot, to: plan.assign.get(x.id)!.slot }));
        reshape = { from: t.formation, to: plan.id, changes };
        const names = changes.map((c) => `${t.active.find((x) => x.p.id === c.id)!.p.name} passa a ${pos(c.to)}`);
        extra = plan.id !== t.formation ? ` Para encaixar ${b.name}, o time muda de ${t.formation} para ${plan.id}${names.length ? ` (${names.join('; ')})` : ''}.`
          : names.length ? ` Para encaixar ${b.name}, o time mantém o ${plan.id} com ajustes: ${names.join('; ')}.` : '';
      }
    }
    return { tick: tickNo, team: t.idx, out: l.p.id, in: b.id, slot, kind, reason: reason + extra, reshape };
  }

  const SUB_MINUTES = new Set([58, 66, 74, 82]);
  const tick = (minute: number, label: string, etFactor: number, added: boolean): void => {
    clock.minute = minute; clock.label = label;
    for (const iv of interventions) if (iv.tick === tickNo) applyIntervention(iv);
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
    pHome = soft(cA / (cA + cB) + K.homeControl * hAdv, 0.5, K.controlMin, K.controlMax);
    const mean = K.phasesPerMinute * (1 + 0.05 * ((T[0].sheet.tactics.tempo + T[1].sheet.tactics.tempo) / 2 - 3)) * (etFactor > 1 ? 0.9 : 1);
    const n = Math.floor(mean) + (rng.next() < mean - Math.floor(mean) ? 1 : 0);
    for (let i = 0; i < n; i++) phase();
    if (timeline) snapshot();
    tickNo++;
  };

  // ---------- decisões do técnico (sem sorteio: não deslocam a sequência aleatória) ----------
  let tickNo = 0;
  const interventions: Intervention[] = opts.interventions ?? [];
  const moraleDelta: Record<string, number> = {};
  const suggestions: SubSuggestion[] = [];
  function controlled(t: TeamState): boolean { return !!opts.control && opts.control.team === t.idx && tickNo < opts.control.until; }
  function applyIntervention(iv: Intervention): void {
    const t = T[iv.team], o = T[1 - iv.team as Side];
    if (iv.kind === 'talk') {
      for (const p of [...t.active.map((l) => l.p), ...t.bench]) {
        const d = talkWithMotivation(talkDelta(iv.tone, t.goals - o.goals, p.attributes.mental.composure), t.sheet.coach);
        p.morale = clamp(p.morale + d, 10, 100);
        moraleDelta[p.id] = (moraleDelta[p.id] ?? 0) + d;
      }
      emit('team_talk', iv.team, { detail: iv.tone });
      return;
    }
    const out = t.active.find((l) => l.p.id === iv.out);
    const inP = t.bench.find((b) => b.id === iv.in);
    if (!out) throw new MatchInterventionError('O jogador escolhido para sair não está mais em campo.');
    if (!inP) throw new MatchInterventionError('O jogador escolhido para entrar não está disponível no banco.');
    if (t.subsUsed >= subCap()) throw new MatchInterventionError(`O time já fez as ${subCap()} substituições permitidas.`);
    doSub(t, out, inP, iv.slot ?? out.slot, 'coach', iv.role);
    if (iv.reshape) reorganize(t, inP.id);
    // adaptabilidade do treinador: quem entra rende um pouco mais na função nova (quem mudou de posição: em reorganize)
    const entered = t.active.find((l) => l.p.id === inP.id);
    if (entered) entered.roleK *= inGameMultiplier(t.sheet.coach);
  }
  /** Aplica a formação escolhida por `planReshape`: muda a função (e o lugar) de cada jogador em campo. */
  function reorganize(t: TeamState, keepFirst: string): void {
    const plan = planReshape(t.active.map((l) => ({ id: l.p.id, p: l.p, slot: l.slot, x: l.x })), t.formation, keepFirst);
    if (!plan) return;
    const from = t.formation;
    for (const l of t.active) { const a = plan.assign.get(l.p.id); if (a) { const moved = l.slot !== a.slot; l.slot = a.slot; l.x = a.x; l.y = a.y; l.rep.slot = a.slot; if (moved) { setRole(l); if (l.p.id !== keepFirst) l.roleK *= inGameMultiplier(t.sheet.coach); } } }
    t.formation = plan.id;
    emit('formation_change', t.idx, { detail: `${from}>${plan.id}`, moves: t.active.map((l) => ({ id: l.p.id, slot: l.slot, x: l.x, y: l.y })) });
  }

  // ---------- linha do tempo (opcional; só lê o estado, nunca sorteia) ----------
  const timeline: MatchTick[] | null = opts.timeline ? [] : null;
  const snapshot = (): void => {
    const side = (t: TeamState) => {
      const o = T[1 - t.idx as Side];
      const p: number[] = [];
      for (const l of t.all) {
        const from = l.rep.subbedInAt ?? 0, mins = clamp((l.rep.subbedOutAt ?? clock.minute) - from, 0, 120);
        p.push(Math.round(rateReport(l.rep, mins, t.goals, o.goals) * 10), Math.round(conditionAfter(l.p.condition, l.p.attributes.physical.stamina, mins, conditions.weather) * 10));
      }
      return { s: TICK_STATS.map((k) => (k === 'xg' ? Math.round(t.stats.xg * 100) : t.stats[k])), p };
    };
    const a = side(T[0]), b = side(T[1]);
    timeline!.push({ minute: clock.minute, label: clock.label, ev: events.length, held: [T[0].held, T[1].held], s: [a.s, b.s], p: [a.p, b.p] });
  };

  const stoppage = (from: number): number => {
    let score = 0;
    for (const e of events.slice(from)) {
      // calibrado pela bateria de formações: ~2–3 min no 1º tempo e ~4–6 no 2º (antes 3,4 e 6,7)
      if (e.type === 'goal') score += 0.5;
      else if (e.type === 'substitution') score += 0.3;
      else if (e.type === 'injury') score += 1.0;
      else if (e.type === 'yellow_card' || e.type === 'red_card') score += 0.2;
      else if (e.type === 'foul') score += 0.03;
      else if (e.type === 'penalty_awarded') score += 0.5;
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
    if (timeline?.length) timeline.at(-1)!.ev = events.length; // o apito final do período entra no último minuto
    lastMinute = to + extra;
  };

  runPeriod(1, 45, 'halftime', 1);
  runPeriod(46, 90, 'fulltime', 1);
  let decidedIn: MatchOutcome['decidedIn'] = 'regular';
  let shootout: MatchOutcome['shootout'] = null;
  /** vencedor pelo placar (com o jogo de ida somado, no jogo de volta) */
  const leader = (): 0 | 1 | null => { const h = T[0].goals + first[0], a = T[1].goals + first[1]; return h > a ? 0 : a > h ? 1 : null; };
  let winner: 0 | 1 | null = decider ? leader() : T[0].goals > T[1].goals ? 0 : T[1].goals > T[0].goals ? 1 : null;
  let endMinute = 90;

  if (winner === null && decider) {
    if (decider.extraTime) {
      decidedIn = 'extra_time';
      runPeriod(91, 105, 'extra1', 1.3);
      runPeriod(106, 120, 'extra2', 1.3);
      endMinute = 120;
      winner = leader();
    }
    if (winner === null && decider.penalties) {
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
      // série de 5: termina assim que um time não consegue mais alcançar o outro (Regras do Jogo, Lei 10)
      series: for (let round = 0; round < 5; round++) {
        for (const s of [0, 1] as Side[]) {
          kick(s, round);
          const left0 = 5 - (round + 1), left1 = 5 - (s === 1 ? round + 1 : round);
          if (res[0] > res[1] + left1 || res[1] > res[0] + left0) break series;
        }
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
    for (const l of t.all) {
      l.rep.rating = rateReport(l.rep, l.rep.minutes, t.goals, o.goals);
      reports.push(l.rep);
    }
  }
  const best = [...reports].filter((r) => r.minutes >= 45).sort((a, b) => b.rating - a.rating || b.goals - a.goals)[0];

  return {
    seed: opts.seed, homeGoals: T[0].goals, awayGoals: T[1].goals, decidedIn, shootout, winner, events,
    aggregate: decider?.firstLeg ? [T[0].goals + first[0], T[1].goals + first[1]] : null,
    stats: [T[0].stats, T[1].stats], players: reports,
    lineups: T.map((t) => ({
      clubId: t.sheet.clubId, name: t.sheet.name, formation: formationLabel(t.sheet.formation),
      slots: t.sheet.lineup.map((l) => ({ slot: l.slot, x: l.x, y: l.y, playerId: l.player.id })),
    })),
    conditions, duration: lastMinute, manOfTheMatch: best?.id ?? null, timeline, moraleDelta, suggestions,
  };
}

export type { TeamTactics };
