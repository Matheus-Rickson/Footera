import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../game/rng.ts';
import { developPlayer, expectedChange, PEAK_AGE, prizeMoney, retirementChance } from '../game/career-engine/development.ts';
import {
  aiRenewalWage, contractBaseYear, contractEndFor, expiresAt, maxContractYears, renewalDecision, renewalDemand, seasonYearOf, turnoverDate,
} from '../game/career-engine/contracts.ts';
import { buildPlayer } from '../game/world/generator.ts';
import { COUNTRY_TEMPLATES } from '../game/world/names.ts';
import { ageAbilityDelta } from '../game/world/generator.ts';
import type { Player } from '../shared/types.ts';
import { ageOn } from '../shared/date.ts';

const ctx = { professionalism: 10, minutesShare: 0.5 };
const young = (seed: string, age = 17): Player => {
  let n = 0;
  return buildPlayer(createRng(seed), (p) => `${p}_${++n}`, COUNTRY_TEMPLATES[0]!, 'clb', 60, 'CM', '2026-07-01', { first: 'A', last: 'B' }, { forceAge: age });
};

test('Desenvolvimento: jovem abaixo do potencial cresce; sem margem não cresce; auge estável; veterano declina cada vez mais', () => {
  assert.ok(expectedChange(18, 50, 75, ctx) > 3);
  assert.equal(expectedChange(20, 70, 70, ctx), 0, 'sem margem até o potencial');
  assert.ok(expectedChange(18, 50, 75, ctx) > expectedChange(25, 50, 75, ctx), 'cresce mais rápido quando mais novo');
  assert.ok(expectedChange(18, 74, 75, ctx) <= 1, 'nunca mais do que a margem');
  assert.equal(expectedChange(28, 70, 80, ctx), 0);
  assert.equal(expectedChange(29, 70, 70, ctx), 0);
  const decline = [31, 32, 33, 34, 35, 36, 37].map((a) => expectedChange(a, 70, 70, ctx));
  assert.ok(decline.every((d, i) => d < 0 && (i === 0 || d < decline[i - 1]!)), `declínio crescente: ${decline.join(', ')}`);
  assert.ok(expectedChange(19, 50, 80, { professionalism: 20, minutesShare: 1 }) > expectedChange(19, 50, 80, { professionalism: 1, minutesShare: 0 }), 'profissionalismo e minutos aceleram');
  assert.ok(expectedChange(34, 70, 70, { professionalism: 20, minutesShare: 0 }) > expectedChange(34, 70, 70, { professionalism: 1, minutesShare: 0 }), 'profissional declina mais devagar');
});

test(`Desenvolvimento: antes dos ${PEAK_AGE} anos a força nunca passa do potencial oculto; invariantes e determinismo`, () => {
  for (let i = 0; i < 300; i++) {
    const p = young(`dev-${i}`, 16 + (i % 11));
    const age = 16 + (i % 11);
    const rng = createRng(`d-${i}`);
    const d = developPlayer(p, age, (i % 5) / 4, rng);
    if (age < PEAK_AGE) assert.ok(d.overall <= p.potentialHidden, `idade ${age}: ${d.overall} > teto ${p.potentialHidden}`);
    assert.ok(d.potentialHidden >= d.overall && d.potentialEstimated >= d.overall && d.potentialEstimated <= 100);
    for (const g of Object.values(d.attributes)) for (const v of Object.values(g as Record<string, number>)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 20);
    assert.deepEqual(developPlayer(p, age, (i % 5) / 4, createRng(`d-${i}`)), d, 'mesma semente, mesma evolução');
  }
});

test('Desenvolvimento: carreira de um jovem de 16 anos chega perto do potencial aos 27 sem passar dele, e depois declina', () => {
  let reached = 0, total = 0;
  for (let i = 0; i < 40; i++) {
    let p: Player = young(`career-${i}`, 16);
    const cap = p.potentialHidden, start = p.overall;
    for (let age = 16; age <= 27; age++) {
      const d = developPlayer(p, age, 0.7, createRng(`c-${i}-${age}`));
      assert.ok(d.overall <= cap, `passou do teto aos ${age}`);
      p = { ...p, ...d };
    }
    total++;
    if (p.overall >= start + (cap - start) * 0.7) reached++;
    const peak = p.overall;
    for (let age = 28; age <= 36; age++) p = { ...p, ...developPlayer(p, age, 0.7, createRng(`v-${i}-${age}`)) };
    assert.ok(p.overall < peak, 'veterano perde força');
  }
  assert.ok(reached / total >= 0.8, `só ${reached}/${total} chegaram a 70% da margem`);
});

