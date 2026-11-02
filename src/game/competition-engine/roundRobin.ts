import type { Rng } from '../rng.ts';

export interface PairingRound { round: number; matches: Array<{ home: string; away: string }> }

/**
 * Gera rodadas de pontos corridos pelo método do círculo (Berger).
 * - Cada equipe joga uma vez por rodada (com folga se o número de equipes for ímpar).
 * - Cada confronto ocorre exatamente `legs` vezes; pernas ímpares invertem o mando.
 * - Regra de mando validada empiricamente: no máximo 2 jogos seguidos no mesmo mando dentro de um turno.
 * A ordem das equipes é embaralhada pelo `rng`, então a tabela varia por semente, mas é reprodutível.
 */
export function generateRounds(teamIds: readonly string[], legs: number, rng: Rng): PairingRound[] {
  if (legs < 1) throw new Error('legs deve ser >= 1');
  if (new Set(teamIds).size !== teamIds.length) throw new Error('IDs de equipes duplicados.');
  if (teamIds.length < 2) throw new Error('São necessárias ao menos 2 equipes.');
  const order: Array<string | null> = rng.shuffle(teamIds);
  if (order.length % 2 === 1) order.push(null); // folga
  const n = order.length, m = n - 1;

  const firstLeg: Array<Array<{ home: string; away: string }>> = [];
  for (let r = 0; r < m; r++) {
    const matches: Array<{ home: string; away: string }> = [];
    const add = (home: string | null, away: string | null) => { if (home !== null && away !== null) matches.push({ home, away }); };
    if (r % 2 === 0) add(order[r]!, order[n - 1]!); else add(order[n - 1]!, order[r]!);
    for (let k = 1; k < n / 2; k++) {
      const a = order[(r + k) % m]!, b = order[(r - k + m) % m]!;
      if (k % 2 === 0) add(a, b); else add(b, a);
    }
    firstLeg.push(matches);
  }

  const rounds: PairingRound[] = [];
  for (let leg = 0; leg < legs; leg++) {
    for (let r = 0; r < m; r++) {
      const base = firstLeg[r]!;
      rounds.push({
        round: leg * m + r + 1,
        matches: leg % 2 === 0 ? base.map((x) => ({ ...x })) : base.map((x) => ({ home: x.away, away: x.home })),
      });
    }
  }
  return rounds;
}
