/**
 * Premiação da CONMEBOL 2026 (anúncio da CONMEBOL de 07/04/2026; os manuais não trazem — valores da imprensa, [SEC]: Trivela, Super Rádio
 * Tupi, Lance, Portal Tela; Recopa: Band, 27/02/2026). Em dólares; o jogo converte para euros pela taxa de referência do BCE de 07/04/2026
 * (1 € = US$ 1,1557). Não escala pela economia do país: a CONMEBOL paga o mesmo valor a todos os clubes.
 */
import { LIB_ID, RECOPA_ID, SUD_ID } from './formats.ts';

export const USD_PER_EUR = 1.1557;
export const usdToEur = (usd: number): number => Math.round(usd / USD_PER_EUR / 1000) * 1000;

export const PRIZES_USD = {
  [LIB_ID]: {
    /** por participar da fase (pago quando a fase é montada) */
    stage: { f1: 400_000, f2: 500_000, f3: 600_000, r16: 1_250_000, qf: 1_700_000, sf: 2_300_000 } as Record<string, number>,
    /** fase de grupos: por jogo em casa (o modelo de 2025: US$ 1 mi por jogo como mandante — [SEC]) e por vitória */
    groupHome: 1_000_000, groupWin: 340_000,
    runnerUp: 7_000_000, champion: 25_000_000,
  },
  [SUD_ID]: {
    stage: { po: 500_000, r16: 600_000, qf: 700_000, sf: 800_000 } as Record<string, number>,
    /** primeira fase: mandante e visitante (uma fonte só — Portal Tela, 19/03/2026) */
    p1Home: 225_000, p1Away: 250_000,
    groupHome: 300_000, groupWin: 125_000,
    runnerUp: 2_500_000, champion: 10_000_000,
  },
  /** Recopa 2026: campeão US$ 1,8 mi; vice "metade" (Band) — [SEC] */
  [RECOPA_ID]: { stage: {} as Record<string, number>, runnerUp: 900_000, champion: 1_800_000 },
} as const;

/** Prêmio por participar de uma fase, em euros (0 se a fase não paga na entrada). */
export function stageEntryPrize(formatId: string, stageId: string): number {
  const p = (PRIZES_USD as Record<string, { stage: Record<string, number> }>)[formatId];
  return p?.stage[stageId] ? usdToEur(p.stage[stageId]!) : 0;
}

/** Prêmios por jogo da fase de grupos (mandante e vitória), em euros; null fora dos grupos. */
export function groupMatchPrize(formatId: string): { home: number; win: number } | null {
  if (formatId === LIB_ID) return { home: usdToEur(PRIZES_USD[LIB_ID].groupHome), win: usdToEur(PRIZES_USD[LIB_ID].groupWin) };
  if (formatId === SUD_ID) return { home: usdToEur(PRIZES_USD[SUD_ID].groupHome), win: usdToEur(PRIZES_USD[SUD_ID].groupWin) };
  return null;
}

/** Campeão e vice, em euros. */
export function finalPrizes(formatId: string): { champion: number; runnerUp: number } {
  const p = (PRIZES_USD as Record<string, { champion: number; runnerUp: number }>)[formatId];
  return p ? { champion: usdToEur(p.champion), runnerUp: usdToEur(p.runnerUp) } : { champion: 0, runnerUp: 0 };
}
