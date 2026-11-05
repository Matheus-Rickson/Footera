import type { Range } from './api.ts';

/**
 * Escala de exibição 1–20 (a mesma dos atributos) para valores que o motor calcula em 0–100: força, potencial, força na vaga,
 * compatibilidade de função e resumos de atributos. O cálculo interno não muda.
 */
export const to20 = (v: number): number => Math.max(1, Math.min(20, Math.round(v / 5)));
export const range20 = (r: Range): Range => ({ low: to20(r.low), high: to20(r.high) });
