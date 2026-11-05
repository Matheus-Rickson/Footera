import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editorCreatePack, editorGet, editorList, editorRemove, editorRevert, editorSave, editorSummary, editorUpdateManifest } from '../services/editorService.node.ts';
import { careerUniverse, exportPackZip, importPackZip, listPacks, packsDir } from '../services/packManager.node.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { readZip } from '../services/zip.node.ts';
import { diffRecord } from '../game/data-pack/diff.ts';
import { to20 } from '../shared/scale.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'footera-editor-'));
const packFile = (dir: string, id: string, f: string) => { const p = path.join(packsDir(dir), id, `${f}.json`); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) as Array<Record<string, unknown>> : []; };

test('Diferença do editor: só os campos alterados (atributos e objetos parciais só com as chaves mudadas); nada mudou = null', () => {
  const base = { id: 'x', name: 'A', attributes: { technical: { finishing: 10, passing: 12 }, mental: { vision: 9 } }, facilities: { training: 5, youth: 6 }, secondaryPositions: ['CB'] };
  assert.equal(diffRecord(base, JSON.parse(JSON.stringify(base))), null);
  assert.deepEqual(diffRecord(base, { ...base, name: 'B', attributes: { technical: { finishing: 15, passing: 12 }, mental: { vision: 9 } }, facilities: { training: 5, youth: 9 } }),
    { id: 'x', name: 'B', attributes: { technical: { finishing: 15 } }, facilities: { youth: 9 } });
  assert.deepEqual(diffRecord(base, { ...base, secondaryPositions: ['CB', 'DM'] }), { id: 'x', secondaryPositions: ['CB', 'DM'] });
});

test('Editor: criar pacote (já ativo), editar jogador da base guarda só a diferença, força recalculada, restaurar e resumo', () => {
  const dir = tmp();
  try {
    const s = editorCreatePack(dir, { name: 'Meu Patch', author: 'Eu' });
    assert.equal(s.pack.id, 'meu-patch'); assert.equal(s.enabled, true);
    assert.equal(editorCreatePack(dir, { name: 'Meu Patch' }).pack.id, 'meu-patch-2', 'nome repetido ganha id novo');
    const p = baseUniverse().world.players.find((x) => x.clubId)!;
    const before = editorGet(dir, 'meu-patch', 'players', p.id);
    assert.equal(before.status, 'base'); assert.equal(before.derived.overall, to20(p.overall));
    const rec = JSON.parse(JSON.stringify(before.record)) as { firstName: string; attributes: { technical: Record<string, number>; mental: Record<string, number>; physical: Record<string, number> } };
    rec.firstName = 'Craque';
    for (const g of ['technical', 'mental', 'physical'] as const) for (const k of Object.keys(rec.attributes[g])) rec.attributes[g][k] = 20;
    const after = editorSave(dir, 'meu-patch', 'players', rec);
    assert.equal(after.status, 'edited');
    assert.equal(after.derived.overall, 20, 'força recalculada pelos atributos');
    const stored = packFile(dir, 'meu-patch', 'players');
    assert.equal(stored.length, 1);
    assert.deepEqual(Object.keys(stored[0]!).sort(), ['attributes', 'firstName', 'id'], 'só o que mudou (nada de contrato, valor, etc.)');
    assert.equal(careerUniverse(dir).world.players.find((x) => x.id === p.id)!.firstName, 'Craque', 'vale na carreira nova (pacote ativo)');
    assert.deepEqual(editorSummary(dir, 'meu-patch').changes.players, { created: 0, edited: 1, removed: 0 });
    assert.deepEqual(editorList(dir, 'meu-patch', { kind: 'players', onlyChanged: true }).rows.map((r) => [r.id, r.status]), [[p.id, 'edited']]);
    // salvar de novo igual ao original tira o registro do pacote
    assert.equal(editorSave(dir, 'meu-patch', 'players', before.record).status, 'base');
    assert.equal(packFile(dir, 'meu-patch', 'players').length, 0);
    editorSave(dir, 'meu-patch', 'players', rec);
    assert.equal(editorRevert(dir, 'meu-patch', 'players', p.id).status, 'base');
    editorUpdateManifest(dir, 'meu-patch', { name: 'Meu Patch Renomeado', version: '1.1', author: 'Eu' });
    assert.equal(listPacks(dir).packs.find((x) => x.id === 'meu-patch')!.name, 'Meu Patch Renomeado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Editor: criar clube com estádio e jogador pela força; excluir clube da base (some e restaura); edição inválida não grava nada; exportar .zip', () => {
  const dir = tmp();
  try {
    editorCreatePack(dir, { name: 'Novidades' });
    const club = editorSave(dir, 'novidades', 'clubs', { name: 'Clube do Editor', country: 'bra', league: 'bra-4', city: 'Cidade Nova', reputation: 30 }, { name: 'Arena Nova', capacity: 12_000 });
    assert.equal(club.status, 'created'); assert.equal(club.id, 'clube-do-editor');
    assert.equal(club.stadium!.name, 'Arena Nova');
    assert.ok((club.derived.squad ?? 0) >= 20, 'elenco completado pelo jogo');
    const pl = editorSave(dir, 'novidades', 'players', { firstName: 'Novo', lastName: 'Talento', birthDate: '2006-03-10', nationality: 'BRA', club: club.id, position: 'CF', ability: 14, potential: 18 });
    assert.equal(pl.status, 'created'); assert.equal(pl.derived.overall, 14); assert.equal(pl.record.potential, 18);
    // excluir um clube da base: vira $remove, aparece como "excluído" para restaurar
    const victim = baseUniverse().world.clubs.find((c) => c.leagueId === 'bra-4' && c.id !== club.id)!;
    editorRemove(dir, 'novidades', 'clubs', victim.id);
    assert.ok(!careerUniverse(dir).world.clubs.some((c) => c.id === victim.id));
    assert.equal(editorList(dir, 'novidades', { kind: 'clubs', search: victim.name }).rows[0]!.status, 'removed');
    assert.equal(editorRevert(dir, 'novidades', 'clubs', victim.id).status, 'base');
    // inválido (liga que não existe): erro e o arquivo do pacote não muda
    const snapshot = fs.readFileSync(path.join(packsDir(dir), 'novidades', 'clubs.json'), 'utf8');
    assert.throws(() => editorSave(dir, 'novidades', 'clubs', { ...club.record, league: 'bra-9' }, club.stadium), /bra-9/);
    assert.equal(fs.readFileSync(path.join(packsDir(dir), 'novidades', 'clubs.json'), 'utf8'), snapshot);
    assert.throws(() => editorRemove(dir, 'novidades', 'leagues', 'bra-4'), /não existe|liga/, 'liga com clubes não pode sumir');
    // excluir o criado tira do pacote
    editorRemove(dir, 'novidades', 'players', pl.id);
    assert.ok(!packFile(dir, 'novidades', 'players').some((r) => r.id === pl.id));
    // exportar e importar em outra pasta: mesmo conteúdo
    const zip = exportPackZip(dir, 'novidades');
    assert.ok(readZip(zip).has('manifest.json'));
    const other = tmp();
    try { assert.equal(importPackZip(other, zip, false).status, 'imported'); assert.deepEqual(packFile(other, 'novidades', 'clubs'), packFile(dir, 'novidades', 'clubs')); }
    finally { fs.rmSync(other, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
