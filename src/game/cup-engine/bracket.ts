/**
 * Chaveamento das copas (puro e determinístico): quem estreia em cada fase, folgas, sorteio dos confrontos, mando, datas e premiação.
 * Ver formats.ts (regras por país) e docs/COPAS_NACIONAIS.md.
 */
import type { Rng } from '../rng.ts';
import { addDays, nextWeekdayOnOrAfter } from '../../shared/date.ts';
import type { CupDraw, CupFormat, CupHost } from './formats.ts';

/** Clube na copa: divisão (1 = primeira) e posição no ranking da copa (0 = melhor; divisão, campanha anterior e reputação). */
export interface CupClub { id: string; tier: number; rank: number }

/** Ordena os participantes: divisão, posição na liga da temporada anterior (se houver) e reputação. */
export function rankCupClubs(clubs: ReadonlyArray<{ id: string; tier: number; prevPosition: number | null; reputation: number }>): CupClub[] {
  return [...clubs]
    .sort((a, b) => a.tier - b.tier || (a.prevPosition ?? 999) - (b.prevPosition ?? 999) || b.reputation - a.reputation || a.id.localeCompare(b.id))
    .map((c, rank) => ({ id: c.id, tier: c.tier, rank }));
}

/** Fase de estreia de cada clube (os "melhores N" primeiro; depois por divisão). Clubes de divisões que o formato não usa ficam de fora. */
export function entryStages(format: CupFormat, ranked: readonly CupClub[]): Map<string, number> {
  const entry = new Map<string, number>();
  format.stages.forEach((s, i) => { if (s.enterBest) for (const c of ranked.filter((x) => !entry.has(x.id)).slice(0, s.enterBest)) entry.set(c.id, i); });
  format.stages.forEach((s, i) => { for (const c of ranked) if (!entry.has(c.id) && s.enterTiers?.includes(c.tier)) entry.set(c.id, i); });
  return entry;
}

/**
 * Plano de folgas: quantos avançam sem jogar em cada fase. Usa as folgas declaradas no formato quando a conta fecha (a base do jogo);
 * se não fechar (um pacote mudou o número de clubes), calcula: de trás para a frente, cada fase precisa entregar clubes suficientes
 * para a seguinte; a fase anterior entrega o máximo possível (menos folgas adiante).
 */
export function planByes(format: CupFormat, entrantsPerStage: readonly number[]): { byes: number[]; pools: number[]; declared: boolean; entryAll?: number } {
  const n = format.stages.length;
  /** pools de cada fase para estas folgas e entradas; null se a conta não fecha (sobra ímpar, folga demais, não termina em 2 → 1) */
  const tryPlan = (byes: readonly number[], entrants: readonly number[]): number[] | null => {
    const pools: number[] = [];
    let carry = 0;
    for (let s = 0; s < n; s++) {
      const pool = carry + (entrants[s] ?? 0);
      const b = byes[s] ?? 0;
      if (b < 0 || b > pool || (pool - b) % 2 !== 0) return null;
      pools.push(pool);
      carry = b + (pool - b) / 2;
    }
    return carry === 1 && pools[n - 1] === 2 ? pools : null;
  };
  const declared = format.stages.map((s) => s.byes ?? 0);
  const ok = tryPlan(declared, entrantsPerStage);
  if (ok) return { byes: declared, pools: ok, declared: true };
  // cálculo: saída exigida de cada fase, de trás para a frente; cada fase entrega o máximo possível
  const out = new Array<number>(n).fill(0);
  out[n - 1] = 1;
  for (let s = n - 1; s > 0; s--) out[s - 1] = Math.max(0, 2 * out[s]! - (entrantsPerStage[s] ?? 0));
  const byes: number[] = [];
  let carry = 0;
  for (let s = 0; s < n; s++) {
    const pool = carry + (entrantsPerStage[s] ?? 0);
    const want = Math.min(out[s]!, pool);
    const b = Math.max(0, 2 * want - pool);
    byes.push(b);
    carry = b + (pool - b) / 2;
  }
  const pools = tryPlan(byes, entrantsPerStage);
  if (pools) return { byes, pools, declared: false };
  // reserva: clubes demais para as fases preliminares → todos estreiam na primeira fase em que cabem (folgas para os melhores)
  const total = entrantsPerStage.reduce((x, y) => x + y, 0);
  for (let s = 0; s < n; s++) {
    const size = 2 ** (n - s);
    if (total > size || total <= size / 2) continue;
    const entrants = Array.from({ length: n }, (_, i) => (i === s ? total : 0));
    const b = Array.from({ length: n }, (_, i) => (i === s ? size - total : 0));
    const p = tryPlan(b, entrants);
    if (p) return { byes: b, pools: p, declared: false, entryAll: s };
  }
  throw new Error(`Formato da ${format.name} não comporta ${total} clubes.`);
}

const shuffle = <T>(rng: Rng, xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
};

/**
 * Sorteio dos confrontos de uma fase (`pool` na ordem da chave: sobreviventes pela ordem dos confrontos anteriores, depois os estreantes).
 * open = livre; seeded = metade de cima × metade de baixo do ranking; opposite = 1º × último, 2º × penúltimo…; bracket = chave fixa
 * (vizinhos na ordem da chave).
 */
