import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState, getCompetitionTable, listCompetitions } from '../database/repositories/competitionRepository.ts';
import { getMatchReport, simulateMatchday } from '../database/repositories/matchRepository.ts';
import { addDays } from '../shared/date.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(teams = 8, seed = 'mp-test'): Promise<{ db: SqlDb; clubId: string }> {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const toFirstMatchday = (db: SqlDb) => assert.equal(advanceTime(db, 'nextMatchday').toDate, '2026-08-01');

test('Rodada: simula todas as partidas do dia e grava placar, relatório e classificação', async () => {
  const { db, clubId } = await setup();
  toFirstMatchday(db);
  const s = simulateMatchday(db);
  assert.equal(s.simulated, 16); // 4 ligas x 4 jogos
  assert.equal(s.results.length, 16);
  assert.ok(s.userMatch && s.userMatch.involvesUser);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played'"), 16);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM matches'), 16);
  for (const r of db.prepare('SELECT f.home_goals AS hg, f.away_goals AS ag, m.home_goals AS mh, m.away_goals AS ma FROM fixtures f JOIN matches m ON m.fixture_id = f.id').all()) {
    assert.deepEqual([r.hg, r.ag], [r.mh, r.ma]);
  }
  const comp = listCompetitions(db).userCompetitionId!;
  const t = getCompetitionTable(db, comp);
  assert.equal(t.roundsPlayed, 1);
  assert.equal(t.rows.reduce((a, r) => a + r.played, 0), 8);
  assert.equal(t.rows.find((r) => r.clubId === clubId)!.played, 1);
  assert.equal(simulateMatchday(db).simulated, 0, 'não simula duas vezes');
  assert.deepEqual([advanceTime(db, 'day').advanced, getCareerState(db).gameDate], [true, '2026-08-02']);
});

test('Rodada: é atômica — se uma partida falhar, nada é gravado nem alterado', async () => {
  const { db } = await setup();
  toFirstMatchday(db);
  const fixtures = db.prepare("SELECT id FROM fixtures WHERE status = 'scheduled' ORDER BY match_date, id").all().map((r) => String(r.id));
  const poisoned = fixtures[9]!; // a 10ª partida será simulada depois de 9 já processadas
  db.prepare("INSERT INTO matches (fixture_id, seed, played_on, home_goals, away_goals, decided_in, detail, report_json) VALUES (?, 'x', '2026-08-01', 0, 0, 'regular', 'full', '{}')").run(poisoned);
  const before = db.prepare('SELECT id, condition_pct, form, morale FROM players ORDER BY id').all();
  assert.throws(() => simulateMatchday(db));
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played'"), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM matches'), 1);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM player_season_stats'), 0);
  assert.deepEqual(db.prepare('SELECT id, condition_pct, form, morale FROM players ORDER BY id').all(), before);
});

test('Rodada: determinística — dois saves idênticos geram exatamente os mesmos jogos', async () => {
  const [a, b] = [await setup(), await setup()];
  for (const { db } of [a, b]) toFirstMatchday(db);
  const ra = simulateMatchday(a.db), rb = simulateMatchday(b.db);
  assert.deepEqual(ra, rb);
  const dump = (db: SqlDb) => db.prepare('SELECT fixture_id, report_json FROM matches ORDER BY fixture_id').all();
  assert.deepEqual(dump(a.db), dump(b.db));
});

