import type { Rng } from '../rng.ts';
import { clamp } from '../rng.ts';

/** Dados econômicos de um clube necessários às fórmulas (todas as fórmulas são puras e mensais, salvo indicação). */
export interface ClubEcon {
  /** Fator econômico do país (1 = referência). */
  econ: number;
  tier: number;
  reputation: number;
  fans: number;
  capacity: number;
  facilities: { training: number; youth: number; medical: number; stadium: number };
}

export type IncomeCategory = 'gate' | 'tv' | 'sponsorship' | 'merchandising' | 'transfer_in';
export type ExpenseCategory = 'wages' | 'staff' | 'maintenance' | 'operations' | 'transfer_out';
export type FinanceCategory = IncomeCategory | ExpenseCategory;
export const INCOME_CATEGORIES: IncomeCategory[] = ['gate', 'tv', 'sponsorship', 'merchandising', 'transfer_in'];
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['wages', 'staff', 'maintenance', 'operations', 'transfer_out'];

/** Calibração (ver teste de calibração e docs/FINANCE.md). */
export const F = {
  /** reputação típica de cada divisão (âncora das fórmulas) */
  refRep: { 1: 65, 2: 44, 3: 30, 4: 20 } as Record<number, number>,
  tvBase: { 1: 0.70e6, 2: 0.27e6, 3: 0.1e6, 4: 0.04e6 } as Record<number, number>,
  sponsorBase: 0.65e6, sponsorExp: 2.4,
  merchPerFan: 1.1,
  staffBase: 15_000, staffPerLevel: 3_000,
  maintPerSeat: 1.0, maintPerLevel: 6_000, maintBase: 30_000,
  opsBase: 0.50e6, opsExp: 2.3,
  ticketBase: 8.5, ticketExp: 1.2,
};

const rep65 = (rep: number, exp: number) => Math.pow(Math.max(rep, 1) / 65, exp);

export const tvMonthly = (c: ClubEcon): number =>
  Math.round(c.econ * (F.tvBase[c.tier] ?? F.tvBase[4]!) * Math.pow(c.reputation / (F.refRep[c.tier] ?? 20), 0.8));
export const merchMonthly = (c: ClubEcon): number => Math.round(c.fans * F.merchPerFan * c.econ);
/** Total mensal de patrocínios (soma dos três contratos) esperado para o clube. */
export const sponsorTotalMonthly = (c: ClubEcon): number => Math.round(c.econ * F.sponsorBase * rep65(c.reputation, F.sponsorExp));
export const staffMonthly = (c: ClubEcon): number =>
  Math.round(c.econ * (F.staffBase + F.staffPerLevel * (c.facilities.training + c.facilities.medical + c.facilities.youth)));
export const maintenanceMonthly = (c: ClubEcon): number =>
  Math.round(c.econ * (c.capacity * F.maintPerSeat + c.facilities.stadium * F.maintPerLevel + F.maintBase));
export const operationsMonthly = (c: ClubEcon): number => Math.round(c.econ * F.opsBase * rep65(c.reputation, F.opsExp));

export type SponsorKind = 'shirt' | 'kit' | 'stadium';
export const SPONSOR_SHARE: Record<SponsorKind, number> = { shirt: 0.55, kit: 0.3, stadium: 0.15 };

export const ticketPrice = (c: ClubEcon): number => Math.round(F.ticketBase * rep65(c.reputation, F.ticketExp) * c.econ * 100) / 100;

export type Weather = 'clear' | 'rain' | 'heat' | 'cold';
const WEATHER_FILL: Record<Weather, number> = { clear: 0, rain: -0.06, heat: -0.03, cold: -0.04 };

/** Taxa de ocupação esperada (sem ruído). */
export function expectedFill(homeRep: number, awayRep: number, weather: Weather): number {
  return clamp(0.42 + 0.0055 * homeRep + 0.0035 * (awayRep - 50) + WEATHER_FILL[weather], 0.25, 1);
}

export function attendance(c: ClubEcon, awayRep: number, weather: Weather, rng: Rng): number {
  const fill = clamp(expectedFill(c.reputation, awayRep, weather) + rng.normal(0, 0.03), 0.2, 1);
  return Math.round(c.capacity * fill);
}

export const gateRevenue = (att: number, c: ClubEcon): number => Math.round(att * ticketPrice(c));

/** Estimativa de resultado anual do clube (usa fluxo esperado de bilheteria: 19 jogos em casa). */
export function annualEstimate(c: ClubEcon, monthlyWages: number): { income: number; expense: number; net: number } {
  const gate = 19 * gateRevenue(Math.round(c.capacity * expectedFill(c.reputation, 50, 'clear')), c);
  const income = 12 * (tvMonthly(c) + merchMonthly(c) + sponsorTotalMonthly(c)) + gate;
  const expense = 12 * (monthlyWages + staffMonthly(c) + maintenanceMonthly(c) + operationsMonthly(c));
  return { income, expense, net: income - expense };
}
