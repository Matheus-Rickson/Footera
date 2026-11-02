import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { createRng } from '../game/rng.ts';
import {
  advanceTime, ensureSeason, getClubCalendar, getCareerState, getCompetitionTable, getNextFixture,
  listCompetitions, recordResult, ResultError,
} from '../database/repositories/competitionRepository.ts';
import { seasonOutcome } from '../game/competition-engine/standings.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };

async function setup(teams = 6, seed = 'season-test'): Promise<{ db: SqlDb; clubId: string }> {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  const clubId = world.clubs[0]!.id;
  createCareer(db, world, coach, clubId);
  return { db, clubId };
}
const count = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const allFixtures = (db: SqlDb) => db.prepare('SELECT id, match_date FROM fixtures ORDER BY match_date, id').all().map((r) => ({ id: String(r.id), date: String(r.match_date) }));

test('Temporada: criar carreira gera uma competição por liga e o calendário completo', async () => {
  const { db } = await setup(6);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM competitions'), 4);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM fixtures'), 4 * 6 * 5); // 6 times, turno e returno = 30 jogos por liga
  for (const r of db.prepare('SELECT home_club_id AS c, COUNT(*) AS n FROM fixtures GROUP BY home_club_id').all()) assert.equal(Number(r.n), 5);
  const cal = getClubCalendar(db);
  assert.equal(cal.fixtures.length, 10);
  assert.ok(cal.fixtures.every((f) => f.homeId === cal.clubId || f.awayId === cal.clubId));
  assert.ok(cal.fixtures.every((f, i, a) => i === 0 || a[i - 1]!.date <= f.date));
  assert.equal(cal.fixtures[0]!.date, '2026-08-01');
});

test('Temporada: ensureSeason é idempotente e recria deterministicamente um save sem calendário', async () => {
  const { db } = await setup(6);
  const before = db.prepare('SELECT id, round, match_date, home_club_id, away_club_id FROM fixtures ORDER BY id').all();
  assert.deepEqual(ensureSeason(db, 2026), { created: 0 });
  db.exec('DELETE FROM fixtures; DELETE FROM competitions;'); // simula save da Fase 2
  assert.deepEqual(ensureSeason(db, 2026), { created: 4 });
  assert.deepEqual(db.prepare('SELECT id, round, match_date, home_club_id, away_club_id FROM fixtures ORDER BY id').all(), before);
});

