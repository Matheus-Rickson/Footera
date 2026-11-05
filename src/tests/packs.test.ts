import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readZip, writeZip, ZipError } from '../services/zip.node.ts';
import { careerUniverse, exportPackZip, importPackZip, listPacks, packsDir, removePack, setLoadOrder } from '../services/packManager.node.ts';
import { ValidationError } from '../services/careerService.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { createProfile } from '../services/profileService.node.ts';
import { createCareerSave } from '../services/saveService.node.ts';
import { openDatabase } from '../database/connection.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'footera-packs-'));
const json = (v: unknown) => Buffer.from(JSON.stringify(v));
const manifest = (id: string, extra: Record<string, unknown> = {}) => ({ format: 1, id, name: `Pacote ${id}`, version: '1.0', ...extra });
/** zip de um pacote: arquivos na raiz ou dentro de uma pasta */
const packZip = (id: string, files: Record<string, unknown>, folder = '', extra: Record<string, unknown> = {}) =>
  writeZip([[`${folder}manifest.json`, json(manifest(id, extra))], ...Object.entries(files).map(([k, v]): [string, Buffer] => [`${folder}${k}.json`, json(v)])]);
const someBraClub = () => baseUniverse().world.clubs.find((c) => c.leagueId === 'bra-1')!;

test('Zip: lê o que escreve (deflate, UTF-8) e recusa caminho inseguro, arquivo que não é zip e conteúdo grande demais', () => {
  const z = writeZip([['a.json', Buffer.from('{"á": 1}')], ['pasta/b.txt', Buffer.alloc(5000, 65)]]);
  const r = readZip(z);
  assert.equal(r.get('a.json')!.toString('utf8'), '{"á": 1}');
  assert.equal(r.get('pasta/b.txt')!.length, 5000);
  assert.throws(() => readZip(writeZip([['../fora.json', json({})]])), /inseguro/);
  assert.throws(() => readZip(writeZip([['C:/x.json', json({})]])), /inseguro/);
  assert.throws(() => readZip(Buffer.from('não sou zip')), ZipError);
  assert.throws(() => readZip(writeZip([['grande.bin', Buffer.alloc(2000)]]), { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 5000 }), /grande demais/);
});

