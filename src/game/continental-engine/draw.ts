/**
 * Sorteios da CONMEBOL (docs/CONTINENTAIS.md), puros e determinísticos pela semente.
 *
 * Grupos (LIB p. 48; SUD p. 47): pote por pote, cada sorteado ocupa a próxima posição livre do grupo A ao H; se o grupo já tem um clube
 * do mesmo país, ele "passa a ocupar o grupo seguinte". O manual não diz o que acontece se o último sorteado não couber em lugar nenhum
 * (o software da CONMEBOL evita); aqui a busca volta atrás no próprio pote e, em último caso, refaz o sorteio do pote (ADAPT).
 */
import type { Rng } from '../rng.ts';

export interface DrawClub { id: string; country: string }

/** Dois clubes não podem cair juntos: mesmo país, salvo se um deles é isento (vindo da fase 3 na Libertadores). */
const clash = (a: DrawClub, b: DrawClub, exempt: ReadonlySet<string>) => a.country === b.country && !exempt.has(a.id) && !exempt.has(b.id);

/**
 * Sorteio dos grupos. `pots[p]` = clubes do pote p+1 (cada pote com `groups` clubes); `fixed` = clube que vai direto para a posição 1 do
 * grupo A (campeão da Libertadores). Devolve os grupos com a posição = pote.
 */
export function groupDraw(pots: ReadonlyArray<readonly DrawClub[]>, groups: number, rng: Rng, opts: { exempt?: ReadonlySet<string>; fixed?: string } = {}): string[][] {
  const exempt = opts.exempt ?? new Set<string>();
  if (pots.some((p) => p.length !== groups)) throw new Error(`Sorteio: cada pote precisa de ${groups} clubes.`);
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = rng.fork(`tentativa${attempt}`);
    const out: DrawClub[][] = Array.from({ length: groups }, () => []);
    let ok = true;
    for (let p = 0; p < pots.length && ok; p++) {
      let order = r.shuffle(pots[p]!);
      if (p === 0 && opts.fixed) {
        const f = order.find((c) => c.id === opts.fixed);
        if (!f) throw new Error('Sorteio: o cabeça do grupo A não está no pote 1.');
        out[0]!.push(f);
        order = order.filter((c) => c !== f);
      }
      const placed = new Set(out.flatMap((g, i) => (g.length > p ? [i] : [])));
      // cada sorteado vai para o primeiro grupo (A→H) ainda sem clube deste pote e sem conflito; trava → volta atrás no pote
      const solve = (i: number): boolean => {
        if (i >= order.length) return true;
        const c = order[i]!;
        for (let g = 0; g < groups; g++) {
          if (placed.has(g) || out[g]!.some((x) => clash(x, c, exempt))) continue;
          placed.add(g); out[g]!.push(c);
          if (solve(i + 1)) return true;
          placed.delete(g); out[g]!.pop();
        }
        return false;
      };
      ok = solve(0);
    }
    if (ok) return out.map((g) => g.map((c) => c.id));
  }
  throw new Error('Sorteio dos grupos impossível com a restrição de país.');
}

/**
 * Cruzamentos de dois potes (LIB p. 39–40 e 49): os clubes do pote 2 são sorteados um a um e cada um recebe um clube do pote 1; com
 * `forbidSameCountry`, um cruzamento do mesmo país passa para a linha seguinte (isentos: E1–E3 da Libertadores). Devolve [pote 1, pote 2]
 * na ordem das chaves (A, B, C…): o do pote 1 decide em casa.
 */
export function potPairs(pot1: readonly DrawClub[], pot2: readonly DrawClub[], rng: Rng, opts: { forbidSameCountry?: boolean; exempt?: ReadonlySet<string> } = {}): Array<[string, string]> {
  if (pot1.length !== pot2.length) throw new Error('Sorteio: potes de tamanhos diferentes.');
  const exempt = opts.exempt ?? new Set<string>();
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = rng.fork(`tentativa${attempt}`);
    const keys = r.shuffle(pot2), balls = r.shuffle(pot1);
    const used = new Set<string>();
    const out: Array<[string, string]> = [];
    const solve = (i: number): boolean => {
      if (i >= keys.length) return true;
      const b = keys[i]!;
      for (const a of balls) {
        if (used.has(a.id) || (opts.forbidSameCountry && clash(a, b, exempt))) continue;
        used.add(a.id); out.push([a.id, b.id]);
        if (solve(i + 1)) return true;
        used.delete(a.id); out.pop();
      }
      return false;
    };
    if (solve(0)) return out;
  }
  throw new Error('Sorteio dos cruzamentos impossível com a restrição de país.');
}

/**
 * Primeira fase da Sul-Americana (SUD p. 39): em cada país, os 4 clubes no mesmo bolilhero; o primeiro sorteado é o mandante e o seguinte o
 * seu adversário; depois os outros dois. `byCountry` = os 4 clubes de cada país. Devolve [mandante, visitante].
 */
export function sameCountryPairs(byCountry: ReadonlyArray<readonly string[]>, rng: Rng): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  byCountry.forEach((clubs, i) => {
    if (clubs.length % 2 !== 0) throw new Error('Primeira fase: número ímpar de clubes de um país.');
    const o = rng.fork(`pais${i}`).shuffle(clubs);
    for (let k = 0; k < o.length; k += 2) out.push([o[k]!, o[k + 1]!]);
  });
  return out;
}
