import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { cupStateOf, previousChampions } from '../database/repositories/cupRepository.ts';
import { SUPERCUP_RULES, supercupEntrants, supercupFormat, supercupRuleFor, type SupercupRule } from '../game/cup-engine/supercups.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const rule = (code: string) => supercupRuleFor(code)!;

test('Supercopas: classificados, dobradinha (vice da liga, vice da copa ou sem jogo), mando e a Supercopa de quatro da Espanha', () => {
  const inp = (league: string[], w: string | null, r: string | null) => ({ league, cupWinner: w, cupRunnerUp: r });
  assert.deepEqual(supercupEntrants(rule('BRA'), inp(['a', 'b', 'c'], 'x', 'y')), ['a', 'x']);
  assert.deepEqual(supercupEntrants(rule('BRA'), inp(['a', 'b', 'c'], 'a', 'y')), ['a', 'b'], 'dobradinha no Brasil: vice da Série A');
  assert.deepEqual(supercupEntrants(rule('POR'), inp(['a', 'b'], 'a', 'y')), ['a', 'y'], 'Portugal: finalista da Taça');
  assert.equal(supercupEntrants(rule('CRO'), inp(['a', 'b'], 'a', 'y')), null, 'Croácia: sem jogo na dobradinha');
  assert.deepEqual(supercupEntrants(rule('GER'), inp(['a', 'b'], 'x', 'y')), ['x', 'a'], 'Alemanha: o campeão da copa manda');
  assert.deepEqual(supercupEntrants(rule('GER'), inp(['a', 'b'], 'a', 'y')), ['b', 'a'], 'Alemanha na dobradinha: o vice da liga herda vaga e mando');
  assert.deepEqual(supercupEntrants(rule('NED'), inp(['a', 'b'], 'x', 'y')), ['a', 'x'], 'Holanda: o campeão da liga manda');
  // Espanha: [L1, C2, C1, L2]; vagas repetidas vão para 3º, 4º... da liga
  assert.deepEqual(supercupEntrants(rule('ESP'), inp(['a', 'b', 'c', 'd'], 'x', 'y')), ['a', 'y', 'x', 'b']);
  assert.deepEqual(supercupEntrants(rule('ESP'), inp(['a', 'b', 'c', 'd'], 'a', 'b')), ['a', 'd', 'c', 'b'], 'finalistas da copa = dois primeiros: entram 3º e 4º (2026: Barcelona × Athletic, Real Madrid × Atlético)');
  assert.deepEqual(supercupEntrants(rule('ESP'), inp(['a', 'b', 'c', 'd'], 'x', 'a')), ['a', 'c', 'x', 'b']);
  // sem dados da temporada anterior (1ª temporada, transição): sem supercopa
  assert.equal(supercupEntrants(rule('ENG'), inp([], null, null)), null);
  assert.equal(supercupEntrants(rule('ENG'), inp(['a', 'b'], null, null)), null);
  // formato: sem prêmio; desempate e mando pela regra; quatro clubes = semifinal e final
  for (const r of SUPERCUP_RULES) {
    const f = supercupFormat(r);
    assert.deepEqual([f.kind, f.prizes.winner, f.prizes.runnerUp], ['supercup', 0, 0]);
    assert.equal(f.stages.length, r.teams === 4 ? 2 : 1);
    assert.ok(f.stages.every((s) => s.legs === 1 && s.decider.penalties && s.decider.extraTime === r.extraTime));
    assert.equal(f.stages.at(-1)!.host, r.host === 'neutral' ? 'neutral' : 'higher');
  }
  assert.deepEqual(SUPERCUP_RULES.filter((r) => r.extraTime).map((r) => r.countryCode).sort(), ['CRO', 'POR'], 'prorrogação só em Portugal e na Croácia');
  // base: todos os países com supercopa, menos Áustria e México
  const codes = baseUniverse().world.countries.map((c) => c.code);
  assert.deepEqual(codes.filter((c) => !supercupRuleFor(c)).sort(), ['AUT', 'MEX']);
});

