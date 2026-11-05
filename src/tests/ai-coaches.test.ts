import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../game/rng.ts';
import { aiCoachSeasonDelta, generateAiCoach, pickReplacement } from '../game/coach-engine/coach.ts';
import { COUNTRY_TEMPLATES } from '../game/world/names.ts';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { aiCoachOf, dismissAiCoach, ensureAiCoaches, getAiCoachDetail, getClubInfo, hireAiCoach, listUnemployedCoaches } from '../database/repositories/aiCoachRepository.ts';
import { listClubs } from '../services/worldService.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { processSocialDay } from '../database/repositories/socialRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import { addDays } from '../shared/date.ts';

test('Técnicos da IA (regras): gerados perto da reputação do clube, reputação na virada, escolha do substituto na faixa certa', () => {
  const t = COUNTRY_TEMPLATES[0]!;
  const reps: number[] = [], attrs: number[] = [];
  for (let i = 0; i < 300; i++) {
    const c = generateAiCoach(createRng(`g${i}`), t, 70, '2026-07-01');
    reps.push(c.reputation); attrs.push(...Object.values(c.attributes));
    assert.ok(Object.values(c.attributes).every((v) => Number.isInteger(v) && v >= 1 && v <= 20));
    const age = 2026 - Number(c.birthDate.slice(0, 4)); assert.ok(age >= 35 && age <= 68);
  }
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(avg(reps) - 70) < 2, `reputação média ${avg(reps)}`);
  assert.ok(avg(attrs) > 7 && avg(attrs) < 10, `atributo médio ${avg(attrs)} (perto do técnico do usuário)`);
  assert.ok(avg(Array.from({ length: 300 }, (_, i) => Object.values(generateAiCoach(createRng(`h${i}`), t, 20, '2026-07-01').attributes)).flat()) < avg(attrs), 'clube grande, técnico melhor');
  assert.deepEqual([aiCoachSeasonDelta({ expected: 10, position: 2, champion: false, relegated: false }), aiCoachSeasonDelta({ expected: 3, position: 1, champion: true, relegated: false }), aiCoachSeasonDelta({ expected: 5, position: 18, champion: false, relegated: true })], [6, 7, -10]);
  const pool = [{ id: 'a', reputation: 20 }, { id: 'b', reputation: 55 }, { id: 'c', reputation: 95 }];
  for (let i = 0; i < 50; i++) assert.equal(pickReplacement(createRng(`p${i}`), 60, pool)?.id, 'b', 'só a faixa de −25 a +15');
  assert.equal(pickReplacement(createRng('x'), 60, [{ id: 'a', reputation: 10 }]), null);
});

const coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' as const, reputation: 20, photoPath: null };
async function career(seed: string) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 6 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return db;
}
/** Invariantes: cada clube (menos o do usuário) tem no máximo um técnico; quem não tem está com vaga aberta; passagens abertas batem com o clube atual. */
function assertConsistent(db: SqlDb) {
  const st = getCareerState(db);
  for (const r of db.prepare('SELECT c.id, (SELECT COUNT(*) FROM ai_coaches a WHERE a.club_id = c.id) AS n, (SELECT COUNT(*) FROM job_vacancies v WHERE v.club_id = c.id) AS v FROM clubs c').all()) {
    const id = String(r.id), n = Number(r.n), v = Number(r.v);
    if (id === st.clubId) { assert.equal(n, 0, 'o clube do usuário não tem técnico da IA'); continue; }
    assert.ok(n <= 1, `${id}: um técnico no máximo`);
    if (n === 0) assert.equal(v, 1, `${id}: sem técnico, vaga aberta`);
  }
  for (const a of db.prepare('SELECT id, club_id, retired, (SELECT COUNT(*) FROM ai_coach_spells s WHERE s.coach_id = a.id AND s.end_date IS NULL) AS open, (SELECT club_id FROM ai_coach_spells s WHERE s.coach_id = a.id AND s.end_date IS NULL) AS spell FROM ai_coaches a').all()) {
    assert.equal(Number(a.open), a.club_id == null ? 0 : 1, `${String(a.id)}: passagem aberta só com clube`);
    if (a.club_id != null) assert.equal(String(a.spell), String(a.club_id));
    if (Number(a.retired)) assert.equal(a.club_id, null);
  }
}

