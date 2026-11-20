import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { migrate, MIGRATIONS } from '../database/migrator.ts';
import { createCareer } from '../services/careerService.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { advanceTime, getClubCalendar, getNextFixture, listCompetitions } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { formatOutcomesOf, formatStateOf, getStagedView } from '../database/repositories/formatRepository.ts';
import { continentalCampaign, continentalStageBuilt, ensureContinentals, getConmebolRanking } from '../database/repositories/continentalRepository.ts';
import { getBoardOverview } from '../database/repositories/boardRepository.ts';
import { getClubProfile } from '../database/repositories/clubProfileRepository.ts';
import { getTrophyRoom } from '../database/repositories/trophyRepository.ts';
import { LIB_ID, LIB_SEEDS } from '../game/continental-engine/formats.ts';
import { PRIZES_USD, usdToEur } from '../game/continental-engine/prizes.ts';
import { conmebolWeeks } from '../game/continental-engine/calendar.ts';
import { stageTables, tieOutcome } from '../game/format-engine/engine.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const S = (v: unknown) => String(v);
const w = baseUniverse().world;
const top = w.clubs.filter((c) => c.leagueId === 'bra-1').sort((a, b) => b.reputation - a.reputation)[0]!;
const CONT = "(competition_id GLOB 'lib_*' OR competition_id GLOB 'sud_*' OR competition_id GLOB 'rec_*')";
/** pares de jogos de um mesmo clube a 1 dia ou menos, com pelo menos um jogo continental */
const clashes = (db: SqlDb) => n(db, `SELECT COUNT(*) AS n FROM fixtures a JOIN fixtures b ON a.id < b.id
  AND (a.home_club_id IN (b.home_club_id, b.away_club_id) OR a.away_club_id IN (b.home_club_id, b.away_club_id)) AND ABS(julianday(a.match_date) - julianday(b.match_date)) <= 1
  WHERE ${CONT.replaceAll('competition_id', 'a.competition_id')} OR ${CONT.replaceAll('competition_id', 'b.competition_id')}`);

async function career(seed = 'conmebol'): Promise<SqlDb> {
  const db = await openDatabase(':memory:');
  createCareer(db, { ...w, seed }, coach, top.id, new Date('2026-01-01T12:00:00Z'), [], ['bra-1']);
  return db;
}
const today = (db: SqlDb) => S(db.prepare('SELECT game_date FROM career').get()!.game_date);
function playUntil(db: SqlDb, until: string): void {
  for (let i = 0; i < 1000 && today(db) < until; i++) {
    const r = advanceTime(db, 'nextMatchday');
    simulateMatchday(db);
    if (!r.advanced && r.reason === 'season_complete') break;
  }
}

test('Continentais na criação: Libertadores e Sul-Americana da temporada, lista de competições, ranking, objetivo da diretoria e determinismo', async () => {
  const db = await career();
  const comps = listCompetitions(db).competitions.filter((c) => c.kind === 'continental');
  assert.deepEqual(comps.map((c) => [c.id, c.teamCount, c.country]), [['lib_2026', 47, 'CONMEBOL'], ['sud_2026', 56, 'CONMEBOL']], 'sem Recopa no 1º ano (sem campeões)');
  const lib = formatStateOf(db, 'lib_2026')!, sud = formatStateOf(db, 'sud_2026')!;
  assert.equal(new Set([...lib.state.seeds, ...sud.state.seeds]).size, 47 + 44, 'nenhum clube nas duas');
  assert.ok(lib.state.seeds.slice(...LIB_SEEDS.groups).includes(top.id), 'o maior clube do Brasil entra direto nos grupos (ADAPT: ordem pela reputação)');
  assert.deepEqual(Object.keys(lib.state.stages), ['f1'], 'só a fase 1 montada');
  const f1 = db.prepare("SELECT match_date FROM fixtures WHERE competition_id = 'lib_2026' ORDER BY match_date").all().map((r) => S(r.match_date));
  assert.ok(f1.every((d) => [2, 3, 4].includes(new Date(`${d}T00:00:00Z`).getUTCDay())), 'fase 1 de terça a quinta');
  assert.ok(f1[0]! >= '2026-02-03' && f1[0]! <= '2026-02-05', `fase 1 na semana de 4/2 (${f1[0]})`);
  // ranking vigente: ano histórico pela reputação (ADAPT)
  const r = getConmebolRanking(db);
  assert.deepEqual([r.season, r.asOf, r.rows.length], [2026, 2025, 50]);
  assert.ok(r.user && r.user.position <= 5 && r.rows.every((x, i) => i === 0 || x.points <= r.rows[i - 1]!.points));
  // diretoria: objetivo continental pelo pote estimado (pote 1 → quartas, importante)
  const camp = continentalCampaign(db, top.id, 2026)!;
  assert.deepEqual([camp.comp, camp.pot, camp.reach, camp.eliminated], ['lib', 1, null, false]);
  const obj = getBoardOverview(db).club!.objectives.find((o) => o.kind === 'conmebol')!;
  assert.deepEqual([obj.label, obj.importance, obj.status], ['CONMEBOL Libertadores: chegar às quartas de final', 'important', 'pending']);
  // determinismo: mesma semente, mesmos classificados e mesmo sorteio da fase 1
  const again = await career();
  const fx = (d: SqlDb) => d.prepare(`SELECT id, match_date, home_club_id, away_club_id FROM fixtures WHERE ${CONT} ORDER BY id`).all().map((x) => Object.values(x).join('|'));
  assert.deepEqual(fx(again), fx(db));
  assert.deepEqual(formatStateOf(again, 'sud_2026')!.state.seeds, sud.state.seeds);
  db.close(); again.close();
});

