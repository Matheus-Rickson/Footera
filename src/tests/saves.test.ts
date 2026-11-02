import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProfile, listProfiles } from '../services/profileService.node.ts';
import {
  advanceCareer, createCareerSave, getCalendar, getTable, listCareerSaves, listCompetitionsFor, openCareer,
} from '../services/saveService.node.ts';
import { openDatabase } from '../database/connection.ts';
import { ValidationError } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { makePng, makeJpeg } from './fixtures.ts';
import type { CoachInput } from '../shared/api.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fmsim-'));
const coach: CoachInput = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession' };
const clubId = generateWorld({ seed: 's1' }).clubs[0]!.id;

test('Perfis: cria, lista, normaliza o nome e impede duplicados e nomes inválidos', () => {
  const base = tmp();
  const p = createProfile(base, '  João   da  Silva ');
  assert.equal(p.name, 'João da Silva');
  assert.deepEqual(listProfiles(base).map((x) => x.name), ['João da Silva']);
  assert.throws(() => createProfile(base, 'joão DA silva'), /Já existe/);
  assert.throws(() => createProfile(base, ''), ValidationError);
  assert.throws(() => createProfile(base, '../hack'), ValidationError);
  assert.throws(() => createProfile(base, 'x'.repeat(41)), ValidationError);
  assert.equal(listProfiles(base).length, 1);
});

test('Perfis: arquivo corrompido gera erro claro e não é sobrescrito', () => {
  const base = tmp();
  fs.writeFileSync(path.join(base, 'profiles.json'), '{ quebrado');
  assert.throws(() => listProfiles(base), /ilegível/);
  assert.throws(() => createProfile(base, 'Novo'), /ilegível/);
  assert.equal(fs.readFileSync(path.join(base, 'profiles.json'), 'utf8'), '{ quebrado');
});

test('Saves: cria carreira com foto, lista e abre com dados reais do banco', async () => {
  const base = tmp();
  const prof = createProfile(base, 'Teste');
  const png = makePng(100, 100);
  const created = await createCareerSave(base, { profileId: prof.id, seed: 's1', clubId, coach, photo: png });
  assert.equal(created.coachName, 'Ana Silva');
  assert.equal(created.gameDate, '2026-07-01');
  const list = await listCareerSaves(base, prof.id);
  assert.equal(list.careers.length, 1);
  assert.deepEqual(list.unreadable, []);
  const ov = await openCareer(base, prof.id, created.id);
  assert.equal(ov.coach.age, 46);
  assert.equal(ov.squad.length, 25);
  assert.equal(ov.club.id, clubId);
  assert.ok(ov.photoDataUrl?.startsWith('data:image/png;base64,'));
  assert.deepEqual(ov.warnings, []);
  assert.ok(ov.squad.every((p, i, a) => i === 0 || a[i - 1]!.position !== 'ST' || p.position === 'ST'));
  // a cópia da foto vive dentro do save
  assert.ok(fs.existsSync(path.join(base, 'saves', prof.id, created.id, 'coach.png')));
});

test('Saves: JPEG também é aceito e a foto é opcional', async () => {
  const base = tmp(); const prof = createProfile(base, 'Teste');
  const a = await createCareerSave(base, { profileId: prof.id, seed: 's1', clubId, coach, photo: makeJpeg(120, 120) });
  assert.ok(fs.existsSync(path.join(base, 'saves', prof.id, a.id, 'coach.jpg')));
  const b = await createCareerSave(base, { profileId: prof.id, seed: 's1', clubId, coach });
  assert.equal((await openCareer(base, prof.id, b.id)).photoDataUrl, null);
});

test('Saves: entradas inválidas são rejeitadas e não deixam rastros no disco', async () => {
  const base = tmp(); const prof = createProfile(base, 'Teste');
  const dir = path.join(base, 'saves', prof.id);
  const bad: Array<[string, Parameters<typeof createCareerSave>[1]]> = [
    ['foto inválida', { profileId: prof.id, seed: 's1', clubId, coach, photo: new TextEncoder().encode('nao sou imagem') }],
    ['nascimento futuro', { profileId: prof.id, seed: 's1', clubId, coach: { ...coach, birthDate: '2030-01-01' } }],
    ['data impossível', { profileId: prof.id, seed: 's1', clubId, coach: { ...coach, birthDate: '1990-02-31' } }],
    ['clube inexistente', { profileId: prof.id, seed: 's1', clubId: 'clb_zzzzz', coach }],
    ['nacionalidade inválida', { profileId: prof.id, seed: 's1', clubId, coach: { ...coach, nationality: 'br' } }],
    ['perfil inexistente', { profileId: '00000000-0000-4000-8000-000000000000', seed: 's1', clubId, coach }],
  ];
  for (const [label, input] of bad) await assert.rejects(() => createCareerSave(base, input), ValidationError, label);
  assert.deepEqual(fs.readdirSync(dir), [], 'nenhum diretório (nem .tmp) deve restar');
});