test('Pacotes: importar .zip (raiz ou pasta), ativar na ordem, universo da carreira com o patch, substituir e remover', async () => {
  const dir = tmp();
  try {
    const club = someBraClub();
    assert.deepEqual(listPacks(dir).packs, []);
    // pacote A renomeia um clube da base; B (dentro de pasta) cria a Argentina
    assert.equal(importPackZip(dir, packZip('renomeia', { clubs: [{ id: club.id, name: 'Clube Renomeado' }] }), false).status, 'imported');
    // (a base já tem a Argentina; o Chile é novo)
    const chi = { countries: [{ id: 'chi', code: 'CHI', name: 'Chile' }], leagues: [{ id: 'chi-1', country: 'chi', name: 'Liga CL', tier: 1 }],
      clubs: [{ id: 'club-a', name: 'Club A', country: 'chi', league: 'chi-1' }, { id: 'club-b', name: 'Club B', country: 'chi', league: 'chi-1' }] };
    assert.equal(importPackZip(dir, packZip('chile', chi, 'meu-pacote/'), false).status, 'imported');
    let ov = listPacks(dir);
    assert.deepEqual(ov.packs.map((p) => [p.id, p.enabled, p.issues.length]), [['chile', false, 0], ['renomeia', false, 0]]);
    assert.equal(careerUniverse(dir).world.clubs.find((c) => c.id === club.id)!.name, club.name, 'desativado: não muda nada');
    ov = setLoadOrder(dir, ['renomeia', 'chile', 'nao-existe']);
    assert.deepEqual(ov.packs.filter((p) => p.enabled).map((p) => [p.id, p.order]), [['renomeia', 0], ['chile', 1]]);
    assert.ok(ov.universe.ok && ov.universe.countries === baseUniverse().world.countries.length + 1);
    const u = careerUniverse(dir);
    assert.equal(u.world.clubs.find((c) => c.id === club.id)!.name, 'Clube Renomeado');
    assert.ok(u.world.leagues.some((l) => l.id === 'chi-1'));
    assert.deepEqual(u.applied, ['footera-base@1.0.0', 'renomeia@1.0', 'chile@1.0']);
    // origem: a tela marca o que veio de pacote (criado × alterado), sem marcar o que é só da base
    const { listClubs } = await import('../services/worldService.ts');
    const opts = listClubs(u.world, u.origin).clubs;
    assert.deepEqual(opts.find((c) => c.id === club.id)!.origin, { created: null, edited: ['Pacote renomeia'] });
    assert.deepEqual(opts.find((c) => c.id === 'club-a')!.origin, { created: 'Pacote chile', edited: [] });
    assert.ok(opts.filter((c) => c.origin.created || c.origin.edited.length).length === 3, 'só os 3 clubes tocados pelos pacotes');
    // mesmo id: pergunta antes de substituir
    const v2 = packZip('renomeia', { clubs: [{ id: club.id, name: 'Nome Versão 2' }] }, '', { version: '2.0' });
    assert.equal(importPackZip(dir, v2, false).status, 'exists');
    assert.equal(importPackZip(dir, v2, true).status, 'imported');
    assert.equal(careerUniverse(dir).world.clubs.find((c) => c.id === club.id)!.name, 'Nome Versão 2', 'cache renovado pela versão/arquivos');
    // carreira nova grava os pacotes usados e usa o universo com o patch
    const prof = createProfile(dir, 'Teste');
    const c = await createCareerSave(dir, { profileId: prof.id, clubId: club.id, coach: { firstName: 'A', lastName: 'B', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' } });
    const db = await openDatabase(path.join(dir, 'saves', prof.id, c.id, 'career.db'));
    try {
      assert.equal(String(db.prepare("SELECT value FROM meta WHERE key = 'data_packs'").get()!.value), '["footera-base@1.0.0","renomeia@2.0","chile@1.0"]');
      assert.equal(String(db.prepare('SELECT name FROM clubs WHERE id = ?').get(club.id)!.name), 'Nome Versão 2');
    } finally { db.close(); }
    // remover tira da ordem
    ov = removePack(dir, 'chile');
    assert.deepEqual(ov.packs.map((p) => p.id), ['renomeia']);
    assert.ok(!fs.existsSync(path.join(packsDir(dir), 'chile')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Pacotes: zip sem manifesto, JSON inválido ou com erros é recusado; pasta com erro aparece mas não ativa; combinação com erro bloqueia carreira nova', async () => {
  const dir = tmp();
  try {
    assert.throws(() => importPackZip(dir, writeZip([['clubs.json', json([])]]), false), /manifest\.json/);
    assert.throws(() => importPackZip(dir, writeZip([['manifest.json', Buffer.from('{ quebrado')]]), false), /JSON inválido/);
    assert.throws(() => importPackZip(dir, packZip('erro', { players: [{ id: 'x', fistName: 'A' }] }), false), (e: Error) => e instanceof ValidationError && /fistName|Unrecognized/.test(e.message));
    assert.throws(() => importPackZip(dir, packZip('footera-base', {}), false), /reservado/);
    // pasta copiada à mão com erro de estrutura: aparece com os erros e não pode ser ativada
    fs.mkdirSync(path.join(packsDir(dir), 'quebrado'), { recursive: true });
    fs.writeFileSync(path.join(packsDir(dir), 'quebrado', 'manifest.json'), JSON.stringify(manifest('quebrado')));
    fs.writeFileSync(path.join(packsDir(dir), 'quebrado', 'players.json'), '[{"id": 1}]');
    let ov = listPacks(dir);
    assert.ok(ov.packs[0]!.issues.length > 0 && !ov.packs[0]!.enabled);
    ov = setLoadOrder(dir, ['quebrado']);
    assert.equal(ov.packs[0]!.enabled, false, 'com erro de estrutura não entra na ordem');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(packsDir(dir), 'load-order.json'), 'utf8')).enabled, [], 'nem fica gravado na ordem (não ativaria sozinho depois de corrigido)');
    // pacote válido sozinho, mas a combinação tem erro (liga que não existe): bloqueia a carreira nova com mensagem clara
    importPackZip(dir, packZip('liga-fantasma', { clubs: [{ id: 'clube-x', name: 'X', country: 'bra', league: 'bra-9' }] }), false);
    ov = setLoadOrder(dir, ['liga-fantasma']);
    assert.equal(ov.universe.ok, false);
    assert.ok(ov.universe.errors.some((x) => /bra-9/.test(x)));
    assert.throws(() => careerUniverse(dir), (e: Error) => e instanceof ValidationError && /Pacotes de dados/.test(e.message));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Imagens: gravar/trocar/remover no pacote (só PNG/JPEG válidos), índice só dos pacotes ativos (último vence), .zip leva e traz as imagens', async () => {
  const { makePng, makeJpeg } = await import('./fixtures.ts');
  const { setPackImage, removePackImage, listPackImages } = await import('../services/imageService.node.ts');
  const { imageIndex } = await import('../services/packManager.node.ts');
  const dir = tmp();
  try {
    importPackZip(dir, packZip('a', {}), false); importPackZip(dir, packZip('b', {}), false);
    const da = path.join(packsDir(dir), 'a'), db = path.join(packsDir(dir), 'b');
    const club = someBraClub().id;
    setPackImage(da, 'clubs', club, makePng(128, 128));
    setPackImage(db, 'clubs', club, makeJpeg(128, 128));
    setPackImage(da, 'players', 'joao-1990', makePng(96, 96));
    setPackImage(da, 'leagues', 'bra-1', makePng(128, 128));
    assert.throws(() => setPackImage(da, 'clubs', 'x', new TextEncoder().encode('não sou imagem')), /PNG ou JPEG/);
    assert.throws(() => setPackImage(da, 'clubs', 'x', makePng(20, 20)), /pequena/);
    assert.equal(imageIndex(dir).size, 0, 'nenhum pacote ativo: nenhuma imagem');
    setLoadOrder(dir, ['a', 'b']);
    assert.ok(imageIndex(dir).get(`clubs/${club}`)!.endsWith(path.join('b', 'images', 'clubs', `${club}.jpg`)), 'o último da ordem vence');
    setLoadOrder(dir, ['b', 'a']);
    assert.ok(imageIndex(dir).get(`clubs/${club}`)!.endsWith(path.join('a', 'images', 'clubs', `${club}.png`)));
    assert.ok(imageIndex(dir).has('players/joao-1990'));
    assert.ok(imageIndex(dir).has('leagues/bra-1'), 'logo de liga entra no índice');
    // trocar de formato remove o antigo
    setPackImage(da, 'clubs', club, makeJpeg(128, 128));
    assert.deepEqual(listPackImages(da).filter((i) => i.kind === 'clubs').map((i) => path.basename(i.file)), [`${club}.jpg`]);
    // .zip leva e traz
    const other = tmp();
    try {
      assert.equal(importPackZip(other, exportPackZip(dir, 'a'), false).status, 'imported');
      assert.deepEqual(listPackImages(path.join(packsDir(other), 'a')).map((i) => i.rel).sort(), listPackImages(da).map((i) => i.rel).sort());
      assert.throws(() => importPackZip(other, writeZip([['manifest.json', json(manifest('c'))], ['images/clubs/../x.png', Buffer.from(makePng(64, 64))]]), false), /inseguro|inválido/);
      assert.throws(() => importPackZip(other, writeZip([['manifest.json', json(manifest('c'))], ['images/escudos/x.png', Buffer.from(makePng(64, 64))]]), false), /nome inválido/);
      assert.throws(() => importPackZip(other, writeZip([['manifest.json', json(manifest('c'))], ['images/clubs/x.png', Buffer.from('falso')]]), false), /PNG ou JPEG/);
      assert.ok(!fs.existsSync(path.join(packsDir(other), 'c')), 'imagem inválida: pacote não é gravado');
      assert.equal(importPackZip(other, writeZip([['manifest.json', json(manifest('d'))], ['images/leagues/arg-1.png', Buffer.from(makePng(64, 64))]]), false).status, 'imported', 'logo de liga é aceito no .zip');
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
    removePackImage(da, 'players', 'joao-1990');
    assert.ok(!imageIndex(dir).has('players/joao-1990'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
