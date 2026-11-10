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
  facilities: { training: number; youth: number; medical: number; stadium: number; scouting?: number; recruitment?: number };
}

export type IncomeCategory = 'gate' | 'tv' | 'sponsorship' | 'merchandising' | 'transfer_in' | 'prize';
export type ExpenseCategory = 'wages' | 'staff' | 'maintenance' | 'operations' | 'transfer_out' | 'youth' | 'scouting' | 'coaching' | 'infrastructure';
export type FinanceCategory = IncomeCategory | ExpenseCategory;
export const INCOME_CATEGORIES: IncomeCategory[] = ['gate', 'tv', 'sponsorship', 'merchandising', 'transfer_in', 'prize'];
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['wages', 'staff', 'maintenance', 'operations', 'transfer_out', 'youth', 'scouting', 'coaching', 'infrastructure'];

/** Calibração (ver teste de calibração e docs/FINANCE.md). */
export const F = {
  /** reputação típica de cada divisão (âncora das fórmulas) */
  refRep: { 1: 65, 2: 44, 3: 30, 4: 20 } as Record<number, number>,
  tvBase: { 1: 0.70e6, 2: 0.27e6, 3: 0.1e6, 4: 0.04e6 } as Record<number, number>,
  /**
   * Cota de participação mensal (× economia) paga a todo clube da 3ª divisão para baixo, independente da reputação: sem ela as receitas (que
   * caem com a reputação) não cobrem os pisos de custo. Recalibrada na v0.8.10 junto com o salário mínimo por país, o porte (`sizeFactor`) e o
   * piso de patrocínio: antes 80/105/120 mil, com custos de clube grande, a Série D movimentava ~€ 1,3 milhão por ano (≈ R$ 8 milhões; na
   * realidade, R$ 0,5–2 milhões). Valores = o que faltava ao clube mediano de cada divisão para a margem ficar perto de +2% (base fixa).
   */
  participation: { 3: 25_000, 4: 18_000, 5: 16_000 } as Record<number, number>,
  /**
   * Piso mensal de patrocínio (× economia) da 3ª divisão para baixo (v0.8.10, pedido do usuário): com o expoente 2,4 da reputação, um clube
   * da Série D recebia ~3% do valor de referência (Brasiliense: € 12 mil/mês, menos que a venda de camisas), enquanto nesses clubes o
   * patrocínio (casas de apostas, empresas regionais) é a principal receita.
   */
  sponsorFloor: { 3: 30_000, 4: 40_000, 5: 35_000 } as Record<number, number>,
  sponsorBase: 0.65e6, sponsorExp: 2.4,
  merchPerFan: 1.1,
  staffBase: 15_000, staffPerLevel: 3_000,
  maintPerSeat: 1.0, maintPerLevel: 6_000, maintBase: 30_000,
  opsBase: 0.50e6, opsExp: 2.3,
  ticketBase: 8.5, ticketExp: 1.2,
  /** porte do clube (custos fixos de estrutura e estádio, produtos licenciados): reputação / sizeRep, entre sizeMin e 1 */
  sizeRep: 30, sizeMin: 0.2,
};

/**
 * Porte do clube (0,2–1): clubes de reputação 30+ (praticamente toda 1ª e 2ª divisão) pagam a estrutura e o estádio cheios; abaixo disso,
 * custos fixos e venda de produtos caem com a reputação. Antes eram iguais para todos, e um clube da Série D gastava com estrutura e
 * estádio quase o orçamento real inteiro de um clube dessa divisão (v0.8.10; docs/FINANCE.md).
 */
export const sizeFactor = (reputation: number): number => clamp(reputation / F.sizeRep, F.sizeMin, 1);

/** Salário mínimo mensal do país: 1.000 × economia, entre 100 e 1.500 (Brasil 600 ≈ R$ 3,7 mil; Inglaterra 1.500). Antes: 1.500 para todos. */
export const MIN_SALARY = { perEconomy: 1000, min: 100, max: 1500, legacy: 1500 } as const;
export const minSalary = (economy: number): number => Math.round(clamp(economy * MIN_SALARY.perEconomy, MIN_SALARY.min, MIN_SALARY.max) / 100) * 100;
/** Salário pelo valor (1,2% do valor de mercado ao mês, em centenas), nunca abaixo do mínimo do país. */
export const fairSalary = (marketValue: number, economy: number): number => Math.max(Math.round((marketValue * 0.012) / 100) * 100, minSalary(economy));
/**
 * Quem ganhava exatamente o piso antigo (1.500) porque o valor dava menos passa ao salário pelo valor com o mínimo do país (bases, pacotes e
 * saves feitos antes da v0.8.10). Salários acima do piso antigo, ou de quem vale mais, não mudam.
 */
export function rebasedFloorSalary(salary: number, marketValue: number, economy: number): number {
  if (salary !== MIN_SALARY.legacy || Math.round((marketValue * 0.012) / 100) * 100 >= MIN_SALARY.legacy) return salary;
  return fairSalary(marketValue, economy);
}

