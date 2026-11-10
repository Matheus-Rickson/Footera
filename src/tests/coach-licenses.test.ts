import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState, moveClock } from '../database/repositories/competitionRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import { addDays } from '../shared/date.ts';
import { canCoach, cappedReputation, enrollError, initialLicenses, requiredLicense } from '../game/coach-engine/licenses.ts';
import {
  activeCourse, applyReputation, canCoachClub, clubRequiredLicense, enrollLicense, heldLicense, LicenseError, licenseReminder, processLicensesDay,
} from '../database/repositories/coachLicenseRepository.ts';
import { backfillCoachSeasons, getCoachCareer, recordCoachSeason } from '../database/repositories/coachCareerRepository.ts';
import { changeReputation, fireCoach, processBoardDay } from '../database/repositories/boardRepository.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const world = generateWorld({ seed: 'licencas', teamsPerLeagueOverride: 6 });
const tierOf = (clubId: string) => world.leagues.find((l) => l.id === world.clubs.find((c) => c.id === clubId)!.leagueId)!.tier;
async function setup(clubId: string, rep = 20) {
  const db = await openDatabase(':memory:');
  createCareer(db, world, { ...coach, reputation: rep }, clubId);
  return db;
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const setLicenses = (db: SqlDb, list: string[]) => { db.exec('DELETE FROM coach_licenses; DELETE FROM coach_course;'); for (const l of list) db.prepare("INSERT INTO coach_licenses (license, obtained) VALUES (?, '2026-01-01')").run(l); };
const repOf = (db: SqlDb) => Number(JSON.parse(String(db.prepare('SELECT coach_json AS j FROM career WHERE id = 1').get()!.j)).reputation);
const tier1 = world.clubs.find((c) => tierOf(c.id) === 1)!;
const tier2 = world.clubs.find((c) => tierOf(c.id) === 2)!;

test('Regras: exigência por divisão, carência pelo curso, teto de reputação, pré-requisitos e licença inicial', () => {
  assert.deepEqual([1, 2, 3, 4, null, 0].map((t) => requiredLicense(t)), ['PRO', 'A', 'B', 'B', 'C', 'C']);
  assert.equal(canCoach('A', null, 'PRO'), false);
  assert.equal(canCoach('A', 'PRO', 'PRO'), true, 'matriculado no curso exigido: carência');
  assert.equal(canCoach('B', 'A', 'PRO'), false, 'curso abaixo do exigido não vale');
  assert.equal(canCoach('PRO', null, 'B'), true);
  assert.equal(cappedReputation(40, 10, 'C'), 45, 'teto da C');
  assert.equal(cappedReputation(40, 10, 'none'), 40, 'sem licença o teto é 35: quem já está acima não cai, mas não sobe');
  assert.equal(cappedReputation(50, -10, 'C'), 40);
  assert.equal(cappedReputation(95, 10, 'PRO'), 100);
  const base = { held: 'C' as const, course: null, careerDays: 0, employedSeasons: 0 };
  assert.match(enrollError({ ...base, target: 'B' })!, /90 dias/);
  assert.equal(enrollError({ ...base, target: 'B', careerDays: 90 }), null);
  assert.match(enrollError({ ...base, target: 'A', careerDays: 999 })!, /exige a Licença B/);
  assert.match(enrollError({ ...base, held: 'B', target: 'A' })!, /1 temporada/);
  assert.match(enrollError({ ...base, held: 'A', target: 'PRO', employedSeasons: 1 })!, /2 temporada/);
  assert.equal(enrollError({ ...base, held: 'A', target: 'PRO', employedSeasons: 2 }), null);
  assert.match(enrollError({ ...base, course: 'B', target: 'B', careerDays: 999 })!, /Um curso por vez/);
  assert.match(enrollError({ ...base, held: 'B', target: 'B' })!, /já tem/);
  assert.deepEqual(initialLicenses(20, 'C'), { held: 'C', course: null });
  assert.deepEqual(initialLicenses(30, 'B'), { held: 'B', course: null });
  assert.deepEqual(initialLicenses(70, 'B'), { held: 'A', course: null }, 'teto nunca abaixo da reputação inicial');
  assert.deepEqual(initialLicenses(20, 'PRO'), { held: 'A', course: 'PRO' }, 'clube da 1ª divisão: chega com a A e cursa a PRO');
  assert.deepEqual(initialLicenses(20, 'B'), { held: 'C', course: 'B' });
});

test('Carreira nova num clube da 1ª divisão: licença A + curso da PRO (carência); conclusão dá bônus e novo teto', async () => {
  const db = await setup(tier1.id);
  assert.equal(clubRequiredLicense(db, tier1.id), 'PRO');
  assert.equal(heldLicense(db), 'A');
  const c = activeCourse(db)!;
  assert.equal(c.license, 'PRO'); assert.equal(c.waived, true);
  assert.equal(c.end, addDays(getCareerState(db).gameDate, 365));
  assert.ok(canCoachClub(db, tier1.id));
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM news WHERE title LIKE 'Matrícula no curso da Licença PRO%'") === 1, 'e-mail explicando a carência');
  // teto da A (80)
  db.exec(`UPDATE career SET coach_json = json_set(coach_json, '$.reputation', 78) WHERE id = 1`);
  withTransaction(db, () => applyReputation(db, 10));
  assert.equal(repOf(db), 80);
  withTransaction(db, () => changeReputation(db, 5));
  assert.equal(repOf(db), 80, 'a reputação mexida pela diretoria também respeita o teto');
  // conclusão do curso pelo relógio (moveClock), no dia do término
  withTransaction(db, () => processLicensesDay(db, addDays(c.end, -1)));
  assert.equal(heldLicense(db), 'A', 'ainda não terminou');
  withTransaction(db, () => processLicensesDay(db, c.end));
  assert.equal(heldLicense(db), 'PRO');
  assert.equal(activeCourse(db), null);
  assert.equal(repOf(db), 88, '+8 já com o teto novo (100)');
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM news WHERE title = 'Curso concluído: Licença PRO'") === 1);
  db.close();
});

test('Matrícula pelo usuário: próxima licença, pré-requisitos de experiência e um curso por vez; o relógio conclui o curso', async () => {
  const db = await setup(tier2.id);
  assert.equal(clubRequiredLicense(db, tier2.id), 'A');
  assert.equal(heldLicense(db), 'B', 'clube da 2ª divisão: chega com a B');
  assert.equal(activeCourse(db)?.license, 'A', 'e é matriculado no curso da A (carência)');
  db.exec('DELETE FROM coach_course');
  assert.throws(() => enrollLicense(db, 'A'), (e) => e instanceof LicenseError && /1 temporada/.test(e.message));
  db.prepare("INSERT INTO coach_seasons (season, label, club_id, start_date, end_date, end_reason) VALUES (2025, '2025/26', ?, '2025-07-01', '2026-05-30', 'season')").run(tier2.id);
  assert.match(enrollLicense(db, 'A'), /termina em/);
  assert.throws(() => enrollLicense(db, 'PRO'), LicenseError);
  const end = activeCourse(db)!.end;
  const from = getCareerState(db).gameDate;
  withTransaction(db, () => moveClock(db, from, end, new Date('2030-01-01T00:00:00Z')));
  assert.equal(heldLicense(db), 'A', 'concluída pelo moveClock');
  db.close();
});

test('Propostas de emprego respeitam a licença; promoção para divisão mais exigente só gera aviso', async () => {
  const db = await setup(tier2.id, 40);
  setLicenses(db, ['C', 'B']);
  fireCoach(db, getCareerState(db).gameDate, 'teste');
  db.exec('DELETE FROM job_vacancies; DELETE FROM job_offers;');
  // vaga num clube da 1ª divisão com reputação compatível: sem a PRO (nem o curso), nenhuma proposta dele
  db.prepare('INSERT INTO job_vacancies (club_id, opened_on) VALUES (?, ?)').run(tier1.id, getCareerState(db).gameDate);
  db.exec(`UPDATE career SET coach_json = json_set(coach_json, '$.reputation', 60) WHERE id = 1`);
  db.prepare('UPDATE clubs SET reputation = 62 WHERE id = ?').run(tier1.id);
  let d = getCareerState(db).gameDate;
  for (let i = 0; i < 25; i++) { d = addDays(d, 1); withTransaction(db, () => processBoardDay(db, d)); }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM job_offers WHERE club_id = ?', tier1.id), 0, 'sem licença, sem proposta');
  // com o curso da PRO em andamento (carência), o clube pode chamar
  db.prepare("INSERT INTO coach_course (id, license, start_date, end_date) VALUES (1, 'PRO', ?, ?)").run(d, addDays(d, 365));
  assert.ok(canCoachClub(db, tier1.id));
  db.close();

  // promoção: treinador só com a B num clube que exige a A (sem curso) → aviso, continua empregado
  const db2 = await setup(tier2.id, 40);
  setLicenses(db2, ['C', 'B']);
  withTransaction(db2, () => licenseReminder(db2, getCareerState(db2).gameDate));
  assert.equal(n(db2, "SELECT COUNT(*) AS n FROM news WHERE title = 'A nova divisão exige a Licença A'"), 1);
  assert.equal(getCareerState(db2).clubId, tier2.id);
  db2.close();
});

test('Histórico: temporada gravada na virada e na demissão; jogos derivados das partidas; save antigo recupera as temporadas', async () => {
  const db = await setup(tier2.id, 30);
  db.prepare('UPDATE board_state SET confidence = 95').run();
  const club = getCareerState(db).clubId;
  const rep0 = repOf(db);
  for (let i = 0; i < 80 && n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  advanceTime(db, 'nextMatchday');
  startNextSeason(db);
  const row = db.prepare('SELECT * FROM coach_seasons WHERE club_id = ?').get(club)!;
  assert.equal(String(row.end_reason), getCareerState(db).clubId ? 'season' : 'sacked');
  assert.equal(Number(row.reputation_start), rep0);
  assert.equal(Number(row.reputation_end), repOf(db));
  assert.ok(row.objective_met === 0 || row.objective_met === 1);
  const played = n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played' AND (home_club_id = ? OR away_club_id = ?) AND match_date BETWEEN ? AND ?", club, club, String(row.start_date), String(row.end_date));
  let career = getCoachCareer(db);
  const done = career.seasons.find((s) => s.endReason !== 'current')!;
  assert.ok(played > 0);
  assert.equal(done.played, played);
  assert.equal(done.won + done.drawn + done.lost, done.played);
  assert.equal(career.totals.played, career.seasons.reduce((s, x) => s + x.played, 0));
  assert.equal(career.employedSeasons, 1);
  // demissão no meio da temporada nova: linha parcial com motivo
  if (getCareerState(db).clubId) {
    for (let i = 0; i < 3; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
    const season = getCareerState(db).season;
    withTransaction(db, () => fireCoach(db, getCareerState(db).gameDate, 'teste'));
    const part = db.prepare('SELECT end_reason, reputation_end FROM coach_seasons WHERE club_id = ? AND season = ?').get(club, season)!;
    assert.equal(String(part.end_reason), 'sacked');
    assert.equal(Number(part.reputation_end), repOf(db), 'já com a perda de reputação da demissão');
    career = getCoachCareer(db);
    assert.equal(career.seasons[0]!.endReason, 'sacked');
    assert.equal(career.seasons.find((s) => s.season === Number(row.season))!.played, played, 'jogos da temporada nova não entram na anterior');
    assert.equal(career.coach.clubId, null);
  }
  // save antigo: sem coach_seasons, recupera pelas passagens e resultados de liga
  db.exec("DELETE FROM coach_seasons; DELETE FROM meta WHERE key = 'coach_seasons_backfill';");
  backfillCoachSeasons(db);
  const back = db.prepare('SELECT season, position, reputation_start FROM coach_seasons WHERE club_id = ?').all(club);
  assert.ok(back.length >= 1);
  assert.equal(back[0]!.reputation_start, null, 'reputação desconhecida');
  db.close();
});

test('Linha da temporada: avaliação seguida de demissão troca o motivo; nova avaliação não desfaz a demissão', async () => {
  const db = await setup(tier2.id, 30);
  const date = getCareerState(db).gameDate;
  const base = { position: 4, competitionId: null, objectiveLabel: 'Meio da tabela', confidence: 40 };
  withTransaction(db, () => recordCoachSeason(db, { ...base, date, reason: 'season', met: false }));
  withTransaction(db, () => recordCoachSeason(db, { ...base, date, reason: 'sacked', met: null, position: null }));
  let r = db.prepare('SELECT end_reason, objective_met, position FROM coach_seasons').all();
  assert.equal(r.length, 1);
  assert.deepEqual([String(r[0]!.end_reason), Number(r[0]!.objective_met), Number(r[0]!.position)], ['sacked', 0, 4], 'motivo trocado; avaliação e posição mantidas');
  withTransaction(db, () => recordCoachSeason(db, { ...base, date, reason: 'season', met: true }));
  r = db.prepare('SELECT end_reason FROM coach_seasons').all();
  assert.equal(String(r[0]!.end_reason), 'sacked');
  db.close();
});
