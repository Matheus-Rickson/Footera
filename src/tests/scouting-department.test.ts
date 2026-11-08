import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { getCareerState, moveClock } from '../database/repositories/competitionRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import { createScoutTask, getScoutedPlayers, getScoutingOverview, hireScout, ScoutError } from '../database/repositories/scoutRepository.ts';
import { getInfrastructureOverview, startUpgrade } from '../database/repositories/infrastructureRepository.ts';
import { loadClubEcon } from '../database/repositories/financeRepository.ts';
import { youthIntake } from '../database/repositories/youthRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import { facilityMonthly, staffUserMonthly } from '../game/finance-engine/finance.ts';
import { foreignChance, intakeRange, intakeSize, maxScoutsFor, recruitBonus, trackedFor } from '../game/scouting-engine/scouting.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
async function setup(seed: string) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8, countries: ['BRA', 'ENG', 'ESP'] });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id };
}
const clockTo = (db: SqlDb, to: string) => withTransaction(db, () => moveClock(db, getCareerState(db).gameDate, to, new Date('2030-01-01T00:00:00Z')));
const setLevel = (db: SqlDb, clubId: string, kind: string, level: number) => {
  const f = JSON.parse(String(db.prepare('SELECT facilities_json FROM clubs WHERE id = ?').get(clubId)!.facilities_json)) as Record<string, number>;
  db.prepare('UPDATE clubs SET facilities_json = ? WHERE id = ?').run(JSON.stringify({ ...f, [kind]: level }), clubId);
};

test('Departamento de scouting e rede de captação (puro): nível 10 reproduz o jogo de antes; níveis maiores rendem mais', () => {
  assert.deepEqual([maxScoutsFor(10), trackedFor(10), recruitBonus(10)], [4, 5, 1], 'nível padrão = regras de antes');
  assert.deepEqual([maxScoutsFor(1), maxScoutsFor(20), trackedFor(1), trackedFor(20)], [2, 6, 3, 7]);
  assert.deepEqual([recruitBonus(1), recruitBonus(20), foreignChance(20)], [0, 2, 0.2]);
  assert.equal(intakeSize(10, true, 0.5), intakeSize(10, true, 0.5, 10), 'sem nível gravado = 10');
  assert.equal(intakeSize(10, false, 0.5, 20), intakeSize(10, false, 0.5, 1), 'a IA não usa a rede de captação');
  const r = intakeRange(10, 20);
  assert.ok(r.min < r.max && r.max <= 8);
});

test('Infraestrutura: seis instalações; manutenção por card soma a estrutura; obra no departamento de scouting libera mais olheiros', async () => {
  const { db, clubId } = await setup('dept-a');
  const ov = getInfrastructureOverview(db);
  assert.deepEqual(ov.facilities.map((f) => f.kind), ['stadium', 'training', 'youth', 'recruitment', 'scouting', 'medical']);
  const scouting = ov.facilities.find((f) => f.kind === 'scouting')!;
  assert.equal(scouting.level, 10, 'save sem nível gravado começa no 10');
  assert.ok(scouting.stats.some((s) => s.label === 'Jogadores por tarefa' && s.value === '5'));
  assert.ok(ov.facilities.find((f) => f.kind === 'recruitment')!.stats.some((s) => s.label === 'Chance no exterior' && s.value === '10%'));
  assert.equal(ov.stadium.avgAttendance, null, 'sem jogos em casa ainda');
  assert.ok(ov.stadium.capacity > 0 && ov.stadium.fans > 0 && ov.stadium.ticketPrice > 0);
  // a manutenção de cada card + a parte fixa = a estrutura cobrada no mês (nível 10/10 = a mesma de antes)
  const e = loadClubEcon(db, clubId);
  const parts = (['training', 'youth', 'medical'] as const).reduce((s, k) => s + facilityMonthly(e, k), 0) + facilityMonthly(e, 'scouting') + facilityMonthly(e, 'recruitment');
  assert.ok(Math.abs(staffUserMonthly(e) - (parts + Math.round(e.econ * (15_000 - 20_000)))) <= 5);
  // limite de olheiros pelo nível: 4 no 10
  const cands = getScoutingOverview(db).candidates;
  for (const c of cands.slice(0, 4)) hireScout(db, c.id);
  assert.throws(() => hireScout(db, cands[4]!.id), ScoutError);
  // obra: +1 nível no scouting (pago pelo extrato), manutenção sobe; no nível 15, 5 olheiros e 6 por tarefa
  db.prepare('UPDATE clubs SET balance = balance + 50000000 WHERE id = ?').run(clubId);
  const before = staffUserMonthly(loadClubEcon(db, clubId));
  startUpgrade(db, 'scouting');
  db.prepare("UPDATE construction_projects SET end_date = date(?, '+3 days') WHERE status = 'active'").run(getCareerState(db).gameDate);
  clockTo(db, getInfrastructureOverview(db).project!.end);
  assert.equal(getInfrastructureOverview(db).facilities.find((f) => f.kind === 'scouting')!.level, 11);
  assert.equal(staffUserMonthly(loadClubEcon(db, clubId)) - before, scouting.extraMonthly, 'manutenção mensal maior');
  assert.ok(scouting.extraMonthly! > 0 && staffUserMonthly(loadClubEcon(db, clubId)) > before, 'o nível do scouting pesa na manutenção');
  setLevel(db, clubId, 'scouting', 15);
  const ov2 = getScoutingOverview(db);
  assert.deepEqual([ov2.maxScouts, ov2.tracked], [5, 6]);
  hireScout(db, ov2.candidates[0]!.id);
  assert.equal(getScoutingOverview(db).scouts.length, 5);
  // no nível 20, cada tarefa acompanha 7 jogadores ao mesmo tempo
  setLevel(db, clubId, 'scouting', 20);
  const t = createScoutTask(db, { scope: 'world', area: '', criteria: {}, months: null });
  clockTo(db, '2026-08-25');
  const partial = n(db, 'SELECT COUNT(*) AS n FROM scout_task_players tp LEFT JOIN scout_knowledge k ON k.player_id = tp.player_id WHERE tp.task_id = ? AND COALESCE(k.knowledge, 0) < 100', t);
  assert.equal(partial, trackedFor(20), 'acompanhados = jogadores por tarefa do nível');
});

