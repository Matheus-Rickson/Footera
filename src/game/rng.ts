/** PRNG determinístico (xmur3 + mulberry32). Mesma semente => mesma sequência. */

export interface Rng {
  /** [0,1) */
  next(): number;
  /** inteiro em [min,max] inclusivo */
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  /** Distribuição normal (Box-Muller). */
  normal(mean: number, sd: number): number;
  shuffle<T>(arr: readonly T[]): T[];
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Cria um RNG independente e determinístico derivado deste e de um rótulo. */
  fork(label: string): Rng;
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): Rng {
  const next = mulberry32(xmur3(seed)());
  return {
    next,
    int(min, max) {
      if (max < min) throw new Error('int: max < min');
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) { return min + next() * (max - min); },
    chance(p) { return next() < p; },
    pick(arr) {
      if (arr.length === 0) throw new Error('pick: lista vazia');
      return arr[Math.floor(next() * arr.length)] as never;
    },
    normal(mean, sd) {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j] as never, a[i] as never];
      }
      return a;
    },
    weighted(items, weights) {
      if (items.length !== weights.length || items.length === 0) throw new Error('weighted: tamanhos incompatíveis');
      const total = weights.reduce((s, w) => s + w, 0);
      if (!(total > 0)) throw new Error('weighted: soma de pesos deve ser > 0');
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i] as number;
        if (r < 0) return items[i] as never;
      }
      return items[items.length - 1] as never;
    },
    fork(label) { return createRng(`${seed}::${label}`); },
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
