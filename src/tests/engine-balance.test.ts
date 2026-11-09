import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, soft } from '../game/match-engine/engine.ts';
import { FORMATIONS } from '../game/match-engine/formations.ts';
import { assignLineup, chooseFormation, pickBench, toMatchPlayer } from '../game/match-engine/team-builder.ts';
import type { TeamTactics } from '../game/match-engine/types.ts';
import { quickResult } from '../game/match-engine/quickResult.ts';
import { createRng } from '../game/rng.ts';
import { baseUniverse } from '../services/universeService.node.ts';

// Correções da bateria de 08/11/2026 (73 mil jogos; ver docs/MATCH_ENGINE.md): goleadas sem teto, zebra quase impossível em jogo
// desigual, mentalidade defensiva sempre pior e resultado rápido aleatório demais.
const w = baseUniverse().world;
const byClub = new Map<string, typeof w.players>();
for (const p of w.players) if (p.clubId) (byClub.get(p.clubId) ?? byClub.set(p.clubId, []).get(p.clubId)!).push(p);
const strength = (id: string) => { const ov = (byClub.get(id) ?? []).map((p) => p.overall).sort((a, b) => b - a).slice(0, 11); return ov.reduce((a, b) => a + b, 0) / Math.max(1, ov.length); };
const squad = (id: string, pre: string) => (byClub.get(id) ?? []).map((p) => ({ ...toMatchPlayer({ ...p, condition: 100, morale: 70, form: 60 }), id: pre + p.id }));
const BAL: TeamTactics = { mentality: 'balanced', tempo: 3, width: 3, defensiveLine: 3, pressing: 3, buildUp: 'mixed' };
const sheet = (id: string, pl: ReturnType<typeof squad>, f = chooseFormation(pl).formation, tactics: TeamTactics = BAL) => {
  const { lineup } = assignLineup(pl, f);
  return { clubId: id, name: id, formation: f.id, lineup, bench: pickBench(pl, lineup), tactics, cohesion: 1 };
};
const pts = (a: number, b: number) => (a > b ? 3 : a === b ? 1 : 0);

test('Saturação suave: crescente, igual ao valor perto do centro e sem passar dos limites', () => {
  let prev = -Infinity;
  for (let x = 0; x <= 6; x += 0.05) { const v = soft(x, 1, 0.5, 1.9); assert.ok(v > prev && v > 0.5 && v < 1.9, `x=${x}: ${v}`); prev = v; }
  assert.ok(Math.abs(soft(1.02, 1, 0.5, 1.9) - 1.02) < 0.001);
  assert.ok(soft(5, 1, 0.5, 1.9) > soft(4, 1, 0.5, 1.9), 'uma melhora sempre conta, mesmo no extremo');
});

test('Jogo muito desigual: sem goleadas absurdas e o mais fraco ainda marca às vezes', () => {
  const clubs = w.clubs.filter((c) => (byClub.get(c.id)?.length ?? 0) >= 18).sort((a, b) => strength(b.id) - strength(a.id));
  const pairs: Array<[string, string]> = [];
  for (const top of clubs.slice(0, 6)) for (const low of clubs.slice(-6)) if (strength(top.id) - strength(low.id) >= 20) pairs.push([top.id, low.id]);
  assert.ok(pairs.length >= 20, `pares com 20+ pontos de diferença: ${pairs.length}`);
  let n = 0, fav = 0, maxMargin = 0, undScored = 0;
  for (let i = 0; i < 240; i++) {
    const [a, b] = pairs[i % pairs.length]!;
    const home = i % 2 === 0;
    const H = home ? sheet(a, squad(a, 'H:')) : sheet(b, squad(b, 'H:')), A = home ? sheet(b, squad(b, 'A:')) : sheet(a, squad(a, 'A:'));
    const o = simulateMatch(H, A, { seed: `blowout-${i}` });
    const [f, u] = home ? [o.homeGoals, o.awayGoals] : [o.awayGoals, o.homeGoals];
    n++; fav += f; maxMargin = Math.max(maxMargin, f - u); if (u > 0) undScored++;
  }
  // antes: 6,8 gols do favorito por jogo com 20+ pontos de diferença, até 19x0, e o mais fraco marcava em ~20% dos jogos
  // pares com ~38 pontos de diferença (o melhor contra o pior da base): antes da correção, ~9 gols do favorito
  assert.ok(fav / n < 5.5, `gols do favorito por jogo: ${(fav / n).toFixed(2)}`);
  assert.ok(maxMargin <= 9, `maior saldo: ${maxMargin}`);
  assert.ok(undScored / n > 0.25, `o mais fraco marcou em ${(100 * undScored / n).toFixed(0)}% dos jogos`);
});