test('Banco: restrições impedem jogos inválidos', async () => {
  const { db } = await setup(6);
  const f = db.prepare('SELECT * FROM fixtures LIMIT 1').get()!;
  const ins = (id: string, round: number, home: string, away: string, status = 'scheduled', hg: number | null = null, ag: number | null = null) =>
    db.prepare('INSERT INTO fixtures (id, competition_id, round, match_date, home_club_id, away_club_id, status, home_goals, away_goals) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, f.competition_id, round, '2030-01-01', home, away, status, hg, ag);
  const [a, b] = [String(f.home_club_id), String(f.away_club_id)];
  assert.throws(() => ins('x1', 99, a, a), 'mandante = visitante');
  assert.throws(() => ins('x2', 99, a, b, 'played'), 'jogada sem placar');
  assert.throws(() => ins('x3', 99, a, b, 'scheduled', 1, 0), 'agendada com placar');
  assert.throws(() => ins('x4', 99, a, b, 'played', -1, 0), 'gols negativos');
  assert.throws(() => ins('x5', Number(f.round), a, b), 'mandante duplicado na mesma rodada');
  assert.throws(() => ins('x6', 99, a, 'clb_inexistente'), 'clube inexistente');
});

test('Resultados: gravar placar atualiza a tabela; inválidos e repetidos são rejeitados', async () => {
  const { db, clubId } = await setup(6);
  const comp = listCompetitions(db).userCompetitionId!;
  const fx = db.prepare("SELECT id, home_club_id AS h, away_club_id AS a FROM fixtures WHERE competition_id = ? ORDER BY round LIMIT 1").get(comp)!;
  recordResult(db, String(fx.id), 3, 1);
  const t = getCompetitionTable(db, comp);
  const home = t.rows.find((r) => r.clubId === fx.h)!, away = t.rows.find((r) => r.clubId === fx.a)!;
  assert.deepEqual([home.points, home.goalDiff, home.played, home.position], [3, 2, 1, 1]);
  assert.deepEqual([away.points, away.goalDiff, away.lost], [0, -2, 1]);
  assert.equal(t.rows.find((r) => r.isUserClub)!.clubId, clubId);
  assert.throws(() => recordResult(db, String(fx.id), 0, 0), /já foi disputada/);
  assert.throws(() => recordResult(db, 'nao-existe', 0, 0), ResultError);
  const other = db.prepare("SELECT id FROM fixtures WHERE status = 'scheduled' LIMIT 1").get()!;
  for (const [h, a] of [[-1, 0], [0, 1.5], [100, 0], [Number.NaN, 0]] as const) assert.throws(() => recordResult(db, String(other.id), h, a), /inválido/);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM fixtures WHERE id = ? AND status = 'scheduled'", String(other.id)), 1, 'nada gravado após erro');
});

test('Avanço do tempo: para em dias de jogos pendentes e retoma após os resultados', async () => {
  const { db } = await setup(6);
  assert.equal(getCareerState(db).gameDate, '2026-07-01');
  const d1 = advanceTime(db, 'day', new Date('2026-01-01T00:00:00Z'));
  assert.deepEqual([d1.advanced, d1.toDate, d1.daysAdvanced, d1.pendingMatches], [true, '2026-07-02', 1, 0]);
  const d2 = advanceTime(db, 'nextMatchday');
  assert.deepEqual([d2.advanced, d2.toDate, d2.daysAdvanced, d2.pendingMatches], [true, '2026-08-01', 30, 12]);
  for (const mode of ['day', 'nextMatchday'] as const) {
    const blocked = advanceTime(db, mode);
    assert.deepEqual([blocked.advanced, blocked.reason, blocked.pendingMatches, blocked.toDate], [false, 'pending_matches', 12, '2026-08-01']);
  }
  const round1 = allFixtures(db).filter((f) => f.date === '2026-08-01');
  assert.equal(round1.length, 12);
  for (const f of round1.slice(0, 11)) recordResult(db, f.id, 1, 0);
  assert.equal(advanceTime(db, 'day').pendingMatches, 1, 'uma partida pendente ainda bloqueia');
  recordResult(db, round1[11]!.id, 0, 0);
  assert.equal(advanceTime(db, 'nextMatchday').toDate, '2026-08-08');
  assert.equal(getCareerState(db).gameDate, '2026-08-08');
  assert.equal(getNextFixture(db)!.date, '2026-08-08');
  assert.equal(String(db.prepare('SELECT updated_at FROM career').get()!.updated_at).startsWith('20'), true);
});

test('Temporada completa: 4 ligas jogadas com resultados aleatórios ficam consistentes até o fim', async () => {
  const { db } = await setup(8, 'full-season');
  const rng = createRng('placares');
  let guard = 0;
  while (guard++ < 200) {
    const r = advanceTime(db, 'nextMatchday');
    if (r.reason === 'season_complete') break;
    if (!r.advanced) {
      for (const f of allFixtures(db).filter((x) => x.date <= getCareerState(db).gameDate)) {
        const st = db.prepare('SELECT status FROM fixtures WHERE id = ?').get(f.id)!;
        if (String(st.status) === 'scheduled') recordResult(db, f.id, rng.int(0, 4), rng.int(0, 3));
      }
    }
  }
  assert.ok(guard < 200, 'terminou');
  assert.equal(advanceTime(db, 'day').reason, 'season_complete');
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM competitions WHERE status <> 'finished'"), 0);
  assert.equal(getCareerState(db).gameDate, '2026-10-31', '14 rodadas: 1º/ago + 13 semanas');
  for (const c of listCompetitions(db).competitions) {
    const t = getCompetitionTable(db, c.id);
    assert.equal(t.roundsPlayed, t.totalRounds);
    assert.equal(t.totalRounds, 14);
    for (const row of t.rows) {
      assert.equal(row.played, 14);
      assert.equal(row.won + row.drawn + row.lost, 14);
      assert.equal(row.points, row.won * 3 + row.drawn);
    }
    const played = count(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?", c.id);
    assert.equal(played, 8 * 7);
    assert.equal(t.rows.reduce((s, r) => s + r.goalsFor, 0), t.rows.reduce((s, r) => s + r.goalsAgainst, 0));
    assert.deepEqual(t.rows.map((r) => r.position), [1, 2, 3, 4, 5, 6, 7, 8]);
  }
});

test('Competições: zonas de promoção, vaga continental e rebaixamento seguem as regras da liga (20 times)', async () => {
  const { db } = await setup(20, 'zones');
  const { competitions } = listCompetitions(db);
  assert.equal(competitions.length, 4);
  const zones = (name: string) => getCompetitionTable(db, competitions.find((c) => c.name.startsWith(name))!.id).rows.map((r) => r.zone);
  const serieA = zones('Série A');
  assert.deepEqual([...new Set(serieA.slice(0, 7))], ['continental']);
  assert.deepEqual([...new Set(serieA.slice(7, 16))], [null]);
  assert.deepEqual([...new Set(serieA.slice(16))], ['relegation']);
  const serieB = zones('Série B');
  assert.deepEqual([...new Set(serieB.slice(0, 4))], ['promotion']);
  assert.deepEqual([...new Set(serieB.slice(4, 16))], [null]);
  assert.deepEqual([...new Set(serieB.slice(16))], ['relegation']);
  assert.equal(zones('Premier').filter((z) => z === 'relegation').length, 3);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM fixtures'), 4 * 380);
  const t = getCompetitionTable(db, competitions[0]!.id);
  assert.equal(seasonOutcome(t.rows.map((r) => ({ teamId: r.clubId, position: r.position, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 })), { promotionSlots: 0, relegationSlots: 4, continentalSlots: 7 }).relegated.length, 4);
});

test('Avanço do tempo: partidas atrasadas (data anterior à de hoje) também bloqueiam o avanço', async () => {
  const { db } = await setup(6);
  db.prepare('UPDATE career SET game_date = ? WHERE id = 1').run('2026-09-01'); // simula data adiantada com jogos não disputados
  const r = advanceTime(db, 'day');
  assert.deepEqual([r.advanced, r.reason, r.pendingMatches, r.toDate], [false, 'pending_matches', 5 * 12, '2026-09-01']); // rodadas de 1, 8, 15, 22 e 29/ago
  assert.equal(getCareerState(db).gameDate, '2026-09-01', 'a data não pode mudar quando bloqueado');
});