test('Gerador: aceita idade forçada (inclusive ≤ 16) com habilidade coerente', () => {
  assert.ok(ageAbilityDelta(16) < ageAbilityDelta(17) && ageAbilityDelta(15) < ageAbilityDelta(16));
  for (const age of [15, 16, 17]) {
    const p = young(`age-${age}`, age);
    assert.equal(ageOn(p.birthDate, '2026-07-01'), age, `nascido em ${p.birthDate}`);
    assert.ok(Number.isFinite(p.overall) && p.overall > 0 && p.potentialHidden > p.overall, `${age}: ${p.overall}/${p.potentialHidden}`);
  }
});

test('Aposentadoria: nula para jovens com contrato, cresce com a idade, certa aos 40; sem clube aumenta', () => {
  assert.equal(retirementChance(25, 60, false), 0);
  assert.equal(retirementChance(32, 60, false), 0);
  const ages = [33, 34, 35, 36, 37].map((a) => retirementChance(a, 60, false));
  assert.ok(ages.every((p, i) => p > 0 && (i === 0 || p > ages[i - 1]!)), ages.join(', '));
  assert.equal(retirementChance(40, 90, false), 1);
  assert.ok(retirementChance(31, 60, true) > retirementChance(31, 60, false));
  assert.ok(retirementChance(34, 80, false) < retirementChance(34, 60, false), 'craques jogam mais tempo');
});

test('Premiação: campeão da 1ª = economia × 2,4 mi; último = 10%; 2ª divisão × 0,23; decresce com a posição', () => {
  assert.equal(prizeMoney(0.6, 1, 1, 20), 1_440_000);
  assert.equal(prizeMoney(0.6, 1, 20, 20), 144_000);
  assert.equal(prizeMoney(1.6, 2, 1, 20), Math.round((1.6 * 2_400_000 * 0.23) / 1000) * 1000);
  const all = Array.from({ length: 20 }, (_, i) => prizeMoney(1, 1, i + 1, 20));
  assert.ok(all.every((v, i) => i === 0 || v < all[i - 1]!));
  assert.ok(all.every((v) => v % 1000 === 0));
});

test('Contratos: temporada de uma data, fim em 30/jun, vencimento na virada, base de renovação e limites por idade', () => {
  assert.equal(seasonYearOf('2026-07-01'), 2026); assert.equal(seasonYearOf('2027-06-30'), 2026); assert.equal(seasonYearOf('2027-01-15'), 2026);
  assert.equal(turnoverDate(2026), '2027-07-01');
  assert.equal(contractEndFor('2026-07-01', 3), '2029-06-30');
  assert.equal(contractEndFor('2027-01-20', 1), '2027-06-30', 'assinado em janeiro por 1 temporada = até o fim desta');
  assert.ok(expiresAt('2027-07-01', '2027-07-01') && expiresAt('2027-06-30', '2027-07-01') && !expiresAt('2027-08-15', '2027-07-01'));
  assert.equal(contractBaseYear('2027-07-01'), 2027); assert.equal(contractBaseYear('2027-06-30'), 2027); assert.equal(contractBaseYear('2027-08-15'), 2028);
  assert.deepEqual([29, 30, 32, 34].map(maxContractYears), [5, 3, 2, 1]);
  const demand = renewalDemand({ marketValue: 10_000_000, salary: 100_000, ambition: 10, loyalty: 10 });
  assert.ok(renewalDemand({ marketValue: 10_000_000, salary: 100_000, ambition: 10, loyalty: 20 }) < demand, 'fidelidade reduz o pedido');
  assert.ok(renewalDemand({ marketValue: 10_000_000, salary: 100_000, ambition: 20, loyalty: 10 }) > demand, 'ambição aumenta o pedido');
  assert.deepEqual(renewalDecision(demand, 5, demand, 33), { kind: 'too_long', maxYears: 2 });
  assert.deepEqual(renewalDecision(demand, 2, demand, 33), { kind: 'accept' });
  assert.equal(renewalDecision(Math.round(demand * 0.85), 2, demand, 25).kind, 'counter');
  assert.equal(renewalDecision(Math.round(demand * 0.5), 2, demand, 25).kind, 'reject');
  // IA: renovação acompanha o valor atual (veterano desvalorizado aceita redução) e nunca sobe mais de 10%
  assert.equal(aiRenewalWage({ marketValue: 1_000_000, salary: 100_000, ambition: 10, loyalty: 10 }), 12_000, 'veterano: cai para ~1,2% do valor');
  assert.equal(aiRenewalWage({ marketValue: 100_000_000, salary: 100_000, ambition: 20, loyalty: 1 }), 110_000, 'teto de +10%');
  assert.ok(aiRenewalWage({ marketValue: 5_000_000, salary: 60_000, ambition: 10, loyalty: 10 }) < renewalDemand({ marketValue: 5_000_000, salary: 60_000, ambition: 10, loyalty: 10 }));
});
