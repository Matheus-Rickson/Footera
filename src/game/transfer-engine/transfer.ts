import { createRng } from '../rng.ts';
import { parseIso } from '../../shared/date.ts';
import type { Attributes, Position } from '../../shared/types.ts';

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
 * O ruído é fixo por jogador (semente), então atualizar a tela não revela o valor verdadeiro. A faixa de força sempre contém o valor real.
 * `knowledge` (0..100, rede de olheiros) estreita as faixas e leva o centro do potencial ao valor oculto; com 0 o resultado é o de antes dos olheiros.
 */
export function estimateRange(overall: number, potentialEstimated: number, seed: string, playerId: string, knowledge = 0, potentialHidden = potentialEstimated): { overall: Range; potential: Range } {
  const rng = createRng(`scout:${seed}:${playerId}`);
  const f = 1 - Math.max(0, Math.min(100, knowledge)) / 100;
  const o = overall + Math.round(rng.int(-4, 4) * f);
  const p = Math.round(potentialEstimated + (potentialHidden - potentialEstimated) * (1 - f)) + Math.round(rng.int(-3, 3) * f);
  const halfO = 1 + Math.round(5 * f), halfP = 2 + Math.round(6 * f);
  const clamp = (v: number) => Math.max(1, Math.min(100, v));
  return { overall: { low: clamp(o - halfO), high: clamp(o + halfO) }, potential: { low: clamp(p - halfP), high: clamp(Math.max(p + halfP, o + halfO)) } };
}

/** Conhecimento mínimo (0..100) para os olheiros relatarem atributos individuais. */
export const ATTR_MIN_KNOWLEDGE = 25;
export type AttributeRanges = { [G in keyof Attributes]: Record<string, Range> };

/**
 * Atributos (1..20) como o usuário os enxerga num jogador de outro clube: null abaixo de `ATTR_MIN_KNOWLEDGE`; depois, faixas de ±3 (25%) a ±1 (100%)
 * que sempre contêm o valor real e são fixas por jogador (semente). Nunca revela o valor exato (regra 7).
 */
export function estimateAttributes(attrs: Attributes, seed: string, playerId: string, knowledge: number): AttributeRanges | null {
  if (knowledge < ATTR_MIN_KNOWLEDGE) return null;
  const f = 1 - Math.min(100, knowledge) / 100;
  const half = 1 + Math.round(3 * f);
  const rng = createRng(`scout-attr:${seed}:${playerId}`);
  const group = (g: Record<string, number>) => Object.fromEntries(Object.keys(g).sort().map((k) => {
    const c = g[k]! + Math.round(rng.int(-2, 2) * f);
    return [k, { low: Math.max(1, c - half), high: Math.min(20, c + half) }];
  }));
  return { technical: group(attrs.technical as unknown as Record<string, number>), mental: group(attrs.mental as unknown as Record<string, number>), physical: group(attrs.physical as unknown as Record<string, number>) };
}

/** Titulares por setor numa formação típica (4-4-2), usados no parecer do olheiro. */
const STARTERS: Record<PositionGroup, number> = { GK: 1, DEF: 4, MID: 4, ATT: 2 };

/**
 * Parecer do olheiro: compara a força estimada (centro da faixa) com o elenco do usuário no mesmo setor e destaca promessas.
 * `squad` = forças do elenco do usuário naquele setor.
 */
export function scoutVerdict(est: { overall: number; potential: number; age: number; group: PositionGroup; knowledge: number }, squad: readonly number[]): { level: 'starter' | 'rotation' | 'depth' | 'no'; text: string } {
  const sorted = [...squad].sort((a, b) => b - a);
  const starterBar = sorted[STARTERS[est.group] - 1] ?? 0, worst = sorted.at(-1) ?? 0;
  const prospect = est.age <= 21 && est.potential - est.overall >= 8 ? ' Promessa: pode crescer bastante.' : '';
  const doubt = est.knowledge < 50 ? ' (relatório ainda pouco preciso)' : '';
  if (est.overall > (sorted[0] ?? 0)) return { level: 'starter', text: `Seria o melhor do elenco no setor${doubt}.${prospect}` };
  if (est.overall >= starterBar) return { level: 'starter', text: `Brigaria por vaga de titular${doubt}.${prospect}` };
  if (est.overall >= worst) return { level: 'rotation', text: `Reforço para o banco${doubt}.${prospect}` };
  if (prospect) return { level: 'depth', text: `Não melhora o elenco hoje${doubt}.${prospect}` };
  return { level: 'no', text: `Não melhora o elenco${doubt}.` };
}

/** Após a saída de um jogador o elenco ainda tem que ter tamanho mínimo e goleiros/defensores/meias/atacantes suficientes. */
export function squadStaysValid(players: ReadonlyArray<{ id: string; position: Position }>, leavingId: string, minSize = SQUAD_MIN): boolean {
  const rest = players.filter((p) => p.id !== leavingId);
  const count = (g: PositionGroup) => rest.filter((p) => groupOf(p.position) === g).length;
  return rest.length >= minSize && count('GK') >= 2 && count('DEF') >= 6 && count('MID') >= 4 && count('ATT') >= 3;
}
