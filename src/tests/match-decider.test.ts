import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchInterventionError, simulateMatch } from '../game/match-engine/engine.ts';
import { quickKnockout } from '../game/match-engine/quickResult.ts';
import { createRng } from '../game/rng.ts';
import type { Intervention, MatchDecider, MatchOutcome, TeamSheet } from '../game/match-engine/types.ts';
import { midClubs, sheetOf } from './fixtures.ts';

const mid = midClubs();
const sheets = new Map<string, TeamSheet>();
const sheet = (id: string) => sheets.get(id) ?? (sheets.set(id, sheetOf(id)), sheets.get(id)!);
const pair = (i: number): [TeamSheet, TeamSheet] => { const a = mid[i % mid.length]!; let b = mid[(i * 3 + 1) % mid.length]!; if (a === b) b = mid[(i + 1) % mid.length]!; return [sheet(a), sheet(b)]; };
const PENS: MatchDecider = { extraTime: false, penalties: true };
const ET_PENS: MatchDecider = { extraTime: true, penalties: true };
const periods = (r: MatchOutcome) => r.events.filter((e) => e.type === 'period_end').map((e) => e.detail);

/** a disputa respeitou a Lei 10: série de 5 que para assim que um time não alcança mais o outro, depois alternadas */
function assertShootout(r: MatchOutcome) {
  const kicks = r.events.filter((e) => e.type === 'shootout_kick');
  const res = [0, 0], taken = [0, 0];
  kicks.forEach((k, n) => {
    assert.equal(k.team, n % 2, 'cobranças alternadas, mandante primeiro');
    if (k.scored) res[k.team]!++;
    taken[k.team]!++;
    if (n === kicks.length - 1) return;
    if (taken[0]! <= 5 && taken[1]! <= 5) {
      const decided = res[0]! > res[1]! + (5 - taken[1]!) || res[1]! > res[0]! + (5 - taken[0]!);
      assert.ok(!decided, `cobrança depois de a série já estar decidida (${res.join('–')} após ${taken.join('/')})`);
    } else if (taken[0] === taken[1]) assert.equal(res[0], res[1], 'nas alternadas, só continua empatado');
  });
  assert.deepEqual([res[0], res[1]], [r.shootout!.home, r.shootout!.away]);
}

test('Desempate: jogo único só com pênaltis não tem prorrogação; com prorrogação, 2×15 e depois pênaltis; vencedor sempre definido', () => {
  let pens = 0, et = 0;
  for (let i = 0; i < 160; i++) {
    const [h, a] = pair(i);
    const p = simulateMatch(h, a, { seed: `pen-${i}`, decider: PENS });
    assert.notEqual(p.winner, null);
    assert.ok(!periods(p).includes('extra1') && p.events.every((e) => e.minute <= 90), 'sem prorrogação');
    assert.notEqual(p.decidedIn, 'extra_time');
    if (p.decidedIn === 'penalties') { pens++; assert.equal(p.homeGoals, p.awayGoals); assertShootout(p); assert.equal(p.winner, p.shootout!.home > p.shootout!.away ? 0 : 1); }
    else { assert.equal(p.shootout, null); assert.equal(p.winner, p.homeGoals > p.awayGoals ? 0 : 1); }
    const e = simulateMatch(h, a, { seed: `pen-${i}`, decider: ET_PENS });
    assert.notEqual(e.winner, null);
    if (e.decidedIn !== 'regular') { et++; assert.deepEqual(periods(e), ['halftime', 'fulltime', 'extra1', 'extra2']); }
    if (e.decidedIn === 'penalties') assertShootout(e);
    // os 90 minutos são os mesmos nas duas regras (a regra só muda o que vem depois)
    const upTo90 = (r: MatchOutcome) => r.events.filter((x) => x.minute <= 90 && x.type !== 'shootout_kick' && !(x.type === 'period_end' && x.detail !== 'halftime' && x.detail !== 'fulltime')).map((x) => `${x.type}${x.minute}${x.player ?? ''}`);
    assert.deepEqual(upTo90(p).slice(0, upTo90(e).length), upTo90(e).slice(0, upTo90(p).length));
  }
  assert.ok(pens > 15 && et > 15, `amostra com pênaltis (${pens}) e prorrogações (${et})`);
  // compatibilidade: knockout sem decider = prorrogação + pênaltis
  const [h, a] = pair(3);
  const old = simulateMatch(h, a, { seed: 'compat', knockout: true }), now = simulateMatch(h, a, { seed: 'compat', decider: ET_PENS });
  assert.deepEqual(old, now);
  assert.deepEqual(simulateMatch(h, a, { seed: 'det', decider: PENS }), simulateMatch(h, a, { seed: 'det', decider: PENS }), 'determinístico');
});