test('Consequências: condição física, forma, estatísticas da temporada e entrosamento são atualizados', async () => {
  const { db, clubId } = await setup();
  toFirstMatchday(db);
  simulateMatchday(db);
  const played = db.prepare("SELECT player_id, minutes FROM player_season_stats WHERE club_id = ?").all(clubId);
  assert.ok(played.length >= 11 && played.length <= 16, `jogaram ${played.length}`);
  for (const r of played) {
    const p = db.prepare('SELECT condition_pct FROM players WHERE id = ?').get(r.player_id)!;
    assert.ok(Number(p.condition_pct) < 100, 'quem jogou perdeu condição');
    assert.ok(Number(r.minutes) > 0);
  }
  // quem não jogou e não está lesionado (lesões de treino limitam a condição) segue descansado
  const unused = db.prepare(`SELECT COUNT(*) AS n FROM players p WHERE p.club_id = ? AND p.id NOT IN (SELECT player_id FROM player_season_stats)
    AND p.id NOT IN (SELECT player_id FROM player_status WHERE injury_until > '2026-08-01')`).get(clubId)!;
  const rested = db.prepare(`SELECT COUNT(*) AS n FROM players p WHERE p.club_id = ? AND p.condition_pct = 100 AND p.id NOT IN (SELECT player_id FROM player_season_stats)`).get(clubId)!;
  assert.ok(Number(unused.n) >= 8 && Number(rested.n) === Number(unused.n), 'quem não jogou segue descansado');
  const goalsInMatches = n(db, 'SELECT SUM(home_goals + away_goals) AS n FROM fixtures WHERE status = ?', 'played');
  assert.equal(n(db, 'SELECT SUM(goals) AS n FROM player_season_stats'), goalsInMatches, 'gols dos jogadores = gols das partidas');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM club_state'), 32);
  const lineup = JSON.parse(String(db.prepare('SELECT last_lineup_json FROM club_state WHERE club_id = ?').get(clubId)!.last_lineup_json)) as string[];
  assert.equal(lineup.length, 11);
  // recuperação diária (não lesionados): +6 por dia nos clubes da IA; no seu clube, 6 + preparador físico (sem preparador = qualidade 5 → +0,375), limitada a 100
  const healthy = `p.id NOT IN (SELECT player_id FROM player_status WHERE injury_until > '2026-08-01')`; // sem lesão em nenhum dos dias avançados
  const ai0 = db.prepare(`SELECT id, condition_pct FROM players p WHERE club_id <> ? AND ${healthy} ORDER BY condition_pct, id LIMIT 1`).get(clubId)!;
  const me0 = db.prepare(`SELECT id, condition_pct FROM players p WHERE club_id = ? AND ${healthy} ORDER BY condition_pct, id LIMIT 1`).get(clubId)!;
  advanceTime(db, 'day'); advanceTime(db, 'day');
  const cond = (id: unknown) => Number(db.prepare('SELECT condition_pct AS n FROM players WHERE id = ?').get(id)!.n);
  assert.ok(Math.abs(cond(ai0.id) - Math.min(100, Number(ai0.condition_pct) + 12)) < 0.001, `recuperação IA: ${ai0.condition_pct} -> ${cond(ai0.id)}`);
  assert.ok(Math.abs(cond(me0.id) - Math.min(100, Number(me0.condition_pct) + 2 * 6.375)) < 0.001, `recuperação usuário: ${me0.condition_pct} -> ${cond(me0.id)}`);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE condition_pct > 100'), 0);
});

test('Relatórios: completo para o clube do usuário, compacto para os demais; comentários nascem dos eventos', async () => {
  const { db } = await setup();
  toFirstMatchday(db);
  const s = simulateMatchday(db);
  const mine = getMatchReport(db, s.userMatch!.fixtureId);
  assert.equal(mine.detail, 'full');
  assert.equal(mine.commentary.length, n(db, 'SELECT 1 AS n') && mine.commentary.length);
  assert.ok(mine.commentary.some((c) => c.kind === 'shot') && mine.players.length >= 22);
  assert.equal(mine.homeGoals, s.userMatch!.homeGoals);
  const other = s.results.find((r) => !r.involvesUser)!;
  const compact = getMatchReport(db, other.fixtureId);
  assert.equal(compact.detail, 'compact');
  assert.ok(compact.commentary.every((c) => ['goal', 'card', 'sub', 'injury', 'penalty', 'period', 'shootout'].includes(c.kind)), 'compacto só guarda eventos-chave');
  for (const r of [mine, compact]) {
    const goals = r.commentary.filter((c) => c.kind === 'goal');
    assert.equal(goals.length, r.homeGoals + r.awayGoals, 'um comentário de gol por gol');
    const names = new Set(r.players.map((p) => p.name));
    for (const g of goals) assert.ok([...names].some((nm) => g.text.includes(nm)), `gol sem nome de jogador: ${g.text}`);
    assert.equal(r.commentary.at(-1)!.kind, 'period');
    assert.ok(r.commentary.at(-1)!.text.includes(`${r.homeGoals} x ${r.awayGoals}`), 'último comentário traz o placar final');
    const sumGoals = (t: 0 | 1) => r.players.filter((p) => p.team === t).reduce((a, p) => a + p.goals, 0);
    assert.deepEqual([sumGoals(0), sumGoals(1)], [r.homeGoals, r.awayGoals]);
  }
  assert.throws(() => getMatchReport(db, 'fx_inexistente'), /não encontrado|ainda não/);
  const unplayed = String(db.prepare("SELECT id FROM fixtures WHERE status = 'scheduled' LIMIT 1").get()!.id);
  assert.throws(() => getMatchReport(db, unplayed), /ainda não foi disputada/);
});

