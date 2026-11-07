import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../game/world/generator.ts';
import { compileUniverse } from '../game/data-pack/compile.ts';
import { exportUniverse } from '../game/data-pack/export.ts';
import { PACK_FORMAT, PackError, parsePack, type Pack, type PackData } from '../game/data-pack/format.ts';
import { rowsToRecords, recordToRow, csvHeader } from '../game/data-pack/csv.ts';
import { openDatabase } from '../database/connection.ts';
import { migrate } from '../database/migrator.ts';
import { loadWorld, saveWorld } from '../database/repositories/worldRepository.ts';
import { createCareer } from '../services/careerService.ts';
import { getCareerState } from '../database/repositories/competitionRepository.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { listClubs } from '../services/worldService.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const base = generateWorld({ seed: 'states-test', teamsPerLeagueOverride: 6 });
const pack = (id: string, data: Partial<Record<keyof PackData, unknown[]>>): Pack =>
  parsePack({ manifest: { format: PACK_FORMAT, id, name: id, version: '1.0' }, files: data }, id);
const issues = (fn: () => unknown): string[] => { try { fn(); } catch (e) { if (e instanceof PackError) return e.issues.map((i) => `${i.file}|${i.record ?? ''}|${i.message}`); throw e; } return []; };
const bra = base.countries.find((c) => c.code === 'BRA')!;
const STATES = [{ code: 'SP', name: 'São Paulo' }, { code: 'RJ', name: 'Rio de Janeiro' }];

test('Pacotes: estados do país, estado e divisão estadual do clube, divisão sem jogos ("Sem divisão") e as validações', () => {
  const [c1, c2] = base.clubs.filter((c) => c.countryId === bra.id);
  const ok = compileUniverse(base, [pack('estados', {
    countries: [{ id: bra.id, states: STATES }],
    leagues: [{ id: 'bra-sd', country: bra.id, name: 'Sem divisão', tier: 3, active: false }],
    clubs: [{ id: c1!.id, state: 'SP', stateDivision: 1 }, { id: c2!.id, state: 'RJ', league: 'bra-sd' }],
  })]).world;
  assert.deepEqual(ok.countries.find((c) => c.id === bra.id)!.states, STATES);
  const sd = ok.leagues.find((l) => l.id === 'bra-sd')!;
  assert.equal(sd.active, false);
  assert.equal(sd.teamCount, 1, 'a "Sem divisão" pode ter só um clube (não tem jogos)');
  assert.deepEqual([ok.clubs.find((c) => c.id === c1!.id)!.state, ok.clubs.find((c) => c.id === c1!.id)!.stateDivision], ['SP', 1]);
  assert.equal(ok.clubs.find((c) => c.id === c2!.id)!.leagueId, 'bra-sd');
  // exportação e nova montagem reproduzem os campos
  const again = compileUniverse(base, [parsePack(JSON.parse(JSON.stringify({ manifest: exportUniverse(ok).manifest, files: exportUniverse(ok).data })), 'copia')]).world;
  assert.equal(again.clubs.find((c) => c.id === c1!.id)!.stateDivision, 1);
  assert.equal(again.leagues.find((l) => l.id === 'bra-sd')!.active, false);
  // erros: estado fora da lista do país; divisão estadual sem estado; sigla inválida; estado repetido
  assert.ok(issues(() => compileUniverse(base, [pack('x', { countries: [{ id: bra.id, states: STATES }], clubs: [{ id: c1!.id, state: 'MG' }] })])).some((m) => /estado "MG" não está entre os estados/.test(m)));
  assert.ok(issues(() => compileUniverse(base, [pack('x', { clubs: [{ id: c1!.id, stateDivision: 1 }] })])).some((m) => /divisão do estadual sem estado/.test(m)));
  assert.throws(() => pack('x', { clubs: [{ id: c1!.id, state: 'sp' }] }), /sigla do estado/);
  assert.ok(issues(() => compileUniverse(base, [pack('x', { countries: [{ id: bra.id, states: [...STATES, { code: 'SP', name: 'Outro' }] }] })])).some((m) => /estado SP repetido/.test(m)));
  // divisão disputada continua exigindo pelo menos 2 clubes
  assert.ok(issues(() => compileUniverse(base, [pack('x', { leagues: [{ id: 'bra-9', country: bra.id, name: 'Nona', tier: 3, rules: { promotionSlots: 4 } }], clubs: [{ id: c2!.id, league: 'bra-9' }] })])).some((m) => /liga com 1 clube/.test(m)));
});

