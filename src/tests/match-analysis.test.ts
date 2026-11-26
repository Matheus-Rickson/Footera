import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../game/match-engine/engine.ts';
import { HEAT_H, HEAT_W, type MatchOutcome } from '../game/match-engine/types.ts';
import { attackRight, averagePosition, decodeDef, decodeHeat, decodePasses, heatAttackRight, momentumSeries, smoothHeat } from '../game/match-engine/v2/detail.ts';
import { midClubs, sheetOf } from './fixtures.ts';

const mid = midClubs();
const H = sheetOf(mid[0]!), A = sheetOf(mid[3]!);
const play = (seed: string, detail = true): MatchOutcome => simulateMatch(H, A, { seed, engine: 'v2', timeline: true, detail });

test('análise: gravar a análise não muda a partida (só observa); v1 não tem análise', () => {
  for (const seed of ['an-1', 'an-2']) {
    const a = play(seed), b = play(seed, false);
    assert.equal(b.detail, null);
    assert.deepEqual({ ...a, detail: null }, b);
  }
  assert.equal(simulateMatch(H, A, { seed: 'an-v1', engine: 'v1', detail: true }).detail, null);
});

test('análise: passes, desarmes, interceptações e faltas de cada jogador batem com o relatório; o mapa de calor cobre o tempo em campo', () => {
  let keyed = 0, keyTotal = 0;
  for (const seed of ['an-3', 'an-4', 'an-5']) {
    const o = play(seed);
    const d = o.detail!;
    for (const r of o.players.filter((p) => p.minutes > 0)) {
      const pd = d.players[r.id];
      assert.ok(pd, `sem análise: ${r.name}`);
      const passes = decodePasses(pd);
      assert.equal(passes.length, r.passes, `passes de ${r.name}`);
      assert.equal(passes.filter((p) => p.ok).length, r.passesCompleted, `passes certos de ${r.name}`);
      const defs = decodeDef(pd);
      assert.equal(defs.filter((x) => x.kind === 'tackle').length, r.tackles, `desarmes de ${r.name}`);
      assert.equal(defs.filter((x) => x.kind === 'interception').length, r.interceptions, `interceptações de ${r.name}`);
      assert.equal(defs.filter((x) => x.kind === 'foul').length, r.fouls, `faltas de ${r.name}`);
      assert.equal(defs.filter((x) => x.kind === 'recovery').length, pd.recoveries);
      assert.ok(pd.dribblesWon <= pd.dribbles && pd.lost >= 0 && pd.touches >= r.shots);
      keyed += passes.filter((p) => p.key).length; keyTotal += r.keyPasses;
      for (const p of passes) for (const q of [p.from, p.to]) assert.ok(q.x >= 0 && q.x <= 105 && q.y >= 0 && q.y <= 68, 'passe fora do campo');
      const heat = decodeHeat(pd);
      assert.equal(heat.length, HEAT_W * HEAT_H);
      assert.ok(heat.every((v) => v >= 0 && v <= 1) && heat.some((v) => v === 1), 'grade 0–1 com a célula mais frequentada = 1');
      // segundos no mapa de calor ~ minutos jogados; os minutos do relatório não contam os acréscimos (até ~12 min no jogo)
      const m = pd.seconds / 60;
      assert.ok(m >= r.minutes - 3 && m <= r.minutes + 14, `${r.name}: ${pd.seconds}s × ${r.minutes}'`);
    }
    assert.equal(d.momentum.length, o.timeline!.length, 'momentum por minuto registrado');
    assert.ok(d.momentum.every(([h, a]) => h >= 0 && a >= 0));
    const terr = d.territory.flat().reduce((s, v) => s + v, 0);
    assert.ok(terr > 60 * 80 && terr < 60 * 110, `tempo com a bola: ${terr}s`);
  }
  // passe decisivo marcado no passe que gerou a finalização (o escanteio cobrado direto conta como passe)
  assert.ok(keyTotal > 0 && keyed === keyTotal, `passes decisivos marcados ${keyed} de ${keyTotal}`);
});

test('análise: leitura — espelhamento do visitante, suavização, posição média e momentum normalizado', () => {
  assert.deepEqual(attackRight({ x: 10, y: 5 }, 0), { x: 10, y: 5 });
  assert.deepEqual(attackRight({ x: 10, y: 5 }, 1), { x: 95, y: 63 });
  const grid = new Array<number>(HEAT_W * HEAT_H).fill(0);
  grid[2 * HEAT_W + 3] = 1; // célula (3, 2)
  const flipped = heatAttackRight(grid, 1);
  assert.equal(flipped[(HEAT_H - 1 - 2) * HEAT_W + (HEAT_W - 1 - 3)], 1, 'visitante girado 180°');
  const sm = smoothHeat(grid, 2);
  assert.equal(Math.max(...sm), 1);
  assert.equal(sm[2 * HEAT_W + 3], 1, 'o pico continua no lugar');
  assert.equal(sm[2 * HEAT_W + 6], 0, 'duas passadas espalham no máximo duas células');
  const avg = averagePosition(grid)!;
  assert.ok(Math.abs(avg.x - 3.5 * (105 / HEAT_W)) < 1e-9 && Math.abs(avg.y - 2.5 * (68 / HEAT_H)) < 1e-9);
  assert.equal(averagePosition(new Array(HEAT_W * HEAT_H).fill(0)), null);
  const m = momentumSeries([[10, 0], [10, 0], [0, 30], [0, 0], [5, 5]]);
  assert.ok(m.every((v) => v >= -1 && v <= 1) && m.some((v) => Math.abs(v) === 1));
  assert.ok(m[0]! > 0 && m[2]! < 0, 'sinal: mandante positivo, visitante negativo');
});

