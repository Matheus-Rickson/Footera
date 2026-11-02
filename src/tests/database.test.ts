import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { migrate, currentVersion, MIGRATIONS } from '../database/migrator.ts';
import { loadWorld } from '../database/repositories/worldRepository.ts';
import { createCareer, ValidationError } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import type { Coach } from '../shared/types.ts';

const world = generateWorld({ seed: 'db-test', teamsPerLeagueOverride: 6 });
const coach: Coach = {
  firstName: 'Ana', lastName: 'Treinadora', birthDate: '1980-05-10', nationality: 'BRA',
  methodology: 'possession', reputation: 30, photoPath: null,
};

const ALL = MIGRATIONS.map((m) => m.version);
const LATEST = Math.max(...ALL);

test('Migrações: aplicam todas uma vez, são idempotentes e recusam versão futura', async () => {
  const db = await openDatabase(':memory:');
  assert.deepEqual(migrate(db), ALL);
  assert.deepEqual(migrate(db), []);
  assert.equal(currentVersion(db), LATEST);
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(LATEST + 98, 'futuro', 'x');
  assert.throws(() => migrate(db), /versão mais nova/);
});

test('Migrações: falha em uma migração faz rollback completo e mantém a versão anterior', async () => {
  const db = await openDatabase(':memory:');
  const bad = [...MIGRATIONS, { version: LATEST + 1, name: 'quebrada', sql: 'CREATE TABLE ok_antes (a INTEGER); CREATE TABLE ok_antes (b INTEGER);' }];
  assert.throws(() => migrate(db, bad));
  assert.equal(currentVersion(db), LATEST);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_antes'").get(), undefined);
});

test('Carreira: universo gravado e relido é idêntico ao original', async () => {
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  assert.deepEqual(loadWorld(db), world);
  const row = db.prepare('SELECT * FROM career').get()!;
  assert.equal(row.club_id, world.clubs[0]!.id);
  assert.equal(row.game_date, world.startDate);
});

test('Carreira: chaves estrangeiras são aplicadas pelo banco', async () => {
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  assert.throws(() => db.prepare('UPDATE players SET club_id = ? WHERE id = ?').run('clb_inexistente', world.players[0]!.id));
});

test('Carreira: duas carreiras do mesmo universo são independentes', async () => {
  const a = await openDatabase(':memory:'), b = await openDatabase(':memory:');
  createCareer(a, world, coach, world.clubs[0]!.id);
  createCareer(b, world, coach, world.clubs[1]!.id);
  const pid = world.players[0]!.id;
  a.prepare('UPDATE players SET salary = 1 WHERE id = ?').run(pid);
  assert.equal(a.prepare('SELECT salary FROM players WHERE id = ?').get(pid)!.salary, 1);
  assert.equal(b.prepare('SELECT salary FROM players WHERE id = ?').get(pid)!.salary, world.players[0]!.salary);
  assert.equal(world.players[0]!.salary === 1, false);
});

test('Carreira: validações do treinador e rollback ao falhar', async () => {
  const db = await openDatabase(':memory:');
  const club = world.clubs[0]!.id;
  assert.throws(() => createCareer(db, world, { ...coach, firstName: ' ' }, club), ValidationError);
  assert.throws(() => createCareer(db, world, { ...coach, birthDate: '2026-07-01' }, club), ValidationError);
  assert.throws(() => createCareer(db, world, { ...coach, birthDate: '2030-01-01' }, club), ValidationError);
  assert.throws(() => createCareer(db, world, { ...coach, birthDate: '1990-02-31' }, club), ValidationError);
  assert.throws(() => createCareer(db, world, coach, 'clb_nao_existe'), ValidationError);
  assert.equal(currentVersion(db), 0, 'nada deve ser criado quando a validação falha');
});