test('Temporada continental completa: semanas do anexo, finais neutras sem bilheteria, entrantes da Libertadores na Sul-Americana, prêmios, disciplina, troféus e ranking', async () => {
  const db = await career();
  // CURRENT_COMP: o jogo continental aparece no calendário (com a fase) e como próximo jogo do usuário
  playUntil(db, '2026-03-25'); // grupos sorteados
  assert.ok(getClubCalendar(db).fixtures.some((f) => f.competitionId === 'lib_2026' && f.cup?.stage === 'Fase de grupos'), 'jogos da Libertadores no calendário do usuário');
  const first = S(db.prepare("SELECT MIN(match_date) AS d FROM fixtures WHERE competition_id = 'lib_2026' AND (home_club_id = ? OR away_club_id = ?)").get(top.id, top.id)!.d);
  for (let i = 0; i < 40 && getNextFixture(db)!.date < first; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  const next = getNextFixture(db)!;
  assert.equal(next.competitionId, 'lib_2026', `o próximo jogo do usuário é o da Libertadores (${first})`);
  assert.deepEqual([next.cup?.name, next.cup?.stage, next.cup?.neutral], ['CONMEBOL Libertadores', 'Fase de grupos', false]);
  playUntil(db, '2026-12-05');
  for (const id of ['lib_2026', 'sud_2026']) {
    const o = formatOutcomesOf(db, id)!;
    assert.ok(o.complete && o.champion, `${id} completa com campeão`);
    assert.equal(S(db.prepare('SELECT status FROM competitions WHERE id = ?').get(id)!.status), 'finished');
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM trophies WHERE competition_id = ? AND club_id = ?', id, o.champion), 1);
  }
  // datas: terça a quinta nas semanas do anexo; finais no sábado (21/11 e 28/11), em campo neutro
  const weeks = new Set(conmebolWeeks(2026));
  const all = db.prepare(`SELECT id, match_date, stage, neutral, competition_id FROM fixtures WHERE ${CONT}`).all();
  for (const f of all) {
    const d = S(f.match_date), dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (S(f.stage) === 'final') { assert.equal(N(f.neutral), 1, `${S(f.id)} neutra`); continue; }
    assert.ok([2, 3, 4].includes(dow), `${S(f.id)} em ${d}: terça a quinta`);
    const wed = new Date(`${d}T00:00:00Z`); wed.setUTCDate(wed.getUTCDate() + 3 - dow);
    assert.ok(weeks.has(wed.toISOString().slice(0, 10)), `${S(f.id)} (${d}) numa semana do anexo`);
  }
  assert.deepEqual(db.prepare(`SELECT competition_id AS c, match_date AS d FROM fixtures WHERE ${CONT} AND stage = 'final' ORDER BY d`).all().map((r) => [S(r.c), S(r.d)]),
    [['sud_2026', '2026-11-21'], ['lib_2026', '2026-11-28']]);
  // final em sede neutra: sem bilheteria para o mandante nominal
  const gate = (where: string) => n(db, `SELECT COUNT(*) AS n FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE ${CONT.replaceAll('competition_id', 'f.competition_id')} AND ${where} AND COALESCE(m.gate_revenue, 0) > 0`);
  assert.equal(gate("f.stage = 'final'"), 0, 'final neutra sem renda');
  assert.ok(gate("f.stage = 'g'") > 0, 'jogos de grupo com renda do mandante');
  // Sul-Americana recebe os 4 perdedores da fase 3 e os 8 terceiros da Libertadores
  const lib = formatStateOf(db, 'lib_2026')!, sud = formatStateOf(db, 'sud_2026')!;
  const f3losers = lib.state.stages.f3!.ties!.map((_, i) => tieOutcome(lib.def, lib.state, 'f3', i)!.loser);
  assert.deepEqual(f3losers.filter((c) => sud.state.stages.g!.groups!.flat().includes(c)).length, 4);
  const thirds = stageTables(lib.def, lib.state, 'g').groups.map((g) => g[2]!.teamId);
  assert.deepEqual(new Set(sud.state.stages.po!.ties!.flatMap((t) => [t.a, t.b]).filter((c) => thirds.includes(c))).size, 8);
  // nenhum clube com dois jogos a 1 dia ou menos por causa dos continentais (remarcação)
  assert.equal(clashes(db), 0);
  // premiação em dólares convertida (regra 1): participação, jogos e títulos no extrato
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM finance_ledger WHERE club_id = ? AND category = 'prize' AND description LIKE '%jogo em casa na fase de grupos — CONMEBOL Libertadores%'", top.id) === 3, '3 jogos em casa nos grupos no extrato do usuário');
  const champ = formatOutcomesOf(db, 'lib_2026')!.champion!;
  const prizes = (club: string) => n(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ? AND category = 'prize' AND month >= '2026-11'", club);
  assert.ok(prizes(champ) >= usdToEur(PRIZES_USD[LIB_ID].champion), 'prêmio de campeão (US$ 25 mi convertidos) no caixa do campeão');
  // disciplina própria (cartões só na competição) e cartões gravados para o fair play
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM cup_discipline WHERE competition_id = 'lib_2026'") > 0);
  // (o resultado rápido entre dois clubes simplificados não tem cartões: conta como zero no fair play)
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures f WHERE f.competition_id = 'lib_2026' AND f.stage = 'g' AND f.cards_json IS NULL AND EXISTS (SELECT 1 FROM matches m WHERE m.fixture_id = f.id)"), 0);
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = 'lib_2026' AND stage = 'g' AND cards_json IS NOT NULL") >= 6);
  // ranking: até onde cada clube chegou (Libertadores 47, Sul-Americana 44 + 12)
  assert.deepEqual(db.prepare('SELECT comp, COUNT(*) AS n FROM continental_results GROUP BY comp ORDER BY comp').all().map((r) => [S(r.comp), N(r.n)]), [['lib', 47], ['sud', 56]]);
  assert.equal(S(db.prepare("SELECT stage FROM continental_results WHERE competition_id = 'lib_2026' AND club_id = ?").get(champ)!.stage), 'champion');
  // telas: fases, sala de troféus, perfil do clube
  const sv = getStagedView(db, 'lib_2026');
  assert.deepEqual([sv.kind, sv.stages.every((s) => s.built), sv.stages.find((s) => s.id === 'g')!.groups.length], ['continental', true, 8]);
  assert.deepEqual(getTrophyRoom(db, champ).cases.filter((c) => c.kind === 'continental').map((c) => [c.key, c.total]), [['conmebol-lib', 1]]);
  assert.ok(getClubProfile(db, top.id).cups.some((c) => c.competitionId === 'lib_2026' && c.stage !== ''));
  const obj = getBoardOverview(db).club!.objectives.find((o) => o.kind === 'conmebol')!;
  const camp = continentalCampaign(db, top.id, 2026)!;
  assert.equal(obj.status, camp.reach! >= 4 ? 'met' : 'missed', 'objetivo julgado pela campanha (quartas = índice 4)');

  // 2ª temporada: Recopa com os campeões, Libertadores com o campeão como cabeça do grupo A, ranking com a 1ª edição
  playUntil(db, '2026-12-31');
  startNextSeason(db, new Date('2027-01-01T12:00:00Z'));
  const sudChamp = formatOutcomesOf(db, 'sud_2026')!.champion!;
  const rec = formatStateOf(db, 'rec_2027');
  if (champ !== sudChamp) assert.deepEqual(rec!.state.seeds, [champ, sudChamp], 'Recopa: campeão da Libertadores × campeão da Sul-Americana');
  const lib27 = formatStateOf(db, 'lib_2027')!;
  assert.ok(lib27.state.seeds.slice(...LIB_SEEDS.groups).includes(champ) && lib27.state.seeds.includes(sudChamp), 'campeões nos grupos da Libertadores seguinte');
  const meta = JSON.parse(S(db.prepare("SELECT format_json FROM competitions WHERE id = 'lib_2027'").get()!.format_json)) as { libChampion: string };
  assert.equal(meta.libChampion, champ);
  assert.equal(getConmebolRanking(db).asOf, 2026);
  db.close();
});
const N = (v: unknown) => Number(v);

test('Migração 035 e saves antigos: competições preservadas, CHECK continental, coluna de cartões; continentais só se as copas evitaram as semanas da CONMEBOL e antes de 4/2', async () => {
  const db = await openDatabase(':memory:');
  migrate(db, MIGRATIONS.filter((m) => m.version <= 34));
  db.exec(`INSERT INTO countries (id, name, code) VALUES ('bra', 'Brasil', 'BRA');
    INSERT INTO competitions (id, kind, country_id, season, name, format_json) VALUES ('cup_bra_2026', 'cup', 'bra', 2026, 'Copa 2026', '{}');`);
  migrate(db);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE id = 'cup_bra_2026' AND kind = 'cup'"), 1, 'copa preservada na reconstrução');
  db.exec(`INSERT INTO competitions (id, kind, season, name, format_json, confederation) VALUES ('lib_2026', 'continental', 2026, 'L', '{}', 'CONMEBOL')`);
  assert.throws(() => db.exec(`INSERT INTO competitions (id, kind, country_id, season, name, format_json, confederation) VALUES ('x', 'continental', 'bra', 2026, 'L', '{}', 'CONMEBOL')`), /CHECK/);
  assert.throws(() => db.exec(`INSERT INTO competitions (id, kind, season, name, format_json) VALUES ('y', 'continental', 2026, 'L', '{}')`), /CHECK/, 'continental exige a confederação');
  assert.ok(db.prepare("SELECT 1 AS x FROM pragma_table_info('fixtures') WHERE name = 'cards_json'").get());
  db.close();

  // save "antigo" em janeiro: sem continentais; copas com datas nas semanas da CONMEBOL → ficam para o ano seguinte; sem isso → cria
  const old = await career('antigo');
  old.exec(`PRAGMA foreign_keys = OFF; DELETE FROM fixtures WHERE ${CONT}; DELETE FROM competitions WHERE kind = 'continental'; PRAGMA foreign_keys = ON;`);
  const cup = old.prepare("SELECT id, format_json FROM competitions WHERE id = 'cup_bra_2026'").get()!;
  const st = JSON.parse(S(cup.format_json)) as { dates: string[][] };
  const orig = JSON.stringify(st);
  st.dates[st.dates.length - 1]![0] = conmebolWeeks(2026)[5]!;
  old.prepare('UPDATE competitions SET format_json = ? WHERE id = ?').run(JSON.stringify(st), S(cup.id));
  assert.equal(ensureContinentals(old), false, 'copa sorteada sem evitar as semanas continentais: continentais só no ano seguinte');
  old.prepare('UPDATE competitions SET format_json = ? WHERE id = ?').run(orig, S(cup.id));
  old.prepare("UPDATE career SET game_date = '2026-02-03'").run(); // fase 1 começa em 4/2 (quarta da semana do anexo)
  assert.equal(ensureContinentals(old), false, 'depois da véspera da 1ª data: tarde demais');
  old.prepare("UPDATE career SET game_date = '2026-01-20'").run();
  assert.equal(ensureContinentals(old), true);
  assert.equal(ensureContinentals(old), false, 'idempotente');
  assert.equal(n(old, "SELECT COUNT(*) AS n FROM competitions WHERE kind = 'continental'"), 2);
  // disciplina: os amarelos pendentes zeram quando as semifinais são montadas; as suspensões continuam
  const pl = old.prepare('SELECT id FROM players LIMIT 2').all().map((r) => S(r.id));
  old.prepare("INSERT INTO cup_discipline (competition_id, player_id, yellow_cards, suspension_matches) VALUES ('lib_2026', ?, 2, 0), ('lib_2026', ?, 1, 1)").run(pl[0]!, pl[1]!);
  const def = formatStateOf(old, 'lib_2026')!.def;
  continentalStageBuilt(old, 'lib_2026', def, 'qf', { ties: [] }, [], '2026-09-01');
  assert.equal(n(old, "SELECT SUM(yellow_cards) AS n FROM cup_discipline WHERE competition_id = 'lib_2026'"), 3, 'quartas: amarelos continuam');
  continentalStageBuilt(old, 'lib_2026', def, 'sf', { ties: [] }, [], '2026-10-01');
  assert.deepEqual(old.prepare("SELECT yellow_cards AS y, suspension_matches AS s FROM cup_discipline WHERE competition_id = 'lib_2026' ORDER BY player_id = ?").all(pl[1]!).map((r) => [N(r.y), N(r.s)]), [[0, 0], [0, 1]]);
  old.close();
});
