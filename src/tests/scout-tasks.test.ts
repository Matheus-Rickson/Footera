import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { getCareerState, moveClock } from '../database/repositories/competitionRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import {
  createScoutTask, fireScout, getScoutingOverview, getScoutTaskPlayers, hireScout, previewScoutTask, removeScoutTask, ScoutError, taskPool,
} from '../database/repositories/scoutRepository.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import {
  addMonths, compatibleBucket, criteriaCount, criteriaProblems, matchesCriteria, reportDays, taskGain, taskName, TASK_TRACKED, type ScoutSubject,
} from '../game/scouting-engine/tasks.ts';
import { dailyGain } from '../game/scouting-engine/scouting.ts';
import { migration025 } from '../database/migrations/025_scout_tasks.ts';
import { ageOn } from '../shared/date.ts';
import { to20 } from '../shared/scale.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
async function setup(seed: string) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8, countries: ['BRA', 'ENG'] });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id };
}
const clockTo = (db: SqlDb, to: string) => withTransaction(db, () => moveClock(db, getCareerState(db).gameDate, to, new Date('2030-01-01T00:00:00Z')));
const hireBest = (db: SqlDb, k: number) => { for (const c of [...getScoutingOverview(db).candidates].sort((a, b) => b.ability - a.ability).slice(0, k)) hireScout(db, c.id); };

const subject = (o: Partial<ScoutSubject> = {}): ScoutSubject => ({
  position: 'ST', secondary: ['CF'], overall: 64, potential: 75, age: 22, value: 3_000_000, salary: 20_000, reputation: 40, foot: 'right', clubId: 'c1',
  contractEnd: '2027-06-30', condition: 95, morale: 70, attributes: null, stats: null, ...o,
});

test('Critérios das tarefas (puro): todos precisam bater; escala 1–20 na força; nome automático; faixa de compatíveis; ritmo do relatório', () => {
  const d = '2026-07-01';
  assert.ok(matchesCriteria(subject(), {}, d), 'sem critérios: todos');
  assert.ok(matchesCriteria(subject(), { positions: ['ST', 'CF'], overall: { min: 13 }, age: { max: 23 } }, d));
  assert.ok(!matchesCriteria(subject(), { overall: { min: 14 } }, d), 'força 64 = 13 na escala 1–20');
  assert.ok(!matchesCriteria(subject(), { positions: ['GK', 'CB'] }, d), 'posição principal fora da lista');
  assert.ok(matchesCriteria(subject(), { secondary: ['CF'] }, d) && !matchesCriteria(subject(), { secondary: ['LW'] }, d));
  assert.ok(!matchesCriteria(subject(), { positions: ['ST'], age: { max: 21 } }, d), 'basta um critério falhar');
  assert.ok(matchesCriteria(subject({ clubId: null }), { status: 'free' }, d) && !matchesCriteria(subject(), { status: 'free' }, d));
  assert.ok(matchesCriteria(subject({ contractEnd: '2026-12-31' }), { status: 'expiring' }, d) && !matchesCriteria(subject(), { status: 'expiring' }, d));
  const attrs = { technical: { finishing: 15 }, mental: {}, physical: { pace: 11 } } as unknown as ScoutSubject['attributes'];
  assert.ok(matchesCriteria(subject({ attributes: attrs }), { attributes: { finishing: 15 } }, d) && !matchesCriteria(subject({ attributes: attrs }), { attributes: { pace: 12 } }, d));
  const stats = { appearances: 10, minutes: 800, goals: 6, assists: 1, avgRating: 7.1 };
  assert.ok(matchesCriteria(subject({ stats }), { stats: { goals: 5, avgRating: 7 } }, d) && !matchesCriteria(subject({ stats }), { stats: { assists: 2 } }, d));
  assert.ok(!matchesCriteria(subject({ reputation: 40 }), { reputation: { min: 2.5 } }, d) && matchesCriteria(subject({ reputation: 40 }), { reputation: { min: 2 } }, d), 'reputação em estrelas');
  assert.equal(taskName('Brasil', { positions: ['ST'], overall: { min: 13 }, age: { max: 27 } }), 'ATA · Brasil · Força 13+ · Idade ≤27');
  assert.equal(taskName('Mundo', { attributes: { finishing: 14 }, foot: 'left' }), 'Todas as posições · Mundo · +2 filtros');
  assert.equal(criteriaCount({ positions: ['ST'], overall: {}, attributes: { finishing: 14 } }), 2, 'faixa vazia não conta');
  assert.deepEqual([compatibleBucket(0), compatibleBucket(1), compatibleBucket(23), compatibleBucket(5000)], [{ low: 0, high: 0 }, { low: 1, high: 5 }, { low: 21, high: 35 }, { low: 2001, high: null }]);
  assert.ok(criteriaProblems({ overall: { min: 15, max: 10 } }).length && criteriaProblems({ attributes: { inventado: 3 } }).length && !criteriaProblems({ age: { min: 18, max: 23 } }).length);
  assert.equal(taskGain(10, 'world'), dailyGain(10) * 0.75);
  assert.ok(reportDays(10, 'world') > reportDays(10, 'country'));
  assert.deepEqual([addMonths('2026-01-31', 1), addMonths('2026-11-15', 3)], ['2026-02-28', '2027-02-15']);
});

