/**
 * Otimização de desempenho do banco (v0.8.11; docs/PERFORMANCE.md): configuração da conexão, cache de consultas preparadas, índice das
 * classificações, cache de leitura do mercado (invalidado por qualquer escrita) e cálculo de força sem objeto achatado. Nenhuma pode mudar
 * resultados.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, withStatementCache } from '../database/connection.ts';
import { memoUntilWrite, writeVersion } from '../database/writeMemo.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld, genAttributes } from '../game/world/generator.ts';
import { deriveGoalkeeper } from '../game/world/goalkeeper.ts';
import { flattenAttributes, overallFor, positionWeights } from '../game/world/overall.ts';
import { createRng } from '../game/rng.ts';
import { POS_ORDER } from '../shared/positions.ts';
import { getCompetitionTable } from '../database/repositories/competitionRepository.ts';
import { releasePlayer, searchMarketPage } from '../database/repositories/transferRepository.ts';
import { setShortlisted } from '../database/repositories/scoutRepository.ts';
import { getCareerState } from '../database/repositories/careerRepository.ts';
import { computeStandings } from '../game/competition-engine/standings.ts';
import type { SqlDb } from '../database/types.ts';
import type { Attributes, Coach, Position } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 40, photoPath: null };
async function career(seed = 'perf-db') {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return db;
}
const plan = (db: SqlDb, sql: string, ...p: unknown[]) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map((r) => String(r.detail)).join(' | ');

/** Implementação anterior de `overallFor` (soma sobre o objeto achatado), referência da equivalência. */
function referenceOverall(a: Attributes, pos: Position): number {
  const flat = flattenAttributes(a), w = positionWeights(pos);
  let sum = 0, tot = 0;
  for (const [k, wt] of Object.entries(w)) { sum += (flat[k] ?? 1) * (wt ?? 0); tot += wt ?? 0; }
  return Math.round((sum / tot) * 5);
}

test('Força: o cálculo sem objeto achatado dá o mesmo resultado em todas as posições, com e sem atributos de goleiro e com grupos incompletos', () => {
  const rng = createRng('overall-equiv');
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const pos = POS_ORDER[i % POS_ORDER.length]!;
    const a = genAttributes(rng, pos, rng.int(2, 18));
    const variants: Attributes[] = [a, { ...a, goalkeeper: deriveGoalkeeper(a.technical.goalkeeping) }];
    const partial = structuredClone(a) as unknown as { mental: Record<string, number> };
    delete partial.mental.composure; // dado antigo/incompleto: vale 1
    variants.push(partial as unknown as Attributes);
    for (const v of variants) for (const p of POS_ORDER) { assert.equal(overallFor(v, p), referenceOverall(v, p), `${p} (caso ${i})`); n++; }
  }
  assert.ok(n > 15_000);
});

test('Conexão: saves em arquivo com WAL, synchronous NORMAL, cache de 32 MB, temporários em memória e espera de 5 s; leitura só para leitura sem PRAGMAs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-pragma-'));
  const file = path.join(dir, 'x.db');
  const db = await openDatabase(file);
  const v = (k: string) => Object.values(db.prepare(`PRAGMA ${k}`).get()!)[0];
  assert.equal(v('journal_mode'), 'wal');
  assert.equal(Number(v('synchronous')), 1, 'NORMAL');
  assert.equal(Number(v('cache_size')), -32000);
  assert.equal(Number(v('temp_store')), 2, 'MEMORY');
  assert.equal(Number(v('busy_timeout')), 5000);
  assert.equal(Number(v('foreign_keys')), 1);
  db.exec('CREATE TABLE t (x INTEGER)');
  db.close();
  const ro = await openDatabase(file, { readOnly: true });
  assert.equal(Number(Object.values(ro.prepare('PRAGMA synchronous').get()!)[0]), 2, 'só leitura: padrão do SQLite (nenhum PRAGMA aplicado)');
  assert.throws(() => ro.exec('INSERT INTO t VALUES (1)'));
  ro.close();
  for (const f of ['x.db', 'x.db-wal', 'x.db-shm']) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* não existe */ } }
  fs.rmdirSync(dir);
});