test('Técnicos da IA na carreira: um por clube e mercado; demissão abre vaga, contratação a fecha; chegada do usuário substitui; consistente após uma temporada e a virada', async () => {
  const db = await career('aic-a');
  const st = getCareerState(db);
  const clubs = Number(db.prepare('SELECT COUNT(*) AS n FROM clubs').get()!.n);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM ai_coaches WHERE club_id IS NOT NULL').get()!.n), clubs - 1);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM ai_coaches WHERE club_id IS NULL').get()!.n), Math.ceil(clubs * 0.15) + 1, 'mercado + o técnico que o usuário substituiu');
  assert.equal(aiCoachOf(db, st.clubId), null);
  const before = JSON.stringify(db.prepare('SELECT * FROM ai_coaches ORDER BY id').all());
  ensureAiCoaches(db);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM ai_coaches ORDER BY id').all()), before, 'idempotente');
  assertConsistent(db);

  // demissão → vaga; contratação → técnico novo; posts na rede social com o nome
  const other = String(db.prepare('SELECT id FROM clubs WHERE id <> ? AND league_id = (SELECT league_id FROM clubs WHERE id = ?) ORDER BY id LIMIT 1').get(st.clubId, st.clubId)!.id);
  const old = aiCoachOf(db, other)!;
  const d = st.gameDate;
  withTransaction(db, () => { db.prepare('INSERT INTO job_vacancies (club_id, opened_on) VALUES (?, ?)').run(other, d); dismissAiCoach(db, other, d, 'sacked'); });
  assert.equal(aiCoachOf(db, other), null);
  assert.equal(Number(db.prepare('SELECT reputation FROM ai_coaches WHERE id = ?').get(old.id)!.reputation), old.reputation - 4, 'demitido perde reputação');
  withTransaction(db, () => processSocialDay(db, addDays(d, 1)));
  assert.ok(db.prepare("SELECT text FROM social_posts WHERE kind = 'sacking'").all().some((r) => String(r.text).includes(old.name)), 'imprensa cita o técnico demitido');
  const hired = withTransaction(db, () => { const id = hireAiCoach(db, other, addDays(d, 1)); db.prepare('DELETE FROM job_vacancies WHERE club_id = ?').run(other); return id; });
  assert.notEqual(hired, old.id);
  const now = aiCoachOf(db, other)!;
  withTransaction(db, () => processSocialDay(db, addDays(d, 2)));
  assert.ok(db.prepare("SELECT p.text FROM social_posts p JOIN social_accounts a ON a.id = p.account_id WHERE p.kind = 'coach' AND a.kind = 'club'").all().some((r) => String(r.text).includes(now.name)), 'perfil do clube anuncia o novo técnico');
  assertConsistent(db);

  // ficha do clube (Competições), do técnico e lista de técnicos sem clube (Comissão técnica)
  const mine = getClubInfo(db, st.clubId);
  assert.ok(mine.isUserClub && mine.coach === null && mine.userCoach === 'Ana Silva');
  assert.equal(mine.squad.length, Number(db.prepare('SELECT COUNT(*) AS n FROM players WHERE club_id = ?').get(st.clubId)!.n));
  assert.ok(mine.squad.every((p) => !('overall' in p)), 'ficha do clube sem força dos jogadores');
  const theirs = getClubInfo(db, other);
  assert.equal(theirs.coach?.id, now.id); assert.equal(theirs.coach?.clubName, theirs.name);
  const det = getAiCoachDetail(db, old.id);
  assert.equal(det.clubId, null);
  assert.deepEqual(det.spells.map((s) => [s.clubId, s.end, s.reason]), [[other, d, 'sacked']], 'passagem encerrada por demissão');
  assert.ok(Object.values(det.attributes).every((v) => v >= 1 && v <= 20));
  assert.equal(getAiCoachDetail(db, now.id).spells[0]!.end, null, 'passagem atual em aberto');
  const free = listUnemployedCoaches(db);
  assert.ok(free.some((c) => c.id === old.id) && free.every((c) => c.clubId === null) && !free.some((c) => c.id === now.id));
  assert.deepEqual(free.map((c) => c.reputation), [...free.map((c) => c.reputation)].sort((a, b) => b - a), 'por reputação');
  assert.throws(() => getClubInfo(db, 'nao-existe'), /Clube não encontrado/);

  // temporada inteira e virada: reputação muda, tudo segue consistente
  for (let i = 0; i < 80 && Number(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'").get()!.n) > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  advanceTime(db, 'nextMatchday');
  const repBefore = new Map(db.prepare('SELECT id, reputation FROM ai_coaches').all().map((r) => [String(r.id), Number(r.reputation)]));
  startNextSeason(db);
  const changed = db.prepare('SELECT id, reputation FROM ai_coaches').all().filter((r) => repBefore.has(String(r.id)) && repBefore.get(String(r.id)) !== Number(r.reputation)).length;
  assert.ok(changed > clubs / 3, `reputação mudou para ${changed} técnicos`);
  assertConsistent(db);
});