test('Tarefas na carreira: encontrados atendem aos critérios reais, 5 acompanhados por vez, fila com um olheiro, prazo conclui e libera o olheiro', async () => {
  const { db, clubId } = await setup('tasks-a');
  // sem olheiros: a tarefa entra na fila
  const pre = previewScoutTask(db, { scope: 'country', area: 'ENG', criteria: { age: { max: 25 } }, months: 1 });
  assert.equal(pre.queued, true);
  assert.equal(pre.startDate, null);
  const exact = taskPool(db, 'country', 'ENG', { age: { max: 25 } }, getCareerState(db).gameDate, clubId).length;
  assert.ok(exact > 0 && pre.compatible.low <= exact && (pre.compatible.high === null || exact <= pre.compatible.high), 'a faixa contém o número real');
  assert.throws(() => createScoutTask(db, { scope: 'league', area: 'liga-inventada', criteria: {}, months: 1 }), ScoutError);
  assert.throws(() => createScoutTask(db, { scope: 'country', area: 'ENG', criteria: { overall: { min: 25 } }, months: 1 }), ScoutError);
  const a = createScoutTask(db, { scope: 'country', area: 'ENG', criteria: { age: { max: 25 } }, months: 1 });
  const b = createScoutTask(db, { scope: 'world', area: '', criteria: { positions: ['GK'] }, months: null });
  assert.deepEqual(getScoutingOverview(db).tasks.map((t) => t.status), ['queued', 'queued']);
  hireBest(db, 1); // o olheiro assume a primeira da fila
  let ov = getScoutingOverview(db);
  assert.deepEqual(ov.tasks.map((t) => [t.id, t.status]), [[a, 'active'], [b, 'queued']]);
  assert.equal(ov.scouts[0]!.taskId, a);
  const t0 = ov.tasks[0]!;
  assert.equal(t0.endsOn, addMonths(t0.startedOn!, 1), 'prazo conta do início');
  // uma semana: no máximo 5 acompanhados; todos ingleses, com até 25 anos, nunca do próprio clube
  clockTo(db, '2026-07-08');
  const found = db.prepare('SELECT p.*, co.code FROM scout_task_players tp JOIN players p ON p.id = tp.player_id LEFT JOIN clubs c ON c.id = p.club_id LEFT JOIN countries co ON co.id = c.country_id WHERE tp.task_id = ?').all(a);
  assert.ok(found.length >= TASK_TRACKED, 'encontrou jogadores');
  for (const r of found) {
    const p = rowToPlayer(r);
    assert.ok(ageOn(p.birthDate, '2026-07-08') <= 26 && p.clubId !== clubId && (String(r.code) === 'ENG' || (p.clubId === null && p.nationality === 'ENG')));
  }
  const partial = n(db, 'SELECT COUNT(*) AS n FROM scout_task_players tp JOIN scout_knowledge k ON k.player_id = tp.player_id WHERE tp.task_id = ? AND k.knowledge < 100', a);
  assert.ok(partial <= TASK_TRACKED, `acompanha no máximo ${TASK_TRACKED} por vez`);
  const list = getScoutTaskPlayers(db, a);
  assert.equal(list.length, found.length);
  assert.ok(list.every((p) => !('overall' in p) && p.knowledge > 0), 'lista só com estimativas');
  // prazo vence: concluída, notícia, e o olheiro passa à tarefa da fila (o prazo dela conta a partir daí)
  clockTo(db, addMonths(t0.startedOn!, 1).slice(0, 8) + '28');
  ov = getScoutingOverview(db);
  const ta = ov.tasks.find((t) => t.id === a)!, tb = ov.tasks.find((t) => t.id === b)!;
  assert.deepEqual([ta.status, tb.status, tb.scoutId], ['done', 'active', ov.scouts[0]!.id]);
  assert.ok(getNews(db).some((x) => x.title.startsWith('Tarefa de busca concluída')));
  clockTo(db, addMonths(getCareerState(db).gameDate, 0).slice(0, 8) + '28');
  const gks = db.prepare('SELECT p.position FROM scout_task_players tp JOIN players p ON p.id = tp.player_id WHERE tp.task_id = ?').all(b);
  assert.ok(gks.length > 0 && gks.every((r) => String(r.position) === 'GK'), 'mundo: só goleiros, de qualquer país');
  // demitir: a tarefa volta para a fila; cancelar a da fila guarda o histórico; apagar remove
  fireScout(db, ov.scouts[0]!.id);
  assert.equal(getScoutingOverview(db).tasks.find((t) => t.id === b)!.status, 'queued');
  removeScoutTask(db, b);
  assert.equal(getScoutingOverview(db).tasks.find((t) => t.id === b)!.status, 'cancelled');
  assert.ok(getScoutTaskPlayers(db, b).length > 0, 'lista mantida no histórico');
  removeScoutTask(db, b);
  assert.equal(getScoutingOverview(db).tasks.some((t) => t.id === b), false);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM scout_task_players WHERE task_id = ?', b), 0);
});

