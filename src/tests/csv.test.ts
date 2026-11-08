import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { csvHeader, decodeCsv, parseCsv, recordToRow, rowsToRecords, toCsv } from '../game/data-pack/csv.ts';
import { editorCreatePack, editorExportCsv, editorGet, editorImportCsv } from '../services/editorService.node.ts';
import { packsDir } from '../services/packManager.node.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { to20 } from '../shared/scale.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'footera-csv-'));
const packFile = (dir: string, id: string, f: string) => { const p = path.join(packsDir(dir), id, `${f}.json`); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) as Array<Record<string, unknown>> : []; };

test('CSV (leitura): ; ou vírgula, aspas, quebra de linha dentro de campo, BOM, CRLF, linhas vazias; UTF-8 ou Windows-1252', () => {
  const a = parseCsv('﻿Nome;Sobrenome;Cidade\r\n"Ana";"da ""Silva""";"Rio;\r\nde Janeiro"\r\n\r\n;;\r\nJoão;Souza;Recife\r\n');
  assert.equal(a.sep, ';');
  assert.deepEqual(a.rows.map((r) => r.cells), [['Nome', 'Sobrenome', 'Cidade'], ['Ana', 'da "Silva"', 'Rio;\nde Janeiro'], ['João', 'Souza', 'Recife']]);
  assert.deepEqual(a.rows.map((r) => r.line), [1, 2, 6], 'número da linha no arquivo (para os erros)');
  const b = parseCsv('nome,posicao\nAna,ZAG\n');
  assert.equal(b.sep, ','); assert.deepEqual(b.rows[1]!.cells, ['Ana', 'ZAG']);
  const latin1 = new Uint8Array([0x4e, 0x6f, 0x6d, 0x65, 0x3b, 0x50, 0x6f, 0x73, 0x69, 0xe7, 0xe3, 0x6f]); // "Nome;Posição" em Windows-1252
  assert.equal(decodeCsv(latin1), 'Nome;Posição');
  assert.equal(decodeCsv(new TextEncoder().encode('Nome;Posição')), 'Nome;Posição');
});

test('CSV (conversão): cabeçalhos em português sem acento, posições/pé/datas/valores brasileiros, atributos por grupo, livre, erros por linha', () => {
  const text = 'NOME;sobrenome;Nascimento;Nacionalidade;Clube;posição;Secundárias;Pé;Altura;Força;Potencial;Salário;Fim do contrato;Finalização;Reflexos;Coluna X\n'
    + 'Ana;Silva;05/03/2001;bra;livre;GOL;;esquerdo;188;14;17;1.250.000;30/06/2029;;16;x\n'
    + 'Bia;Souza;2002-01-02;ARG;sao-tome-ec;CA;SA/PE;direito;175;;;;;15;;\n'
    + 'Cris;Lima;31/02;BRA;;XYZ;;canhoto;abc;;;;;;;\n';
  const { records, issues } = rowsToRecords('players', text);
  assert.ok(issues.some((i) => i.line === 1 && /Coluna X/.test(i.message)), 'coluna desconhecida vira aviso');
  assert.deepEqual(records[0]!.record, { firstName: 'Ana', lastName: 'Silva', birthDate: '2001-03-05', nationality: 'BRA', club: null, position: 'GK', foot: 'left', heightCm: 188, ability: 14, potential: 17, contract: { salary: 1250000, end: '2029-06-30' }, attributes: { goalkeeper: { reflexes: 16 } } });
  assert.deepEqual(records[1]!.record, { firstName: 'Bia', lastName: 'Souza', birthDate: '2002-01-02', nationality: 'ARG', club: 'sao-tome-ec', position: 'CF', secondaryPositions: ['SS', 'LW'], foot: 'right', heightCm: 175, attributes: { technical: { finishing: 15 } } });
  const line4 = issues.filter((i) => i.line === 4).map((i) => i.message).join(' | ');
  assert.match(line4, /Nascimento/); assert.match(line4, /Posição "XYZ"/); assert.match(line4, /Altura/);
  // ida e volta: registro → linha → CSV → registro
  const rec = records[1]!.record;
  const back = rowsToRecords('players', toCsv(csvHeader('players'), [recordToRow('players', rec)])).records[0]!.record;
  assert.deepEqual(back, rec);
  assert.deepEqual(rowsToRecords('clubs', 'Nome;Reputação;Categorias de base;Caixa\nNovo FC;45;12;2.000.000\n').records[0]!.record, { name: 'Novo FC', reputation: 45, facilities: { youth: 12 }, balance: 2000000 });
});

