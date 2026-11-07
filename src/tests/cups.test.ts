import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../game/rng.ts';
import { CUP_FORMATS, cupFormatFor } from '../game/cup-engine/formats.ts';
import { cupDates, cupPrizes, drawPairs, entryStages, hostOf, planByes, rankCupClubs, type CupClub } from '../game/cup-engine/bracket.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState, getClubCalendar } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { applyCupCards, cupStateOf, getCupBracket } from '../database/repositories/cupRepository.ts';
import { loadSquad } from '../database/repositories/squadRepository.ts';
import { migrate, MIGRATIONS } from '../database/migrator.ts';
import { saveWorld } from '../database/repositories/worldRepository.ts';
import type { SqlDb } from '../database/types.ts';
import { addDays } from '../shared/date.ts';

const coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' as const, reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);

test('Formatos com a base real: as contas fecham com as folgas declaradas (tabelas aprovadas no PDF revisado), datas válidas, México e Rússia sem copa', () => {
  const w = baseUniverse().world;
  const expected: Record<string, number[]> = {
    BRA: [40, 40, 20, 32, 16, 8, 4, 2], ENG: [40, 60, 32, 16, 8, 4, 2], ESP: [56, 32, 16, 8, 4, 2], GER: [56, 32, 16, 8, 4, 2], ITA: [32, 16, 16, 8, 4, 2],
    FRA: [18, 32, 16, 8, 4, 2], POR: [18, 32, 16, 8, 4, 2], NED: [36, 32, 16, 8, 4, 2], ARG: [40, 32, 16, 8, 4, 2], BEL: [32, 16, 8, 4, 2],
    JPN: [36, 32, 16, 8, 4, 2], AUT: [28, 16, 8, 4, 2], IRL: [20, 16, 8, 4, 2], CRO: [12, 16, 8, 4, 2],
  };
  assert.equal(cupFormatFor('MEX'), null); assert.equal(cupFormatFor('RUS'), null);
  assert.deepEqual(CUP_FORMATS.map((f) => f.countryCode).sort(), Object.keys(expected).sort());
  for (const f of CUP_FORMATS) {
    const co = w.countries.find((c) => c.code === f.countryCode)!;
    const tierOf = new Map(w.leagues.map((l) => [l.id, l.tier]));
    const ranked = rankCupClubs(w.clubs.filter((c) => c.countryId === co.id).map((c) => ({ id: c.id, tier: tierOf.get(c.leagueId)!, prevPosition: null, reputation: c.reputation })));
    const entry = entryStages(f, ranked);
    assert.equal(entry.size, ranked.length, `${f.name}: todos os clubes do país entram`);
    const plan = planByes(f, f.stages.map((_, i) => [...entry.values()].filter((s) => s === i).length));
    assert.ok(plan.declared, `${f.name}: folgas declaradas fecham a conta`);
    assert.deepEqual(plan.pools, expected[f.countryCode], f.name);
    const dates = cupDates(f, 2026, new Set());
    const flat = dates.flat();
    assert.ok(flat.every((d, i) => i === 0 || d > flat[i - 1]!), `${f.name}: datas em ordem`);
    assert.ok(flat.every((d) => d > '2026-07-31' && d < '2027-07-01'), `${f.name}: dentro da temporada`);
    assert.ok(dates.slice(0, -1).flat().every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3), `${f.name}: fases às quartas-feiras`);
    // prêmio: o campeão que estreia com a 1ª divisão recebe o mesmo que o campeão da liga principal (economia × 2,4 mi)
    const top = Math.min(...ranked.filter((c) => c.tier === 1).map((c) => entry.get(c.id)!));
    const pz = cupPrizes(f, co.economy, top);
    const champ = pz.winner + pz.perStage.slice(top, -1).reduce((a, b) => a + b, 0) + pz.win.slice(top, -1).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(champ - co.economy * 2_400_000) < 20_000, `${f.name}: prêmio total do campeão ${champ}`);
  }
  // as datas fogem dos jogos da liga; a final também
  const f = cupFormatFor('BRA')!;
  const free = cupDates(f, 2026, new Set());
  const blocked = cupDates(f, 2026, new Set([free[0]![0]!, free.at(-1)![0]!]));
  assert.notEqual(blocked[0]![0], free[0]![0]); assert.equal(blocked.at(-1)![0], addDays(free.at(-1)![0]!, -1));
});

