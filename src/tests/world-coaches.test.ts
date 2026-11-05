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
import { listClubs } from '../services/worldService.ts';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { getAiCoachDetail, getClubInfo, listUnemployedCoaches } from '../database/repositories/aiCoachRepository.ts';
import { clubCoachId } from '../game/coach-engine/worldCoaches.ts';

const EMPTY: PackData = { countries: [], leagues: [], stadiums: [], clubs: [], players: [], coaches: [] };
const pack = (id: string, data: Partial<PackData>): Pack => ({ manifest: { format: PACK_FORMAT, id, name: id, version: '1.0.0' }, data: { ...EMPTY, ...data } });
const build = (...packs: Pack[]) => compileUniverse(EMPTY_WORLD, [basePack(), ...packs]);
const coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' as const, reputation: 20, photoPath: null };

test('Base fixa: um técnico padrão por clube (id tec-<clube>) e o mercado; determinístico; ida e volta pela exportação', () => {
  const w = baseUniverse().world;
  const ks = w.coaches!;
  for (const c of w.clubs) assert.deepEqual(ks.filter((k) => k.clubId === c.id).map((k) => k.id), [clubCoachId(c.id)], c.id);
  assert.equal(ks.filter((k) => k.clubId === null).length, Math.ceil(w.clubs.length * 0.15));
  assert.ok(ks.every((k) => Object.values(k.attributes).every((v) => v >= 1 && v <= 20)));
  assert.deepEqual(build().world.coaches, ks, 'mesma base, mesmos técnicos');
  const full = parsePack(JSON.parse(JSON.stringify({ manifest: exportUniverse(w, { id: 'copia' }).manifest, files: exportUniverse(w).data })), 'copia');
  assert.deepEqual(compileUniverse(EMPTY_WORLD, [full]).world.coaches, ks, 'base completa exportada reproduz os técnicos');
});

test('Pacote: altera só o informado, cria técnico (o padrão do clube vai para o mercado), remove (clube ganha um gerado) e valida', () => {
  const w = baseUniverse().world;
  const [a, b, c] = [w.clubs[0]!, w.clubs[1]!, w.clubs[2]!];
  const ka = w.coaches!.find((k) => k.clubId === a.id)!;
  const r = build(pack('tec', { coaches: [
    { id: ka.id, reputation: 77, attributes: { tactics: 19 } },
    { id: 'tec-novo-zeca', firstName: 'Zeca', lastName: 'Novo', birthDate: '1970-05-05', nationality: 'ARG', club: b.id },
    { id: clubCoachId(c.id), $remove: true },
  ] }));
  const ks = r.world.coaches!;
  const ea = ks.find((k) => k.id === ka.id)!;
  assert.deepEqual([ea.reputation, ea.attributes.tactics, ea.attributes.motivation, ea.firstName, ea.clubId], [77, 19, ka.attributes.motivation, ka.firstName, a.id]);
  const zeca = ks.find((k) => k.id === 'tec-novo-zeca')!;
  assert.equal(zeca.clubId, b.id);
  assert.ok(Object.values(zeca.attributes).every((v) => v >= 1 && v <= 20) && ['defensive', 'possession', 'aggressive'].includes(zeca.methodology), 'o que falta o jogo completa');
  assert.equal(ks.find((k) => k.id === clubCoachId(b.id))!.clubId, null, 'o técnico padrão do clube vai para o mercado');
  assert.ok(r.warnings.some((x) => x.record === clubCoachId(b.id) && /fica sem clube/.test(x.message)));
  assert.equal(ks.filter((k) => k.clubId === b.id).length, 1);
  assert.ok(!ks.some((k) => k.id === clubCoachId(c.id)), 'removido');
  assert.equal(ks.filter((k) => k.clubId === c.id).length, 1, 'clube sem técnico ganha um gerado');
  assert.ok(r.warnings.some((x) => x.record === c.id && /clube sem técnico/.test(x.message)));
  // clube removido: o técnico dele fica sem clube
  const gone = build(pack('sem', { clubs: [{ id: a.id, $remove: true }] })).world.coaches!.find((k) => k.id === ka.id)!;
  assert.equal(gone.clubId, null);
  // erros: dois técnicos de pacote no mesmo clube, clube inexistente, idade fora da faixa, campos faltando ao criar
  const err = (data: Partial<PackData>, re: RegExp) => assert.throws(() => build(pack('x', data)), (e: unknown) => e instanceof PackError && e.issues.some((i) => re.test(i.message)));
  const novo = (id: string, extra: object) => ({ id, firstName: 'Fulano', lastName: 'Tal', birthDate: '1970-01-01', nationality: 'BRA', ...extra });
  err({ coaches: [novo('tec-x1', { club: b.id }), novo('tec-x2', { club: b.id })] }, /um técnico por clube/);
  err({ coaches: [novo('tec-x3', { club: 'clube-que-nao-existe' })] }, /não existe/);
  err({ coaches: [novo('tec-x4', { birthDate: '2010-01-01' })] }, /25 a 85 anos/);
  err({ coaches: [{ id: 'tec-x5', firstName: 'Só' }] }, /faltam os campos: lastName, birthDate, nationality/);
  err({ coaches: [novo(a.id, {})] }, /id já usado/);
});