test('Saves: isolamento entre perfis e proteção contra path traversal', async () => {
  const base = tmp();
  const a = createProfile(base, 'A'), b = createProfile(base, 'B');
  const ca = await createCareerSave(base, { profileId: a.id, seed: 's1', clubId, coach });
  assert.equal((await listCareerSaves(base, a.id)).careers.length, 1);
  assert.equal((await listCareerSaves(base, b.id)).careers.length, 0);
  await assert.rejects(() => openCareer(base, b.id, ca.id), /não encontrado/);
  await assert.rejects(() => openCareer(base, a.id, '../../profiles.json'), ValidationError);
  await assert.rejects(() => listCareerSaves(base, '..'), ValidationError);
});

test('Saves: save corrompido é reportado sem derrubar a listagem', async () => {
  const base = tmp(); const prof = createProfile(base, 'Teste');
  const ok = await createCareerSave(base, { profileId: prof.id, seed: 's1', clubId, coach });
  const brokenId = '11111111-1111-4111-8111-111111111111';
  fs.mkdirSync(path.join(base, 'saves', prof.id, brokenId));
  fs.writeFileSync(path.join(base, 'saves', prof.id, brokenId, 'career.db'), 'isto não é um banco sqlite');
  const list = await listCareerSaves(base, prof.id);
  assert.deepEqual(list.careers.map((c) => c.id), [ok.id]);
  assert.equal(list.unreadable.length, 1);
  assert.equal(list.unreadable[0]!.id, brokenId);
});

test('Saves: foto ausente no disco gera aviso, não erro', async () => {
  const base = tmp(); const prof = createProfile(base, 'Teste');
  const c = await createCareerSave(base, { profileId: prof.id, seed: 's1', clubId, coach, photo: makePng(90, 90) });
  fs.rmSync(path.join(base, 'saves', prof.id, c.id, 'coach.png'));
  const ov = await openCareer(base, prof.id, c.id);
  assert.equal(ov.photoDataUrl, null);
  assert.equal(ov.warnings.length, 1);
});

test('Saves: visão geral traz próxima partida, posição na liga e nacionalidade por extenso', async () => {
  const base = tmp(); const prof = createProfile(base, 'Teste');
  const c = await createCareerSave(base, { profileId: prof.id, seed: 's1', clubId, coach });
  const ov = await openCareer(base, prof.id, c.id);
  assert.equal(ov.nationalityName, 'Brasil');
  assert.equal(ov.nextFixture?.date, '2026-08-01');
  assert.ok(ov.nextFixture && (ov.nextFixture.homeId === clubId || ov.nextFixture.awayId === clubId));
  assert.equal(ov.leaguePosition?.total, 20);
  assert.equal(ov.leaguePosition?.played, 0);
  const cal = await getCalendar(base, prof.id, c.id);
  assert.equal(cal.fixtures.length, 38);
  const comps = await listCompetitionsFor(base, prof.id, c.id);
  assert.equal(comps.competitions.length, 4);
  const table = await getTable(base, prof.id, c.id, comps.userCompetitionId!);
  assert.equal(table.rows.length, 20);
  await assert.rejects(() => getTable(base, prof.id, c.id, 'cmp_nao_existe'), /não encontrada/);
});

test('Saves: avanço do tempo é persistido e sobrevive a fechar e reabrir o save', async () => {
  const base = tmp(); const prof = createProfile(base, 'Teste');
  const c = await createCareerSave(base, { profileId: prof.id, seed: 's1', clubId, coach });
  const r1 = await advanceCareer(base, prof.id, c.id, 'nextMatchday');
  assert.deepEqual([r1.advanced, r1.toDate], [true, '2026-08-01']);
  assert.equal(r1.pendingMatches, 40);
  const r2 = await advanceCareer(base, prof.id, c.id, 'day');
  assert.deepEqual([r2.advanced, r2.reason], [false, 'pending_matches']);
  const ov = await openCareer(base, prof.id, c.id);
  assert.equal(ov.summary.gameDate, '2026-08-01');
  const list = await listCareerSaves(base, prof.id);
  assert.equal(list.careers[0]!.gameDate, '2026-08-01');
  await assert.rejects(() => advanceCareer(base, prof.id, c.id, 'semana' as never), /Modo de avanço inválido/);
});

test('Saves: save no formato da Fase 2 (sem calendário) é reparado automaticamente ao abrir', async () => {
  const base = tmp(); const prof = createProfile(base, 'Teste');
  const c = await createCareerSave(base, { profileId: prof.id, seed: 's1', clubId, coach });
  const db = await openDatabase(path.join(base, 'saves', prof.id, c.id, 'career.db'));
  db.exec('DELETE FROM fixtures; DELETE FROM competitions;');
  db.close();
  const ov = await openCareer(base, prof.id, c.id);
  assert.equal(ov.nextFixture?.date, '2026-08-01');
  assert.equal((await getCalendar(base, prof.id, c.id)).fixtures.length, 38);
});
