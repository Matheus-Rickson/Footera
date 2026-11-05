import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState, getCompetitionTable, listCompetitions } from '../database/repositories/competitionRepository.ts';
import { getMatchReport, previewUserMatch, simulateMatchday } from '../database/repositories/matchRepository.ts';
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
  const myLeague = String(db.prepare('SELECT league_id AS l FROM clubs WHERE id = ?').get(clubId)!.l);
  assert.equal(t.competition.leagueId, myLeague, 'a competição informa a liga (logo da liga)');
  assert.equal(listCompetitions(db).competitions.find((c) => c.id === comp)!.leagueId, myLeague);
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

test('Relatório: linha do tempo minuto a minuto só nas partidas do usuário; força só dos jogadores do usuário; condição gravada = última foto', async () => {
  const { db, clubId } = await setup();
  toFirstMatchday(db);
  const s = simulateMatchday(db);
  const mine = getMatchReport(db, s.userMatch!.fixtureId);
  assert.ok(mine.timeline && mine.timeline.length >= 91, 'partida do usuário tem a linha do tempo');
  const other = s.results.find((r) => !r.involvesUser)!;
  assert.equal(getMatchReport(db, other.fixtureId).timeline, null, 'outras partidas não guardam (relatório resumido)');
  const myIds = new Set(db.prepare('SELECT id FROM players WHERE club_id = ?').all(clubId).map((r) => String(r.id)));
  assert.ok(Object.keys(mine.levels).length >= 11 && Object.keys(mine.levels).every((id) => myIds.has(id)), 'força só do próprio clube');
  const side = mine.home.clubId === clubId ? 0 : 1;
  const last = mine.timeline!.at(-1)!;
  mine.players.filter((p) => p.team === side).forEach((p, j) => {
    const cond = Number(db.prepare('SELECT condition_pct AS c FROM players WHERE id = ?').get(p.id)!.c);
    assert.equal(last.p[side][2 * j + 1], Math.round(cond * 10), `condição gravada de ${p.name}`);
  });
});

