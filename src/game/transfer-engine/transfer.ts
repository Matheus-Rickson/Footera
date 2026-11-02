import { createRng } from '../rng.ts';
import { parseIso } from '../../shared/date.ts';
import type { Position } from '../../shared/types.ts';

/** Janelas de transferência (MM-DD, fim exclusivo). Configuráveis por liga na Fase 9; por ora iguais para todos. */
export const WINDOWS = [{ start: '07-01', end: '09-01' }, { start: '01-01', end: '02-01' }] as const;
export const SQUAD_MAX = 30;
export const SQUAD_MIN = 18;
export const OFFER_VALID_DAYS = 7;

export interface WindowStatus { open: boolean; opensOn: string | null; closesOn: string | null }

export function windowStatus(date: string): WindowStatus {
  const { y } = parseIso(date);
  const md = date.slice(5);
  for (const w of WINDOWS) if (md >= w.start && md < w.end) return { open: true, opensOn: null, closesOn: `${y}-${w.end}` };
  // próxima abertura
  const upcoming = WINDOWS.map((w) => `${y}-${w.start}`).filter((d) => d > date).sort()[0] ?? `${y + 1}-${WINDOWS[1].start}`;
  return { open: false, opensOn: upcoming, closesOn: null };
}

export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'ATT';
export const groupOf = (pos: Position): PositionGroup =>
  pos === 'GK' ? 'GK' : pos === 'CB' || pos === 'LB' || pos === 'RB' ? 'DEF' : pos === 'DM' || pos === 'CM' || pos === 'AM' ? 'MID' : 'ATT';

export interface PricedPlayer {
  marketValue: number; age: number; overall: number; potentialHidden: number; contractMonthsLeft: number; isKey: boolean;
}

/** Preço que o clube vendedor pede (arredondado ao milhar). */
export function askingPrice(p: PricedPlayer, seller: { balance: number }): number {
  let ask = p.marketValue;
  const m = p.contractMonthsLeft;
  ask *= m <= 6 ? 0.55 : m <= 12 ? 0.75 : m <= 24 ? 0.92 : 1.05;
  if (p.age <= 23) ask *= 1 + Math.max(p.potentialHidden - p.overall, 0) / 80;
  if (p.age >= 32) ask *= 0.8;
  if (p.isKey) ask *= 1.25;
  if (seller.balance < 0) ask *= 0.88;
  return Math.max(Math.round(ask / 1000) * 1000, 1000);
}

/** Salário mensal que o jogador exige para se transferir (depende do prestígio do novo clube e da ambição). */
export function wageDemand(p: { marketValue: number; salary: number; ambition: number }, fromReputation: number, toReputation: number): number {
  const base = Math.max(p.marketValue * 0.012, p.salary * 1.05, 1500);
  const prestige = toReputation - fromReputation;
  const f = prestige >= 10 ? 0.92 : prestige <= -10 ? 1.2 : 1;
  return Math.round((base * f * (0.9 + 0.2 * (p.ambition / 20))) / 100) * 100;
}

export type ClubDecision = { kind: 'accept' } | { kind: 'counter'; fee: number } | { kind: 'reject' };
export function clubDecision(fee: number, ask: number): ClubDecision {
  if (fee >= ask) return { kind: 'accept' };
  if (fee >= ask * 0.85) return { kind: 'counter', fee: ask };
  return { kind: 'reject' };
}
export type PlayerDecision = { kind: 'accept' } | { kind: 'counter'; wage: number } | { kind: 'reject' };
export function playerDecision(wage: number, demand: number): PlayerDecision {
  if (wage >= demand * 0.97) return { kind: 'accept' };
  if (wage >= demand * 0.8) return { kind: 'counter', wage: demand };
  return { kind: 'reject' };
}

export interface Range { low: number; high: number }
/**
 * Estimativa de qualidade com margem de erro (o usuário não vê os atributos reais antes de contratar).
 * O ruído é fixo por jogador (semente), então atualizar a tela não revela o valor verdadeiro. A faixa sempre contém o valor real.
 */
export function estimateRange(overall: number, potentialEstimated: number, seed: string, playerId: string): { overall: Range; potential: Range } {
  const rng = createRng(`scout:${seed}:${playerId}`);
  const o = overall + rng.int(-4, 4), p = potentialEstimated + rng.int(-3, 3);
  const clamp = (v: number) => Math.max(1, Math.min(100, v));
  return { overall: { low: clamp(o - 6), high: clamp(o + 6) }, potential: { low: clamp(p - 8), high: clamp(Math.max(p + 8, o + 6)) } };
}

/** Após a saída de um jogador o elenco ainda tem que ter tamanho mínimo e goleiros/defensores/meias/atacantes suficientes. */
export function squadStaysValid(players: ReadonlyArray<{ id: string; position: Position }>, leavingId: string, minSize = SQUAD_MIN): boolean {
  const rest = players.filter((p) => p.id !== leavingId);
  const count = (g: PositionGroup) => rest.filter((p) => groupOf(p.position) === g).length;
  return rest.length >= minSize && count('GK') >= 2 && count('DEF') >= 6 && count('MID') >= 4 && count('ATT') >= 3;
}
