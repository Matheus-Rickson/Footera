import type { Range } from './api.ts';

/**
 * Resumo dos atributos em grupos (escala 0–100 = média dos atributos 1–20 × 5), o mesmo da ficha do jogador.
 * Goleiros usam "Goleiro" no lugar de "Finalização".
 */
export const SUMMARY_KEYS = {
  gol: ['reflexes', 'oneOnOne', 'handling', 'aerial', 'rushingOut'],
  fin: ['finishing', 'longShots', 'composure'],
  tec: ['dribbling', 'firstTouch', 'crossing'],
  pas: ['passing', 'vision', 'decisions'],
  des: ['tackling', 'marking', 'positioning'],
  fis: ['strength', 'stamina', 'jumping', 'naturalFitness'],
  vel: ['pace', 'agility'],
} as const;
export type SummaryKey = keyof typeof SUMMARY_KEYS;
export type AttrSummary = Record<SummaryKey, Range>;
type RangeGroups = { technical: Record<string, Range>; mental: Record<string, Range>; physical: Record<string, Range>; goalkeeper?: Record<string, Range> };

export function summarizeRanges(attrs: RangeGroups): AttrSummary {
  const flat: Record<string, Range> = { ...attrs.technical, ...attrs.mental, ...attrs.physical, ...(attrs.goalkeeper ?? {}) };
  const one = (keys: readonly string[]): Range => {
    const rs = keys.map((k) => flat[k]).filter((r): r is Range => !!r);
    const avg = (f: (r: Range) => number) => Math.round((rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length)) * 5);
    return { low: avg((r) => r.low), high: avg((r) => r.high) };
  };
  return Object.fromEntries(Object.entries(SUMMARY_KEYS).map(([k, keys]) => [k, one(keys)])) as AttrSummary;
}
