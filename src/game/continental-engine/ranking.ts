/**
 * Ranking de Clubes CONMEBOL (manual da Libertadores 2026, item 2.5 — LIB p. 55–59), puro.
 *
 * Total = Libertadores + Sul-Americana. Em cada uma: desempenho dos últimos 10 anos (o ano mais recente vale 100% e cada ano anterior 10%
 * a menos, até 10%) + coeficiente histórico (a partir do 11º ano, só campeão, vice, semifinal, vitórias e empates, com os valores da
 * coluna HIST., sem depreciar). Libertadores: + 50 pontos por título nacional nos últimos 10 anos, com a mesma depreciação. Os pontos se
 * acumulam conforme o clube avança (grupos + oitavas + quartas + semi + final).
 *
 * ADAPT (universo fictício, sem história real): cada clube começa com um "ano histórico" (`historyPoints`, pela reputação) que vale como
 * uma edição do ano anterior ao início da carreira e deprecia como ela, sumindo em 10 temporadas.
 */

/** Até onde o clube chegou numa edição. `prelimOut` = eliminado nas fases preliminares (Libertadores). */
export type ReachStage = 'prelimOut' | 'groups' | 'po' | 'r16' | 'qf' | 'sf' | 'runnerUp' | 'champion';
export const REACH_ORDER: readonly ReachStage[] = ['prelimOut', 'groups', 'po', 'r16', 'qf', 'sf', 'runnerUp', 'champion'];

export interface EditionRow {
  season: number; comp: 'lib' | 'sud'; stage: ReachStage;
  /** disputou a fase preliminar (a Sul-Americana pontua a participação nela) */
  prelim: boolean;
  /** disputou a fase de grupos desta competição (os terceiros da Libertadores entram na Sul-Americana direto no play-off) */
  groups: boolean;
  /** vitórias e empates da fase de grupos em diante */
  wins: number; draws: number;
}

/** Valores a 100% (ano mais recente) e da coluna HIST. (LIB p. 57 e 59). */
export const RANKING_POINTS = {
  lib: { champion: 1000, runnerUp: 500, sf: 300, qf: 200, r16: 100, win: 80, draw: 40, groups: 100, prelimOut: 25, prelim: 0 },
  sud: { champion: 600, runnerUp: 300, sf: 180, qf: 120, r16: 60, win: 48, draw: 24, groups: 60, prelimOut: 0, prelim: 15 },
} as const;
export const RANKING_HIST = {
  lib: { champion: 100, runnerUp: 50, sf: 30, win: 8, draw: 4 },
  sud: { champion: 60, runnerUp: 30, sf: 18, win: 4.8, draw: 2.4 },
} as const;
export const NATIONAL_TITLE_POINTS = 50;

const atLeast = (s: ReachStage, t: ReachStage) => REACH_ORDER.indexOf(s) >= REACH_ORDER.indexOf(t);
/** Peso do ano `k` anos antes do mais recente (0 → 100%, 9 → 10%); 0 a partir do 11º ano. */
export const yearWeight = (k: number): number => (k >= 0 && k < 10 ? (10 - k) / 10 : 0);

/** Pontos de uma edição, `k` anos antes da mais recente do ranking (k ≥ 10: coeficiente histórico). */
export function editionPoints(r: EditionRow, k: number): number {
  if (k >= 10) {
    const h = RANKING_HIST[r.comp];
    return (r.stage === 'champion' ? h.champion : r.stage === 'runnerUp' ? h.runnerUp : 0) + (atLeast(r.stage, 'sf') ? h.sf : 0) + r.wins * h.win + r.draws * h.draw;
  }
  const p = RANKING_POINTS[r.comp];
  let pts = (r.prelim ? p.prelim : 0) + (r.stage === 'prelimOut' ? p.prelimOut : 0) + r.wins * p.win + r.draws * p.draw;
  if (r.groups) pts += p.groups;
  // Sul-Americana: "participação em playoff + oitavas" vale uma vez; Libertadores: oitavas
  if (atLeast(r.stage, 'r16') || (r.comp === 'sud' && r.stage === 'po')) pts += p.r16;
  if (atLeast(r.stage, 'qf')) pts += p.qf;
  if (atLeast(r.stage, 'sf')) pts += p.sf;
  if (r.stage === 'champion') pts += p.champion; else if (r.stage === 'runnerUp') pts += p.runnerUp;
  return pts * yearWeight(k);
}

/**
 * Pontos de um clube no ranking calculado ao fim da temporada `asOf`: edições (Libertadores e Sul-Americana), títulos nacionais (temporadas
 * em que foi campeão da 1ª divisão) e o ano histórico inicial (ADAPT).
 */
export function rankingPoints(rows: readonly EditionRow[], titles: readonly number[], history: { season: number; points: number } | null, asOf: number): number {
  let pts = 0;
  for (const r of rows) if (r.season <= asOf) pts += editionPoints(r, asOf - r.season);
  for (const s of titles) if (s <= asOf) pts += NATIONAL_TITLE_POINTS * yearWeight(asOf - s);
  if (history && history.season <= asOf) pts += history.points * yearWeight(asOf - history.season);
  return Math.round(pts * 10) / 10;
}

/** Ano histórico inicial pela reputação (ADAPT): 0,6 × (reputação − 30)² — reputação 90 ≈ 2.160 pontos (perto de um título da Libertadores), 40 ≈ 60. */
export const historyPoints = (reputation: number): number => Math.round(0.6 * Math.max(0, reputation - 30) ** 2);

/** Ordem do ranking: mais pontos; empate → maior reputação, depois o id (determinístico). */
export function rankOrder(clubs: ReadonlyArray<{ id: string; points: number; reputation: number }>): string[] {
  return [...clubs].sort((a, b) => b.points - a.points || b.reputation - a.reputation || a.id.localeCompare(b.id)).map((c) => c.id);
}
