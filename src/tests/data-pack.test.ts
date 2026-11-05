import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateWorld } from '../game/world/generator.ts';
import { overallFor } from '../game/world/overall.ts';
import { compileUniverse } from '../game/data-pack/compile.ts';
import { exportUniverse } from '../game/data-pack/export.ts';
import { PACK_FORMAT, PackError, parsePack, type Pack, type PackData } from '../game/data-pack/format.ts';
import { packJsonSchemas } from '../game/data-pack/jsonSchema.ts';
import { readPackDir, writePackDir } from '../services/packService.node.ts';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { advanceTime } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { ID_PATTERN } from '../shared/slug.ts';
import { to20 } from '../shared/scale.ts';
import type { Coach } from '../shared/types.ts';

const base = generateWorld({ seed: 'pack-test', teamsPerLeagueOverride: 6 });
const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const EMPTY: PackData = { countries: [], leagues: [], stadiums: [], clubs: [], players: [] };
/** pacote a partir de objetos (passa pela mesma validação de estrutura que um pacote lido do disco) */
const pack = (id: string, data: Partial<Record<keyof PackData, unknown[]>>, extra: Record<string, unknown> = {}): Pack =>
  parsePack({ manifest: { format: PACK_FORMAT, id, name: id, version: '1.0', ...extra }, files: data }, id);
const issuesOf = (fn: () => unknown): string[] => { try { fn(); } catch (e) { if (e instanceof PackError) return e.issues.map((i) => `${i.file}|${i.record ?? ''}|${i.message}`); throw e; } assert.fail('esperava PackError'); };