export function drawPairs(rng: Rng, pool: readonly CupClub[], draw: CupDraw): Array<[CupClub, CupClub]> {
  if (pool.length % 2 !== 0) throw new Error('Sorteio com número ímpar de clubes.');
  const pairs: Array<[CupClub, CupClub]> = [];
  if (draw === 'bracket') { for (let i = 0; i < pool.length; i += 2) pairs.push([pool[i]!, pool[i + 1]!]); return pairs; }
  const byRank = [...pool].sort((a, b) => a.rank - b.rank);
  if (draw === 'opposite') { for (let i = 0; i < byRank.length / 2; i++) pairs.push([byRank[i]!, byRank[byRank.length - 1 - i]!]); return pairs; }
  if (draw === 'seeded') {
    const half = byRank.length / 2, low = shuffle(rng, byRank.slice(half));
    for (let i = 0; i < half; i++) pairs.push([byRank[i]!, low[i]!]);
    return shuffle(rng, pairs);
  }
  const s = shuffle(rng, pool);
  for (let i = 0; i < s.length; i += 2) pairs.push([s[i]!, s[i + 1]!]);
  return pairs;
}

/**
 * Mando do confronto. Jogo único: quem joga em casa; ida e volta: quem manda o jogo de VOLTA.
 * draw = o primeiro sorteado; lower = o de divisão inferior (mesma divisão: sorteio); lower2 = o que estiver 2 ou mais divisões abaixo
 * (senão sorteio); higher = o mais bem classificado; neutral = campo neutro (a ordem é só formal).
 */
export function hostOf(rng: Rng, a: CupClub, b: CupClub, rule: CupHost): { home: CupClub; away: CupClub; neutral: boolean } {
  const coin = () => (rng.next() < 0.5 ? { home: a, away: b } : { home: b, away: a });
  if (rule === 'neutral') return { ...coin(), neutral: true };
  if (rule === 'higher') return a.rank <= b.rank ? { home: a, away: b, neutral: false } : { home: b, away: a, neutral: false };
  const gap = a.tier - b.tier, need = rule === 'lower2' ? 2 : rule === 'lower' ? 1 : Infinity;
  if (Math.abs(gap) >= need) return gap > 0 ? { home: a, away: b, neutral: false } : { home: b, away: a, neutral: false };
  return { ...coin(), neutral: false };
}

/**
 * Datas das fases: quartas-feiras distribuídas entre o início da janela e a final (jogos de volta uma semana depois da ida), evitando
 * as datas da liga do país. A final cai na data da janela (ou na quarta-feira anterior, se houver jogo de liga nesse dia).
 */
export function cupDates(format: CupFormat, season: number, avoid: ReadonlySet<string>): string[][] {
  const yearOf = (mmdd: string) => (mmdd >= '07-01' ? season : season + 1);
  const start = nextWeekdayOnOrAfter(`${yearOf(format.window.start)}-${format.window.start}`, 3);
  let finalDate = `${yearOf(format.window.final)}-${format.window.final}`;
  while (avoid.has(finalDate)) finalDate = addDays(finalDate, -1);
  const stages = format.stages.slice(0, -1);
  const slots = stages.reduce((s, st) => s + st.legs, 0);
  const weds: string[] = [];
  for (let d = start; d <= addDays(finalDate, -10); d = addDays(d, 7)) if (!avoid.has(d)) weds.push(d);
  if (weds.length < slots) throw new Error(`Janela da ${format.name} curta demais (${weds.length} quartas-feiras para ${slots} datas).`);
  // espaçamento uniforme: cada fase recebe um bloco; a volta é a quarta-feira seguinte à ida
  const out: string[][] = [];
  let used = 0;
  const step = (weds.length - 1) / Math.max(1, slots - 1);
  for (const st of stages) {
    const legs: string[] = [];
    for (let l = 0; l < st.legs; l++) legs.push(weds[Math.min(weds.length - 1, Math.round(used++ * step))]!);
    out.push(legs);
  }
  for (let i = 1; i < out.flat().length; i++) if (out.flat()[i]! <= out.flat()[i - 1]!) throw new Error(`Datas fora de ordem na ${format.name}.`);
  out.push([finalDate]);
  return out;
}

/**
 * Premiação em euros na escala do jogo: a forma (proporções entre as fases) vem do formato, e o total do campeão que estreia junto com a
 * 1ª divisão é igual ao prêmio de campeão da liga principal do país (economia × 2,4 mi, docs/CAREER_CYCLE.md) vezes `factor`.
 */
export const CUP_PRIZE_FACTOR = 1.0;
export interface CupPrizeTable { perStage: number[]; win: number[]; semiLoser: number; runnerUp: number; winner: number }
export function cupPrizes(format: CupFormat, economy: number, topEntryStage: number, factor = CUP_PRIZE_FACTOR): CupPrizeTable {
  const n = format.stages.length;
  const p = format.prizes;
  const perStage = Array.from({ length: n }, (_, s) => p.perStage?.[s] ?? 0);
  // sem forma real conhecida: cada vitória vale o dobro da anterior (a da última fase antes da final = 1/8 do prêmio do campeão)
  const generic = !p.perStage && !p.win;
  const win = Array.from({ length: n }, (_, s) => (generic ? (s < n - 1 ? p.winner / 8 / 2 ** (n - 2 - s) : 0) : p.win?.[s] ?? 0));
  let champion = p.winner;
  for (let s = topEntryStage; s < n - 1; s++) champion += perStage[s]! + win[s]!;
  const k = (economy * 2_400_000 * factor) / champion;
  const r = (x: number) => Math.round((x * k) / 1000) * 1000;
  return { perStage: perStage.map(r), win: win.map(r), semiLoser: r(p.semiLoser ?? 0), runnerUp: r(p.runnerUp), winner: r(p.winner) };
}
