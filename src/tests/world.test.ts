import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../game/world/generator.ts';
import { overallFor } from '../game/world/overall.ts';

const world = generateWorld({ seed: 'teste-1' });

test('Mundo: geração é determinística por semente', () => {
  const again = generateWorld({ seed: 'teste-1' });
  assert.deepEqual(again, world);
  assert.notDeepEqual(generateWorld({ seed: 'teste-2' }).clubs.map((c) => c.name), world.clubs.map((c) => c.name));
});

test('Mundo: IDs únicos e relacionamentos explícitos íntegros', () => {
  const all = [...world.countries, ...world.leagues, ...world.stadiums, ...world.clubs, ...world.players].map((e) => e.id);
  assert.equal(new Set(all).size, all.length);
  const leagueIds = new Set(world.leagues.map((l) => l.id));
  const stadiumIds = new Set(world.stadiums.map((s) => s.id));
  const countryIds = new Set(world.countries.map((c) => c.id));
  const clubIds = new Set(world.clubs.map((c) => c.id));
  for (const c of world.clubs) {
    assert.ok(leagueIds.has(c.leagueId) && stadiumIds.has(c.stadiumId) && countryIds.has(c.countryId));
  }
  for (const p of world.players) assert.ok(p.clubId && clubIds.has(p.clubId));
  const stadiumUse = world.clubs.map((c) => c.stadiumId);
  assert.equal(new Set(stadiumUse).size, stadiumUse.length);
});

test('Mundo: cada liga tem o número de clubes configurado e nomes únicos por país', () => {
  for (const l of world.leagues) {
    assert.equal(world.clubs.filter((c) => c.leagueId === l.id).length, l.teamCount);
  }
  for (const country of world.countries) {
    const names = world.clubs.filter((c) => c.countryId === country.id).map((c) => c.name);
    assert.equal(new Set(names).size, names.length);
  }
});

test('Mundo: elencos coerentes (25 jogadores, 3 goleiros, atributos 1..20)', () => {
  for (const c of world.clubs) {
    const squad = world.players.filter((p) => p.clubId === c.id);
    assert.equal(squad.length, 25);
    assert.equal(squad.filter((p) => p.position === 'GK').length, 3);
  }
  for (const p of world.players) {
    for (const group of Object.values(p.attributes)) {
      for (const v of Object.values(group as Record<string, number>)) assert.ok(v >= 1 && v <= 20);
    }
    assert.ok(p.potentialHidden >= p.overall);
    assert.ok(p.overall >= 1 && p.overall <= 100);
  }
});

test('Mundo: especialistas são melhores na própria posição (goleiro como atacante é ruim)', () => {
  const gks = world.players.filter((p) => p.position === 'GK').slice(0, 50);
  const asGk = gks.reduce((s, p) => s + overallFor(p.attributes, 'GK'), 0) / gks.length;
  const asSt = gks.reduce((s, p) => s + overallFor(p.attributes, 'ST'), 0) / gks.length;
  assert.ok(asGk > asSt + 15, `GK=${asGk} ST=${asSt}`);
});

test('Mundo: clubes de maior reputação têm elencos melhores em média', () => {
  const avg = (clubId: string) => {
    const s = world.players.filter((p) => p.clubId === clubId);
    return s.reduce((a, p) => a + p.overall, 0) / s.length;
  };
  const sorted = [...world.clubs].sort((a, b) => b.reputation - a.reputation);
  const top = sorted.slice(0, 10).reduce((a, c) => a + avg(c.id), 0) / 10;
  const bottom = sorted.slice(-10).reduce((a, c) => a + avg(c.id), 0) / 10;
  assert.ok(top > bottom + 8, `top=${top} bottom=${bottom}`);
});

import { ageOn } from '../shared/date.ts';

test('Mundo: jovens têm habilidade atual menor e mais margem de crescimento que veteranos', () => {
  const group = (lo: number, hi: number) => world.players.filter((p) => { const a = ageOn(p.birthDate, world.startDate); return a >= lo && a <= hi; });
  const avg = (ps: typeof world.players, f: (p: (typeof world.players)[number]) => number) => ps.reduce((s, p) => s + f(p), 0) / ps.length;
  const young = group(17, 20), prime = group(25, 29), old = group(33, 40);
  assert.ok(young.length > 30 && prime.length > 300 && old.length > 30, 'amostras suficientes');
  assert.ok(avg(prime, (p) => p.overall) > avg(young, (p) => p.overall) + 6, 'jovens piores que jogadores no auge');
  assert.ok(avg(prime, (p) => p.overall) > avg(old, (p) => p.overall) + 2, 'veteranos em declínio');
  assert.ok(avg(young, (p) => p.potentialHidden - p.overall) > avg(old, (p) => p.potentialHidden - p.overall) + 8, 'jovens têm mais margem de crescimento');
  assert.ok(young.every((p) => p.potentialHidden >= p.overall));
});

