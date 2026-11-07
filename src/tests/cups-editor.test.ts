import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileUniverse } from '../game/data-pack/compile.ts';
import { exportUniverse } from '../game/data-pack/export.ts';
import { PACK_FORMAT, PackError, parsePack, type Pack, type PackData } from '../game/data-pack/format.ts';
import { basePack, baseUniverse, EMPTY_WORLD } from '../services/universeService.node.ts';
import { editorCreatePack, editorGet, editorList, editorSave } from '../services/editorService.node.ts';
import { packsDir } from '../services/packManager.node.ts';
import { listPackImages, setPackImage } from '../services/imageService.node.ts';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { cupDefOf, cupStateOf } from '../database/repositories/cupRepository.ts';
import { CUP_FORMATS } from '../game/cup-engine/formats.ts';
import { SUPERCUP_RULES } from '../game/cup-engine/supercups.ts';
import { resolveCup, resolveSupercup } from '../game/cup-engine/catalog.ts';
import { makePng } from './fixtures.ts';
import { generateWorld } from '../game/world/generator.ts';

const EMPTY: PackData = { countries: [], leagues: [], stadiums: [], clubs: [], players: [], coaches: [], cups: [] };
const pack = (id: string, data: Partial<PackData>): Pack => ({ manifest: { format: PACK_FORMAT, id, name: id, version: '1.0.0' }, data: { ...EMPTY, ...data } });
const build = (...packs: Pack[]) => compileUniverse(EMPTY_WORLD, [basePack(), ...packs]);
const coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' as const, reputation: 20, photoPath: null };
const err = (data: Partial<PackData>, re: RegExp) => assert.throws(() => build(pack('p', data)), (e: unknown) => e instanceof PackError && e.issues.some((i) => re.test(i.message)), String(re));

test('Base: uma copa e uma supercopa por país com regra; a definição resolve para a regra real; ida e volta pela exportação', () => {
  const w = baseUniverse().world;
  const cups = w.cups!;
  assert.equal(cups.filter((k) => k.kind === 'cup').length, CUP_FORMATS.length);
  assert.equal(cups.filter((k) => k.kind === 'supercup').length, SUPERCUP_RULES.length);
  for (const k of cups) {
    const co = w.countries.find((c) => c.id === k.countryId)!;
    if (k.kind === 'cup') {
      const real = CUP_FORMATS.find((f) => f.countryCode === co.code)!, f = resolveCup(k, co.code)!;
      assert.deepEqual([f.name, f.stages, f.window, f.windowCalendarYear, f.discipline], [real.name, real.stages, real.window, real.windowCalendarYear, real.discipline], co.code);
      assert.equal(f.id, `cup-${co.id}`);
    } else {
      const real = SUPERCUP_RULES.find((r) => r.countryCode === co.code)!, r = resolveSupercup(k, co.code)!;
      assert.deepEqual([r.teams, r.double, r.host, r.extraTime, r.dates], [real.teams, real.double, real.host, real.extraTime, real.dates], co.code);
    }
  }
  assert.deepEqual(build().world.cups, cups, 'determinístico');
  const ex = exportUniverse(w, { id: 'copia' });
  const again = compileUniverse(EMPTY_WORLD, [parsePack(JSON.parse(JSON.stringify({ manifest: ex.manifest, files: ex.data })), 'copia')]).world;
  assert.deepEqual(again.cups, cups, 'exportar e montar de novo dá as mesmas copas');
});

