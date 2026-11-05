import { clamp, type Rng } from '../rng.ts';
import { overallFor, positionWeights } from '../world/overall.ts';
import type { Attributes, Personality, Position } from '../../shared/types.ts';
import { deriveGoalkeeper, syncGoalkeeping } from '../world/goalkeeper.ts';

/** Idade a partir da qual não há mais crescimento: antes dela a força nunca passa do potencial oculto. */
export const PEAK_AGE = 28;

const GROWTH_RATE: Record<number, number> = { 16: 0.3, 17: 0.3, 18: 0.3, 19: 0.28, 20: 0.26, 21: 0.24, 22: 0.22, 23: 0.2, 24: 0.18, 25: 0.16, 26: 0.14, 27: 0.12 };
const DECLINE: Record<number, number> = { 30: -0.3, 31: -1, 32: -1.5, 33: -2, 34: -2.5, 35: -3 };

export interface DevelopmentContext {
  /** 1..20 */
  professionalism: number;
  /** Fração (0..1) dos minutos possíveis que o jogador disputou na temporada. */
  minutesShare: number;
}

/** Variação esperada da força (escala 1..100) em uma temporada, sem ruído. */
export function expectedChange(age: number, overall: number, potential: number, ctx: DevelopmentContext): number {
  const prof = clamp(ctx.professionalism, 1, 20) / 20;
  if (age < PEAK_AGE) {
    const gap = Math.max(potential - overall, 0);
    if (gap === 0) return 0;
    const rate = GROWTH_RATE[Math.max(age, 16)] ?? 0.12;
    const play = 0.85 + 0.3 * clamp(ctx.minutesShare, 0, 1); // reservas também treinam: minutos aceleram, mas não decidem
    return Math.min(gap, (gap * rate + 0.3) * play * (0.85 + 0.3 * prof));
  }
  const base = age >= 36 ? -3.5 - 0.5 * (age - 36) : DECLINE[age] ?? 0;
  return base * (1.15 - 0.3 * prof);
}

/** Probabilidade de o jogador se aposentar na virada de temporada. */
export function retirementChance(age: number, overall: number, freeAgent: boolean): number {
  if (age >= 40) return 1;
  let p = age >= 37 ? 0.9 : ({ 33: 0.12, 34: 0.28, 35: 0.48, 36: 0.7 } as Record<number, number>)[age] ?? 0;
  if (freeAgent) p += age >= 30 ? 0.5 : 0.3; // sem clube, muitos abandonam o futebol profissional (inclusive jovens dispensados da base)
  if (overall >= 75) p -= 0.1;
  return clamp(p, 0, 1);
}

export interface Developable {
  position: Position; attributes: Attributes; overall: number; potentialHidden: number; potentialEstimated: number; personality: Personality;
}
export interface Developed { attributes: Attributes; overall: number; potentialHidden: number; potentialEstimated: number }

/** Arredondamento estocástico: sem viés, mesmo para variações menores que 1 ponto. */
const stochastic = (x: number, rng: Rng) => Math.floor(x + rng.next());

/** Ajustes do treino sobre a evolução (todos opcionais; sem eles o resultado é o da evolução anual "pura"). */
export interface DevelopmentOptions {
  /** Fração do ano (1/12 = um mês). O crescimento é composto para que 12 meses ≈ 1 ano. */
  fraction?: number;
  /** Atributos priorizados pelo foco de treino (×1,35; os demais ×0,9: o total de pontos se conserva). */
  focusKeys?: ReadonlySet<string>;
  /** Multiplicador de crescimento por grupo (comissão técnica, instalações, intensidade). */
  growth?: Partial<Record<keyof Attributes, number>>;
  /** Multiplicador do declínio físico de veteranos (preparador físico). */
  physicalDecline?: number;
}

/**
 * Evolução por um período (um ano por padrão). A variação de força vira uma mudança média nos atributos (o físico cai mais rápido nos veteranos);
 * antes de `PEAK_AGE` o resultado é cortado no potencial oculto.
 */