test('Desempate: jogo de volta decide pelo agregado (sem gol fora); agregado empatado vai aos pênaltis; a ida sem regra aceita empate', () => {
  let byAgg = 0, pensAgg = 0, draws = 0;
  for (let i = 0; i < 120; i++) {
    const [h, a] = pair(i);
    const ida = simulateMatch(a, h, { seed: `ida-${i}` });
    assert.equal(ida.aggregate, null);
    if (ida.homeGoals === ida.awayGoals) { draws++; assert.equal(ida.winner, null, 'ida empatada é resultado válido'); }
    // na volta, o mandante é quem foi visitante na ida
    const first: [number, number] = [ida.awayGoals, ida.homeGoals];
    const volta = simulateMatch(h, a, { seed: `volta-${i}`, decider: { ...PENS, firstLeg: first } });
    assert.deepEqual(volta.aggregate, [volta.homeGoals + first[0], volta.awayGoals + first[1]]);
    const [ah, aa] = volta.aggregate!;
    if (ah !== aa) { byAgg++; assert.equal(volta.winner, ah > aa ? 0 : 1); assert.equal(volta.shootout, null); assert.equal(volta.decidedIn, 'regular'); }
    else { pensAgg++; assert.equal(volta.decidedIn, 'penalties'); assertShootout(volta); }
  }
  assert.ok(byAgg > 40 && pensAgg > 5 && draws > 10, `agregado ${byAgg}, pênaltis ${pensAgg}, idas empatadas ${draws}`);
  // quem perdeu a ida por 3 e vence a volta por 1 está eliminado (mesmo vencendo o jogo)
  const [h, a] = pair(5);
  for (let k = 0; k < 30; k++) {
    const r = simulateMatch(h, a, { seed: `rev-${k}`, decider: { ...ET_PENS, firstLeg: [0, 3] } });
    if (r.homeGoals - r.awayGoals > 0 && r.homeGoals - r.awayGoals < 3) { assert.equal(r.winner, 1); return; }
  }
});

test('Substituições: a 6ª troca só existe na prorrogação quando a competição permite', () => {
  for (let i = 0; i < 200; i++) {
    const [h, a] = pair(i);
    const outs = h.lineup.filter((l) => l.slot !== 'GK').slice(0, 6).map((l) => l.player.id);
    const ins = h.bench.filter((b) => b.position !== 'GK').slice(0, 6).map((b) => b.id);
    if (ins.length < 6) continue;
    const five: Intervention[] = outs.slice(0, 5).map((out, k) => ({ tick: 2 + k, kind: 'sub', team: 0, out, in: ins[k]! }));
    const base = { seed: `six-${i}`, timeline: true, control: { team: 0 as const, until: 100_000 } };
    const r = simulateMatch(h, a, { ...base, decider: { ...ET_PENS, extraTimeSub: true }, interventions: five });
    if (r.decidedIn === 'regular') continue;
    const tick = r.timeline!.findIndex((t) => t.minute >= 100);
    const six: Intervention[] = [...five, { tick, kind: 'sub', team: 0, out: outs[5]!, in: ins[5]! }];
    const ok = simulateMatch(h, a, { ...base, decider: { ...ET_PENS, extraTimeSub: true }, interventions: six });
    assert.equal(ok.events.filter((e) => e.type === 'substitution' && e.team === 0).length, 6);
    assert.ok(ok.players.find((p) => p.id === ins[5])!.subbedInAt! > 90, 'a 6ª entra na prorrogação');
    assert.throws(() => simulateMatch(h, a, { ...base, decider: ET_PENS, interventions: six }), (e: unknown) => e instanceof MatchInterventionError && /5 substituições/.test((e as Error).message));
    // 6ª troca ainda no tempo normal: proibida mesmo com a regra da prorrogação
    const early: Intervention[] = [...five, { tick: 20, kind: 'sub', team: 0, out: outs[5]!, in: ins[5]! }];
    assert.throws(() => simulateMatch(h, a, { ...base, decider: { ...ET_PENS, extraTimeSub: true }, interventions: early }), MatchInterventionError);
    return;
  }
  assert.fail('nenhuma partida com prorrogação na amostra');
});