test('Chaveamento: folgas calculadas quando o número de clubes muda; sorteios (livre, cabeças, opostos, chave fixa) e mando pela regra', () => {
  const f = cupFormatFor('BRA')!;
  for (let a = 1; a <= 30; a++) for (const b of [0, 6, 20, 90]) {
    const entrants = f.stages.map((_, i) => (i === 3 ? a : i === 0 ? b : 0));
    if (a + b < 2) continue;
    const plan = planByes(f, entrants);
    const used = plan.entryAll === undefined ? entrants : entrants.map((_, i) => (i === plan.entryAll ? a + b : 0));
    let carry = 0;
    plan.pools.forEach((pool, i) => { assert.equal(pool, carry + used[i]!); carry = plan.byes[i]! + (pool - plan.byes[i]!) / 2; });
    assert.equal(carry, 1, `um campeão com ${a + b} clubes`);
  }
  const clubs: CupClub[] = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, tier: i < 4 ? 1 : 2, rank: i }));
  assert.deepEqual(drawPairs(createRng('x'), clubs, 'opposite').map(([x, y]) => [x.rank, y.rank]), [[0, 7], [1, 6], [2, 5], [3, 4]]);
  assert.deepEqual(drawPairs(createRng('x'), clubs, 'bracket').map(([x, y]) => [x.rank, y.rank]), [[0, 1], [2, 3], [4, 5], [6, 7]]);
  for (let k = 0; k < 20; k++) {
    const seeded = drawPairs(createRng(`s${k}`), clubs, 'seeded');
    assert.ok(seeded.every(([x, y]) => x.rank < 4 && y.rank >= 4), 'cabeças × demais');
    const open = drawPairs(createRng(`o${k}`), clubs, 'open');
    assert.deepEqual(open.flat().map((c) => c.id).sort(), clubs.map((c) => c.id).sort(), 'cada clube uma vez');
  }
  const [top, low] = [clubs[0]!, clubs[7]!], third = { id: 'x', tier: 3, rank: 9 };
  for (let k = 0; k < 10; k++) {
    assert.equal(hostOf(createRng(`h${k}`), top, low, 'lower').home.id, low.id, 'divisão inferior manda');
    assert.equal(hostOf(createRng(`h${k}`), top, top.id === 'c0' ? clubs[1]! : top, 'higher').home.id, 'c0', 'mais bem classificado manda');
    assert.equal(hostOf(createRng(`h${k}`), top, third, 'lower2').home.id, 'x', '2+ divisões abaixo manda');
    assert.ok(hostOf(createRng(`h${k}`), top, low, 'neutral').neutral);
  }
  const coin = new Set(Array.from({ length: 20 }, (_, k) => hostOf(createRng(`c${k}`), top, low, 'lower2').home.id));
  assert.equal(coin.size, 2, 'uma divisão de diferença na França: sorteio');
});

