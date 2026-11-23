// Laboratório (lab/, docs/LAB.md): parâmetros, determinismo dos cenários, relatório e o save original intocado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveParams, runScenario, scenarioById, scenarioCatalog } from '../../lab/core/registry.ts';
import { batchGame } from '../../lab/core/scenarios/matchBatch.ts';
import { reportHtml, reportText } from '../../lab/core/render.ts';
import { copySave, listSaves } from '../../lab/core/saves.ts';
import { ParamError, type RunContext } from '../../lab/core/types.ts';
import { createProfile } from '../services/profileService.node.ts';
import { createCareerSave } from '../services/saveService.node.ts';
import { baseUniverse } from '../services/universeService.node.ts';

const ctx: RunContext = { onProgress: () => {}, cancelled: () => false };
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('Laboratório: parâmetros validados (padrões, números, sim/não, chaves desconhecidas)', () => {
  const s = scenarioById('lote-partidas');
  const p = resolveParams(s, { n: '40', alternate: 'não' });
  assert.equal(p.n, 40);
  assert.equal(p.alternate, false);
  assert.equal(p.seed, 'lab', 'padrão aplicado');
  assert.throws(() => resolveParams(s, { n: 0 }), ParamError, 'abaixo do mínimo');
  assert.throws(() => resolveParams(s, { n: 'muitos' }), ParamError);
  assert.throws(() => resolveParams(s, { alternate: 'talvez' }), ParamError);
  assert.throws(() => resolveParams(s, { homeMentality: 'kamikaze' }), ParamError, 'fora das opções');
  assert.throws(() => resolveParams(s, { nn: 3 }), /desconhecido/);
  assert.throws(() => scenarioById('nao-existe'), /nao-existe/);
  assert.deepEqual(scenarioCatalog().map((c) => c.id), ['lote-partidas', 'inspetor-partida', 'calibracao', 'inspetor-save']);
});

test('Laboratório: lote determinístico, inspetor refaz o mesmo jogo e o relatório é renderizável', async () => {
  const p = resolveParams(scenarioById('lote-partidas'), { n: 12 });
  const a = batchGame('calib', p, 7);
  const b = batchGame('calib', p, 7);
  assert.deepEqual(a.game, b.game, 'mesma semente e número de jogo = mesmo jogo');
  assert.notDeepEqual(batchGame('calib', p, 8).game, a.game);

  const r1 = await runScenario('lote-partidas', { n: 12 }, ctx);
  const r2 = await runScenario('lote-partidas', { n: 12 }, ctx);
  const strip = (r: typeof r1) => JSON.stringify(r.sections.filter((s) => !(s.kind === 'kpis' && s.items.some((i) => i.label === 'Tempo por partida'))));
  assert.equal(strip(r1), strip(r2), 'mesmo relatório (fora o tempo medido)');

  const ins = await runScenario('inspetor-partida', { game: 7 }, ctx);
  const head = ins.sections[0];
  if (head?.kind !== 'kpis') throw new Error('primeira seção deveria ser o placar');
  assert.equal(head.items[0]!.value, String(a.outcome.homeGoals), 'gols do mandante iguais aos do jogo 7 do lote');
  assert.equal(head.items[1]!.value, String(a.outcome.awayGoals));

  const html = reportHtml(r1);
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes('Lote de partidas'));
  assert.ok(!html.includes('<script'), 'relatório estático, sem scripts');
  assert.ok(reportText(r1).includes('Gols por jogo'));
  await assert.rejects(runScenario('lote-partidas', { n: 50 }, { onProgress: () => {}, cancelled: () => true }), /cancelada/);
});

test('Laboratório: inspetor de save avança dias só na cópia; o save original não muda', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-labtest-'));
  try {
    const w = baseUniverse().world;
    const eng = w.countries.find((c) => c.code === 'ENG')!.id;
    const clubId = w.clubs.find((c) => w.leagues.find((l) => l.id === c.leagueId)!.countryId === eng)!.id;
    const prof = createProfile(base, 'Teste');
    const c = await createCareerSave(base, { profileId: prof.id, clubId, coach: { firstName: 'A', lastName: 'B', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' } });
    const { closeAllCareerDbs } = await import('../services/saveService.node.ts');
    closeAllCareerDbs();
    const original = path.join(base, 'saves', prof.id, c.id, 'career.db');
    const listed = listSaves(base);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.file, original);
    assert.equal(listed[0]!.profileName, 'Teste');

    const files = () => fs.readdirSync(path.dirname(original)).sort();
    const before = { hash: sha(original), files: files(), mtime: fs.statSync(original).mtimeMs };
    const r = await runScenario('inspetor-save', { path: original, days: 3, squad: false, finance: false, youth: false }, ctx);
    assert.ok(r.sections.some((s) => s.title?.startsWith('Depois de')), 'mostra o antes e depois');
    assert.equal(sha(original), before.hash, 'conteúdo idêntico');
    assert.deepEqual(files(), before.files, 'nenhum -wal/-shm criado ao lado do original');
    assert.equal(fs.statSync(original).mtimeMs, before.mtime);

    const copy = copySave(original);
    assert.notEqual(copy.file, original);
    assert.equal(sha(copy.file), before.hash);
    copy.dispose();
    assert.ok(!fs.existsSync(copy.base), 'pasta temporária apagada');
    assert.throws(() => copySave(path.join(base, 'nada.db')), ParamError);
  } finally {
    const { closeAllCareerDbs } = await import('../services/saveService.node.ts');
    closeAllCareerDbs();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
