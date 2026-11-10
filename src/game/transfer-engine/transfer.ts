import { createRng } from '../rng.ts';
import { parseIso } from '../../shared/date.ts';
import type { Attributes, Position } from '../../shared/types.ts';

/** Janelas de transferência (MM-DD, fim exclusivo). Configuráveis por liga na Fase 9; por ora iguais para todos. */
export const WINDOWS = [{ start: '07-01', end: '09-01' }, { start: '01-01', end: '02-01' }] as const;
export const SQUAD_MAX = 35;
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
  pos === 'GK' ? 'GK' : pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB' ? 'DEF' : pos === 'DM' || pos === 'CM' || pos === 'AM' || pos === 'LM' || pos === 'RM' ? 'MID' : 'ATT';

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

/**
 * Salário mensal que o jogador exige para se transferir (depende do prestígio do novo clube e da ambição). `floor` = salário mínimo do país
 * do clube que contrata (`minSalary`); o padrão é o piso antigo de 1.500.
 */
export function wageDemand(p: { marketValue: number; salary: number; ambition: number }, fromReputation: number, toReputation: number, floor = 1500): number {
  const base = Math.max(p.marketValue * 0.012, p.salary * 1.05, floor);
  const prestige = toReputation - fromReputation;
  const f = prestige >= 10 ? 0.92 : prestige <= -10 ? 1.2 : 1;
  return Math.round((base * f * (0.9 + 0.2 * (p.ambition / 20))) / 100) * 100;
}

/**
 * Disposição do clube vendedor em negociar (0..100), só com dados públicos: os mesmos fatores que baixam o preço pedido em
 * `askingPrice` (contrato perto do fim, jogador veterano, caixa negativo). Não usa a força real nem o status de titular.
 */
export function sellerWillingness(a: { contractMonthsLeft: number; age: number; sellerBalance: number; canSell: boolean }): number {
  if (!a.canSell) return 0;
  const m = a.contractMonthsLeft;
  let v = m <= 6 ? 85 : m <= 12 ? 70 : m <= 24 ? 50 : 35;
  if (a.age >= 32) v += 10;
  if (a.sellerBalance < 0) v += 10;
  return Math.min(100, v);
}
/** Interesse do jogador na mudança (0..100) pelo prestígio relativo dos clubes, o fator público de `wageDemand`. */
export function playerInterest(toReputation: number, fromReputation: number): number {
  return Math.max(5, Math.min(95, Math.round(50 + (toReputation - fromReputation) * 2.5)));
}

export type ClubDecision = { kind: 'accept' } | { kind: 'counter'; fee: number } | { kind: 'reject' };
export function clubDecision(fee: number, ask: number): ClubDecision {
  if (fee >= ask) return { kind: 'accept' };
  if (fee >= ask * 0.85) return { kind: 'counter', fee: ask };
  return { kind: 'reject' };
}
/** Contrapropostas que o usuário pode fazer numa proposta recebida; depois disso o comprador só aceita ou desiste. */
export const MAX_COUNTER_ROUNDS = 2;
export type BuyerReply = { kind: 'accept' } | { kind: 'counter'; fee: number } | { kind: 'withdraw' };
/**
 * Resposta do clube comprador (IA) a uma contraproposta do usuário. O teto que ele aceita pagar é o maior entre a proposta e o valor de
 * mercado, × 1,10–1,35 (sorteio fixo por proposta e rodada), nunca acima do caixa. Pedido até o teto: aceita. Até 30% acima do teto e com
 * rodadas sobrando: cobre com um valor intermediário (entre a proposta atual e o pedido, sem passar do teto). Acima disso: desiste.
 */
export function buyerReply(a: { offer: number; asked: number; marketValue: number; buyerBalance: number; rounds: number }, roll: number): BuyerReply {
  const ceiling = Math.min(a.buyerBalance, Math.max(a.offer, a.marketValue) * (1.1 + 0.25 * Math.max(0, Math.min(1, roll))));
  if (a.asked <= Math.max(a.offer, ceiling)) return { kind: 'accept' };
  if (a.rounds < MAX_COUNTER_ROUNDS && a.asked <= ceiling * 1.3) {
    const fee = Math.round(Math.min(ceiling, (a.offer + a.asked) / 2) / 1000) * 1000;
    if (fee > a.offer) return { kind: 'counter', fee };
  }
  return { kind: 'withdraw' };
}

export type PlayerDecision = { kind: 'accept' } | { kind: 'counter'; wage: number } | { kind: 'reject' };
export function playerDecision(wage: number, demand: number): PlayerDecision {
  if (wage >= demand * 0.97) return { kind: 'accept' };
  if (wage >= demand * 0.8) return { kind: 'counter', wage: demand };
  return { kind: 'reject' };
}

export interface Range { low: number; high: number }
/**
 * Estimativa de qualidade com margem de erro. O ruído é fixo por jogador (semente), então atualizar a tela não revela o valor verdadeiro.
 * A faixa de força sempre contém o valor real. `knowledge` (0..100, olheiros) estreita as faixas: sem conhecimento, ±12 na força (ex.: 32–56)
 * e ±14 no potencial; com 100%, o valor exato (força atual e potencial real).
 */
export function estimateRange(overall: number, potentialEstimated: number, seed: string, playerId: string, knowledge = 0, potentialHidden = potentialEstimated): { overall: Range; potential: Range } {
  const rng = createRng(`scout:${seed}:${playerId}`);
  const f = 1 - Math.max(0, Math.min(100, knowledge)) / 100;
  const o = overall + Math.round(rng.int(-4, 4) * f);
  const p = Math.round(potentialEstimated + (potentialHidden - potentialEstimated) * (1 - f)) + Math.round(rng.int(-3, 3) * f);
  const halfO = Math.round(12 * f), halfP = Math.round(14 * f);
  const clamp = (v: number) => Math.max(1, Math.min(100, v));
  return { overall: { low: clamp(o - halfO), high: clamp(o + halfO) }, potential: { low: clamp(p - halfP), high: clamp(Math.max(p + halfP, o + halfO)) } };
}

/** Conhecimento a partir do qual o jogador conta como "bem observado" (filtro do mercado). */
export const WELL_KNOWN = 50;
export type AttributeRanges = { [G in keyof Attributes]: Record<string, Range> };

/**
 * Atributos (1..20) como o usuário os enxerga num jogador de outro clube: faixas que sempre contêm o valor real e são fixas por jogador
 * (semente), de ±5 sem conhecimento até o valor exato com 100% de observação (regra 7). Sempre há uma estimativa (nunca null).
 */
export function estimateAttributes(attrs: Attributes, seed: string, playerId: string, knowledge: number): AttributeRanges {
  const f = 1 - Math.max(0, Math.min(100, knowledge)) / 100;
  const half = Math.round(5 * f);
  const rng = createRng(`scout-attr:${seed}:${playerId}`);
  const group = (g: Record<string, number>) => Object.fromEntries(Object.keys(g).sort().map((k) => {
    const c = g[k]! + Math.round(rng.int(-2, 2) * f);
    return [k, { low: Math.max(1, c - half), high: Math.min(20, c + half) }];
  }));
  return { technical: group(attrs.technical as unknown as Record<string, number>), mental: group(attrs.mental as unknown as Record<string, number>), physical: group(attrs.physical as unknown as Record<string, number>),
    ...(attrs.goalkeeper ? { goalkeeper: group(attrs.goalkeeper as unknown as Record<string, number>) } : {}) };
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