async function career(seed: string) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return db;
}
function playAll(db: SqlDb) {
  for (let i = 0; i < 300 && n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
}

test('Temporada com copas: cada fase conserva clubes, um campeão por copa, regra de desempate de cada fase respeitada, prêmios e troféu; determinístico', async () => {
  const db = await career('cups-a');
  const cups = db.prepare("SELECT id FROM competitions WHERE kind = 'cup'").all().map((r) => String(r.id));
  assert.equal(cups.length, 2);
  const initial = new Map(db.prepare('SELECT id, balance FROM clubs').all().map((r) => [String(r.id), Number(r.balance)]));
  playAll(db);
  for (const id of cups) {
    const state = cupStateOf(db, id);
    assert.equal(state.declaredByes, false, 'mundo de teste (2 divisões): folgas calculadas');
    const stages = state.format.stages.length;
    let alive = new Set<string>();
    for (let s = 0; s < stages; s++) {
      const ties = db.prepare('SELECT * FROM cup_ties WHERE competition_id = ? AND stage = ? ORDER BY slot').all(id, s);
      const inStage = ties.flatMap((t) => [String(t.club_a), ...(t.club_b == null ? [] : [String(t.club_b)])]);
      assert.equal(new Set(inStage).size, inStage.length, 'nenhum clube duas vezes na mesma fase');
      const entrants = Object.entries(state.entry).filter(([, st]) => st === s).map(([c]) => c);
      assert.deepEqual([...inStage].sort(), [...alive, ...entrants].sort(), `fase ${s}: sobreviventes + estreantes`);
      assert.ok(ties.every((t) => t.winner != null && (String(t.winner) === String(t.club_a) || String(t.winner) === String(t.club_b))));
      assert.equal(ties.filter((t) => t.club_b == null).length, state.byes[s] ?? 0, 'folgas do plano');
      // as folgas vão para os mais bem classificados da fase
      const rankOf = new Map(state.clubs.map((c) => [c.id, c.rank]));
      const byeRanks = ties.filter((t) => t.club_b == null).map((t) => rankOf.get(String(t.club_a))!);
      const playRanks = ties.filter((t) => t.club_b != null).flatMap((t) => [rankOf.get(String(t.club_a))!, rankOf.get(String(t.club_b))!]);
      if (byeRanks.length && playRanks.length) assert.ok(Math.max(...byeRanks) < Math.min(...playRanks), `fase ${s}: folga para os melhores`);
      alive = new Set(ties.map((t) => String(t.winner)));
      // regra de desempate da fase: pênaltis direto não têm prorrogação; volta decide pelo agregado
      const rule = state.format.stages[s]!.decider;
      for (const t of ties.filter((x) => x.club_b != null)) {
        if (!rule.extraTime) assert.notEqual(String(t.decided_in), 'extra_time', `fase ${s} sem prorrogação`);
        const games = db.prepare('SELECT home_club_id, home_goals, away_goals FROM fixtures WHERE tie_id = ? ORDER BY leg').all(String(t.id));
        assert.equal(games.length, state.format.stages[s]!.legs);
        const goals = (c: string) => games.reduce((acc, g) => acc + (String(g.home_club_id) === c ? Number(g.home_goals) : Number(g.away_goals)), 0);
        const [ga, gb] = [goals(String(t.club_a)), goals(String(t.club_b))];
        if (t.decided_in === 'penalties') assert.equal(ga, gb, 'pênaltis só com o placar (ou agregado) empatado');
        else assert.equal(String(t.winner), ga > gb ? String(t.club_a) : String(t.club_b), 'vence quem fez mais gols no confronto');
      }
    }
    assert.equal(alive.size, 1);
    const champ = [...alive][0]!;
    assert.equal(String(db.prepare('SELECT club_id FROM trophies WHERE competition_id = ?').get(id)!.club_id), champ);
    assert.equal(String(db.prepare('SELECT status FROM competitions WHERE id = ?').get(id)!.status), 'finished');
    const prize = n(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ? AND category = 'prize'", champ);
    assert.ok(prize >= state.prizes.winner, `campeão recebeu o prêmio (${prize})`);
    const b = getCupBracket(db, id);
    assert.equal(b.champion?.id, champ); assert.equal(b.stages.length, stages);
  }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE neutral = 1 AND tie_id IS NOT NULL') >= 2, true, 'finais em campo neutro');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.neutral = 1 AND m.gate_revenue IS NOT NULL'), 0, 'campo neutro: sem bilheteria para os clubes');
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.neutral = 0 AND f.tie_id IS NOT NULL AND m.gate_revenue IS NOT NULL') > 0, 'nos outros jogos de copa, o mandante tem bilheteria');
  // jogo de ida: o empate vale (sem prorrogação nem pênaltis)
  const idas = db.prepare('SELECT m.decided_in FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.leg = 1').all();
  assert.ok(idas.length > 0 && idas.every((r) => String(r.decided_in) === 'regular'), 'ida sem prorrogação nem pênaltis');
  // saldo = inicial + extrato, com os prêmios das copas (regra 1)
  const rows = db.prepare('SELECT c.id, c.balance, (SELECT COALESCE(SUM(amount),0) FROM finance_months f WHERE f.club_id = c.id) AS s FROM clubs c').all();
  assert.equal(rows.length, initial.size);
  for (const r of rows) assert.equal(Number(r.balance), initial.get(String(r.id))! + Number(r.s), `saldo de ${String(r.id)}`);
  // calendário: cada jogo de copa diz qual copa, fase e ida/volta; os de liga não
  const cal = getClubCalendar(db).fixtures;
  const cupGames = cal.filter((x) => x.competitionId.startsWith('cup_'));
  assert.ok(cupGames.length > 0, 'o clube do usuário jogou a copa');
  for (const g of cal) {
    if (!g.competitionId.startsWith('cup_')) { assert.equal(g.cup, null); continue; }
    const leg = db.prepare('SELECT f.leg, t.stage, f.competition_id FROM fixtures f JOIN cup_ties t ON t.id = f.tie_id WHERE f.id = ?').get(g.id)!;
    const st = cupStateOf(db, String(leg.competition_id));
    assert.deepEqual([g.cup?.name, g.cup?.stage, g.cup?.leg], [st.format.name, st.format.stages[Number(leg.stage)]!.name, leg.leg == null ? null : Number(leg.leg)]);
  }
  const again = await career('cups-a');
  playAll(again);
  const dump = (x: SqlDb) => JSON.stringify(x.prepare('SELECT * FROM cup_ties ORDER BY id').all());
  assert.equal(dump(again), dump(db), 'mesma semente, mesmas copas');
});