test('Editor: importar CSV cria e altera (só as colunas preenchidas), ignora linhas sem mudança, é tudo ou nada e aponta a linha do erro', () => {
  const dir = tmp();
  try {
    editorCreatePack(dir, { name: 'Planilha' });
    const w = baseUniverse().world;
    const club = w.clubs[0]!, p = w.players.find((x) => x.clubId === club.id && x.position !== 'GK')!;
    const csv = 'id;Nome;Sobrenome;Nascimento;Nacionalidade;Clube;Posição;Força;Potencial\n'
      + `;Rafa;Teste;10/10/2003;BRA;${club.id};MEI;15;18\n`
      + `${p.id};Renomeado;;;;;;;\n`;
    const r = editorImportCsv(dir, 'planilha', 'players', csv);
    assert.deepEqual([r.created, r.updated, r.errors], [1, 1, []]);
    const stored = packFile(dir, 'planilha', 'players');
    const created = stored.find((x) => x.firstName === 'Rafa')!;
    assert.ok(created && created.id === 'rafa-teste-2003');
    assert.equal(editorGet(dir, 'planilha', 'players', String(created.id)).derived.overall, 15, 'força pedida');
    assert.deepEqual(stored.find((x) => x.id === p.id), { id: p.id, firstName: 'Renomeado' }, 'altera só o que foi preenchido');
    // erro de regra (clube inexistente) na linha 3: nada é gravado
    const before = JSON.stringify(packFile(dir, 'planilha', 'players'));
    const bad = editorImportCsv(dir, 'planilha', 'players', 'Nome;Sobrenome;Nascimento;Nacionalidade;Clube;Posição;Força\nOk;Um;01/01/2000;BRA;' + club.id + ';ZAG;10\nRuim;Dois;01/01/2000;BRA;clube-que-nao-existe;ZAG;10\n');
    assert.deepEqual([bad.created, bad.updated], [0, 0]);
    assert.ok(bad.errors.some((e) => e.startsWith('Linha 3:')), bad.errors.join(' | '));
    assert.equal(JSON.stringify(packFile(dir, 'planilha', 'players')), before, 'tudo ou nada');
    // erro de formato também barra tudo
    assert.ok(editorImportCsv(dir, 'planilha', 'players', 'Nome;Posição\nX;QQQ\n').errors[0]!.startsWith('Linha 2:'));
    // exportar e reimportar sem mudanças: nada a gravar
    const exported = editorExportCsv(dir, 'planilha', 'clubs', false);
    const again = editorImportCsv(dir, 'planilha', 'clubs', exported);
    assert.deepEqual([again.created, again.updated, again.unchanged, again.errors], [0, 0, w.clubs.length, []]);
    assert.equal(packFile(dir, 'planilha', 'clubs').length, 0, 'pacote sem registros de clubes');
    const pExport = rowsToRecords('players', editorExportCsv(dir, 'planilha', 'players', false)).records;
    assert.equal(pExport.length, w.players.length + 1, 'exporta o universo base + pacote');
    const row = pExport.find((x) => x.record.id === p.id)!.record;
    assert.equal(row.firstName, 'Renomeado'); assert.equal(row.ability, to20(p.overall));
    assert.equal(editorExportCsv(dir, 'planilha', 'players', true).trim(), toCsv(csvHeader('players'), []).trim(), 'modelo = só o cabeçalho');
    // exportação filtrada (os filtros da lista): país + liga → só os clubes dela e os jogadores desses clubes; posição; clube
    const lg = w.leagues.find((l) => l.countryId === club.countryId && w.clubs.some((c) => c.leagueId === l.id))!;
    const inLeague = new Set(w.clubs.filter((c) => c.leagueId === lg.id).map((c) => c.id));
    const cRows = rowsToRecords('clubs', editorExportCsv(dir, 'planilha', 'clubs', false, { countryId: lg.countryId, leagueId: lg.id })).records;
    assert.deepEqual(new Set(cRows.map((r) => r.record.id)), inLeague, 'só os clubes da liga');
    const pRows = rowsToRecords('players', editorExportCsv(dir, 'planilha', 'players', false, { countryId: lg.countryId, leagueId: lg.id })).records;
    assert.equal(pRows.length, w.players.filter((x) => x.clubId && inLeague.has(x.clubId)).length + (inLeague.has(club.id) ? 1 : 0), 'jogadores dos clubes da liga (+ o criado pelo pacote)');
    assert.ok(pRows.every((r) => inLeague.has(String(r.record.club))), 'nenhum de fora da liga nem sem clube');
    const gks = rowsToRecords('players', editorExportCsv(dir, 'planilha', 'players', false, { clubId: club.id, position: 'GK' })).records;
    assert.ok(gks.length > 0 && gks.every((r) => r.record.club === club.id && r.record.position === 'GK'));
    // jogador NOVO com a linha completa como a planilha exporta (sem a coluna "goalkeeping", que é calculada do grupo de goleiro)
    const gk = pExport.find((x) => x.record.position === 'GK')!.record;
    const novo = { ...gk, id: 'goleiro-novo-2000', firstName: 'Goleiro', lastName: 'Novo', birthDate: '2000-01-01' };
    const imp = editorImportCsv(dir, 'planilha', 'players', toCsv(csvHeader('players'), [recordToRow('players', novo)]));
    assert.deepEqual([imp.created, imp.errors], [1, []], imp.errors.join(' | '));
    const d = editorGet(dir, 'planilha', 'players', 'goleiro-novo-2000');
    assert.equal(d.derived.overall, gk.ability, 'mesma força do goleiro copiado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