test('Pacote de copas: alterar, desativar, criar para país novo com fases de outro; regras conferidas', () => {
  const w = baseUniverse().world;
  const eng = w.countries.find((c) => c.code === 'ENG')!;
  const r = build(pack('p', { cups: [{ id: `cup-${eng.id}`, name: 'Copa da Inglaterra', yellowLimit: 3, window: { start: '09-01', final: '05-20' } }, { id: `sup-${eng.id}`, enabled: false }] })).world;
  const cup = r.cups!.find((k) => k.id === `cup-${eng.id}`)!;
  const f = resolveCup(cup, 'ENG')!;
  assert.deepEqual([f.name, f.discipline.yellowLimit, f.window], ['Copa da Inglaterra', 3, { start: '09-01', final: '05-20' }]);
  assert.equal(resolveSupercup(r.cups!.find((k) => k.id === `sup-${eng.id}`)!, 'ENG'), null, 'supercopa desativada');
  assert.equal(resolveCup({ ...cup, enabled: false }, 'ENG'), null, 'copa desativada');
  // país novo (código sem regra no jogo): sem copa até o pacote criar uma, com as fases de outro país
  const chile = { countries: [{ id: 'chi', code: 'CHI', name: 'Chile' }] };
  assert.equal(build(pack('p', chile)).world.cups!.filter((k) => k.countryId === 'chi').length, 0);
  const made = build(pack('p', { ...chile, cups: [{ id: 'copa-chile', country: 'chi', kind: 'cup', name: 'Copa Chile', stagesFrom: 'POR' }] })).world.cups!.find((k) => k.id === 'copa-chile')!;
  assert.deepEqual(resolveCup(made, 'CHI')!.stages, CUP_FORMATS.find((x) => x.countryCode === 'POR')!.stages);
  // país novo com código conhecido ganha as padrão (ARG num universo gerado só com Brasil e Inglaterra: copa e supercopa)
  const gen = generateWorld({ seed: 'copas-arg', teamsPerLeagueOverride: 6 });
  const withArg = compileUniverse(gen, [pack('p', { countries: [{ id: 'arg', code: 'ARG', name: 'Argentina' }] })]).world;
  assert.deepEqual(withArg.cups!.filter((k) => k.countryId === 'arg').map((k) => k.kind).sort(), ['cup', 'supercup']);
  assert.equal(withArg.cups!.length, 6, 'Brasil e Inglaterra (padrão do mundo gerado) + Argentina');
  // regras
  err({ ...chile, cups: [{ id: 'copa-chile', country: 'chi', kind: 'cup', name: 'Copa Chile' }] }, /sem formato de fases/);
  err({ cups: [{ id: 'cup-x', country: eng.id, kind: 'cup', name: 'Outra' }] }, /já tem uma copa ativa/);
  err({ cups: [{ id: `cup-${eng.id}`, stagesFrom: 'XYZ' }] }, /não tem formato de copa/);
  err({ cups: [{ id: `sup-${eng.id}`, teams: 4 }] }, /precisa de 2 data/);
  err({ cups: [{ id: 'nova', name: 'Sem país' }] }, /faltam os campos: country, kind/);
  // removido o país, as copas dele saem junto (sem erro)
  const bel = w.countries.find((c) => c.code === 'BEL')!;
  assert.ok(!build(pack('p', { countries: [{ id: bel.id, $remove: true }], leagues: w.leagues.filter((l) => l.countryId === bel.id).map((l) => ({ id: l.id, $remove: true as const })), clubs: w.clubs.filter((c) => c.countryId === bel.id).map((c) => ({ id: c.id, $remove: true as const })) })).world.cups!.some((k) => k.countryId === bel.id));
});

test('Editor de dados: copas listadas, alteração guarda só a diferença, logo; a carreira usa o nome e a regra do pacote', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-copas-'));
  try {
    editorCreatePack(dir, { name: 'Copas' });
    const w = baseUniverse().world;
    const eng = w.countries.find((c) => c.code === 'ENG')!;
    const rows = editorList(dir, 'copas', { kind: 'cups', countryId: eng.id });
    assert.deepEqual(rows.rows.map((x) => x.id).sort(), [`cup-${eng.id}`, `sup-${eng.id}`]);
    const e = editorGet(dir, 'copas', 'cups', `cup-${eng.id}`);
    assert.equal(e.record.kind, 'cup');
    editorSave(dir, 'copas', 'cups', { ...e.record, name: 'Copa Inglesa', yellowLimit: 4 });
    const s = editorGet(dir, 'copas', 'cups', `sup-${eng.id}`);
    editorSave(dir, 'copas', 'cups', { ...s.record, enabled: false });
    const stored = JSON.parse(fs.readFileSync(path.join(packsDir(dir), 'copas', 'cups.json'), 'utf8')) as unknown[];
    assert.deepEqual(stored, [{ id: `cup-${eng.id}`, name: 'Copa Inglesa', yellowLimit: 4 }, { id: `sup-${eng.id}`, enabled: false }], 'só o que mudou');
    assert.match(editorList(dir, 'copas', { kind: 'cups', countryId: eng.id }).rows.find((x) => x.id === `sup-${eng.id}`)!.subtitle, /desativada/);
    // logo da copa
    setPackImage(path.join(packsDir(dir), 'copas'), 'cups', `cup-${eng.id}`, makePng(128, 128));
    assert.ok(listPackImages(path.join(packsDir(dir), 'copas')).some((i) => i.kind === 'cups' && i.id === `cup-${eng.id}`));
    // carreira com o pacote (clube inglês: temporada de julho)
    const { readPackDir } = await import('../services/packService.node.ts');
    const world = build(readPackDir(path.join(packsDir(dir), 'copas'))).world;
    const db = await openDatabase(':memory:');
    createCareer(db, { ...world, seed: 'carreira-copas' }, coach, world.clubs.find((c) => c.countryId === eng.id)!.id);
    const st = cupStateOf(db, `cup_${eng.id}_2026`);
    assert.deepEqual([st.format.name, st.format.discipline.yellowLimit, st.format.id], ['Copa Inglesa', 4, `cup-${eng.id}`]);
    assert.equal(String(db.prepare('SELECT name FROM competitions WHERE id = ?').get(`cup_${eng.id}_2026`)!.name), 'Copa Inglesa 2026/27');
    assert.equal(cupDefOf(db, eng.id, 'ENG', 'supercup'), null, 'supercopa desativada no save');
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM cup_formats').get()!.n), world.cups!.length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