test('Resultado rápido: mesma regra de desempate (pênaltis sem prorrogação, prorrogação, agregado), determinístico', () => {
  const stats = { pens: 0, et: 0, homeWins: 0 };
  for (let i = 0; i < 3000; i++) {
    const p = quickKnockout(60, 60, createRng(`q-${i}`), PENS, true);
    assert.notEqual(p.winner, null);
    assert.notEqual(p.decidedIn, 'extra_time');
    if (p.decidedIn === 'penalties') {
      stats.pens++;
      assert.equal(p.homeGoals, p.awayGoals);
      assert.notEqual(p.shootout!.home, p.shootout!.away);
      assert.equal(p.winner, p.shootout!.home > p.shootout!.away ? 0 : 1);
    } else assert.equal(p.winner, p.homeGoals > p.awayGoals ? 0 : 1);
    if (p.winner === 0) stats.homeWins++;
    const e = quickKnockout(60, 60, createRng(`q-${i}`), ET_PENS, true);
    if (e.decidedIn === 'extra_time') { stats.et++; assert.notEqual(e.homeGoals, e.awayGoals); }
    const v = quickKnockout(60, 60, createRng(`v-${i}`), { ...PENS, firstLeg: [2, 0] });
    assert.deepEqual(v.aggregate, [v.homeGoals + 2, v.awayGoals]);
    if (v.aggregate![0] !== v.aggregate![1]) assert.equal(v.winner, v.aggregate![0] > v.aggregate![1] ? 0 : 1);
  }
  assert.ok(stats.pens > 450 && stats.pens < 1050, `empates nos 90 (${stats.pens}/3000)`);
  assert.ok(stats.et > 150, `decididos na prorrogação (${stats.et})`);
  assert.ok(Math.abs(stats.homeWins / 3000 - 0.5) < 0.04, `campo neutro e times iguais: ~50% (${stats.homeWins})`);
  assert.deepEqual(quickKnockout(70, 55, createRng('d'), ET_PENS), quickKnockout(70, 55, createRng('d'), ET_PENS));
  let strong = 0;
  for (let i = 0; i < 2000; i++) if (quickKnockout(75, 50, createRng(`s-${i}`), PENS, true).winner === 0) strong++;
  assert.ok(strong / 2000 > 0.7, `o mais forte avança mais (${strong}/2000)`);
  // nos pênaltis, a força pesa pouco, mas pesa (±5 pontos no acerto)
  let sh = 0, shWins = 0;
  for (let i = 0; i < 6000; i++) { const r = quickKnockout(75, 50, createRng(`p-${i}`), PENS, true); if (r.decidedIn === 'penalties') { sh++; if (r.winner === 0) shWins++; } }
  assert.ok(sh > 300 && shWins / sh > 0.53 && shWins / sh < 0.75, `mais forte nos pênaltis: ${shWins}/${sh}`);
});
