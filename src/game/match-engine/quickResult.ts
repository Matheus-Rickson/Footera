/**
 * Resultado rápido para partidas de países com simulação simplificada (sem lance a lance, sem jogadores em campo).
 * Gols de cada lado ~ Poisson, com média pela diferença de força (média dos 11 melhores, escala 0–100) e fator casa.
 * Calibrado para ficar perto do motor completo: ~2,6 gols por jogo, mandante vence ~45%, empates ~26% (testes em quick-result).
 */
import type { Rng } from '../rng.ts';

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