test('Rede de captação: no nível 20, jovens de outros países chegam na peneira do usuário; a IA continua só com os do país', async () => {
  const { db, clubId } = await setup('dept-b');
  setLevel(db, clubId, 'recruitment', 20);
  setLevel(db, clubId, 'youth', 20);
  for (const y of [2027, 2028, 2029, 2030, 2031]) {
    db.prepare('DELETE FROM players WHERE youth_club_id = ?').run(clubId); // abre espaço na base a cada peneira
    youthIntake(db, `${y}-03-15`);
  }
  const home = String(db.prepare('SELECT co.code FROM clubs c JOIN countries co ON co.id = c.country_id WHERE c.id = ?').get(clubId)!.code);
  const mine = db.prepare("SELECT nationality FROM players WHERE youth_club_id = ? AND id LIKE '%_y20%'").all(clubId).map((r) => String(r.nationality));
  const all = db.prepare("SELECT p.nationality, co.code FROM players p JOIN clubs c ON c.id = p.youth_club_id JOIN countries co ON co.id = c.country_id WHERE p.youth_club_id <> ? AND p.id LIKE '%_y20%'").all(clubId);
  assert.ok(mine.length > 0 && mine.some((x) => x !== home), `jovens estrangeiros na base do usuário: ${mine.join(' ')}`);
  assert.ok(all.length > 0 && all.every((r) => String(r.nationality) === String(r.code)), 'IA: só jovens do país');
});

test('E-mails dos olheiros: resumo semanal por tarefa com os jogadores (estimativas) e lista no aviso de conclusão', async () => {
  const { db } = await setup('dept-c');
  hireScout(db, [...getScoutingOverview(db).candidates].sort((a, b) => b.ability - a.ability)[0]!.id);
  const id = createScoutTask(db, { scope: 'country', area: 'ENG', criteria: { age: { max: 27 } }, months: 1 });
  clockTo(db, '2026-07-06');
  assert.equal(getNews(db).filter((m) => m.sender === 'Departamento de scouting' && m.playerIds).length, 0, 'antes de 7 dias, nenhum resumo');
  clockTo(db, '2026-07-09');
  const digests = getNews(db).filter((m) => m.sender === 'Departamento de scouting' && m.playerIds && m.title.includes('identificad'));
  assert.equal(digests.length, 1, 'um resumo na primeira semana');
  const ids = digests[0]!.playerIds!;
  const found = new Set(db.prepare('SELECT player_id FROM scout_task_players WHERE task_id = ?').all(id).map((r) => String(r.player_id)));
  assert.ok(ids.length > 0 && ids.every((p) => found.has(p)), 'só jogadores da tarefa');
  assert.equal(digests[0]!.action, 'scouting');
  const rows = getScoutedPlayers(db, ids);
  assert.equal(rows.length, ids.length);
  assert.ok(rows.every((p) => !('overall' in p) && p.knowledge > 0), 'tabela só com estimativas');
  const first = digests[0]!.date;
  const digestCount = () => n(db, "SELECT COUNT(*) AS n FROM news WHERE sender = 'Departamento de scouting' AND players_json IS NOT NULL");
  clockTo(db, '2026-07-14');
  assert.equal(digestCount(), 1, 'nada antes de 7 dias do último resumo');
  clockTo(db, '2026-07-16');
  const second = getNews(db).filter((m) => m.sender === 'Departamento de scouting' && m.playerIds && m.date !== first);
  assert.equal(second.length, 1, 'segundo resumo uma semana depois');
  assert.equal(Date.parse(second[0]!.date) - Date.parse(first), 7 * 86_400_000);
  assert.ok(second[0]!.title.includes('relatório'), 'na 2ª semana, os relatórios concluídos dos primeiros acompanhados');
  clockTo(db, '2026-08-03');
  const done = getNews(db).find((m) => m.title.startsWith('Tarefa de busca concluída'))!;
  assert.ok(done.playerIds && done.playerIds.length > 0 && done.playerIds.every((p) => found.has(p) || db.prepare('SELECT 1 AS x FROM scout_task_players WHERE task_id = ? AND player_id = ?').get(id, p)));
});
