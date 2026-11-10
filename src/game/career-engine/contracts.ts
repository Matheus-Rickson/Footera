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

// ---------------------------------------------------------------- tempo de jogo (status no elenco)
/** Status de tempo de jogo combinado com o jogador (faz parte do contrato). */
export type SquadStatus = 'key' | 'starter' | 'rotation' | 'backup' | 'prospect';
export const SQUAD_STATUSES: readonly SquadStatus[] = ['key', 'starter', 'rotation', 'backup', 'prospect'];
/**
 * Rótulo, parte dos minutos que o jogador espera jogar e peso no salário pedido. O peso vale em relação ao status atual: manter o status
 * não muda o pedido; subir de Rotação (1,00) para Titular (1,05) pede 5% a mais; descer para Reserva (0,92), 8% a menos.
 */
export const STATUS_INFO: Record<SquadStatus, { label: string; expected: number; wageFactor: number }> = {
  key: { label: 'Jogador-chave', expected: 0.85, wageFactor: 1.15 },
  starter: { label: 'Titular', expected: 0.7, wageFactor: 1.05 },
  rotation: { label: 'Rotação', expected: 0.4, wageFactor: 1 },
  backup: { label: 'Reserva', expected: 0.15, wageFactor: 0.92 },
  prospect: { label: 'Promessa', expected: 0.1, wageFactor: 0.9 },
};
/** Promessa só até esta idade. */
export const PROSPECT_MAX_AGE = 21;
export const statusRank = (s: SquadStatus): number => SQUAD_STATUSES.indexOf(s);

/**
 * Status padrão de um elenco (carreira nova ou jogador que chega): pela força, os 3 melhores são jogadores-chave, os 8 seguintes titulares,
 * os 7 seguintes rotação; do resto, até 21 anos é promessa e os demais, reserva. Empate de força: pelo id (determinístico).
 */
export function defaultStatuses(squad: ReadonlyArray<{ id: string; overall: number; age: number }>): Map<string, SquadStatus> {
  const sorted = [...squad].sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
  return new Map(sorted.map((p, i) => [p.id, i < 3 ? 'key' : i < 11 ? 'starter' : i < 18 ? 'rotation' : p.age <= PROSPECT_MAX_AGE ? 'prospect' : 'backup']));
}

/** Jogos do clube, desde a última avaliação, para julgar o tempo de jogo (com menos, a avaliação fica para o mês seguinte). */
export const PLAYING_TIME_MIN_MATCHES = 3;
export type PlayingTimeVerdict = 'happy' | 'ok' | 'unhappy';
/** Efeito de cada veredito na moral (0–100). */
export const PLAYING_TIME_MORALE: Record<PlayingTimeVerdict, number> = { happy: 2, ok: 0, unhappy: -6 };
/** Abaixo de 60% dos minutos esperados: insatisfeito; no esperado ou acima: satisfeito; entre os dois: sem efeito. */
export function playingTimeVerdict(share: number, expected: number): PlayingTimeVerdict {
  if (share < 0.6 * expected) return 'unhappy';
  return share >= expected ? 'happy' : 'ok';
}

// ---------------------------------------------------------------- renegociação (a qualquer momento)
/** Ofertas insuficientes que o jogador aceita discutir; na última ele encerra a conversa. */
export const MAX_RENEGOTIATION_ROUNDS = 3;
/** Dias até o jogador aceitar conversar de novo depois de encerrar. */
export const RENEGOTIATION_LOCK_DAYS = 30;
/** Parte da diferença entre a oferta e o que ele quer que o jogador cede na contraproposta. */
export const COUNTER_SHARE = 0.4;
/** A contraproposta nunca fica abaixo desta fração do que ele quer (oferta muito baixa não derruba o salário). */
export const COUNTER_FLOOR = 0.85;
/** Rebaixamento de status aceito: moral perdida por degrau descido. */
export const DEMOTION_MORALE = -5;

/** Salário que o jogador quer para assinar com o novo status (pedido de renovação × peso do status novo em relação ao atual). */
export function renegotiationTarget(demand: number, current: SquadStatus, next: SquadStatus): number {
  return Math.round((demand * STATUS_INFO[next].wageFactor) / STATUS_INFO[current].wageFactor / 100) * 100;
}

export type RenegotiationReply = { kind: 'accept' } | { kind: 'counter'; wage: number; roundsLeft: number } | { kind: 'walkout' };
/**
 * Resposta do jogador a uma oferta. `round` = ofertas insuficientes já feitas nesta conversa; `lastCounter` = o último pedido dele nos
 * mesmos termos (status e temporadas), que ele sempre aceita. Oferta ≥ 97% do que ele quer: aceita. Senão contrapropõe: oferta + 40% da
 * diferença, nunca abaixo de 85% do que ele quer nem acima do pedido anterior. Na 3ª oferta insuficiente, encerra a conversa.
 */
export function renegotiationReply(a: { offered: number; target: number; round: number; lastCounter: number | null }): RenegotiationReply {
  if (a.offered >= a.target * 0.97 || (a.lastCounter !== null && a.offered >= a.lastCounter)) return { kind: 'accept' };
  if (a.round + 1 >= MAX_RENEGOTIATION_ROUNDS) return { kind: 'walkout' };
  let wage = Math.round(Math.max(a.offered + COUNTER_SHARE * (a.target - a.offered), COUNTER_FLOOR * a.target) / 100) * 100;
  if (a.lastCounter !== null) wage = Math.min(wage, a.lastCounter);
  if (wage <= a.offered) return { kind: 'accept' };
  return { kind: 'counter', wage, roundsLeft: MAX_RENEGOTIATION_ROUNDS - (a.round + 1) };
}

/** Meses além do limite de temporadas da idade que um contrato renegociado pode ter (o que resta do atual conta). */
export const RENEGOTIATION_EXTRA_MONTHS = 24;
