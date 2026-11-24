/** Partes comuns às versões do motor (v1 estatística e v2 lance a lance): nota, condição, saturação e erros. */
import { clamp } from '../rng.ts';
import type { MatchPlayer, PlayerReport, TeamStats } from './types.ts';
import type { Position } from '../../shared/types.ts';
import { UserError } from '../../shared/errors.ts';

/** Decisão do técnico impossível naquele momento (jogador já saiu, banco esgotado…). */
export class MatchInterventionError extends UserError {}

/**
 * Saturação suave em torno de `mid`: igual a x perto do centro e se aproxima de `lo`/`hi` sem nunca chegar (tanh). Ao contrário de um
 * limite rígido, uma melhora (substituição, tática, treinador) sempre conta, mesmo num jogo muito desigual.
 */
export function soft(x: number, mid: number, lo: number, hi: number): number {
  return x >= mid ? mid + (hi - mid) * Math.tanh((x - mid) / (hi - mid)) : mid - (mid - lo) * Math.tanh((mid - x) / (mid - lo));
}

export const emptyStats = (): TeamStats => ({
  possession: 0, shots: 0, shotsOnTarget: 0, shotsBlocked: 0, chancesCreated: 0, xg: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0,
  offsides: 0, passes: 0, passesCompleted: 0, tackles: 0, interceptions: 0, saves: 0,
});

/**
 * Condição física depois de `minutes` em campo (a mesma fórmula grava a condição no fim do jogo, v0.8.12): um custo fixo por minuto
 * mais a fadiga acumulada no jogo (`fatigueGained`, que já depende de resistência, recuperação física, ritmo, pressão, calor, posição
 * e função). Calibrado para ~70% depois de 90 minutos com a tática padrão (antes: ~87%, só pela resistência).
 */
export const COND = { perMinute: 8 / 90, fatigueK: 1.41, fatigueExp: 0.8, floor: 30, startFrom: 95, startK: 0.6 };
export function conditionAfter(condition: number, fatigueGained: number, minutes: number): number {
  // a fadiga pesa de forma sublinear: pressão alta e calor cansam mais, sem levar todo mundo ao piso (fadiga ~31 em 90' padrão → −30)
  const loss = COND.perMinute * minutes + COND.fatigueK * Math.pow(Math.max(fatigueGained, 0), COND.fatigueExp);
  return Math.round(clamp(condition - loss, COND.floor, 100) * 10) / 10;
}
/** Fadiga com que o jogador entra em campo: quem chega cansado começa o jogo já rendendo menos (v0.8.12). */
export const startFatigue = (condition: number): number => Math.max(0, COND.startFrom - condition) * COND.startK;

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

export function newReport(p: MatchPlayer, team: 0 | 1, slot: Position, starter: boolean, at: number): PlayerReport {
  return {
    id: p.id, name: p.name, team, slot, position: p.position, starter, minutes: 0, subbedInAt: starter ? null : at, subbedOutAt: null, rating: 6,
    goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, passes: 0, passesCompleted: 0, keyPasses: 0, tackles: 0, interceptions: 0, fouls: 0,
    yellow: 0, red: 0, saves: 0, goalsConceded: 0, xg: 0, injuredDays: 0, fatigue: 0,
  };
}