test('análise: cada time joga com a esquerda e a direita certas (o visitante, que ataca para o outro lado, não fica espelhado)', () => {
  // posição média pelo mapa de calor, vista com o time atacando para a direita: a esquerda de quem ataca fica em cima (y < 34)
  const LEFT = new Set(['LB', 'LWB', 'LM', 'LW']), RIGHT = new Set(['RB', 'RWB', 'RM', 'RW']);
  let checked = 0;
  for (const seed of ['lado-1', 'lado-2']) {
    const o = play(seed);
    for (const p of o.players.filter((r) => r.starter && (LEFT.has(r.slot) || RIGHT.has(r.slot)))) {
      const avg = averagePosition(heatAttackRight(decodeHeat(o.detail!.players[p.id]!), p.team))!;
      if (LEFT.has(p.slot)) assert.ok(avg.y < 30, `${p.team ? 'visitante' : 'mandante'} ${p.slot} pela esquerda: y=${avg.y.toFixed(1)}`);
      else assert.ok(avg.y > 38, `${p.team ? 'visitante' : 'mandante'} ${p.slot} pela direita: y=${avg.y.toFixed(1)}`);
      checked++;
    }
  }
  assert.ok(checked >= 8, `poucos jogadores de lado: ${checked}`);
});

test('motor v2: a bola passa pelos zagueiros e o centroavante não é o centro do jogo; interceptação só perto da linha da bola', () => {
  // 30 partidas entre clubes médios, titulares que jogaram 80 min ou mais (v0.11.1; antes: zagueiro 6, centroavante 75, 80 interceptações)
  const by = new Map<string, number[]>();
  let int = 0, tk = 0, rec = 0, lost = 0, teams = 0;
  for (let i = 0; i < 30; i++) {
    const h = sheetOf(mid[i % mid.length]!), a = sheetOf(mid[(i * 7 + 3) % mid.length]!);
    if (h.clubId === a.clubId) continue;
    const o = simulateMatch(h, a, { seed: `dist-${i}`, engine: 'v2', detail: true });
    teams += 2;
    for (const s of o.stats) { int += s.interceptions; tk += s.tackles; }
    for (const p of o.players) { const d = o.detail!.players[p.id]; if (d) { rec += d.recoveries; lost += d.lost; } }
    for (const p of o.players.filter((r) => r.starter && r.minutes >= 80)) {
      const g = p.slot === 'CB' ? 'CB' : p.slot === 'CF' || p.slot === 'ST' ? 'CF' : p.slot === 'CM' ? 'CM' : null;
      if (!g) continue;
      const v = by.get(g) ?? [0, 0]; v[0]!++; v[1]! += p.passes; by.set(g, v);
    }
  }
  const avg = (g: string) => { const [n, s] = by.get(g)!; return s! / n!; };
  assert.ok(avg('CB') >= 12, `zagueiro com ${avg('CB').toFixed(1)} passes por jogo`);
  assert.ok(avg('CF') <= 65, `centroavante com ${avg('CF').toFixed(1)} passes por jogo`);
  assert.ok(avg('CF') < avg('CM'), 'centroavante passa menos que o meio-campista');
  assert.ok(int / teams <= 25 && int / teams >= 4, `${(int / teams).toFixed(1)} interceptações por time`);
  assert.ok(tk / teams <= 28, `${(tk / teams).toFixed(1)} desarmes por time (a condução que perde a bola longe do defensor é recuperação)`);
  assert.ok(rec > int, 'a bola que sobra solta conta como recuperação, não como interceptação');
  assert.ok(lost / teams <= 145, `${(lost / teams).toFixed(0)} posses perdidas por time`);
});

test('análise: onde a bola esteve com cada time bate com o território por terço (mesma escala nos dois times)', () => {
  for (const seed of ['ball-1', 'ball-2']) {
    const d = play(seed).detail!;
    assert.ok(d.ball, 'grade da bola gravada');
    const g = d.ball.map((b) => decodeHeat({ heat: b }));
    assert.ok(Math.max(...g[0]!, ...g[1]!) === 1, 'a célula mais usada (de qualquer time) vale 1');
    for (const t of [0, 1] as const) {
      // terços no sentido do mandante: colunas 0–6, 7–13 e 14–20
      const cols = [0, 0, 0];
      g[t]!.forEach((v, i) => { cols[Math.min(2, Math.floor((i % HEAT_W) / 7))]! += v; });
      const tot = cols.reduce((a, b) => a + b, 0);
      const ter = d.territory[t], tt = ter.reduce((a, b) => a + b, 0);
      const att = t === 0 ? cols[2]! : cols[0]!; // terço de ataque de cada um
      assert.ok(Math.abs(att / tot - ter[2] / tt) < 0.06, `time ${t}: ataque ${(att / tot).toFixed(2)} × território ${(ter[2] / tt).toFixed(2)}`);
    }
    // o mandante tem a bola mais no campo da direita do que o visitante (cada um ataca para um lado)
    const right = (gr: number[]) => gr.reduce((s, v, i) => s + ((i % HEAT_W) >= 11 ? v : 0), 0) / gr.reduce((s, v) => s + v, 0);
    assert.ok(right(g[0]!) > right(g[1]!), 'mandante mais à direita');
  }
});
