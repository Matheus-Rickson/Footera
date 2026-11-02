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