test('Mundo: nenhum elenco tem dois jogadores com o mesmo nome completo', () => {
  for (const c of world.clubs) {
    const names = world.players.filter((p) => p.clubId === c.id).map((p) => `${p.firstName} ${p.lastName}`);
    assert.equal(new Set(names).size, names.length, c.name);
  }
});

test('Mundo: o potencial estimado nunca fica abaixo da força atual', () => {
  const world = generateWorld({ seed: 'semente-potencial' });
  for (const p of world.players) assert.ok(p.potentialEstimated >= p.overall, `${p.id}: ${p.potentialEstimated} < ${p.overall}`);
});

test('Posições ME/MD/AE/AD: atributos de cada função, funções parecidas a 95% e elencos de carreiras novas com essas posições', async () => {
  const { positionFit } = await import('../game/match-engine/roles.ts');
  const base = world.players.find((p) => p.position === 'CM')!;
  const withAttrs = (over: Record<string, number>) => {
    const a = JSON.parse(JSON.stringify(base.attributes)) as typeof base.attributes;
    for (const g of ['technical', 'mental', 'physical'] as const) for (const k of Object.keys(a[g])) (a[g] as unknown as Record<string, number>)[k] = over[k] ?? 8;
    return a;
  };
  // meia aberto: visão, passe, cruzamento, controle e resistência pesam mais na ME do que no ponta (drible e velocidade)
  const creator = withAttrs({ vision: 17, passing: 17, crossing: 17, firstTouch: 16, stamina: 16 });
  assert.ok(overallFor(creator, 'LM') > overallFor(creator, 'LW') + 10);
  const winger = withAttrs({ dribbling: 17, pace: 17, agility: 16, finishing: 14 });
  assert.ok(overallFor(winger, 'LW') > overallFor(winger, 'LM') + 10);
  // MD: velocidade, passe, cruzamento, drible e recomposição
  const rm = withAttrs({ pace: 16, passing: 16, crossing: 16, dribbling: 16, workRate: 16 });
  assert.ok(overallFor(rm, 'RM') > overallFor(rm, 'CM'));
  // ala: resistência e velocidade para o corredor inteiro; AE marca, AD se posiciona e defende
  const runner = withAttrs({ stamina: 18, pace: 17, crossing: 16, marking: 15 });
  assert.ok(overallFor(runner, 'LWB') > overallFor(runner, 'LB'));
  const rwb = withAttrs({ stamina: 18, pace: 16, crossing: 16, positioning: 15, tackling: 15 });
  assert.ok(overallFor(rwb, 'RWB') > overallFor(rwb, 'RM'));

  const mp = (position: 'LW' | 'LB' | 'CM') => ({ id: 'x', name: 'x', position, secondaryPositions: [], attributes: base.attributes, condition: 100, morale: 70, form: 50 });
  assert.equal(positionFit(mp('LW'), 'LM'), 0.95, 'ponta como meia aberto (mesmo lado)');
  assert.equal(positionFit(mp('LB'), 'LWB'), 0.95, 'lateral como ala (mesmo lado)');
  assert.equal(positionFit(mp('LW'), 'RM'), 0.9, 'lado trocado: fora de posição');
  assert.equal(positionFit(mp('CM'), 'LM'), 0.9);

  // carreira nova: todo elenco tem ME, MD, AE e AD naturais
  for (const c of world.clubs.slice(0, 20)) {
    const pos = new Set(world.players.filter((p) => p.clubId === c.id).map((p) => p.position));
    for (const want of ['LM', 'RM', 'LWB', 'RWB', 'SS', 'CF'] as const) assert.ok(pos.has(want), `${c.name} sem ${want}`);
    assert.ok(!pos.has('ST'), 'carreira nova não gera o atacante genérico (ATA)');
  }
});