test('Editor de dados: técnicos listados, alteração guarda só a diferença, criação; a carreira e a tela de nova carreira usam os técnicos do pacote', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-tec-'));
  try {
    editorCreatePack(dir, { name: 'Técnicos' });
    const w = baseUniverse().world;
    const club = w.clubs[3]!, ka = w.coaches!.find((k) => k.clubId === club.id)!;
    const rows = editorList(dir, 'tecnicos', { kind: 'coaches', clubId: club.id });
    assert.deepEqual(rows.rows.map((x) => x.id), [ka.id]);
    assert.match(rows.rows[0]!.subtitle, new RegExp(club.name));
    const e = editorGet(dir, 'tecnicos', 'coaches', ka.id);
    editorSave(dir, 'tecnicos', 'coaches', { ...e.record, reputation: 88, attributes: { ...(e.record.attributes as object), youth: 20 } });
    const stored = JSON.parse(fs.readFileSync(path.join(packsDir(dir), 'tecnicos', 'coaches.json'), 'utf8')) as unknown[];
    assert.deepEqual(stored, [{ id: ka.id, reputation: 88, attributes: { youth: 20 } }], 'só o que mudou');
    const other = w.clubs[4]!;
    const made = editorSave(dir, 'tecnicos', 'coaches', { firstName: 'Lia', lastName: 'Rocha', birthDate: '1972-03-03', nationality: 'POR', club: other.id, reputation: 61, methodology: 'aggressive', attributes: { tactics: 14, motivation: 13, youth: 12, discipline: 11, negotiation: 10, adaptability: 9 } });
    assert.equal(made.status, 'created'); assert.match(made.id, /^tec-lia-rocha/);
    // universo com o pacote → tela de nova carreira e carreira
    const { readPackDir } = await import('../services/packService.node.ts');
    const world = build(readPackDir(path.join(packsDir(dir), 'tecnicos'))).world;
    assert.equal(listClubs(world).clubs.find((x) => x.id === other.id)!.coach!.id, made.id, 'tela de nova carreira');
    const db = await openDatabase(':memory:');
    createCareer(db, { ...world, seed: 'carreira-tec' }, coach, w.clubs[0]!.id);
    assert.equal(getClubInfo(db, other.id).coach!.id, made.id, 'na carreira, o técnico do pacote (mesmo id: a foto do pacote aparece)');
    assert.deepEqual(getAiCoachDetail(db, ka.id).attributes.youth, 20);
    assert.equal(getAiCoachDetail(db, made.id).methodology, 'aggressive');
    assert.ok(listUnemployedCoaches(db).some((k) => k.id === clubCoachId(other.id)), 'o padrão do clube foi para o mercado');
    assert.ok(listUnemployedCoaches(db).some((k) => k.id === clubCoachId(w.clubs[0]!.id)), 'o do clube do usuário também');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Guarda: os canais do processo principal aceitam todos os tipos do editor e de imagem (senão a tela recebe "Dados inválidos")', async () => {
  const main = fs.readFileSync(path.join('src', 'main', 'main.ts'), 'utf8');
  const enumAfter = (marker: string) => { const m = new RegExp(marker + String.raw`[^\n]*?z\.enum\(\[([^\]]+)\]`).exec(main); assert.ok(m, marker); return m![1]!.split(',').map((s) => s.trim().replace(/'/g, '')).sort(); };
  const { IMAGE_KINDS } = await import('../services/imageService.node.ts');
  assert.deepEqual(enumAfter('const kind = '), ['clubs', 'coaches', 'countries', 'leagues', 'players'], 'tipos do editor (EditorKind)');
  assert.deepEqual(enumAfter('const imgRef = '), [...IMAGE_KINDS].sort(), 'tipos de imagem');
});