test('Consultas preparadas: reaproveitadas pelo texto (LRU com limite), resultados independentes entre execuções, fechadas junto com o banco', async () => {
  const raw = await openDatabase(':memory:');
  let compiled = 0;
  const counting: SqlDb = { exec: (s) => raw.exec(s), prepare: (s) => { compiled++; return raw.prepare(s); }, close: () => raw.close() };
  const db = withStatementCache(counting, 3);
  db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2), (3);');
  const a = db.prepare('SELECT x FROM t ORDER BY x').all();
  const b = db.prepare('SELECT x FROM t ORDER BY x').all();
  assert.equal(compiled, 1, 'mesma SQL: compilada uma vez');
  assert.notEqual(a, b); a.pop(); assert.equal(b.length, 3, 'cada execução devolve o próprio array');
  // reentrância: a mesma consulta usada dentro do processamento do resultado dela
  const nested = db.prepare('SELECT x FROM t WHERE x <= ? ORDER BY x').all(3).map((r) => db.prepare('SELECT x FROM t WHERE x <= ? ORDER BY x').all(Number(r.x)).length);
  assert.deepEqual(nested, [1, 2, 3]);
  for (const q of ['SELECT 1', 'SELECT 2', 'SELECT 3']) db.prepare(q).get();
  compiled = 0;
  db.prepare('SELECT x FROM t ORDER BY x').all();
  assert.equal(compiled, 1, 'com limite 3, a mais antiga saiu do cache e é compilada de novo');
  db.prepare('SELECT 3').get();
  assert.equal(compiled, 1, 'a mais recente continua no cache');
  db.close();
  assert.throws(() => raw.prepare('SELECT 1'), 'fechar o cache fecha o banco');
});

test('Consultas preparadas: LRU de verdade (usar uma consulta a renova; sai a menos usada recentemente)', async () => {
  const raw = await openDatabase(':memory:');
  let compiled = 0;
  const db = withStatementCache({ exec: (s) => raw.exec(s), prepare: (s) => { compiled++; return raw.prepare(s); }, close: () => raw.close() }, 2);
  db.prepare('SELECT 1').get(); db.prepare('SELECT 2').get();
  db.prepare('SELECT 1').get(); // renova a 1
  db.prepare('SELECT 3').get(); // sai a 2
  compiled = 0;
  db.prepare('SELECT 1').get();
  assert.equal(compiled, 0, 'a renovada continua no cache');
  db.prepare('SELECT 2').get();
  assert.equal(compiled, 1, 'a menos usada recentemente saiu');
  db.close();
});

test('Cache até a próxima escrita: devolve o mesmo valor sem escritas; qualquer INSERT/UPDATE/DELETE (mesmo desfeito) recalcula; cada conexão tem o seu', async () => {
  const db = await openDatabase(':memory:'), other = await openDatabase(':memory:');
  db.exec('CREATE TABLE t (x INTEGER)');
  let calls = 0;
  const count = () => memoUntilWrite(db, 'n', () => { calls++; return Number(db.prepare('SELECT COUNT(*) AS n FROM t').get()!.n); });
  assert.equal(count(), 0); assert.equal(count(), 0); assert.equal(calls, 1);
  db.prepare('INSERT INTO t VALUES (1)').run();
  assert.equal(count(), 1); assert.equal(calls, 2, 'escrita invalida');
  db.prepare('UPDATE t SET x = 2').run(); count(); assert.equal(calls, 3);
  const v = writeVersion(db);
  db.exec('BEGIN'); db.prepare('DELETE FROM t').run(); db.exec('ROLLBACK');
  assert.ok(writeVersion(db) > v, 'transação desfeita também muda a versão (só invalida a mais)');
  assert.equal(count(), 1); assert.equal(calls, 4);
  let otherCalls = 0;
  memoUntilWrite(other, 'n', () => ++otherCalls); memoUntilWrite(other, 'n', () => ++otherCalls);
  assert.equal(otherCalls, 1); count(); assert.equal(calls, 4, 'conexões independentes');
  db.close(); other.close();
});

