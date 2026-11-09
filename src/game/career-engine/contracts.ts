import { clamp } from '../rng.ts';
import type { PlayerDecision } from '../transfer-engine/transfer.ts';
import { playerDecision } from '../transfer-engine/transfer.ts';

/** Ano de início da temporada que contém a data (a temporada vai de 1º/jul a 30/jun). */
export const seasonYearOf = (date: string): number => Number(date.slice(0, 4)) - (date.slice(5) < '07-01' ? 1 : 0);

/** Data da virada que encerra a temporada `season`. */
export const turnoverDate = (season: number): string => `${season + 1}-07-01`;

/** Fim de contrato assinado em `date` por `years` temporadas: sempre 30/jun, para vencer exatamente numa virada. */
export const contractEndFor = (date: string, years: number): string => `${seasonYearOf(date) + years}-06-30`;

/** Um contrato vence na virada `turnover` se terminar até essa data (contratos antigos terminam em 1º/jul ou no meio da temporada). */
export const expiresAt = (contractEnd: string, turnover: string): boolean => contractEnd <= turnover;

/** Ano da virada em que um contrato vence (base para renovações). */
export const contractBaseYear = (contractEnd: string): number => Number(contractEnd.slice(0, 4)) + (contractEnd.slice(5) <= '07-01' ? 0 : 1);

/** Máximo de temporadas que o jogador aceita assinar, pela idade. */
export const maxContractYears = (age: number): number => (age >= 34 ? 1 : age >= 32 ? 2 : age >= 30 ? 3 : 5);

const personalityFactor = (p: { ambition: number; loyalty: number }) =>
  (0.92 + 0.16 * (clamp(p.ambition, 1, 20) / 20)) * (1.04 - 0.08 * (clamp(p.loyalty, 1, 20) / 20));

/** Salário mensal pedido ao usuário para renovar (fidelidade reduz o pedido; ambição aumenta; quem está no auge não aceita redução). */
export function renewalDemand(p: { marketValue: number; salary: number; ambition: number; loyalty: number }): number {
  const base = Math.max(p.marketValue * 0.012, p.salary * 1.08, 1500);
  return Math.round((base * personalityFactor(p)) / 100) * 100;
}

/**
 * Salário de uma renovação feita pela IA: acompanha o valor ATUAL do jogador (veterano em declínio aceita redução) e sobe no
 * máximo 10%. Sem isso, renovações sucessivas inflacionam as folhas e corroem as finanças em poucas temporadas.
 */
export function aiRenewalWage(p: { marketValue: number; salary: number; ambition: number; loyalty: number }): number {
  const fair = Math.max(p.marketValue * 0.012, 1500) * personalityFactor(p);
  return Math.round(Math.min(fair, p.salary * 1.1) / 100) * 100;
}

export type RenewDecision = PlayerDecision | { kind: 'too_long'; maxYears: number };
export function renewalDecision(wage: number, years: number, demand: number, age: number): RenewDecision {
  const maxYears = maxContractYears(age);
  if (years > maxYears) return { kind: 'too_long', maxYears };
  return playerDecision(wage, demand);
}

/** Chance de um clube da IA renovar um contrato que vence: alta para os 14 mais fortes do elenco, menor para o resto. */
export const AI_RENEW_CHANCE = { core: 0.9, other: 0.55 } as const;

/**
 * Rescisão de contrato pelo clube: paga os salários que faltam até o fim do contrato (no mínimo um mês). O jogador sai livre, com a
 * pretensão salarial pelo valor de mercado atual.
 */
export const terminationCost = (salary: number, monthsLeft: number): number => Math.max(0, salary) * Math.max(1, monthsLeft);