function playSeason(db: SqlDb) {
  for (let i = 0; i < 300 && n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  for (let i = 0; i < 5 && advanceTime(db, 'nextMatchday').advanced; i++);
}

test('Supercopas no save: nenhuma na 1ª temporada; na 2ª, com os campeões da anterior, antes da liga, sem prêmio; troféu ao campeão', async () => {
  const world = generateWorld({ seed: 'super-a', teamsPerLeagueOverride: 8, countries: ['ENG', 'ESP', 'GER', 'ITA', 'NED', 'CRO', 'POR', 'BEL'] });
  const db = await openDatabase(':memory:');
  const clubId = world.clubs[0]!.id;
  createCareer(db, world, coach, clubId);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE id LIKE 'sup%'"), 0, 'sem supercopa na 1ª temporada');
  playSeason(db);
  // campeões de 2026/27 por país, antes da virada
  const cups = db.prepare("SELECT id, country_id FROM competitions WHERE kind = 'cup' AND season = 2026 AND status = 'finished'").all().map((r) => String(r.country_id));
  assert.ok(cups.length > 0);
  startNextSeason(db);
  const sups = db.prepare("SELECT c.id, c.country_id, co.code, c.format_json FROM competitions c JOIN countries co ON co.id = c.country_id WHERE c.id LIKE 'sup%' AND c.season = 2027").all();
  assert.ok(['ENG', 'ESP', 'GER', 'ITA', 'NED'].every((c) => sups.some((s) => String(s.code) === c)), `supercopas criadas na 2ª temporada: ${sups.map((s) => String(s.code)).join(' ')}`);
  for (const s of sups) {
    const code = String(s.code), country = String(s.country_id);
    assert.ok(cups.includes(country), `${code}: só com copa disputada na temporada anterior`);
    const r = supercupRuleFor(code) as SupercupRule;
    const prev = previousChampions(db, country, 2027);
    const st = cupStateOf(db, String(s.id));
    assert.deepEqual(st.clubs.map((c) => c.id), supercupEntrants(r, prev), `${code}: participantes pela regra`);
    assert.deepEqual(st.prizes, { perStage: [], win: [], semiLoser: 0, runnerUp: 0, winner: 0 });
    const games = db.prepare('SELECT match_date, home_club_id, neutral FROM fixtures WHERE competition_id = ? ORDER BY match_date').all(String(s.id));
    assert.equal(games.length, r.teams === 4 ? 2 : 1, `${code}: ${r.teams === 4 ? 'semifinais sorteadas' : 'final marcada'}`);
    const firstLeague = String(db.prepare("SELECT MIN(f.match_date) AS d FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.country_id = ? AND c.season = 2027 AND c.kind = 'league'").get(country)!.d);
    if (r.dates[0]!.startsWith('07')) assert.ok(String(games[0]!.match_date) < firstLeague, `${code}: abre a temporada`);
    else assert.ok(String(games[0]!.match_date).startsWith('2028-01'), `${code}: em janeiro`);
    // mando: neutro, ou o primeiro do chaveamento em casa
    if (r.teams === 2) {
      if (r.host === 'neutral') assert.equal(Number(games[0]!.neutral), 1);
      else assert.deepEqual([Number(games[0]!.neutral), String(games[0]!.home_club_id)], [0, st.clubs[0]!.id], `${code}: mando pela regra`);
    }
  }
  // joga até o fim de janeiro: todas as supercopas decididas, troféu, sem lançamento de prêmio
  for (let i = 0; i < 200 && getCareerState(db).gameDate < '2028-02-01'; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  for (const s of sups) {
    assert.equal(String(db.prepare('SELECT status FROM competitions WHERE id = ?').get(String(s.id))!.status), 'finished');
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM trophies WHERE competition_id = ?', String(s.id)), 1);
    const name = cupStateOf(db, String(s.id)).format.name;
    assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_ledger WHERE description LIKE ?", `${name}:%`), 0, `${name}: sem prêmio em dinheiro`);
  }
});