const rep65 = (rep: number, exp: number) => Math.pow(Math.max(rep, 1) / 65, exp);

/** Direitos de TV + cota de participação das divisões de baixo (3ª em diante; ver `F.participation`). */
export const tvMonthly = (c: ClubEcon): number =>
  Math.round(c.econ * ((F.tvBase[c.tier] ?? F.tvBase[4]!) * Math.pow(c.reputation / (F.refRep[c.tier] ?? 20), 0.8) + participationOf(c.tier)));
export const participationOf = (tier: number): number => (tier >= 3 ? F.participation[Math.min(tier, 5)] ?? 0 : 0);
export const merchMonthly = (c: ClubEcon): number => Math.round(c.fans * F.merchPerFan * c.econ * sizeFactor(c.reputation));
/** Piso de patrocínio da divisão (3ª em diante; ver `F.sponsorFloor`). */
export const sponsorFloorOf = (tier: number): number => (tier >= 3 ? F.sponsorFloor[Math.min(tier, 5)] ?? 0 : 0);
/** Total mensal de patrocínios (soma dos três contratos) esperado para o clube: piso da divisão + parte pela reputação. */
export const sponsorTotalMonthly = (c: ClubEcon): number => Math.round(c.econ * (sponsorFloorOf(c.tier) + F.sponsorBase * rep65(c.reputation, F.sponsorExp)));
export const staffMonthly = (c: ClubEcon): number =>
  Math.round(c.econ * sizeFactor(c.reputation) * (F.staffBase + F.staffPerLevel * (c.facilities.training + c.facilities.medical + c.facilities.youth)));
/**
 * Clube do usuário (Fase 8C): a comissão técnica é contratada à parte (categoria `coaching`); aqui fica só a estrutura — categorias de base,
 * administração do futebol e a manutenção do centro de treinamento e do departamento médico (metade do peso que esses níveis têm em `staffMonthly`).
 */
export const staffUserMonthly = (c: ClubEcon): number =>
  Math.round(c.econ * sizeFactor(c.reputation) * (F.staffBase + F.staffPerLevel * c.facilities.youth + (F.staffPerLevel / 2) * (c.facilities.training + c.facilities.medical)
    + (F.staffPerLevel / 3) * ((c.facilities.scouting ?? 10) + (c.facilities.recruitment ?? 10) - 20)));
/**
 * Parte da manutenção mensal de cada instalação do usuário (cards da Infraestrutura). Base: nível × 3.000 (× economia); treino e médico
 * metade; scouting e rede de captação um terço (no nível 10 o total é o mesmo de antes deles existirem); estádio = manutenção do estádio.
 */
export function facilityMonthly(c: ClubEcon, kind: 'training' | 'youth' | 'medical' | 'stadium' | 'scouting' | 'recruitment'): number {
  if (kind === 'stadium') return maintenanceMonthly(c);
  const w = kind === 'youth' ? 1 : kind === 'training' || kind === 'medical' ? 1 / 2 : 1 / 3;
  return Math.round(c.econ * sizeFactor(c.reputation) * F.staffPerLevel * w * (c.facilities[kind] ?? 10));
}
export const maintenanceMonthly = (c: ClubEcon): number =>
  Math.round(c.econ * sizeFactor(c.reputation) * (c.capacity * F.maintPerSeat + c.facilities.stadium * F.maintPerLevel + F.maintBase));
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

/**
 * Folha fora da realidade do clube: acima de `over` da receita anual estimada, os salários do elenco são reduzidos proporcionalmente até
 * `to` da receita. Acontece com salários reais de pacotes de dados (ex.: folha 4× a receita), que levavam o clube ao vermelho já na 1ª
 * temporada. Aplicado só na montagem do universo (compile); a base gerada fica abaixo do limite.
 */
export const WAGE_CAP = { over: 0.8, to: 0.65 } as const;
/** Fator (≤ 1) a aplicar nos salários para a folha caber na receita; 1 = sem ajuste. */
export function wageCapFactor(c: ClubEcon, monthlyWages: number): number {
  if (monthlyWages <= 0) return 1;
  const income = annualEstimate(c, monthlyWages).income;
  return 12 * monthlyWages > WAGE_CAP.over * income ? (WAGE_CAP.to * income) / (12 * monthlyWages) : 1;
}

/** Estimativa de resultado anual do clube (usa fluxo esperado de bilheteria: 19 jogos em casa). */
export function annualEstimate(c: ClubEcon, monthlyWages: number): { income: number; expense: number; net: number } {
  const gate = 19 * gateRevenue(Math.round(c.capacity * expectedFill(c.reputation, 50, 'clear')), c);
  const income = 12 * (tvMonthly(c) + merchMonthly(c) + sponsorTotalMonthly(c)) + gate;
  const expense = 12 * (monthlyWages + staffMonthly(c) + maintenanceMonthly(c) + operationsMonthly(c));
  return { income, expense, net: income - expense };
}
