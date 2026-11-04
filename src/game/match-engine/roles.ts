import type { Position } from '../../shared/types.ts';
import { overallFor } from '../world/overall.ts';
import { clamp } from '../rng.ts';
import type { MatchPlayer } from './types.ts';

const OUTFIELD = new Set<Position>(['CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST']);
/** Posições parecidas (rendem 95%): lateral ↔ ala e ponta ↔ meia aberto do mesmo lado; atacante (ATA) ↔ centroavante e segundo atacante. */
const RELATED: Partial<Record<Position, Position[]>> = { LB: ['LWB'], LWB: ['LB'], RB: ['RWB'], RWB: ['RB'], LW: ['LM'], LM: ['LW'], RW: ['RM'], RM: ['RW'], ST: ['CF', 'SS'], CF: ['ST'], SS: ['ST'] };

/** Funções parecidas (lateral ↔ ala, ponta ↔ meia aberto, do mesmo lado). */
export const isRelatedPosition = (natural: Position, slot: Position): boolean => !!RELATED[natural]?.includes(slot);

/** Quão confortável o jogador é na posição (1 = natural). */
export function positionFit(p: MatchPlayer, slot: Position): number {
  if (p.position === slot) return 1;
  if (p.secondaryPositions.includes(slot)) return 0.97;
  if (slot === 'GK' || p.position === 'GK') return 0.45;
  if (RELATED[p.position]?.includes(slot)) return 0.95;
  return OUTFIELD.has(slot) ? 0.9 : 0.5;
}

/** Qualidade do jogador na função (0..100), sem considerar estado físico. */
export function roleRating(p: MatchPlayer, slot: Position): number {
  return overallFor(p.attributes, slot) * positionFit(p, slot);
}

/** Fator de prontidão: condição física, moral e forma recente (≈ 0.80 .. 1.05). */
export function readiness(p: MatchPlayer): number {
  const c = clamp(p.condition, 0, 100) / 100;
  return (0.78 + 0.22 * Math.sqrt(c)) * (0.97 + 0.06 * (clamp(p.morale, 0, 100) / 100)) * (0.98 + 0.04 * (clamp(p.form, 0, 100) / 100));
}

export const effective = (p: MatchPlayer, slot: Position): number => roleRating(p, slot) * readiness(p);
