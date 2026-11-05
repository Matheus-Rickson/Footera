import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../game/rng.ts';
import { ageOn, addDays, addYears, isValidIso } from '../shared/date.ts';

test('RNG: mesma semente produz a mesma sequência', () => {
  const a = createRng('x'), b = createRng('x');
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('RNG: sementes diferentes divergem e fork é independente e determinístico', () => {
  assert.notEqual(createRng('x').next(), createRng('y').next());
  assert.equal(createRng('s').fork('a').next(), createRng('s').fork('a').next());
  assert.notEqual(createRng('s').fork('a').next(), createRng('s').fork('b').next());
});

test('RNG: int respeita limites e normal tem média aproximada', () => {
  const r = createRng('lim');
  for (let i = 0; i < 2000; i++) { const v = r.int(3, 7); assert.ok(v >= 3 && v <= 7); }
  const n = createRng('norm');
  let sum = 0; for (let i = 0; i < 20000; i++) sum += n.normal(10, 2);
  assert.ok(Math.abs(sum / 20000 - 10) < 0.1);
});

test('RNG: weighted respeita pesos e rejeita entrada inválida', () => {
  const r = createRng('w');
  let hits = 0; for (let i = 0; i < 5000; i++) if (r.weighted(['a', 'b'], [9, 1]) === 'a') hits++;
  assert.ok(hits > 4300 && hits < 4700);
  assert.throws(() => r.weighted(['a'], [0]));
});

test('Datas: idade, validação e aritmética', () => {
  assert.equal(ageOn('2000-07-02', '2026-07-01'), 25);
  assert.equal(ageOn('2000-07-01', '2026-07-01'), 26);
  assert.equal(isValidIso('2026-02-30'), false);
  assert.equal(isValidIso('2024-02-29'), true);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addYears('2024-02-29', 1), '2025-02-28');
});

test('Calendário: grade do mês em semanas completas de domingo a sábado, com o mês inteiro dentro', async () => {
  const { monthGrid, weekday } = await import('../shared/date.ts');
  // agosto/2026 começa num sábado e tem 31 dias: 6 semanas (de 26/jul a 05/set)
  const ago = monthGrid(2026, 8);
  assert.deepEqual([ago.length, ago[0], ago.at(-1)], [42, '2026-07-26', '2026-09-05']);
  // fevereiro/2026 começa num domingo e tem 28 dias: exatamente 4 semanas
  assert.deepEqual([monthGrid(2026, 2).length, monthGrid(2026, 2)[0], monthGrid(2026, 2).at(-1)], [28, '2026-02-01', '2026-02-28']);
  for (const [y, m] of [[2026, 7], [2026, 12], [2027, 1], [2028, 2], [2027, 6]] as const) {
    const g = monthGrid(y, m), key = `${y}-${String(m).padStart(2, '0')}`;
    assert.equal(g.length % 7, 0); assert.equal(weekday(g[0]!), 0, 'começa no domingo'); assert.equal(weekday(g.at(-1)!), 6, 'termina no sábado');
    assert.equal(g.filter((d) => d.startsWith(key)).length, new Date(Date.UTC(y, m, 0)).getUTCDate(), `${key}: todos os dias do mês`);
    assert.ok(g.every((d, i) => i === 0 || d > g[i - 1]!), 'dias em ordem, sem repetir');
  }
});
