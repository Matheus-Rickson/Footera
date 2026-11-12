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

/**
 * Fator de prontidão: condição física (termo leve — o cansaço pesa no jogo pela fadiga inicial, `startFatigue`), ritmo de jogo,
 * moral e forma recente (≈ 0,85 .. 1,05). v0.8.12: condição 0,78 + 0,22√c → 0,90 + 0,10√c; ritmo 0,92 + 0,08 × ritmo/100.
 */
export function readiness(p: MatchPlayer): number {
  const c = clamp(p.condition, 0, 100) / 100;
  return (0.9 + 0.1 * Math.sqrt(c)) * sharpnessFactor(p.sharpness) * (0.97 + 0.06 * (clamp(p.morale, 0, 100) / 100)) * (0.98 + 0.04 * (clamp(p.form, 0, 100) / 100));
}
/** Ritmo de jogo no rendimento: 0,92 sem ritmo nenhum, 1 com ritmo pleno (ausente = pleno). */
export const sharpnessFactor = (sharpness: number | undefined): number => 0.92 + 0.08 * clamp(sharpness ?? 100, 0, 100) / 100;
/**
 * Peso da condição só na ESCOLHA dos jogadores (escalação, banco): com 88% ou mais não muda nada; abaixo, cai 1% por ponto, para a IA
 * e a "melhor escalação" pouparem quem está cansado. O motor não usa este fator (v0.8.12).
 */
export const selectionCondition = (condition: number): number => (condition >= 88 ? 1 : Math.max(0.5, 1 - 0.01 * (88 - condition)));
/** Valor de um jogador para ser escalado na vaga: rendimento × peso da condição. */
export const selectionValue = (p: MatchPlayer, slot: Position): number => effective(p, slot) * selectionCondition(p.condition);

export const effective = (p: MatchPlayer, slot: Position): number => roleRating(p, slot) * readiness(p);