test('Banco: estados, estado/divisão estadual do clube e divisão sem jogos sobrevivem a gravar e ler o universo', async () => {
  const w = compileUniverse(base, [pack('estados', {
    countries: [{ id: bra.id, states: STATES }],
    leagues: [{ id: 'bra-sd', country: bra.id, name: 'Sem divisão', tier: 3, active: false }],
    clubs: [{ id: base.clubs[0]!.id, state: 'SP', stateDivision: 2 }, { id: base.clubs[1]!.id, league: 'bra-sd', state: 'RJ' }],
  })]).world;
  const db = await openDatabase(':memory:');
  migrate(db);
  saveWorld(db, w);
  const back = loadWorld(db);
  assert.deepEqual(back.countries.find((c) => c.id === bra.id)!.states, STATES);
  assert.equal(back.leagues.find((l) => l.id === 'bra-sd')!.active, false);
  assert.equal(back.leagues.find((l) => l.id === 'bra-1')!.active, undefined);
  assert.deepEqual([back.clubs[0]!.state, back.clubs[0]!.stateDivision], ['SP', 2]);
  assert.deepEqual([back.clubs[1]!.state, back.clubs[1]!.stateDivision], ['RJ', undefined]);
});

test('CSV de clubes: colunas Estado e Divisão estadual (1, 2 ou vazio), com erro para valor inválido', () => {
  assert.ok(csvHeader('clubs').includes('Estado') && csvHeader('clubs').includes('Divisão estadual'));
  const { records, issues: errs } = rowsToRecords('clubs', 'id;Estado;Divisão estadual\nclube-a;sp;1\nclube-b;RJ;\nclube-c;MG;7');
  assert.deepEqual(records.map((r) => r.record), [{ id: 'clube-a', state: 'SP', stateDivision: 1 }, { id: 'clube-b', state: 'RJ' }, { id: 'clube-c', state: 'MG' }]);
  assert.ok(errs.some((e) => e.line === 4 && /Divisão estadual "7"/.test(e.message)));
  const row = recordToRow('clubs', { id: 'clube-a', state: 'SP', stateDivision: 2 });
  assert.equal(row[csvHeader('clubs').indexOf('Estado')], 'SP');
  assert.equal(row[csvHeader('clubs').indexOf('Divisão estadual')], 2);
});

test('Base real: a escolha do clube lista os sem divisão do Brasil e uma carreira com um deles é criada (ainda sem jogos próprios até os estaduais)', async () => {
  const w = baseUniverse().world;
  const list = listClubs(w);
  const brasil = list.countries.find((c) => c.code === 'BRA')!;
  assert.ok(!brasil.leagues.some((l) => l.id === 'bra-sd'), 'a "Sem divisão" não aparece no menu de divisões simuladas');
  assert.equal(brasil.divisions, 4);
  const sd = list.clubs.filter((c) => c.leagueId === 'bra-sd');
  assert.ok(sd.length > 150 && sd.every((c) => c.league === 'Sem divisão'));
  const db = await openDatabase(':memory:');
  createCareer(db, { ...w, seed: 'sem-divisao' }, coach, sd[0]!.id, new Date(), [], ['bra-1']);
  assert.equal(getCareerState(db).gameDate, '2026-01-01');
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM competitions WHERE league_id = 'bra-sd'").get()!.n), 0, 'a "Sem divisão" não tem competição própria');
  assert.equal(String(db.prepare("SELECT sim_level AS s FROM leagues WHERE id = 'bra-sd'").get()!.s), 'full', 'a divisão do clube escolhido é sempre completa');
});
