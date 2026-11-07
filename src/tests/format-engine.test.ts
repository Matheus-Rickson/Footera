import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, type Rng } from '../game/rng.ts';
import {
  buildableStages, buildStage, campaign, deciderFor, finalRanking, formatComplete, outcomes, resolveRef, stageTables, tieOutcome,
  type FormatDef, type FormatState, type Fixture,
} from '../game/format-engine/engine.ts';
import { ESTADUAIS, SERIE_D_SPOTS, serieC, serieD } from '../game/format-engine/formats.ts';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${String(i).padStart(3, '0')}`);

/** Simula a competição inteira com placares aleatórios (pênaltis aleatórios no confronto empatado). Devolve o estado e os jogos por fase. */
function simulate(def: FormatDef, seed: string) {
  const rng = createRng(seed);
  const state: FormatState = { seeds: ids(def.size), stages: {} };
  const fixtures = new Map<string, Fixture[]>();
  for (let guard = 0; guard < 50 && !formatComplete(def, state); guard++) {
    const ready = buildableStages(def, state);
    assert.ok(ready.length > 0, `${def.name}: nenhuma fase pronta para montar (travou)`);
    for (const id of ready) {
      const st = def.stages.find((s) => s.id === id)!;
      const preset = st.kind === 'league' && st.assign === 'preset' ? chunk(state, id, def) : undefined;
      const built = buildStage(def, state, id, rng.fork(id), preset);
      state.stages[id] = built.stage;
      fixtures.set(id, built.fixtures);
      play(def, state, id, built.fixtures, rng.fork(`p:${id}`));
    }
  }
  assert.ok(formatComplete(def, state), `${def.name}: não terminou`);
  return { state, fixtures };
}
function chunk(state: FormatState, id: string, def: FormatDef): string[][] {
  const stage = def.stages.find((s) => s.id === id)!;
  const groups = stage.kind === 'league' ? stage.groups : 1;
  const per = state.seeds.length / groups;
  return Array.from({ length: groups }, (_, g) => state.seeds.slice(g * per, (g + 1) * per));
}
function play(def: FormatDef, state: FormatState, id: string, fixtures: readonly Fixture[], rng: Rng) {
  const st = state.stages[id]!;
  for (const f of [...fixtures].sort((a, b) => a.round - b.round)) {
    const r = { home: f.home, away: f.away, homeGoals: rng.int(0, 3), awayGoals: rng.int(0, 3), ...(f.tie !== undefined ? { tie: f.tie, leg: f.leg } : {}) };
    st.results.push(r);
    if (f.tie !== undefined && tieOutcome(def, state, id, f.tie) === null && st.results.filter((x) => x.tie === f.tie).length >= (f.leg ?? 1)) {
      const t = st.ties![f.tie]!;
      if (st.results.filter((x) => x.tie === f.tie).length === (def.stages.find((s) => s.id === id) as { legs: number }).legs) Object.assign(r, { pens: rng.next() < 0.5 ? t.a : t.b });
    }
  }
}

const ALL: FormatDef[] = [
  ...ESTADUAIS.map((e) => e.format(2026)),
  ESTADUAIS.find((e) => e.id === 'sc')!.format(2027),
  serieC(2026), serieC(2027), serieC(2028), serieD(),
];

test('Formatos: todas as competições (29 estaduais, Séries C 2026/27/28, Série D) rodam até o fim com campeão, classificação e zonas coerentes', () => {
  assert.equal(ESTADUAIS.length, 29);
  assert.equal(new Set(ESTADUAIS.map((e) => e.id)).size, 29);
  assert.deepEqual([...new Set(ESTADUAIS.filter((e) => e.division === 1).map((e) => e.uf))].sort(), Object.keys(SERIE_D_SPOTS).sort(), 'um estadual por estado (27)');
  assert.equal(Object.values(SERIE_D_SPOTS).reduce((s, x) => s + x, 0), 64, '64 vagas das federações');
  for (const def of ALL) {
    for (const seed of ['a', 'b']) {
      const { state, fixtures } = simulate(def, `${def.id}:${seed}`);
      // ninguém joga duas vezes na mesma rodada de uma fase; ninguém enfrenta a si mesmo
      for (const [id, fx] of fixtures) {
        const seen = new Set<string>();
        for (const f of fx) {
          assert.notEqual(f.home, f.away);
          for (const c of [f.home, f.away]) { const k = `${f.round}|${c}`; assert.ok(!seen.has(k), `${def.name}/${id}: ${c} joga duas vezes na rodada ${f.round}`); seen.add(k); }
        }
      }
      const out = outcomes(def, state);
      assert.ok(out.champion, `${def.name}: campeão`);
      const ranking = finalRanking(def, state);
      assert.equal(ranking.length, def.size, `${def.name}: classificação com todos`);
      assert.equal(new Set(ranking).size, def.size);
      assert.equal(ranking[0], out.champion);
      assert.equal(out.relegated.length, def.relegated?.length ?? 0, `${def.name}: rebaixados`);
      assert.equal(new Set(out.relegated).size, out.relegated.length);
      assert.equal(out.promoted.length, def.promoted?.length ?? 0, `${def.name}: acessos`);
      assert.ok(!out.relegated.includes(out.champion!), `${def.name}: campeão não cai`);
      for (const t of out.titles) assert.ok(t.club, `${def.name}: ${t.name}`);
    }
  }
});

test('Fases de liga: dentro do grupo, contra os outros grupos (Carioca, Mineiro) e potes (Paulistão) com o número certo de jogos', () => {
  const count = (fx: readonly Fixture[], c: string) => fx.filter((f) => f.home === c || f.away === c);
  // Carioca: cada clube enfrenta os 6 do outro grupo, uma vez, nunca o próprio grupo
  const rj = ESTADUAIS.find((e) => e.id === 'rj-a1')!.format(2026);
  const { state: s1, fixtures: f1 } = simulate(rj, 'rj');
  const [ga, gb] = s1.stages.f1!.groups!;
  for (const c of [...ga!, ...gb!]) {
    const games = count(f1.get('f1')!, c);
    assert.equal(games.length, 6);
    const own = ga!.includes(c) ? ga! : gb!;
    assert.ok(games.every((g) => !own.includes(g.home === c ? g.away : g.home)), 'não enfrenta o próprio grupo');
  }
  assert.equal(new Set(f1.get('f1')!.map((f) => f.round)).size, 6, '6 rodadas');
  // Mineiro: 3 grupos de 4, 8 jogos contra os outros grupos em 8 rodadas
  const { fixtures: f2, state: s2 } = simulate(ESTADUAIS.find((e) => e.id === 'mg')!.format(2026), 'mg');
  for (const c of s2.seeds) assert.equal(count(f2.get('f1')!, c).length, 8);
  assert.equal(new Set(f2.get('f1')!.map((f) => f.round)).size, 8);
  // Paulistão: 3 jogos no pote + 5 contra outros potes = 8, em 8 rodadas, sem repetir adversário
  const sp = ESTADUAIS.find((e) => e.id === 'sp-a1')!.format(2026);
  const { fixtures: f3, state: s3 } = simulate(sp, 'sp');
  for (const c of s3.seeds) {
    const games = count(f3.get('f1')!, c), opp = games.map((g) => (g.home === c ? g.away : g.home));
    const pot = s3.stages.f1!.groups!.find((g) => g.includes(c))!;
    assert.equal(games.length, 8);
    assert.equal(new Set(opp).size, 8, 'sem repetir adversário');
    assert.equal(opp.filter((o) => pot.includes(o)).length, 3, '3 jogos no pote');
  }
  // Série C 2026: grupos da 2ª fase pelo Anexo B (1º, 4º, 5º, 8º × 2º, 3º, 6º, 7º), ida e volta
  const c = serieC(2026);
  const { state: sc, fixtures: fc } = simulate(c, 'c');
  const order = stageTables(c, sc, 'f1').overall.map((r) => r.teamId);
  assert.deepEqual(sc.stages.f2!.groups, [[order[0], order[3], order[4], order[7]], [order[1], order[2], order[5], order[6]]]);
  assert.equal(fc.get('f2')!.length, 24, '2 grupos de 4 em ida e volta');
  assert.deepEqual(outcomes(c, sc).relegated, [order[19], order[18]]);
});

test('Série D: 96 clubes, 16 grupos de 6 em ida e volta, mata-mata 64/32/16/8, playoffs dos eliminados nas quartas e 6 acessos', () => {
  const d = serieD();
  const { state, fixtures } = simulate(d, 'd');
  assert.equal(state.stages.f1!.groups!.length, 16);
  assert.equal(fixtures.get('f1')!.length, 16 * 30, '16 grupos × 30 jogos');
  assert.deepEqual(['f2', 'f3', 'f4', 'f5', 'sf', 'po', 'final'].map((s) => state.stages[s]!.ties!.length), [32, 16, 8, 4, 2, 2, 1]);
  // 2ª fase: 1º do grupo 1 × 4º do grupo 2, volta na casa do 1º
  const t0 = state.stages.f2!.ties![0]!;
  assert.equal(t0.a, resolveRef(d, state, { stage: 'f1', group: 0, pos: 1 }));
  assert.equal(t0.b, resolveRef(d, state, { stage: 'f1', group: 1, pos: 4 }));
  assert.equal(t0.host, t0.a);
  // quartas pelo Bloco I (campanha somada): 1º×8º, 4º×5º, 2º×7º, 3º×6º
  const upToF4: FormatState = { seeds: state.seeds, stages: { f1: state.stages.f1!, f2: state.stages.f2!, f3: state.stages.f3!, f4: state.stages.f4! } }; // campanha no momento da chave
  const bloco = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => tieOutcome(d, state, 'f4', i)!.winner).sort((x, y) => {
    const p = campaign(d, upToF4, x), q = campaign(d, upToF4, y);
    return q.points - p.points || q.wins - p.wins || q.goalDiff - p.goalDiff || q.goalsFor - p.goalsFor || x.localeCompare(y);
  });
  assert.deepEqual(state.stages.f5!.ties!.map((t) => [t.a, t.b]), [[0, 7], [3, 4], [1, 6], [2, 5]].map(([x, y]) => [bloco[x!], bloco[y!]]));
  // playoffs com os eliminados nas quartas; acesso: 4 semifinalistas + 2 vencedores dos playoffs
  const qfLosers = [0, 1, 2, 3].map((i) => tieOutcome(d, state, 'f5', i)!.loser).sort();
  assert.deepEqual(state.stages.po!.ties!.flatMap((t) => [t.a, t.b]).sort(), qfLosers);
  const out = outcomes(d, state);
  assert.equal(new Set(out.promoted).size, 6);
  assert.deepEqual(out.promoted.slice(0, 4).sort(), state.stages.sf!.ties!.flatMap((t) => [t.a, t.b]).sort());
  // classificação final: os eliminados na 1ª fase ficam do 65º ao 96º
  const ranking = finalRanking(d, state);
  const firstOut = state.seeds.filter((c) => !state.stages.f2!.ties!.some((t) => t.a === c || t.b === c));
  assert.equal(firstOut.length, 32);
  assert.deepEqual(ranking.slice(64).sort(), firstOut.sort());
});

/** Formato mínimo para testar regras de confronto. */
const tiny = (o: Partial<{ advantage: boolean; legs: 1 | 2 }> = {}): FormatDef => ({
  id: 't', name: 'Teste', regulation: '', source: { structure: 'ADAPT', tiebreak: 'ADAPT', national: 'ADAPT' }, size: 2,
  tiebreakers: ['points'], stages: [{ kind: 'knockout', id: 'k', name: 'Final', entrants: [{ seed: 0 }, { seed: 1 }], pairing: 'fixed', legs: o.legs ?? 2, host: 'first', ...(o.advantage ? { advantage: true } : {}) }],
  champion: { stage: 'k', winner: 0 },
});

test('Mata-mata: agregado, pênaltis só quando empata, vantagem do empate para o mandante e placar da ida para o motor da partida', () => {
  const def = tiny();
  const state: FormatState = { seeds: ['x', 'y'], stages: {} };
  const b = buildStage(def, state, 'k', createRng('k'));
  state.stages.k = b.stage;
  assert.deepEqual(b.fixtures.map((f) => [f.home, f.leg]), [['y', 1], ['x', 2]], 'ida na casa do outro, volta na casa do primeiro');
  state.stages.k.results.push({ home: 'y', away: 'x', homeGoals: 2, awayGoals: 1, tie: 0, leg: 1 });
  assert.equal(deciderFor(def, state, 'k', 0, 1), null, 'a ida não decide');
  assert.deepEqual(deciderFor(def, state, 'k', 0, 2), { extraTime: false, penalties: true, firstLeg: [1, 2] }, 'ida vista pelo mandante da volta');
  state.stages.k.results.push({ home: 'x', away: 'y', homeGoals: 1, awayGoals: 0, tie: 0, leg: 2 });
  assert.equal(tieOutcome(def, state, 'k', 0), null, '2 a 2 no agregado: falta o resultado dos pênaltis');
  state.stages.k.results[1]!.pens = 'y';
  assert.deepEqual(tieOutcome(def, state, 'k', 0), { winner: 'y', loser: 'x' });
  state.stages.k.results[1]!.homeGoals = 2;
  assert.equal(tieOutcome(def, state, 'k', 0)!.winner, 'x', 'agregado decide antes dos pênaltis');
  // vantagem do empate: empate no agregado classifica o mandante da volta, sem pênaltis
  const adv = tiny({ advantage: true, legs: 1 });
  const s2: FormatState = { seeds: ['x', 'y'], stages: {} };
  s2.stages.k = buildStage(adv, s2, 'k', createRng('k')).stage;
  assert.equal(deciderFor(adv, s2, 'k', 0, 1), null, 'sem pênaltis');
  s2.stages.k.results.push({ home: 'x', away: 'y', homeGoals: 0, awayGoals: 0, tie: 0, leg: 1 });
  assert.equal(tieOutcome(adv, s2, 'k', 0)!.winner, 'x');
});

test('Referências: melhor 2º, piores lanternas (Mineiro), jogos contra outros grupos na tabela e pontos de bonificação', () => {
  const def: FormatDef = {
    id: 'r', name: 'Ref', regulation: '', source: { structure: 'ADAPT', tiebreak: 'ADAPT', national: 'ADAPT' }, size: 6, tiebreakers: ['points', 'goalDiff', 'goalsFor'],
    stages: [{ kind: 'league', id: 'f1', name: 'F1', entrants: [0, 1, 2, 3, 4, 5].map((i) => ({ seed: i })), groups: 3, assign: 'order', play: 'cross', legs: 1, bonus: [{ ref: { seed: 5 }, points: 4 }] }],
    champion: { stage: 'f1', pos: 1 },
  };
  const state: FormatState = { seeds: ['a', 'b', 'c', 'd', 'e', 'f'], stages: {} };
  const built = buildStage(def, state, 'f1', createRng('r'));
  assert.deepEqual(built.stage.groups, [['a', 'b'], ['c', 'd'], ['e', 'f']]);
  assert.equal(built.fixtures.length, 12, 'cada clube enfrenta os 4 dos outros grupos');
  state.stages.f1 = built.stage;
  // placares: a vence tudo; b perde tudo; f empata tudo (e ganha 4 de bônus); os demais alternam
  for (const fx of built.fixtures) {
    const score = (c: string) => ({ a: 3, b: 0, c: 2, d: 1, e: 1, f: 1 } as Record<string, number>)[c]!;
    state.stages.f1.results.push({ home: fx.home, away: fx.away, homeGoals: score(fx.home), awayGoals: score(fx.away) });
  }
  const t = stageTables(def, state, 'f1');
  assert.ok(t.groups.every((g) => g.every((r) => r.played === 4)), 'a tabela do grupo conta os jogos contra os outros grupos');
  const pts = new Map(t.overall.map((r) => [r.teamId, r.points]));
  assert.equal(pts.get('a'), 12);
  assert.equal(pts.get('b'), 0);
  assert.ok(pts.get('f')! >= 4, 'bônus somado');
  // lanternas: b (0), d e f; os dois piores entre os últimos de cada grupo
  const lasts = t.groups.map((g) => g[g.length - 1]!.teamId);
  assert.ok(lasts.includes('b'));
  assert.equal(resolveRef(def, state, { stage: 'f1', pos: -1, nthWorst: 1 }), 'b', 'pior lanterna');
  assert.equal(resolveRef(def, state, { stage: 'f1', pos: 1, nthBest: 1 }), 'a', 'melhor líder');
  assert.equal(resolveRef(def, state, { stage: 'f1', pos: -1 }), t.overall[5]!.teamId, 'último da geral');
});

test('Formatos: mesma semente = mesmos grupos, jogos e campeão', () => {
  for (const def of [ESTADUAIS[0]!.format(2026), serieD(), ESTADUAIS.find((e) => e.id === 'rj-a1')!.format(2026)]) {
    const a = simulate(def, 'same'), b = simulate(def, 'same');
    assert.deepEqual([...a.fixtures.entries()], [...b.fixtures.entries()]);
    assert.equal(outcomes(def, a.state).champion, outcomes(def, b.state).champion);
  }
});
