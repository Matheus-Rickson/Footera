import type { Range } from './api.ts';

/**
 * Escala de exibição 1–20 (a mesma dos atributos) para valores que o motor calcula em 0–100: força, potencial, força na vaga,
 * compatibilidade de função e resumos de atributos. O cálculo interno não muda.
 */
export const to20 = (v: number): number => Math.max(1, Math.min(20, Math.round(v / 5)));
export const range20 = (r: Range): Range => ({ low: to20(r.low), high: to20(r.high) });

/**
 * Reputação (treinador, clubes e jogadores): o motor usa 0–100; a tela mostra 0–5 estrelas, de meia em meia.
 * 100 → 5; 50 → 2,5; 1 → 0 (arredonda para a meia estrela mais próxima).
 */
export const toStars = (reputation: number): number => Math.max(0, Math.min(5, Math.round(Math.max(0, reputation) / 10) / 2));

/**
 * Reputação de um jogador (0–100), derivada do que é público: o valor de mercado (escala logarítmica, €20 mil → 0 e
 * €60 milhões → 100) pesa 70% e a reputação do clube, 30% (sem clube conta como 20). Não revela a força real.
 */
export function playerReputation(marketValue: number, clubReputation: number | null): number {
  const lo = Math.log10(20_000), hi = Math.log10(60_000_000);
  const fame = Math.max(0, Math.min(100, ((Math.log10(Math.max(marketValue, 1)) - lo) / (hi - lo)) * 100));
  return Math.max(1, Math.min(100, Math.round(0.7 * fame + 0.3 * (clubReputation ?? 20))));
}