test('Técnicos do universo: iguais em toda carreira (independem da semente da carreira) e iguais aos da tela de nova carreira; o do clube do usuário fica sem clube', async () => {
  const world = generateWorld({ seed: 'aic-u', teamsPerLeagueOverride: 6 });
  const make = async (seed: string, clubId: string) => { const db = await openDatabase(':memory:'); createCareer(db, { ...world, seed }, coach, clubId); return db; };
  const a = await make('carreira-1', world.clubs[0]!.id), b = await make('carreira-2', world.clubs[0]!.id);
  const dump = (db: SqlDb) => JSON.stringify(db.prepare('SELECT * FROM ai_coaches ORDER BY id').all());
  assert.equal(dump(a), dump(b), 'mesma base → mesmos técnicos');
  const list = listClubs(world);
  for (const c of world.clubs.slice(1)) {
    const k = getClubInfo(a, c.id).coach!, shown = list.clubs.find((x) => x.id === c.id)!.coach!;
    assert.deepEqual([k.name, k.reputation, k.age, k.nationality], [shown.name, shown.reputation, shown.age, shown.nationality], `${c.id}: tela de nova carreira = jogo`);
  }
  // escolhendo outro clube, o técnico mostrado para ele é quem fica sem clube
  const pick = world.clubs[1]!;
  const c = await make('carreira-3', pick.id);
  const was = list.clubs.find((x) => x.id === pick.id)!.coach!;
  assert.equal(getClubInfo(c, pick.id).coach, null);
  assert.ok(listUnemployedCoaches(c).some((x) => x.name === was.name && x.reputation === was.reputation), 'substituído pelo usuário, fica sem clube');
  assert.equal(getClubInfo(c, world.clubs[0]!.id).coach?.name, list.clubs[0]!.coach!.name);
});

test('Técnicos da IA: determinísticos pela semente; a chegada do usuário a um clube que ainda tinha técnico o substitui', async () => {
  const dump = async () => JSON.stringify((await career('aic-b')).prepare('SELECT * FROM ai_coaches ORDER BY id').all());
  assert.equal(await dump(), await dump());
  const db = await career('aic-c');
  const { respondJobOffer } = await import('../database/repositories/boardRepository.ts');
  const target = String(db.prepare('SELECT id FROM clubs WHERE id <> ? ORDER BY reputation LIMIT 1').get(getCareerState(db).clubId)!.id);
  assert.ok(aiCoachOf(db, target));
  const d = getCareerState(db).gameDate;
  db.prepare('INSERT INTO job_offers (club_id, date, expires) VALUES (?, ?, ?)').run(target, d, addDays(d, 10));
  respondJobOffer(db, Number(db.prepare('SELECT id FROM job_offers').get()!.id), true);
  assert.equal(getCareerState(db).clubId, target);
  assert.equal(aiCoachOf(db, target), null, 'o técnico de lá saiu');
  assert.equal(String(db.prepare('SELECT end_reason FROM ai_coach_spells WHERE club_id = ? ORDER BY id DESC LIMIT 1').get(target)!.end_reason), 'replaced');
  assertConsistent(db);
});

test('Técnicos da IA na partida: tática e disciplina deles valem (mesma semente, técnicos no máximo × na base dão rodadas diferentes)', async () => {
  const round = async (attr: number) => {
    const db = await career('aic-m');
    db.prepare('UPDATE ai_coaches SET attributes_json = ?').run(JSON.stringify({ tactics: attr, motivation: attr, youth: attr, discipline: attr, negotiation: attr, adaptability: attr }));
    advanceTime(db, 'nextMatchday'); simulateMatchday(db);
    const user = getCareerState(db).clubId;
    return db.prepare('SELECT f.id, m.report_json FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.home_club_id <> ? AND f.away_club_id <> ? ORDER BY f.id').all(user, user)
      .map((r) => { const x = JSON.parse(String(r.report_json)); return [x.homeGoals, x.awayGoals, x.stats[0].yellowCards, x.stats[1].yellowCards].join('-'); });
  };
  const base = await round(5), top = await round(20);
  assert.deepEqual(await round(5), base, 'determinístico');
  assert.notDeepEqual(top, base, 'técnicos fortes mudam as partidas da IA');
});