test('Tarefas: critérios de atributo e estatística usam os valores reais; tarefa com prazo sem compatíveis conclui antes; olheiro livre ajuda a lista', async () => {
  const { db, clubId } = await setup('tasks-b');
  // dois olheiros de qualidades diferentes: o melhor assume a primeira tarefa
  const cands = getScoutingOverview(db).candidates;
  const hi = cands.reduce((m, c) => (c.ability > m.ability ? c : m)), lo = cands.find((c) => c.ability < hi.ability)!;
  hireScout(db, lo.id); hireScout(db, hi.id);
  const date = getCareerState(db).gameDate;
  const own = new Set(db.prepare('SELECT id FROM players WHERE club_id = ?').all(clubId).map((r) => String(r.id)));
  assert.ok(own.size > 0 && !taskPool(db, 'world', '', {}, date, clubId).some((id) => own.has(id)), 'nunca os jogadores do próprio clube');
  // atributo: só quem tem Finalização ≥ 15 de verdade
  const pool = taskPool(db, 'world', '', { attributes: { finishing: 15 } }, date, clubId);
  assert.ok(pool.length > 0);
  for (const id of pool) assert.ok(rowToPlayer(db.prepare('SELECT * FROM players WHERE id = ?').get(id)!).attributes.technical.finishing >= 15);
  const all = n(db, 'SELECT COUNT(*) AS n FROM players WHERE retired = 0 AND youth_club_id IS NULL AND (club_id IS NULL OR club_id <> ?)', clubId);
  assert.ok(pool.length < all, 'o critério filtra');
  // força pela escala 1–20 (to20 do valor real)
  for (const id of taskPool(db, 'country', 'BRA', { overall: { min: 12, max: 13 } }, date, clubId)) {
    const ov = Number(db.prepare('SELECT overall FROM players WHERE id = ?').get(id)!.overall);
    assert.ok(to20(ov) >= 12 && to20(ov) <= 13);
  }
  // estatística: antes de qualquer jogo, ninguém tem 3 gols → nenhum compatível; tarefa com prazo conclui no 1º dia
  assert.equal(taskPool(db, 'country', 'BRA', { stats: { goals: 3 } }, date, clubId).length, 0);
  assert.deepEqual(previewScoutTask(db, { scope: 'country', area: 'BRA', criteria: { stats: { goals: 3 } }, months: 3 }).compatible, { low: 0, high: 0 });
  const empty = createScoutTask(db, { scope: 'country', area: 'BRA', criteria: { stats: { goals: 3 } }, months: 3 });
  assert.equal(getScoutingOverview(db).tasks.find((t) => t.id === empty)!.scoutId, hi.id, 'o melhor olheiro livre assume');
  const target = String(db.prepare("SELECT p.id FROM players p JOIN clubs c ON c.id = p.club_id JOIN countries co ON co.id = c.country_id WHERE co.code = 'ENG' LIMIT 1").get()!.id);
  db.prepare('INSERT INTO scout_shortlist (player_id, added_on) VALUES (?, ?)').run(target, date);
  clockTo(db, '2026-07-03');
  assert.equal(getScoutingOverview(db).tasks.find((t) => t.id === empty)!.status, 'done', 'sem compatíveis: conclui antes do prazo');
  assert.ok(n(db, 'SELECT knowledge AS n FROM scout_knowledge WHERE player_id = ?', target) > 0, 'olheiros livres observam a lista');  // contínua sem compatíveis: fica ativa e só procura de novo 7 dias depois da última busca vazia
  const cont = createScoutTask(db, { scope: 'country', area: 'BRA', criteria: { stats: { goals: 3 } }, months: null });
  const searched = () => String(db.prepare('SELECT searched_on FROM scout_tasks WHERE id = ?').get(cont)!.searched_on);
  clockTo(db, '2026-07-04');
  assert.equal(getScoutingOverview(db).tasks.find((t) => t.id === cont)!.status, 'active');
  assert.equal(searched(), '2026-07-04');
  clockTo(db, '2026-07-10');
  assert.equal(searched(), '2026-07-04', 'sem nova busca antes de 7 dias');
  clockTo(db, '2026-07-12');
  assert.equal(searched(), '2026-07-11');
});

test('Migração 025: olheiro designado a um país vira tarefa contínua ativa, sem critérios, no mesmo país', async () => {
  const { db } = await setup('tasks-mig');
  hireBest(db, 1);
  const sid = String(db.prepare('SELECT id FROM scouts').get()!.id);
  db.exec('DROP TABLE scout_task_players; DROP TABLE scout_tasks;');
  db.prepare("UPDATE scouts SET assignment = 'country:ENG'").run();
  db.exec(migration025.sql);
  const t = getScoutingOverview(db).tasks;
  assert.equal(t.length, 1);
  assert.deepEqual([t[0]!.status, t[0]!.scope, t[0]!.area, t[0]!.months, t[0]!.scoutId, t[0]!.criteria], ['active', 'country', 'ENG', null, sid, {}]);
  assert.equal(String(db.prepare('SELECT assignment FROM scouts').get()!.assignment), 'shortlist');
  clockTo(db, '2026-07-05');
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM scout_task_players') > 0, 'continua trabalhando');
});