export function developPlayer(p: Developable, age: number, minutesShare: number, rng: Rng, opts: DevelopmentOptions = {}): Developed {
  const fraction = opts.fraction ?? 1;
  const annual = expectedChange(age, p.overall, p.potentialHidden, { professionalism: p.personality.professionalism, minutesShare });
  const gap = Math.max(p.potentialHidden - p.overall, 0);
  // crescimento composto: a fração do que falta, por mês, que soma a fração anual em 12 meses
  const trend = annual > 0 && gap > 0 && fraction < 1 ? gap * (1 - Math.pow(1 - Math.min(annual / gap, 0.999), fraction)) : annual * fraction;
  let delta = trend + rng.normal(0, 1.1 * Math.sqrt(fraction));
  if (age < PEAK_AGE) delta = Math.max(delta, -fraction); // jovens quase nunca regridem
  const shift = delta / 5; // força = média ponderada dos atributos × 5
  const factor = (group: keyof Attributes, key: string) => {
    if (delta < 0) return group === 'physical' ? 1.5 * (opts.physicalDecline ?? 1) : group === 'mental' ? 0.5 : 1;
    // ×1,6/×0,85 fazia a força crescer 42% mais rápido quando o foco coincidia com a posição (vantagem enorme sobre a IA)
    const focus = opts.focusKeys ? (opts.focusKeys.has(key) ? 1.35 : 0.9) : 1;
    return focus * (opts.growth?.[group] ?? 1);
  };
  const move = <T extends object>(group: keyof Attributes, attrs: T): T =>
    Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, clamp(stochastic((v as number) + shift * factor(group, k), rng), 1, 20)])) as T;
  const gk = p.attributes.goalkeeper ?? deriveGoalkeeper(p.attributes.technical.goalkeeping);
  const attributes: Attributes = { technical: move('technical', p.attributes.technical), mental: move('mental', p.attributes.mental), physical: move('physical', p.attributes.physical), goalkeeper: move('technical', gk) };
  syncGoalkeeping(attributes); // "goleiro (geral)" acompanha os atributos de goleiro

  let overall = overallFor(attributes, p.position);
  if (age < PEAK_AGE && overall > p.potentialHidden) {
    // corta no teto: reduz os atributos mais relevantes para a posição, um ponto por vez
    const weights = Object.entries(positionWeights(p.position)).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k]) => k);
    for (let guard = 0; overall > p.potentialHidden && guard < 200; guard++) {
      const key = weights[guard % weights.length]!;
      if (key === 'goalkeeping' && attributes.goalkeeper) {
        // o geral é derivado: corta nos atributos de goleiro (o de maior peso primeiro) e recalcula
        const gkk = (['reflexes', 'oneOnOne', 'handling'] as const).find((k) => attributes.goalkeeper![k] > 1);
        if (gkk) attributes.goalkeeper[gkk] -= 1;
        syncGoalkeeping(attributes);
      } else for (const group of ['technical', 'mental', 'physical'] as const) {
        const g = attributes[group] as unknown as Record<string, number>;
        if (key in g && g[key]! > 1) g[key] = g[key]! - 1;
      }
      overall = overallFor(attributes, p.position);
    }
  }
  const peaked = fraction >= 1 ? age + 1 >= PEAK_AGE : age >= PEAK_AGE;
  const potentialHidden = peaked ? overall : Math.max(p.potentialHidden, overall);
  // a estimativa visível só é revista uma vez por temporada (virada); no mês apenas não fica abaixo da força
  const potentialEstimated = fraction >= 1 ? reviseEstimate(p.potentialEstimated, potentialHidden, overall, rng) : Math.max(p.potentialEstimated, overall);
  return { attributes, overall, potentialHidden, potentialEstimated };
}

/** Revisão anual (virada) do potencial estimado visível: aproxima-se do potencial oculto, com ruído. */
export function reviseEstimate(potentialEstimated: number, potentialHidden: number, overall: number, rng: Rng): number {
  return clamp(Math.round(0.5 * potentialEstimated + 0.5 * (potentialHidden + rng.normal(0, 3))), overall, 100);
}

/** Premiação da liga: campeão da 1ª divisão = economia × 2,4 mi; o último leva 10% do campeão; cada divisão abaixo vale ×0,23. */
export function prizeMoney(economy: number, tier: number, position: number, teamCount: number): number {
  const top = economy * 2_400_000 * Math.pow(0.23, Math.max(tier - 1, 0));
  const last = top * 0.1;
  const share = teamCount <= 1 ? 0 : (position - 1) / (teamCount - 1);
  return Math.round((top - (top - last) * clamp(share, 0, 1)) / 1000) * 1000;
}
