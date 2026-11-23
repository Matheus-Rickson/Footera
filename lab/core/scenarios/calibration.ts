/**
 * Calibração do motor: as metas de realismo de docs/MATCH_ENGINE_DEBUG.md conferidas em verde/vermelho.
 * Partidas entre clubes médios e parecidos da 1ª liga (sorteados por jogo), tática equilibrada e formação automática.
 * Também confere determinismo (mesma semente = mesma partida) e, opcionalmente, o equilíbrio entre as formações pré-definidas
 * (cada formação contra todas as outras, com mando alternado e os mesmos pares de clubes: a diferença de força se anula).
 */
import { FORMATIONS } from '../../../src/game/match-engine/formations.ts';
import { asUniverse } from '../universe.ts';
import { f2, mean, pct, pts, se } from '../stats.ts';
import { Cancelled, type ParamValue, type Scenario, type Section } from '../types.ts';
import { batchGame, summarize, type BatchGame } from './matchBatch.ts';

/** metas (faixas de referência do futebol real usadas nas calibrações do motor) */
export const TARGETS = {
  goals: [2.5, 2.9], home: [0.43, 0.48], draw: [0.23, 0.29], away: [0.27, 0.32], nil: [0.06, 0.10],
  yellows: [3, 4.5], reds: [0.05, 0.15], added1: [2, 3], added2: [4, 6], xgGap: 0.15, formationSpread: 0.2,
} as const;

const base = (seed: string): Record<string, ParamValue> => ({
  universe: 'calib', homeClub: '', awayClub: '', alternate: true, seed,
  homeFormation: 'auto', homeMentality: 'balanced', homePressing: 3, homeTempo: 3, homeLine: 3,
  awayFormation: 'auto', awayMentality: 'balanced', awayPressing: 3, awayTempo: 3, awayLine: 3,
});

const inRange = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
const rng = (r: readonly [number, number], fmt: (x: number) => string) => `${fmt(r[0])} – ${fmt(r[1])}`;