test('Cartões da copa: limite do regulamento, suspensão vale só na copa (a liga não vê) e a da liga não vale na copa', async () => {
  const db = await career('cups-cards');
  const cup = String(db.prepare("SELECT id FROM competitions WHERE kind = 'cup' LIMIT 1").get()!.id);
  const club = String(db.prepare('SELECT club_a FROM cup_ties WHERE competition_id = ? LIMIT 1').get(cup)!.club_a);
  const pid = String(db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 1').get(club)!.id);
  assert.deepEqual(applyCupCards(db, cup, pid, 1, 0, false, 3), { suspension: 0, byYellow: false });
  assert.deepEqual(applyCupCards(db, cup, pid, 2, 0, false, 3), { suspension: 1, byYellow: true }, '3º amarelo suspende');
  const cupSq = loadSquad(db, club, '2026-08-01', new Map([[pid, 1]]));
  assert.ok(!cupSq.available.some((p) => p.id === pid), 'suspenso na copa');
  assert.ok(loadSquad(db, club, '2026-08-01').available.some((p) => p.id === pid), 'disponível na liga');
  db.prepare("INSERT INTO player_status (player_id, suspension_matches, yellow_cards) VALUES (?, 2, 0) ON CONFLICT(player_id) DO UPDATE SET suspension_matches = 2").run(pid);
  assert.ok(loadSquad(db, club, '2026-08-01', new Map()).available.some((p) => p.id === pid), 'suspensão da liga não vale na copa');
  assert.deepEqual(applyCupCards(db, cup, pid, 0, 2, false, 3), { suspension: 3, byYellow: false }, 'vermelho direto soma 2');
  assert.deepEqual(applyCupCards(db, cup, pid, 0, 0, true, 3), { suspension: 2, byYellow: false }, 'cumpriu um jogo');
});

test('Migração 18 num save com dados: competições viram ligas com país, partidas e estatísticas preservadas, chaves estrangeiras íntegras; copas só se a 1ª fase não passou', async () => {
  const world = generateWorld({ seed: 'mig18', teamsPerLeagueOverride: 6 });
  const db = await openDatabase(':memory:');
  migrate(db, MIGRATIONS.filter((m) => m.version <= 17));
  saveWorld(db, world);
  db.prepare("INSERT INTO competitions (id, league_id, season, name) VALUES ('cmp_x', ?, 2026, 'Liga X')").run(world.leagues[0]!.id);
  const [h, a] = world.clubs.filter((c) => c.leagueId === world.leagues[0]!.id);
  db.prepare("INSERT INTO fixtures (id, competition_id, round, match_date, home_club_id, away_club_id, status, home_goals, away_goals) VALUES ('f1','cmp_x',1,'2026-08-01',?,?,'played',2,1)").run(h!.id, a!.id);
  db.prepare("INSERT INTO player_season_stats (player_id, competition_id, club_id) VALUES (?, 'cmp_x', ?)").run(world.players.find((p) => p.clubId === h!.id)!.id, h!.id);
  migrate(db);
  const c = db.prepare("SELECT kind, league_id, country_id FROM competitions WHERE id = 'cmp_x'").get()!;
  assert.deepEqual([String(c.kind), String(c.league_id), String(c.country_id)], ['league', world.leagues[0]!.id, world.leagues[0]!.countryId]);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = 'cmp_x' AND home_goals = 2"), 1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.throws(() => db.prepare("INSERT INTO competitions (id, kind, season, name) VALUES ('bad', 'cup', 2026, 'x')").run(), /CHECK/, 'copa precisa de país e formato');
  // save aberto depois da 1ª fase da copa: a copa desta temporada não é criada (só na próxima)
  const late = await career('cups-late');
  const { createCups } = await import('../database/repositories/cupRepository.ts');
  late.prepare("DELETE FROM fixtures WHERE tie_id IS NOT NULL").run(); late.prepare('DELETE FROM cup_ties').run(); late.prepare("DELETE FROM competitions WHERE kind = 'cup'").run();
  assert.equal(createCups(late, { notBefore: '2027-03-01' }), 0);
  assert.equal(createCups(late, { notBefore: getCareerState(late).gameDate }), 2);
});

test('Base real na criação da carreira: 14 copas sorteadas; folgas da 1ª fase para os mais bem classificados; mando e campo pela regra; jogos fora das datas da liga', async () => {
  const w = baseUniverse().world;
  // carreira de ano civil: copas dos países de julho (2025/26, já em andamento) e as do ano civil (2026) — as 14
  const civil = (cid: string) => w.countries.find((x) => x.id === cid)!.seasonStart === '01-01';
  const careers = [];
  for (const pick of [w.clubs.find((c) => civil(c.countryId))!]) {
    const db = await openDatabase(':memory:');
    createCareer(db, { ...w, seed: 'cups-base' }, coach, pick.id);
    careers.push(db);
  }
  const total = careers.reduce((s, db) => s + Number(db.prepare("SELECT COUNT(*) AS n FROM competitions WHERE kind = 'cup'").get()!.n), 0);
  assert.equal(total, 14);
  let checkedByes = 0, checkedLower = 0;
  for (const db of careers) {
  const cups = db.prepare("SELECT id, country_id FROM competitions WHERE kind = 'cup'").all();
  const leagueDates = new Set(db.prepare('SELECT DISTINCT match_date AS d FROM fixtures WHERE tie_id IS NULL').all().map((r) => String(r.d)));
  const tierOf = new Map(db.prepare('SELECT c.id, l.tier FROM clubs c JOIN leagues l ON l.id = c.league_id').all().map((r) => [String(r.id), Number(r.tier)]));
  for (const c of cups) {
    const id = String(c.id), state = cupStateOf(db, id);
    assert.ok(state.declaredByes, `${state.format.name}: plano aprovado`);
    const first = Math.min(...Object.values(state.entry));
    const ties = db.prepare('SELECT * FROM cup_ties WHERE competition_id = ? AND stage = ?').all(id, first);
    const rank = new Map(state.clubs.map((x) => [x.id, x.rank]));
    const byes = ties.filter((t) => t.club_b == null).map((t) => rank.get(String(t.club_a))!);
    const play = ties.filter((t) => t.club_b != null).flatMap((t) => [rank.get(String(t.club_a))!, rank.get(String(t.club_b))!]);
    assert.equal(byes.length, state.byes[first]);
    if (byes.length) { checkedByes++; assert.ok(Math.max(...byes) < Math.min(...play), `${state.format.name}: folgas para os melhores`); }
    const st = state.format.stages[first]!;
    for (const t of ties.filter((x) => x.club_b != null)) {
      const games = db.prepare('SELECT home_club_id, away_club_id, neutral, match_date FROM fixtures WHERE tie_id = ? ORDER BY leg').all(String(t.id));
      assert.ok(games.every((g) => !leagueDates.has(String(g.match_date))), 'não coincide com a liga');
      const decisive = games.at(-1)!;
      if (st.host === 'neutral') assert.equal(Number(decisive.neutral), 1);
      if (st.host === 'lower' && tierOf.get(String(t.club_a)) !== tierOf.get(String(t.club_b))) {
        checkedLower++;
        assert.ok(tierOf.get(String(decisive.home_club_id))! > tierOf.get(String(decisive.away_club_id))!, `${state.format.name}: divisão inferior manda`);
      }
    }
  }
  }
  assert.ok(checkedByes >= 6 && checkedLower > 0, `cobertura: ${checkedByes} copas com folga, ${checkedLower} mandos por divisão`);
});
