/**
 * Vagas da CONMEBOL por país (LIB e SUD, item 3.6.1) e a distribuição dos classificados pelas fases de entrada, puro.
 *
 * Libertadores (47): Argentina 6, Brasil 7, os outros 8 países 4 cada, mais o campeão da Libertadores e o da Sul-Americana do ano anterior.
 * Entrada (LIB p. 39–44): grupos = Nº1–Nº5 de Argentina e Brasil e Nº1–Nº2 dos outros (26 + os 2 campeões = 28); fase 2 = Brasil, Chile
 * e Colômbia 2 cada e 1 de cada um dos outros 7 (13); fase 1 = o Nº4 de Bolívia, Equador, Paraguai, Peru, Uruguai e Venezuela (6).
 * Os campeões entram por fora da cota do país (o da Libertadores como "Nº1"; o da Sul-Americana já classificado por mérito cede a vaga à
 * federação), então a cota é preenchida sem eles.
 * Sul-Americana (44): Argentina 6 e Brasil 6 direto nos grupos; 4 de cada um dos outros 8 países na primeira fase.
 */

export const CONMEBOL_COUNTRY_CODES: readonly string[] = ['ARG', 'BOL', 'BRA', 'CHI', 'COL', 'ECU', 'PAR', 'PER', 'URU', 'VEN'];

export const LIB_SLOTS: Record<string, { groups: number; f2: number; f1: number }> = {
  ARG: { groups: 5, f2: 1, f1: 0 }, BRA: { groups: 5, f2: 2, f1: 0 }, CHI: { groups: 2, f2: 2, f1: 0 }, COL: { groups: 2, f2: 2, f1: 0 },
  BOL: { groups: 2, f2: 1, f1: 1 }, ECU: { groups: 2, f2: 1, f1: 1 }, PAR: { groups: 2, f2: 1, f1: 1 }, PER: { groups: 2, f2: 1, f1: 1 },
  URU: { groups: 2, f2: 1, f1: 1 }, VEN: { groups: 2, f2: 1, f1: 1 },
};
export const SUD_SLOTS: Record<string, { groups: number; p1: number }> = {
  ARG: { groups: 6, p1: 0 }, BRA: { groups: 6, p1: 0 }, BOL: { groups: 0, p1: 4 }, CHI: { groups: 0, p1: 4 }, COL: { groups: 0, p1: 4 },
  ECU: { groups: 0, p1: 4 }, PAR: { groups: 0, p1: 4 }, PER: { groups: 0, p1: 4 }, URU: { groups: 0, p1: 4 }, VEN: { groups: 0, p1: 4 },
};

export interface Qualifiers {
  lib: { f1: string[]; f2: string[]; groups: string[] };
  /** primeira fase: os 4 de cada país, um bloco por país */
  sud: { p1: string[][]; groups: string[] };
  libChampion: string | null;
  sudChampion: string | null;
}

/**
 * Distribui os classificados. `order[país]` = ordem de classificação do país (Nº1, Nº2…; ADAPT: liga com o campeão da copa nacional);
 * `champions` = campeões do ano anterior (null na 1ª temporada da carreira: a vaga do campeão da Libertadores fica com o Brasil e a do
 * campeão da Sul-Americana com a Argentina, os países dos campeões reais de 2025 — Flamengo e Lanús —, ADAPT). Lança erro se faltar clube.
 */
export function distributeQualifiers(order: Readonly<Record<string, readonly string[]>>, champions: { lib: string | null; sud: string | null }): Qualifiers {
  const taken = new Set<string>([champions.lib, champions.sud].filter((c): c is string => !!c));
  const next = (code: string, n: number): string[] => {
    const out: string[] = [];
    for (const id of order[code] ?? []) { if (out.length >= n) break; if (!taken.has(id)) { out.push(id); taken.add(id); } }
    if (out.length < n) throw new Error(`Vagas CONMEBOL: faltam clubes de ${code} (${out.length} de ${n}).`);
    return out;
  };
  const lib = { f1: [] as string[], f2: [] as string[], groups: [] as string[] };
  if (champions.lib) lib.groups.push(champions.lib);
  if (champions.sud) lib.groups.push(champions.sud);
  for (const code of CONMEBOL_COUNTRY_CODES) {
    const s = LIB_SLOTS[code]!;
    lib.groups.push(...next(code, s.groups + (code === 'BRA' && !champions.lib ? 1 : 0) + (code === 'ARG' && !champions.sud ? 1 : 0)));
    lib.f2.push(...next(code, s.f2));
    lib.f1.push(...next(code, s.f1));
  }
  const sud = { p1: [] as string[][], groups: [] as string[] };
  for (const code of CONMEBOL_COUNTRY_CODES) {
    const s = SUD_SLOTS[code]!;
    sud.groups.push(...next(code, s.groups));
    if (s.p1) sud.p1.push(next(code, s.p1));
  }
  return { lib, sud, libChampion: champions.lib, sudChampion: champions.sud };
}

/**
 * Ordem de um país (ADAPT — cada federação define a sua pelo seu campeonato): a classificação final da 1ª divisão, com o campeão da copa
 * nacional (Brasil, Argentina) logo depois dos 4 primeiros, se ainda não estiver entre eles (no Brasil de 2026: G4 + campeão da Copa do
 * Brasil nos grupos). Clubes que faltarem (liga menor que as vagas) vêm depois, na ordem de `rest`.
 */
export function countryOrder(league: readonly string[], cupChampion: string | null, rest: readonly string[] = []): string[] {
  const out = [...league];
  if (cupChampion && out.indexOf(cupChampion) > 4) { out.splice(out.indexOf(cupChampion), 1); out.splice(4, 0, cupChampion); }
  else if (cupChampion && !out.includes(cupChampion)) out.splice(Math.min(4, out.length), 0, cupChampion);
  for (const id of rest) if (!out.includes(id)) out.push(id);
  return out;
}
