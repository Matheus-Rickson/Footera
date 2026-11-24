/**
 * Lote de partidas: N jogos com os clubes, formações e táticas escolhidos (ou sorteio entre clubes médios) e o resumo do que saiu:
 * médias, distribuição de placares, desempenho de cada lado e os jogos mais extremos (com a semente, para abrir no inspetor).
 * "Lado A" = o clube/tática do 1º grupo de parâmetros; com mando alternado, ele é mandante nos jogos pares e visitante nos ímpares.
 */
import { simulateMatch } from '../../../src/game/match-engine/engine.ts';
import { createRng } from '../../../src/game/rng.ts';
import type { EngineVersion, MatchOutcome } from '../../../src/game/match-engine/types.ts';
import { asUniverse, clubName, midClubs, sheetFor, UNIVERSES, type UniverseId } from '../universe.ts';
import { addedTime, anomalies, f1, f2, mean, pct, pts, se, sideParams, tacticsFrom, ENGINE_PARAM } from '../stats.ts';
import { Cancelled, ParamError, type ParamValue, type Scenario, type Section } from '../types.ts';

export interface BatchGame {
  i: number; seed: string; aHome: boolean; aClub: string; bClub: string;
  aGoals: number; bGoals: number; aXg: number; bXg: number; aShots: number; bShots: number; aPoss: number;
  yellows: number; reds: number; subs: number; injuries: number; added: [number, number]; anomalies: string[];
  /** por lado [A, B]: passes, passes certos, finalizações no gol, faltas, escanteios, impedimentos */
  passes: [number, number]; passesOk: [number, number]; onTarget: [number, number]; fouls: [number, number]; corners: [number, number]; offsides: [number, number];
}

/** o jogo `i` do lote: mesmos parâmetros e semente = mesmo jogo (o inspetor de partida refaz exatamente este) */
export function batchGame(u: UniverseId, p: Record<string, ParamValue>, i: number, opts?: { track?: boolean; timeline?: boolean }): { game: BatchGame; outcome: MatchOutcome } {
  const pool = midClubs(u);
  const pr = createRng(`${String(p.seed)}-pair-${i}`);
  const aClub = String(p.homeClub) || pr.pick(pool);
  let bClub = String(p.awayClub) || pr.pick(pool);
  if (!p.awayClub && bClub === aClub && pool.length > 1) bClub = pool[(pool.indexOf(aClub) + 1 + pr.int(0, pool.length - 2)) % pool.length]!;
  const aHome = !p.alternate || i % 2 === 0;
  const A = { clubId: aClub, formation: String(p.homeFormation), tactics: tacticsFrom(p, 'home') };
  const B = { clubId: bClub, formation: String(p.awayFormation), tactics: tacticsFrom(p, 'away') };
  const seed = `${String(p.seed)}-${i}`;
  const mo = { seed, engine: (p.engine === 'v2' ? 'v2' : 'v1') as EngineVersion, ...(opts ?? {}) };
  const o = aHome ? simulateMatch(sheetFor(u, A, 'H:'), sheetFor(u, B, 'A:'), mo) : simulateMatch(sheetFor(u, B, 'H:'), sheetFor(u, A, 'A:'), mo);
  const [a, b] = aHome ? [0, 1] as const : [1, 0] as const;
  const goals = [o.homeGoals, o.awayGoals];
  const ev = (t: string) => o.events.filter((e) => e.type === t).length;
  const at = addedTime(o);
  return {
    outcome: o,
    game: {
      i, seed, aHome, aClub, bClub, aGoals: goals[a]!, bGoals: goals[b]!, aXg: o.stats[a].xg, bXg: o.stats[b].xg,
      aShots: o.stats[a].shots, bShots: o.stats[b].shots, aPoss: o.stats[a].possession,
      yellows: ev('yellow_card'), reds: ev('red_card'), subs: ev('substitution'), injuries: ev('injury'), added: [at.first, at.second], anomalies: anomalies(o),
      passes: [o.stats[a].passes, o.stats[b].passes], passesOk: [o.stats[a].passesCompleted, o.stats[b].passesCompleted], onTarget: [o.stats[a].shotsOnTarget, o.stats[b].shotsOnTarget],
      fouls: [o.stats[a].fouls, o.stats[b].fouls], corners: [o.stats[a].corners, o.stats[b].corners], offsides: [o.stats[a].offsides, o.stats[b].offsides],
    },
  };
}

