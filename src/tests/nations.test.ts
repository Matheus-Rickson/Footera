import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NATIONS, nationalityOptions, nationName } from '../shared/nations.ts';
import { editorCreatePack, editorGet, editorImportCsv } from '../services/editorService.node.ts';
import { baseUniverse } from '../services/universeService.node.ts';

test('Nacionalidades: códigos únicos de 3 letras, todos os países do universo na lista, e cada um com bandeira em flag-icons', () => {
  const codes = NATIONS.map((n) => n.code);
  assert.equal(new Set(codes).size, codes.length, 'código repetido');
  assert.ok(NATIONS.length >= 200);
  assert.ok(codes.every((c) => /^[A-Z]{3}$/.test(c)));
  for (const c of baseUniverse().world.countries) assert.ok(codes.includes(c.code), `${c.code} do universo fora da lista`);
  const dir = new URL('../../node_modules/flag-icons/flags/4x3/', import.meta.url);
  const missing = NATIONS.filter((n) => !fs.existsSync(new URL(`${n.iso}.svg`, dir))).map((n) => n.code);
  assert.deepEqual(missing, [], 'sem bandeira');
});

test('Nacionalidades: o nome do universo tem prioridade; opções sem repetir, em ordem alfabética', () => {
  assert.equal(nationName('NGA'), 'Nigéria');
  assert.equal(nationName('NED', 'Países Baixos'), 'Países Baixos', 'nome do universo vence');
  assert.equal(nationName('XYZ'), 'XYZ', 'código desconhecido aparece como está');
  const opts = nationalityOptions([{ code: 'BRA', name: 'Brasil' }, { code: 'ZZZ', name: 'Terra Nova' }]);
  assert.equal(opts.filter((o) => o.code === 'BRA').length, 1);
  assert.ok(opts.some((o) => o.code === 'ZZZ') && opts.some((o) => o.code === 'USA'));
  const names = opts.map((o) => o.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'pt-BR')));
});

test('Nacionalidades: jogador do pacote pode ter nação fora do universo (só rótulo e bandeira)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-nat-'));
  try {
    editorCreatePack(dir, { name: 'Nações' });
    const club = baseUniverse().world.clubs[0]!;
    const r = editorImportCsv(dir, 'nacoes', 'players', `Nome;Sobrenome;Nascimento;Nacionalidade;Clube;Posição;Força\nKwame;Teste;01/01/2001;GHA;${club.id};ATA;12\n`);
    assert.deepEqual([r.created, r.errors], [1, []], r.errors.join(' | '));
    const d = editorGet(dir, 'nacoes', 'players', 'kwame-teste-2001');
    assert.equal(d.record.nationality, 'GHA');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