test('Ao vivo: placar, eventos, jogadores em campo e estatísticas em cada minuto batem com o relatório; sem linha do tempo, só eventos', async () => {
  const { liveAt, ticksOf } = await import('../renderer/matchLive.ts');
  const { db } = await setup(8, 'live-test');
  let checked = 0;
  for (let round = 0; round < 4; round++) {
    advanceTime(db, 'nextMatchday');
    const s = simulateMatchday(db);
    const r = getMatchReport(db, s.userMatch!.fixtureId);
    const ticks = ticksOf(r);
    assert.equal(ticks, r.timeline);
    const start = liveAt(r, ticks, 0);
    assert.deepEqual([start.score, start.lines.length, start.started], [[0, 0], 0, false]);
    assert.ok(start.teams.every((t) => t.onPitch.length === 11 && t.onPitch.every((p) => p.rating === null)));
    let prevShots = [0, 0];
    for (let k = 1; k <= ticks.length; k++) {
      const st = liveAt(r, ticks, k);
      const goals = [0, 1].map((t) => st.lines.filter((l) => l.kind === 'goal' && l.team === t).length);
      assert.deepEqual(st.score, st.finished ? [r.homeGoals, r.awayGoals] : goals);
      for (const t of [0, 1] as const) {
        const tm = st.teams[t];
        const removed = st.lines.filter((l) => l.team === t && (l.type === 'red_card' || (l.type === 'injury' && !r.commentary.some((x) => x.type === 'substitution' && x.player2 === l.player && x.i === l.i + 1)))).length;
        assert.equal(tm.onPitch.length, 11 - removed, `jogadores em campo (${k})`);
        assert.equal(new Set(tm.onPitch.map((p) => p.id)).size, tm.onPitch.length);
        const out = new Set(st.lines.filter((l) => l.team === t && l.type === 'substitution').map((l) => l.player2));
        const inn = st.lines.filter((l) => l.team === t && l.type === 'substitution').map((l) => l.player);
        assert.ok(tm.onPitch.every((p) => !out.has(p.id)), 'substituído não continua em campo');
        assert.ok(inn.every((id) => tm.onPitch.some((p) => p.id === id) || tm.gone.some((p) => p.id === id)), 'quem entrou aparece');
        assert.ok(tm.onPitch.every((p) => p.rating !== null && p.rating >= 3 && p.rating <= 10 && p.condition !== null));
        assert.ok(st.stats![t].shots >= prevShots[t]!); prevShots[t] = st.stats![t].shots;
      }
      checked++;
    }
    const end = liveAt(r, ticks, ticks.length);
    assert.equal(end.finished, true); assert.deepEqual(end.stats, r.stats); assert.equal(end.lines.length, r.commentary.length);
    for (const t of [0, 1] as const) for (const p of [...end.teams[t].onPitch, ...end.teams[t].gone]) assert.equal(p.rating, r.players.find((x) => x.id === p.id)!.rating);
    const subsOut = r.commentary.filter((l) => l.type === 'substitution').map((l) => l.player2);
    assert.ok(subsOut.every((id) => [...end.teams[0].gone, ...end.teams[1].gone].some((p) => p.id === id && p.subOut)), 'substituídos aparecem como "saíram"');
    // relatório antigo (sem linha do tempo): um passo por minuto, sem notas nem estatísticas parciais
    const old = { ...r, timeline: null };
    const ot = ticksOf(old);
    assert.equal(ot.length, r.decidedIn === 'regular' ? 90 : 120);
    const mid = liveAt(old, ot, 60);
    assert.equal(mid.stats, null); assert.ok(mid.teams[0].onPitch.every((p) => p.rating === null));
    assert.ok(mid.lines.every((l) => l.minute <= 60));
    assert.deepEqual(liveAt(old, ot, ot.length).score, [r.homeGoals, r.awayGoals]);
  }
  assert.ok(checked > 300);
  // lesão sem substituto (sem trocas restantes) e expulsão tiram o jogador de campo
  const r = getMatchReport(db, simulateMatchday(db).userMatch?.fixtureId ?? db.prepare("SELECT fixture_id AS f FROM matches WHERE detail = 'full' LIMIT 1").get()!.f as string);
  const subbed = new Set(r.commentary.filter((l) => l.type === 'substitution').map((l) => l.player2));
  const [hurt, sent] = r.players.filter((p) => p.team === 0 && p.starter && !subbed.has(p.id) && p.slot !== 'GK').map((p) => p.id);
  const extra = [
    { i: 100000, minute: 88, label: "88'", text: 'lesão', team: 0 as const, kind: 'injury' as const, major: true, type: 'injury' as const, player: hurt },
    { i: 100001, minute: 89, label: "89'", text: 'vermelho', team: 0 as const, kind: 'card' as const, major: true, type: 'red_card' as const, player: sent },
  ];
  const r2 = { ...r, commentary: [...r.commentary, ...extra] };
  const end2 = liveAt(r2, ticksOf(r2), ticksOf(r2).length);
  const base = liveAt(r, ticksOf(r), ticksOf(r).length).teams[0].onPitch.length;
  assert.equal(end2.teams[0].onPitch.length, base - 2);
  assert.ok(end2.teams[0].gone.some((p) => p.id === hurt && p.injured) && end2.teams[0].gone.some((p) => p.id === sent && p.red));
});