export const calibration: Scenario = {
  id: 'calibracao',
  title: 'Calibração do motor',
  description: 'Confere as metas de realismo (gols, mando, empates, 0x0, cartões, acréscimos), o determinismo e o equilíbrio entre formações.',
  params: [
    { key: 'universe', label: 'Universo', kind: 'select', default: 'calib', options: [{ value: 'calib', label: 'Calibração (Brasil e Inglaterra, 2 divisões)' }, { value: 'base', label: 'Base fixa do jogo (sem pacotes)' }] },
    { key: 'n', label: 'Partidas da bateria geral', kind: 'number', default: 2000, min: 100, max: 50000, step: 500 },
    { key: 'formations', label: 'Testar o equilíbrio entre formações', kind: 'boolean', default: true },
    { key: 'perFormation', label: 'Partidas por formação', kind: 'number', default: 420, min: 70, max: 20000, step: 70, help: 'Cada formação enfrenta as outras em rodízio; 420 = 70 contra cada uma das 6 outras.' },
    { key: 'seed', label: 'Semente', kind: 'text', default: 'calib-lab' },
  ],
  async run(p, ctx) {
    const u = asUniverse(p.universe);
    const n = Number(p.n), perF = p.formations ? Number(p.perFormation) : 0;
    const total = n + 20 + perF * FORMATIONS.length;
    let done = 0;
    const tick = async () => { done++; if (done % 25 === 0) { ctx.onProgress({ done, total }); await new Promise((r) => setImmediate(r)); } if (ctx.cancelled()) throw new Cancelled(); };
    const prm = { ...base(String(p.seed)), universe: u };

    // 1) bateria geral
    const games: BatchGame[] = [];
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { games.push(batchGame(u, prm, i).game); await tick(); }
    const ms = performance.now() - t0;

    // 2) determinismo: 20 jogos refeitos têm de sair idênticos
    let same = 0;
    for (let i = 0; i < 20; i++) {
      const a = batchGame(u, prm, i).outcome, b = batchGame(u, prm, i).outcome;
      if (JSON.stringify([a.homeGoals, a.awayGoals, a.events, a.stats]) === JSON.stringify([b.homeGoals, b.awayGoals, b.events, b.stats])) same++;
      await tick();
    }

    // 3) formações: cada uma contra as outras em rodízio, mesmos pares de clubes e sementes para todas
    const fRows: Array<{ id: string; p: number[]; gf: number[]; ga: number[] }> = [];
    if (perF > 0) {
      for (const F of FORMATIONS) {
        const others = FORMATIONS.filter((x) => x.id !== F.id);
        const r = { id: F.id, p: [] as number[], gf: [] as number[], ga: [] as number[] };
        for (let k = 0; k < perF; k++) {
          const opp = others[k % others.length]!;
          const g = batchGame(u, { ...prm, seed: `${String(p.seed)}-f`, homeFormation: F.id, awayFormation: opp.id }, k).game;
          r.p.push(pts(g.aGoals, g.bGoals)); r.gf.push(g.aGoals); r.ga.push(g.bGoals);
          await tick();
        }
        fRows.push(r);
      }
    }
    ctx.onProgress({ done: total, total });

    const N = games.length;
    const goals = mean(games.map((g) => g.aGoals + g.bGoals)), xg = mean(games.map((g) => g.aXg + g.bXg));
    const hg = games.map((g) => (g.aHome ? g.aGoals : g.bGoals)), vg = games.map((g) => (g.aHome ? g.bGoals : g.aGoals));
    const home = hg.filter((h, k) => h > vg[k]!).length / N, draw = hg.filter((h, k) => h === vg[k]).length / N, away = 1 - home - draw;
    const nil = games.filter((g) => g.aGoals + g.bGoals === 0).length / N;
    const yel = mean(games.map((g) => g.yellows)), red = mean(games.map((g) => g.reds));
    const a1 = mean(games.map((g) => g.added[0])), a2 = mean(games.map((g) => g.added[1]));
    const anom = games.reduce((s, g) => s + g.anomalies.length, 0);
    const n2 = (x: number) => f2(x), pc = (x: number) => pct(x, 0);
    const checks: Section = {
      kind: 'checks', title: 'Metas de realismo', items: [
        { label: 'Gols por jogo', value: f2(goals), target: rng(TARGETS.goals, n2), ok: inRange(goals, TARGETS.goals) },
        { label: 'xG próximo dos gols', value: `${f2(xg)} (dif. ${f2(Math.abs(xg - goals))})`, target: `dif. ≤ ${f2(TARGETS.xgGap)}`, ok: Math.abs(xg - goals) <= TARGETS.xgGap },
        { label: 'Vitória do mandante', value: pct(home), target: rng(TARGETS.home, pc), ok: inRange(home, TARGETS.home) },
        { label: 'Empate', value: pct(draw), target: rng(TARGETS.draw, pc), ok: inRange(draw, TARGETS.draw) },
        { label: 'Vitória do visitante', value: pct(away), target: rng(TARGETS.away, pc), ok: inRange(away, TARGETS.away) },
        { label: '0x0', value: pct(nil), target: rng(TARGETS.nil, pc), ok: inRange(nil, TARGETS.nil) },
        { label: 'Amarelos por jogo', value: f2(yel), target: rng(TARGETS.yellows, n2), ok: inRange(yel, TARGETS.yellows) },
        { label: 'Vermelhos por jogo', value: f2(red), target: rng(TARGETS.reds, n2), ok: inRange(red, TARGETS.reds) },
        { label: 'Acréscimos 1º tempo (min)', value: f2(a1), target: rng(TARGETS.added1, n2), ok: inRange(a1, TARGETS.added1) },
        { label: 'Acréscimos 2º tempo (min)', value: f2(a2), target: rng(TARGETS.added2, n2), ok: inRange(a2, TARGETS.added2) },
        { label: 'Anomalias', value: String(anom), target: '0', ok: anom === 0 },
        { label: 'Determinismo (20 jogos refeitos)', value: `${same}/20 idênticos`, target: '20/20', ok: same === 20 },
      ],
    };
    const sections: Section[] = [checks];
    if (fRows.length) {
      const ppg = fRows.map((r) => mean(r.p));
      const spread = Math.max(...ppg) - Math.min(...ppg);
      (checks.items).push({ label: 'Equilíbrio entre formações (maior − menor pontos/jogo)', value: f2(spread), target: `≤ ${f2(TARGETS.formationSpread)}`, ok: spread <= TARGETS.formationSpread });
      sections.push({
        kind: 'table', title: `Formações (${perF} jogos cada, contra as outras em rodízio, mando alternado)`, numeric: [1, 2, 3],
        columns: ['Formação', 'Pontos/jogo', 'Gols pró', 'Gols contra'],
        note: 'O ± é o erro-padrão de cada linha. Com poucos jogos ele é grande e a diferença entre formações pode ser só sorte: para uma conclusão, use 1.000 ou mais por formação.',
        rows: fRows.map((r) => ({ r, m: mean(r.p) })).sort((x, y) => y.m - x.m).map(({ r, m }) => [r.id, `${f2(m)} ±${f2(se(r.p))}`, f2(mean(r.gf)), f2(mean(r.ga))]),
      });
    }
    sections.push(...summarize(u, games, ms).map((s) => (s.kind === 'kpis' ? { ...s, title: `Bateria geral: ${N} partidas` } : s)));
    return { sections, data: { games, formations: fRows.map((r) => ({ id: r.id, ppg: mean(r.p) })) } };
  },
};