test('Mentalidade: defensiva e ofensiva não ganham nem perdem pontos de graça; mudam o estilo (gols)', () => {
  const ref = w.clubs.filter((c) => (byClub.get(c.id)?.length ?? 0) >= 20).sort((a, b) => strength(b.id) - strength(a.id));
  // clube fixo (o mediano da Série A da base): não muda quando a base ganha países ou clubes
  const serieA = ref.filter((c) => c.leagueId === 'bra-1');
  const id = serieA[Math.floor(serieA.length / 2)]!.id;
  const f = FORMATIONS.find((x) => x.id === '4-2-3-1')!;
  const run = (m: TeamTactics['mentality']) => {
    let p = 0, goals = 0, ga = 0;
    for (let i = 0; i < 700; i++) {
      const X = sheet(id, squad(id, 'X:'), f, { ...BAL, mentality: m }), Y = sheet(id, squad(id, 'Y:'), f, BAL);
      const o = i % 2 ? simulateMatch(X, Y, { seed: `ment-${m}-${i}` }) : simulateMatch(Y, X, { seed: `ment-${m}-${i}` });
      const [a, b] = i % 2 ? [o.homeGoals, o.awayGoals] : [o.awayGoals, o.homeGoals];
      p += pts(a, b); goals += a + b; ga += b;
    }
    return { ppg: p / 700, goals: goals / 700, ga: ga / 700 };
  };
  const d = run('defensive'), b = run('balanced'), a = run('attacking');
  // antes: defensiva −0,19 ponto/jogo contra o neutro (a pior escolha até para segurar resultado); ofensiva +0,14
  assert.ok(d.ppg > b.ppg - 0.13, `defensiva ${d.ppg.toFixed(3)} × equilibrada ${b.ppg.toFixed(3)}`);
  assert.ok(a.ppg < b.ppg + 0.13, `ofensiva ${a.ppg.toFixed(3)} × equilibrada ${b.ppg.toFixed(3)}`);
  // a defensiva tem que defender de verdade e a ofensiva tem que cobrar atrás (neste clube: antes 0,82 e 1,08 dos gols sofridos da equilibrada; agora 0,74 e 1,18)
  assert.ok(d.ga < b.ga * 0.78, `gols sofridos: defensiva ${d.ga.toFixed(2)} × equilibrada ${b.ga.toFixed(2)}`);
  assert.ok(a.ga > b.ga * 1.13, `gols sofridos: ofensiva ${a.ga.toFixed(2)} × equilibrada ${b.ga.toFixed(2)}`);
  assert.ok(d.goals < b.goals && b.goals < a.goals, `gols: defensiva ${d.goals.toFixed(2)}, equilibrada ${b.goals.toFixed(2)}, ofensiva ${a.goals.toFixed(2)}`);
});

test('Resultado rápido acompanha o motor completo: favorito com 8–10 pontos de vantagem vence ~70%', () => {
  let fav = 0, und = 0, goals = 0;
  for (let i = 0; i < 4000; i++) {
    const rng = createRng(`quick-fav-${i}`), home = i % 2 === 0;
    const r = home ? quickResult(69, 60, rng) : quickResult(60, 69, rng);
    const [f, u] = home ? [r.homeGoals, r.awayGoals] : [r.awayGoals, r.homeGoals];
    if (f > u) fav++; else if (u > f) und++;
    goals += r.homeGoals + r.awayGoals;
  }
  // antes (k 0,055): o favorito vencia 53% e o mais fraco 24%; no motor completo, 74% e 8%
  assert.ok(fav / 4000 > 0.62 && fav / 4000 < 0.8, `favorito vence ${(100 * fav / 4000).toFixed(1)}%`);
  assert.ok(und / 4000 < 0.16, `mais fraco vence ${(100 * und / 4000).toFixed(1)}%`);
  assert.ok(goals / 4000 > 2.4 && goals / 4000 < 3.2, `gols por jogo: ${(goals / 4000).toFixed(2)}`);
  // diferença extrema (75 × 40): sem a saturação, o favorito marcava ~6 gols por jogo e saíam placares de 12x1
  let big = 0, maxM = 0;
  for (let i = 0; i < 3000; i++) { const r = quickResult(75, 40, createRng(`quick-cap-${i}`)); big += r.homeGoals; maxM = Math.max(maxM, r.homeGoals - r.awayGoals); }
  assert.ok(big / 3000 < 4.6, `gols do favorito com 35 pontos de vantagem: ${(big / 3000).toFixed(2)}`);
  assert.ok(maxM <= 15, `maior saldo: ${maxM}`); // cauda da Poisson em 3.000 jogos; sem a saturação, a média passava de 8
});