export function summarize(u: UniverseId, games: BatchGame[], ms: number): Section[] {
  const n = games.length;
  const total = games.map((g) => g.aGoals + g.bGoals);
  const home = games.map((g) => (g.aHome ? g.aGoals : g.bGoals)), away = games.map((g) => (g.aHome ? g.bGoals : g.aGoals));
  const hw = games.filter((_, k) => home[k]! > away[k]!).length / n, dr = games.filter((_, k) => home[k] === away[k]).length / n;
  const nil = games.filter((g) => g.aGoals + g.bGoals === 0).length / n;
  const anomalyCount = games.reduce((s, g) => s + g.anomalies.length, 0);
  const kpis: Section = {
    kind: 'kpis', title: `${n} partidas`, items: [
      { label: 'Gols por jogo', value: f2(mean(total)), hint: `erro-padrão ±${f2(se(total))}` },
      { label: 'xG por jogo', value: f2(mean(games.map((g) => g.aXg + g.bXg))) },
      { label: 'Mandante / empate / visitante', value: `${pct(hw, 0)} / ${pct(dr, 0)} / ${pct(1 - hw - dr, 0)}` },
      { label: '0x0', value: pct(nil) },
      { label: 'Amarelos / vermelhos', value: `${f2(mean(games.map((g) => g.yellows)))} / ${f2(mean(games.map((g) => g.reds)))}` },
      { label: 'Substituições / lesões', value: `${f2(mean(games.map((g) => g.subs)))} / ${f2(mean(games.map((g) => g.injuries)))}` },
      { label: 'Acréscimos 1º / 2º tempo', value: `${f1(mean(games.map((g) => g.added[0])))} / ${f1(mean(games.map((g) => g.added[1])))} min` },
      { label: 'Anomalias', value: String(anomalyCount), tone: anomalyCount ? 'bad' : 'ok', hint: 'nota fora de 3–10, posse ≠ 100%, minutos ou números inválidos' },
      { label: 'Tempo por partida', value: `${f1(ms / Math.max(1, n))} ms` },
    ],
  };
  const side = (k: 'a' | 'b') => {
    const gf = games.map((g) => (k === 'a' ? g.aGoals : g.bGoals)), ga = games.map((g) => (k === 'a' ? g.bGoals : g.aGoals));
    const p = games.map((_, j) => pts(gf[j]!, ga[j]!));
    const w = p.filter((x) => x === 3).length / n, d = p.filter((x) => x === 1).length / n;
    return [k === 'a' ? 'Lado A' : 'Lado B', `${f2(mean(p))} ±${f2(se(p))}`, `${pct(w, 0)} / ${pct(d, 0)} / ${pct(1 - w - d, 0)}`, f2(mean(gf)), f2(mean(ga)),
      f2(mean(games.map((g) => (k === 'a' ? g.aXg : g.bXg)))), f1(mean(games.map((g) => (k === 'a' ? g.aShots : g.bShots)))), pct(mean(games.map((g) => (k === 'a' ? g.aPoss : 100 - g.aPoss))) / 100, 0)];
  };
  const sides: Section = { kind: 'table', title: 'Por lado', columns: ['Lado', 'Pontos/jogo', 'V / E / D', 'Gols pró', 'Gols contra', 'xG pró', 'Finalizações', 'Posse'], rows: [side('a'), side('b')], numeric: [1, 3, 4, 5, 6, 7] };
  const scores = new Map<string, number>();
  for (const g of games) { const k = `${Math.max(g.aGoals, g.bGoals)}x${Math.min(g.aGoals, g.bGoals)}`; scores.set(k, (scores.get(k) ?? 0) + 1); }
  const dist: Section = { kind: 'bars', title: 'Placares mais comuns (sem ordem de mando)', items: [...scores].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([label, c]) => ({ label, value: c, display: `${c} (${pct(c / n)})` })) };
  const ext = [...games].sort((x, y) => (y.aGoals + y.bGoals) - (x.aGoals + x.bGoals) || Math.abs(y.aGoals - y.bGoals) - Math.abs(x.aGoals - x.bGoals)).slice(0, 8);
  const extremes: Section = {
    kind: 'table', title: 'Jogos mais extremos (abra no inspetor de partida pela semente)', columns: ['Jogo', 'Semente', 'Mandante', 'Placar', 'Visitante', 'xG'],
    rows: ext.map((g) => {
      const [hc, vc, hg, vg, hx, vx] = g.aHome ? [g.aClub, g.bClub, g.aGoals, g.bGoals, g.aXg, g.bXg] : [g.bClub, g.aClub, g.bGoals, g.aGoals, g.bXg, g.aXg];
      return [g.i, g.seed, clubName(u, hc), `${hg} x ${vg}`, clubName(u, vc), `${f2(hx)} x ${f2(vx)}`];
    }),
  };
  const out: Section[] = [kpis, sides, dist, extremes];
  const bad = games.filter((g) => g.anomalies.length).slice(0, 20);
  if (bad.length) out.push({ kind: 'table', title: 'Anomalias encontradas', columns: ['Jogo', 'Semente', 'Problemas'], rows: bad.map((g) => [g.i, g.seed, g.anomalies.join('; ')]) });
  return out;
}

export const matchBatch: Scenario = {
  id: 'lote-partidas',
  title: 'Lote de partidas',
  description: 'Simula N partidas com os clubes, formações e táticas escolhidos e resume gols, resultados, estatísticas e os jogos mais extremos.',
  params: [
    { key: 'universe', label: 'Universo', kind: 'select', default: 'calib', options: UNIVERSES },
    ENGINE_PARAM,
    { key: 'homeClub', label: 'Clube do lado A', kind: 'select', default: '', options: [{ value: '', label: 'Sorteio entre clubes médios da 1ª liga' }], source: 'clubs' },
    { key: 'awayClub', label: 'Clube do lado B', kind: 'select', default: '', options: [{ value: '', label: 'Sorteio entre clubes médios da 1ª liga' }], source: 'clubs' },
    { key: 'n', label: 'Partidas', kind: 'number', default: 500, min: 1, max: 20000, step: 100 },
    { key: 'alternate', label: 'Alternar mando (A em casa nos jogos pares)', kind: 'boolean', default: true, help: 'Com o mando alternado, a vantagem de casa se anula na comparação entre os lados.' },
    { key: 'seed', label: 'Semente', kind: 'text', default: 'lab' },
    ...sideParams('home', 'A'),
    ...sideParams('away', 'B'),
  ],
  async run(p, ctx) {
    const u = asUniverse(p.universe);
    const n = Number(p.n);
    if (!Number.isInteger(n) || n < 1) throw new ParamError('Número de partidas inválido.');
    const games: BatchGame[] = [];
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      if (ctx.cancelled()) throw new Cancelled();
      games.push(batchGame(u, p, i).game);
      if (i % 25 === 0 || i === n - 1) { ctx.onProgress({ done: i + 1, total: n }); await new Promise((r) => setImmediate(r)); }
    }
    const ms = performance.now() - t0;
    return { sections: summarize(u, games, ms), data: { games } };
  },
};