test('IDs da base são fixos e legíveis (país, liga, clube, jogador) e únicos no universo', () => {
  assert.deepEqual(base.countries.map((c) => c.id), ['bra', 'eng']);
  assert.deepEqual(base.leagues.map((l) => l.id), ['bra-1', 'bra-2', 'eng-1', 'eng-2']);
  const all = [...base.countries, ...base.leagues, ...base.stadiums, ...base.clubs, ...base.players].map((x) => x.id);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every((id) => ID_PATTERN.test(id)));
  const p = base.players[0]!;
  assert.ok(p.id.startsWith(`${p.firstName}-${p.lastName}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')), p.id);
  assert.deepEqual(generateWorld({ seed: 'pack-test', teamsPerLeagueOverride: 6 }).players.map((x) => x.id), base.players.map((x) => x.id), 'mesma semente, mesmos IDs');
});

test('Ida e volta: exportar a base e montar o universo a partir do pacote reproduz exatamente o original (também pelo disco)', () => {
  assert.deepEqual(compileUniverse(base, []).world, base, 'sem pacotes: universo idêntico à base');
  const exported = exportUniverse(base);
  const viaJson = parsePack(JSON.parse(JSON.stringify({ manifest: exported.manifest, files: exported.data })), 'base');
  const other = generateWorld({ seed: 'outra', teamsPerLeagueOverride: 4 });
  assert.deepEqual(compileUniverse(other, [viaJson]).world.players, base.players, 'base "none" descarta o universo gerado');
  assert.deepEqual(compileUniverse(other, [viaJson]).world, { ...base, seed: other.seed, startDate: other.startDate });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-pack-'));
  try {
    writePackDir(exported, dir);
    const back = readPackDir(dir);
    assert.deepEqual(back, viaJson);
    assert.deepEqual(compileUniverse(base, [back]).world, base);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Patch altera só o que informa: nome, clube, força (atributos regerados para a força pedida) e potencial; determinístico', () => {
  const [p, q] = [base.players[0]!, base.players[30]!];
  const target = base.clubs.find((c) => c.id !== p.clubId)!;
  const patch = pack('ajustes', { players: [
    { id: p.id, firstName: 'Zé', lastName: 'Patch', club: target.id },
    { id: q.id, ability: 17, potential: 19 },
  ] });
  const a = compileUniverse(base, [patch]), b = compileUniverse(base, [patch]);
  assert.deepEqual(a.world, b.world, 'mesmos pacotes, mesmo universo');
  const P = a.world.players.find((x) => x.id === p.id)!, Q = a.world.players.find((x) => x.id === q.id)!;
  assert.equal(P.firstName, 'Zé'); assert.equal(P.clubId, target.id);
  assert.deepEqual(P.attributes, p.attributes, 'atributos intactos'); assert.equal(P.birthDate, p.birthDate); assert.equal(P.salary, p.salary);
  assert.equal(to20(Q.overall), 17, `força pedida 17, obtida ${Q.overall}`);
  assert.equal(Q.overall, overallFor(Q.attributes, Q.position));
  assert.equal(Q.potentialHidden, 95); assert.ok(Q.marketValue > q.marketValue);
  assert.equal(a.world.players.length, base.players.length);
  // atributos parciais
  const c = compileUniverse(base, [pack('fin', { players: [{ id: p.id, attributes: { technical: { finishing: 20 } } }] })]).world.players.find((x) => x.id === p.id)!;
  assert.equal(c.attributes.technical.finishing, 20); assert.equal(c.attributes.mental.vision, p.attributes.mental.vision);
});

test('Criar país, liga e clubes novos com jogadores resumidos (força 1–20); clubes curtos são completados; o universo vira carreira jogável', async () => {
  const data = {
    countries: [{ id: 'arg', code: 'ARG', name: 'Argentina', economy: 0.7 }],
    leagues: [{ id: 'arg-1', country: 'arg', name: 'Liga Argentina', tier: 1 }],
    clubs: [
      { id: 'club-norte', name: 'Club Norte', country: 'arg', league: 'arg-1', reputation: 70 },
      { id: 'club-sur', name: 'Club Sur', country: 'arg', league: 'arg-1', city: 'Rosario' },
    ],
    players: [
      { id: 'juan-perez-1999', firstName: 'Juan', lastName: 'Pérez', birthDate: '1999-03-02', nationality: 'ARG', club: 'club-norte', position: 'CF', ability: 16 },
      { id: 'tito-gomez-2001', firstName: 'Tito', lastName: 'Gómez', birthDate: '2001-01-20', nationality: 'ARG', club: 'club-norte', position: 'GK', ability: 12, potential: 15 },
      { id: 'livre-2000', firstName: 'Livre', lastName: 'Silva', birthDate: '2000-05-05', nationality: 'BRA', club: null, position: 'CM', ability: 10 },
    ],
  };
  const r = compileUniverse(base, [pack('argentina', data)]);
  const w = r.world;
  const juan = w.players.find((p) => p.id === 'juan-perez-1999')!, tito = w.players.find((p) => p.id === 'tito-gomez-2001')!;
  assert.equal(to20(juan.overall), 16); assert.equal(to20(tito.overall), 12); assert.equal(tito.potentialHidden, 75);
  assert.ok(tito.attributes.technical.goalkeeping > tito.attributes.technical.finishing + 5, 'goleiro gerado com perfil de goleiro');
  assert.equal(w.players.find((p) => p.id === 'livre-2000')!.clubId, null);
  for (const c of ['club-norte', 'club-sur']) {
    const sq = w.players.filter((p) => p.clubId === c);
    assert.ok(sq.length >= 20 && sq.filter((p) => p.position === 'GK').length >= 2, `${c}: ${sq.length} jogadores`);
    assert.ok(sq.filter((p) => !['juan-perez-1999', 'tito-gomez-2001'].includes(p.id)).every((p) => p.nationality === 'ARG'));
  }
  assert.ok(r.warnings.some((x) => x.record === 'club-sur' && /completado/.test(x.message)));
  assert.equal(w.leagues.find((l) => l.id === 'arg-1')!.teamCount, 2);
  assert.ok(w.stadiums.some((s) => s.id === 'club-sur-estadio' && s.city === 'Rosario'), 'estádio criado para o clube');
  assert.deepEqual(r.applied, ['argentina@1.0']);
  const ids = [...w.countries, ...w.leagues, ...w.stadiums, ...w.clubs, ...w.players].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  // carreira com o clube novo: grava os pacotes e joga uma rodada
  const db = await openDatabase(':memory:');
  createCareer(db, w, coach, 'club-norte', new Date(), r.applied);
  assert.equal(String(db.prepare("SELECT value FROM meta WHERE key = 'data_packs'").get()!.value), '["argentina@1.0"]');
  advanceTime(db, 'nextMatchday');
  const day = simulateMatchday(db);
  assert.ok(day.userMatch, 'o clube novo joga');
});

test('Remoções: jogador sai do universo; clube removido libera os jogadores (aviso); remover id inexistente é só aviso', () => {
  const victim = base.players[5]!, club = base.clubs[base.clubs.length - 1]!;
  // a liga do clube removido fica com 5 clubes (ímpar é permitido: há folga no calendário)
  const r = compileUniverse(base, [pack('cortes', { players: [{ id: victim.id, $remove: true }, { id: 'nao-existe', $remove: true }], clubs: [{ id: club.id, $remove: true }] })]);
  assert.ok(!r.world.players.some((p) => p.id === victim.id));
  assert.ok(!r.world.clubs.some((c) => c.id === club.id));
  assert.ok(!r.world.stadiums.some((s) => s.id === club.stadiumId), 'estádio órfão sai');
  const freed = base.players.filter((p) => p.clubId === club.id && p.id !== victim.id).map((p) => p.id);
  assert.ok(freed.every((id) => r.world.players.find((p) => p.id === id)!.clubId === null));
  assert.ok(r.warnings.some((x) => /ficaram sem clube/.test(x.message)) && r.warnings.some((x) => x.record === 'nao-existe'));
});

test('Erros claros: campo desconhecido, campos de criação, referências, id de outro tipo, ordem de carga, divisões e idade — nada aplicado pela metade', () => {
  const club = base.clubs[0]!;
  assert.ok(issuesOf(() => pack('typo', { players: [{ id: base.players[0]!.id, fistName: 'X' }] })).some((m) => /players\.json\|.*\|.*fistName|Unrecognized/.test(m)));
  assert.ok(issuesOf(() => pack('dup', { clubs: [{ id: 'a-b', name: 'A' }, { id: 'a-b', name: 'B' }] })).some((m) => /repetido/.test(m)));
  assert.ok(issuesOf(() => pack('bad', { players: [{ id: 'Maiúsculo!' }] })).some((m) => /id inválido/.test(m)));
  assert.ok(issuesOf(() => pack('man', {}, { format: 2 })).some((m) => /manifest\.json/.test(m)));
  const errs = (data: Parameters<typeof pack>[1], extra?: Record<string, unknown>) => issuesOf(() => compileUniverse(base, [pack('x', data, extra)]));
  assert.ok(errs({ players: [{ id: 'novo-1', firstName: 'A' }] }).some((m) => /faltam os campos: lastName, birthDate, nationality, position, club/.test(m)));
  assert.ok(errs({ players: [{ id: 'novo-2', firstName: 'A', lastName: 'B', birthDate: '2000-01-01', nationality: 'BRA', position: 'CM', club: null }] }).some((m) => /ability/.test(m)));
  assert.ok(errs({ players: [{ id: 'novo-3', firstName: 'A', lastName: 'B', birthDate: '2000-01-01', nationality: 'BRA', position: 'CM', club: null, attributes: { technical: { finishing: 10 } } }] }).some((m) => /faltam atributos: passing/.test(m)));
  assert.ok(errs({ clubs: [{ id: 'clube-x', name: 'X', country: 'bra', league: 'liga-que-nao-existe' }] }).some((m) => /liga "liga-que-nao-existe" não existe/.test(m)));
  assert.ok(errs({ clubs: [{ id: 'clube-y', name: 'Y', country: 'eng', league: 'bra-1' }] }).some((m) => /outro país/.test(m)));
  assert.ok(errs({ players: [{ id: club.id, firstName: 'A', lastName: 'B', birthDate: '2000-01-01', nationality: 'BRA', position: 'CM', club: null, ability: 10 }] }).some((m) => /já usado por um\(a\) clube/.test(m)));
  assert.ok(errs({ players: [{ id: base.players[0]!.id, birthDate: '1950-01-01' }] }).some((m) => /idade/.test(m)));
  assert.ok(errs({ leagues: [{ id: 'bra-4', country: 'bra', name: 'Série D', tier: 4 }] }).some((m) => /1, 2, 3/.test(m)));
  assert.ok(errs({ leagues: [{ id: 'bra-1', rules: { relegationSlots: 2 } }] }).some((m) => /rebaixa 2/.test(m)));
  const none = pack('completo', {}, { base: 'none' });
  assert.ok(issuesOf(() => compileUniverse(base, [pack('a', {}), none])).some((m) => /primeiro pacote/.test(m)));
  assert.ok(issuesOf(() => compileUniverse(base, [pack('b', {}, { requires: ['lendas'] })])).some((m) => /precisa do pacote "lendas"/.test(m)));
  assert.ok(issuesOf(() => compileUniverse(base, [none])).some((m) => /nenhum clube/.test(m)), 'base vazia sem clubes');
});

test('Pacote no disco: JSON inválido e arquivo desconhecido apontam o arquivo; BOM do Bloco de Notas é aceito', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-pack-'));
  try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), `﻿${JSON.stringify({ format: 1, id: 'disco', name: 'Disco', version: '1' })}`);
    fs.writeFileSync(path.join(dir, 'players.json'), '[ { "id": "x", } ]');
    fs.writeFileSync(path.join(dir, 'jogadores.json'), '[]');
    const msgs = issuesOf(() => readPackDir(dir));
    assert.ok(msgs.some((m) => m.startsWith('players.json||JSON inválido')), msgs.join('\n'));
    assert.ok(msgs.some((m) => m.startsWith('jogadores.json||arquivo não reconhecido')));
    fs.rmSync(path.join(dir, 'jogadores.json')); fs.writeFileSync(path.join(dir, 'players.json'), '[]');
    assert.equal(readPackDir(dir).manifest.id, 'disco');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('JSON Schema publicado em docs/schema está em dia com as regras do jogo (rode "npm run pack -- schema" ao mudar o formato)', () => {
  const dir = path.join(process.cwd(), 'docs', 'schema');
  const want = packJsonSchemas();
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(), Object.keys(want).sort());
  for (const [name, schema] of Object.entries(want)) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')), schema, name);
  const players = want['players.schema.json'] as { items: { properties: Record<string, unknown>; additionalProperties: boolean; required: string[] } };
  assert.equal(players.items.additionalProperties, false); assert.deepEqual(players.items.required, ['id']);
  assert.ok('ability' in players.items.properties && 'attributes' in players.items.properties);
});

test('Pacote de exemplo da documentação (docs/exemplos/pacote-exemplo) é válido e monta o universo', () => {
  const ex = readPackDir(path.join(process.cwd(), 'docs', 'exemplos', 'pacote-exemplo'));
  const { world } = compileUniverse(generateWorld({ seed: 'qualquer', teamsPerLeagueOverride: 6 }), [ex]);
  assert.equal(world.leagues.find((l) => l.id === 'bra-1')!.name, 'Brasileirão Série A', 'altera uma liga da base');
  assert.equal(world.leagues.find((l) => l.id === 'arg-1')!.teamCount, 4);
  const rivera = world.players.find((p) => p.id === 'lucas-rivera-1995')!;
  assert.equal(rivera.salary, 18000); assert.equal(rivera.attributes.technical.passing, 15);
  assert.equal(world.players.find((p) => p.id === 'jogador-livre-1997')!.clubId, null);
});
