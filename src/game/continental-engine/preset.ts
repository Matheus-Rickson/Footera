/**
 * Potes e sorteios de cada fase da CONMEBOL (docs/CONTINENTAIS.md), puro: recebe os entrantes da fase (na ordem dos `entrants` do formato),
 * o país e o ranking de cada clube, e devolve os grupos (posição = pote) ou os confrontos ([quem decide em casa, o outro]).
 */
import type { Rng } from '../rng.ts';
import { groupDraw, potPairs, sameCountryPairs, type DrawClub } from './draw.ts';
import { LIB_ID, SUD_ID } from './formats.ts';

export interface PresetContext {
  country: ReadonlyMap<string, string>;
  /** posição no ranking CONMEBOL (menor = melhor); quem não aparece fica no fim */
  rank: Readonly<Record<string, number>>;
  libChampion?: string | null;
  sudChampion?: string | null;
}

/** Fases com sorteio (`assign`/`pairing` = preset). */
export function isConmebolPresetStage(formatId: string, stageId: string): boolean {
  return (formatId === LIB_ID && ['f1', 'f2', 'g', 'r16'].includes(stageId)) || (formatId === SUD_ID && ['p1', 'g', 'r16'].includes(stageId));
}

export function conmebolPreset(formatId: string, stageId: string, entrants: readonly string[], ctx: PresetContext, rng: Rng): string[][] {
  const club = (id: string): DrawClub => ({ id, country: ctx.country.get(id) ?? '?' });
  const byRank = (ids: readonly string[]) => [...ids].sort((a, b) => (ctx.rank[a] ?? 1e9) - (ctx.rank[b] ?? 1e9) || a.localeCompare(b));
  const clubs = (ids: readonly string[]) => ids.map(club);
  if (formatId === LIB_ID && stageId === 'f1') { // pote 1 = os 3 mais bem ranqueados (decidem em casa); sem restrição de país
    const r = byRank(entrants);
    return potPairs(clubs(r.slice(0, 3)), clubs(r.slice(3)), rng);
  }
  if (formatId === LIB_ID && stageId === 'f2') { // pote 1 = 8 melhores diretos; pote 2 = 5 seguintes + E1–E3 (isentos da restrição)
    const direct = byRank(entrants.slice(0, 13)), e = entrants.slice(13);
    return potPairs(clubs(direct.slice(0, 8)), clubs([...direct.slice(8), ...e]), rng, { forbidSameCountry: true, exempt: new Set(e) });
  }
  if (formatId === LIB_ID && stageId === 'g') {
    const g = entrants.slice(28);
    const champ = ctx.libChampion && entrants.includes(ctx.libChampion) ? ctx.libChampion : null;
    const rest = byRank(entrants.slice(0, 28).filter((c) => c !== champ));
    const pot1 = [...(champ ? [champ] : []), ...rest.slice(0, champ ? 7 : 8)];
    let left = rest.filter((c) => !pot1.includes(c));
    // o campeão da Sul-Americana vai ao pote 2, salvo se o ranking já o põe no pote 1
    const sud = ctx.sudChampion && left.includes(ctx.sudChampion) ? ctx.sudChampion : null;
    const pot2 = [...(sud ? [sud] : []), ...left.filter((c) => c !== sud).slice(0, sud ? 7 : 8)];
    left = left.filter((c) => !pot2.includes(c));
    const pot3 = left.slice(0, 8), pot4 = [...g, ...left.slice(8)];
    return groupDraw([pot1, pot2, pot3, pot4].map(clubs), 8, rng, { exempt: new Set(g), ...(champ ? { fixed: champ } : {}) });
  }
  if (stageId === 'r16') return potPairs(clubs(entrants.slice(0, 8)), clubs(entrants.slice(8)), rng); // [1º de grupo, 2º / vencedor do play-off]
  if (formatId === SUD_ID && stageId === 'p1') {
    const byCountry = new Map<string, string[]>();
    for (const c of entrants) { const k = ctx.country.get(c) ?? '?'; byCountry.set(k, [...(byCountry.get(k) ?? []), c]); }
    return sameCountryPairs([...byCountry.values()], rng);
  }
  if (formatId === SUD_ID && stageId === 'g') { // potes pelo ranking; pote 4 = os 4 da fase 3 da Libertadores + os 4 seguintes; sem exceção de país
    const lib = entrants.slice(12, 16);
    const rest = byRank([...entrants.slice(0, 12), ...entrants.slice(16)]);
    return groupDraw([rest.slice(0, 8), rest.slice(8, 16), rest.slice(16, 24), [...lib, ...rest.slice(24)]].map(clubs), 8, rng);
  }
  throw new Error(`Sorteio CONMEBOL: fase sem sorteio (${formatId}/${stageId}).`);
}
