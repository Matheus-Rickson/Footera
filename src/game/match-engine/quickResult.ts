/**
 * Resultado rápido para partidas de países com simulação simplificada (sem lance a lance, sem jogadores em campo).
 * Gols de cada lado ~ Poisson, com média pela diferença de força (média dos 11 melhores, escala 0–100) e fator casa.
 * Calibrado para ficar perto do motor completo: ~2,6 gols por jogo, mandante vence ~45%, empates ~26% (testes em quick-result).
 */
import type { Rng } from '../rng.ts';
import type { MatchDecider } from './types.ts';

export const QUICK = {
  /** gols esperados de cada time em jogo equilibrado, campo neutro */ base: 1.28,
  /** vantagem de jogar em casa (multiplica os gols esperados do mandante; divide os do visitante) */ home: 1.13,
  /** sensibilidade à diferença de força: a cada 10 pontos, os gols esperados se multiplicam por e^0,55 ≈ 1,7 */ k: 0.055,
};

function poisson(rng: Rng, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > l && k < 15);
  return k - 1;
}

export function quickResult(homeStrength: number, awayStrength: number, rng: Rng): { homeGoals: number; awayGoals: number } {
  const d = homeStrength - awayStrength;
  const lh = QUICK.base * QUICK.home * Math.exp((QUICK.k * d) / 2);
  const la = (QUICK.base / QUICK.home) * Math.exp((-QUICK.k * d) / 2);
  return { homeGoals: poisson(rng, lh), awayGoals: poisson(rng, la) };
}

/** Força do time para o resultado rápido: média da força dos 11 melhores do elenco (menos de 11 = buracos contam como 30). */
export function teamStrength(overalls: number[]): number {
  const top = [...overalls].sort((a, b) => b - a).slice(0, 11);
  while (top.length < 11) top.push(30);
  return top.reduce((s, v) => s + v, 0) / 11;
}

/**
 * Confronto de copa no resultado rápido, com a MESMA regra de desempate do motor completo (`MatchDecider`): agregado no jogo de volta,
 * prorrogação (30 min = um terço dos gols esperados de 90) e pênaltis (cobranças alternadas de 75% de acerto, ±5 pontos pela força).
 * `neutral` tira o fator casa.
 */
export function quickKnockout(homeStrength: number, awayStrength: number, rng: Rng, decider: MatchDecider, neutral = false): QuickKnockoutResult {
  const d = homeStrength - awayStrength;
  const home = neutral ? 1 : QUICK.home;
  const lh = QUICK.base * home * Math.exp((QUICK.k * d) / 2);
  const la = (QUICK.base / home) * Math.exp((-QUICK.k * d) / 2);
  let hg = poisson(rng, lh), ag = poisson(rng, la);
  const first = decider.firstLeg ?? [0, 0];
  const lead = (): 0 | 1 | null => { const h = hg + first[0], a = ag + first[1]; return h > a ? 0 : a > h ? 1 : null; };
  let winner = lead();
  let decidedIn: QuickKnockoutResult['decidedIn'] = 'regular';
  let shootout: QuickKnockoutResult['shootout'] = null;
  if (winner === null && decider.extraTime) {
    decidedIn = 'extra_time';
    hg += poisson(rng, lh / 3); ag += poisson(rng, la / 3);
    winner = lead();
  }
  if (winner === null && decider.penalties) {
    decidedIn = 'penalties';
    const edge = Math.max(-0.05, Math.min(0.05, d * 0.005));
    const p = [0.75 + edge, 0.75 - edge];
    const res = [0, 0];
    series: for (let r = 0; r < 5; r++) for (const s of [0, 1]) {
      if (rng.next() < p[s]!) res[s]!++;
      const left0 = 5 - (r + 1), left1 = 5 - (s === 1 ? r + 1 : r);
      if (res[0]! > res[1]! + left1 || res[1]! > res[0]! + left0) break series;
    }
    for (let n = 0; res[0] === res[1] && n < 60; n++) { if (rng.next() < p[0]!) res[0]!++; if (rng.next() < p[1]!) res[1]!++; }
    if (res[0] === res[1]) res[rng.next() < 0.5 ? 0 : 1]!++;
    shootout = { home: res[0]!, away: res[1]! };
    winner = res[0]! > res[1]! ? 0 : 1;
  }
  return { homeGoals: hg, awayGoals: ag, winner, decidedIn, shootout, aggregate: decider.firstLeg ? [hg + first[0], ag + first[1]] : null };
}
export interface QuickKnockoutResult {
  homeGoals: number; awayGoals: number; winner: 0 | 1 | null;
  decidedIn: 'regular' | 'extra_time' | 'penalties'; shootout: { home: number; away: number } | null; aggregate: [number, number] | null;
}