test('Mercado em cache: "carregar mais" igual à busca sem cache; contratação, dispensa e lista de observação aparecem na hora', async () => {
  const db = await career('perf-market');
  const page1 = searchMarketPage(db, { limit: 50 });
  const page2 = searchMarketPage(db, { offset: 50, limit: 50 });
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('perf_test', '1')").run(); // força recálculo
  const fresh = searchMarketPage(db, { offset: 0, limit: 100 });
  assert.deepEqual([...page1.players, ...page2.players].map((p) => p.id), fresh.players.map((p) => p.id), 'páginas do cache = busca nova');
  assert.equal(page1.total, fresh.total);
  // dispensa: o jogador entra na hora nos livres
  const freeBefore = searchMarketPage(db, { freeOnly: true, limit: 500 });
  const st = getCareerState(db);
  const other = String(db.prepare('SELECT id FROM players WHERE club_id IS NOT NULL AND club_id <> ? ORDER BY id LIMIT 1').get(st.clubId)!.id);
  releasePlayer(db, other, st.gameDate, false);
  const freeAfter = searchMarketPage(db, { freeOnly: true, limit: 500 });
  assert.equal(freeAfter.total, freeBefore.total + 1);
  assert.ok(freeAfter.players.some((p) => p.id === other));
  // lista de observação
  assert.equal(searchMarketPage(db, { shortlistedOnly: true }).total, 0);
  setShortlisted(db, other, true);
  assert.deepEqual(searchMarketPage(db, { shortlistedOnly: true }).players.map((p) => p.id), [other]);
  db.close();
});

test('Índices: classificação usa o índice competição + situação; lista de observação parte da própria lista; resultado da classificação igual ao das partidas', async () => {
  const db = await career('perf-index');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_fixtures_comp_status'").get());
  const comp = String(db.prepare("SELECT id FROM competitions WHERE kind = 'league' ORDER BY id LIMIT 1").get()!.id);
  assert.match(plan(db, "SELECT home_club_id FROM fixtures WHERE competition_id = ? AND status = 'played' AND (stage IS NULL OR stage = 'f1') ORDER BY match_date, round, id", comp), /idx_fixtures_comp_status/);
  assert.match(plan(db, `SELECT s.player_id FROM scout_shortlist s CROSS JOIN players p ON p.id = s.player_id
    WHERE p.retired = 0 AND p.youth_club_id IS NULL AND (p.club_id IS NULL OR p.club_id <> ?) ORDER BY s.added_on, s.player_id`, 'x'), /SCAN s/);
  // regra 4: a tabela continua derivada das partidas
  const clubs = db.prepare('SELECT id FROM clubs WHERE league_id = (SELECT league_id FROM competitions WHERE id = ?)').all(comp).map((r) => String(r.id));
  db.prepare("UPDATE fixtures SET status = 'played', home_goals = 2, away_goals = 0 WHERE competition_id = ? AND round = 1").run(comp);
  const results = db.prepare("SELECT home_club_id AS h, away_club_id AS a FROM fixtures WHERE competition_id = ? AND status = 'played'").all(comp)
    .map((r) => ({ home: String(r.h), away: String(r.a), homeGoals: 2, awayGoals: 0 }));
  const rules = JSON.parse(String(db.prepare('SELECT l.rules_json AS r FROM competitions c JOIN leagues l ON l.id = c.league_id WHERE c.id = ?').get(comp)!.r));
  const want = computeStandings(clubs, results, rules).map((r) => [r.teamId, r.points]);
  assert.deepEqual(getCompetitionTable(db, comp).rows.map((r) => [r.clubId, r.points]), want);
  db.close();
});