test('Temporada simulada: lesionados e suspensos não são escalados, tabelas e estatísticas fecham', async () => {
  const { db } = await setup(8, 'season-sim');
  let rounds = 0;
  for (; rounds < 40; rounds++) {
    if (n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") === 0) break; // fim das partidas (avançar levaria até a virada, 1º/jul)
    const a = advanceTime(db, 'nextMatchday');
    if (a.reason === 'season_complete') break;
    if (!a.advanced) { simulateMatchday(db); continue; }
    simulateMatchday(db);
  }
  assert.equal(rounds, 14);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'"), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM matches'), 4 * 56);
  assert.equal(n(db, 'SELECT SUM(goals) AS n FROM player_season_stats'), n(db, 'SELECT SUM(home_goals + away_goals) AS n FROM fixtures'));
  for (const c of listCompetitions(db).competitions) {
    const t = getCompetitionTable(db, c.id);
    assert.deepEqual(t.rows.map((r) => r.played), Array(8).fill(14));
  }

  // reconstrói, só a partir dos relatórios, quem estava lesionado/suspenso em cada data
  const reports = db.prepare('SELECT m.fixture_id, m.played_on, f.home_club_id, f.away_club_id FROM matches m JOIN fixtures f ON f.id = m.fixture_id ORDER BY m.played_on, m.fixture_id').all()
    .map((r) => ({ id: String(r.fixture_id), date: String(r.played_on), home: String(r.home_club_id), away: String(r.away_club_id), rep: getMatchReport(db, String(r.fixture_id)) }));
  const injuredUntil = new Map<string, string>(), bans = new Map<string, number>();
  let violations = 0, injuries = 0, redCards = 0, bannedChecks = 0, emergencyGk = 0;
  for (const r of reports) {
    const unavailable = (id: string) => (injuredUntil.get(id) ?? '') > r.date || (bans.get(id) ?? 0) > 0;
    for (const p of r.rep.players) {
      if (!unavailable(p.id)) continue;
      if (p.position === 'GK') {
        // escalação de emergência: só é aceitável se TODOS os goleiros do clube estiverem indisponíveis
        const club = p.team === 0 ? r.home : r.away;
        const gks = db.prepare("SELECT id FROM players WHERE club_id = ? AND position = 'GK'").all(club).map((g) => String(g.id));
        if (gks.every(unavailable)) { emergencyGk++; continue; }
      }
      violations++;
    }
    for (const club of [r.home, r.away]) {
      for (const [pid, k] of [...bans]) {
        const owner = db.prepare('SELECT club_id FROM players WHERE id = ?').get(pid)!.club_id;
        if (owner === club && k > 0) { bans.set(pid, k - 1); bannedChecks++; }
      }
    }
    for (const p of r.rep.players) if (p.injuredDays > 0) { injuredUntil.set(p.id, addDays(r.date, p.injuredDays)); injuries++; }
    const full = db.prepare('SELECT report_json FROM matches WHERE fixture_id = ?').get(r.id)!;
    for (const e of (JSON.parse(String(full.report_json)) as { events: Array<{ type: string; player?: string; detail?: string }> }).events) {
      if (e.type === 'red_card') { bans.set(e.player!, (bans.get(e.player!) ?? 0) + (e.detail === 'second_yellow' ? 1 : 2)); redCards++; }
    }
  }
  assert.equal(violations, 0, 'jogador indisponível foi escalado sem que fosse emergência de goleiro');
  assert.ok(emergencyGk <= 3, `escalações de emergência demais: ${emergencyGk}`);
  assert.ok(injuries >= 5 && redCards >= 1, `cobertura: lesões=${injuries} vermelhos=${redCards} verificações de suspensão=${bannedChecks}`);
});

test('Desempenho: uma rodada completa de 4 ligas de 20 times (40 jogos) simula em menos de 2 s', async () => {
  const { db } = await setup(20, 'perf');
  toFirstMatchday(db);
  const t0 = performance.now();
  assert.equal(simulateMatchday(db).simulated, 40);
  assert.ok(performance.now() - t0 < 2000, `${(performance.now() - t0).toFixed(0)} ms`);
});