test('Ao vivo com o técnico: prévia não grava nada; a rodada gravada reproduz a prévia (subs + conversa); a conversa não fica no save', async () => {
  const { db, clubId } = await setup(8, 'live-coach');
  toFirstMatchday(db);
  const snap = () => JSON.stringify([n(db, 'SELECT COUNT(*) AS n FROM matches'), db.prepare('SELECT id, morale, condition_pct FROM players WHERE club_id = ? ORDER BY id').all(clubId), n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_ledger')]);
  const before = snap();
  const p0 = previewUserMatch(db, { interventions: [], controlUntil: null });
  assert.equal(snap(), before, 'prévia não grava');
  const r0 = p0.report, side = p0.side;
  assert.ok(r0.timeline && p0.bench.length > 0 && p0.subsMax === 5);
  assert.ok(!r0.commentary.some((l) => l.type === 'substitution' && l.team === side), 'sob controle do técnico, nenhuma troca automática');
  const H = r0.timeline!.findIndex((t) => t.ev > r0.commentary.find((l) => l.kind === 'period')!.i) + 1;
  const subbed = new Set(r0.commentary.filter((l) => l.team === side && (l.type === 'red_card' || l.type === 'injury')).map((l) => l.player));
  const outId = r0.lineups[side]!.slots.map((x) => x.playerId).find((id) => !subbed.has(id) && id !== r0.lineups[side]!.slots[0]!.playerId)!;
  const live = { interventions: [{ tick: H, kind: 'talk' as const, tone: 'cobrar' as const }, { tick: H, kind: 'sub' as const, out: outId, in: p0.bench[0]!.id }], controlUntil: null };
  const p1 = previewUserMatch(db, live);
  assert.deepEqual(p1.report.timeline!.slice(0, H), r0.timeline!.slice(0, H), '1º tempo igual');
  assert.ok(p1.report.commentary.some((l) => l.type === 'team_talk'));
  const moraleOf = () => new Map(db.prepare('SELECT id, morale FROM players WHERE club_id = ?').all(clubId).map((r) => [String(r.id), Number(r.morale)]));
  const m0 = moraleOf();
  const sum = simulateMatchday(db, live);
  const saved = getMatchReport(db, sum.userMatch!.fixtureId);
  const strip = (r: typeof saved) => ({ ...r, attendance: null });
  assert.deepEqual(strip(saved), strip(p1.report), 'o que foi visto ao vivo é exatamente o que fica gravado');
  const m1 = moraleOf(), mine = side === 0 ? saved.homeGoals - saved.awayGoals : saved.awayGoals - saved.homeGoals;
  const res = mine > 0 ? 3 : mine < 0 ? -3 : 0;
  assert.ok(Object.values(p1.morale).some((mo) => mo.delta !== 0), 'a conversa mexeu na moral durante o jogo');
  for (const id of Object.keys(p1.morale)) {
    const playedIt = saved.players.some((x) => x.id === id);
    // a conversa vale só nesta partida: depois do jogo, só o efeito do resultado
    assert.equal(m1.get(id), Math.max(10, Math.min(100, m0.get(id)! + (playedIt ? res : 0))), `moral de ${id}`);
  }
  // auxiliar assume no fim: controle só até o minuto escolhido (ex.: "ir para o fim" no minuto 30)
  const { db: db2 } = await setup(8, 'live-coach');
  toFirstMatchday(db2);
  const half = previewUserMatch(db2, { interventions: [], controlUntil: 30 });
  assert.deepEqual(half.report.timeline!.slice(0, 30), r0.timeline!.slice(0, 30));
  const sum2 = simulateMatchday(db2, { interventions: [], controlUntil: 30 });
  assert.deepEqual({ ...getMatchReport(db2, sum2.userMatch!.fixtureId), attendance: null }, { ...half.report, attendance: null });
});

test('Ao vivo: aceitar a sugestão com nova formação atualiza o campo e o rótulo da formação na tela; o gravado é igual ao visto', async () => {
  const { liveAt, ticksOf } = await import('../renderer/matchLive.ts');
  const { db } = await setup(8, 'live-reshape');
  let done = false;
  for (let round = 0; round < 12 && !done; round++) {
    advanceTime(db, 'nextMatchday');
    const p0 = previewUserMatch(db, { interventions: [], controlUntil: null });
    const sg = p0.suggestions.find((s) => s.reshape && s.reshape.to !== s.reshape.from);
    if (!sg) { simulateMatchday(db); continue; }
    const live = { interventions: [{ tick: sg.tick + 1, kind: 'sub' as const, out: sg.out, in: sg.in, slot: sg.slot, reshape: true }], controlUntil: null };
    const p1 = previewUserMatch(db, live);
    const r = p1.report, ticks = ticksOf(r);
    const before = liveAt(r, ticks, sg.tick + 1), after = liveAt(r, ticks, sg.tick + 2);
    assert.equal(before.teams[p1.side].formation, sg.reshape!.from);
    assert.equal(after.teams[p1.side].formation, sg.reshape!.to);
    const fc = r.commentary.find((l) => l.type === 'formation_change')!;
    for (const m of fc.moves!) {
      const pl = after.teams[p1.side].onPitch.find((x) => x.id === m.id);
      if (pl) assert.deepEqual([pl.slot, pl.x, pl.y], [m.slot, m.x, m.y], 'campo da tela na nova formação');
    }
    const sum = simulateMatchday(db, live);
    assert.deepEqual({ ...getMatchReport(db, sum.userMatch!.fixtureId), attendance: null }, { ...r, attendance: null });
    done = true;
  }
  assert.ok(done, 'encontrou uma sugestão com mudança de formação em 12 rodadas');
});
