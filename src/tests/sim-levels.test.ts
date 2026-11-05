import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { makeOffer, proposeFee } from '../database/repositories/transferRepository.ts';
import { createRng } from '../game/rng.ts';
import { quickResult, teamStrength } from '../game/match-engine/quickResult.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const scheduled = (db: SqlDb) => n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'");

/** Brasil completo, Inglaterra simplificada (6 clubes por divisão) */
async function mixed(seed = 'mixed') {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 6 });
  const db = await openDatabase(':memory:');
  const user = world.clubs.find((c) => c.countryId === 'bra')!;
  createCareer(db, world, coach, user.id, new Date(), [], world.leagues.filter((l) => l.countryId === 'bra').map((l) => l.id));
  const eng = new Set(world.clubs.filter((c) => c.countryId === 'eng').map((c) => c.id));
  return { db, world, user: user.id, eng, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}

test('Resultado rápido: perto do motor completo (gols, mando, empates) e o mais forte vence mais; determinístico', () => {
  const r = createRng('quick-test'); let g = 0, h = 0, d = 0; const N = 20_000;
  for (let i = 0; i < N; i++) { const diff = (r.next() - 0.5) * 16; const x = quickResult(60 + diff / 2, 60 - diff / 2, r); g += x.homeGoals + x.awayGoals; if (x.homeGoals > x.awayGoals) h++; else if (x.homeGoals === x.awayGoals) d++; }
  assert.ok(g / N > 2.45 && g / N < 2.8, `gols ${g / N}`);
  assert.ok(h / N > 0.41 && h / N < 0.49, `mandante ${h / N}`);
  assert.ok(d / N > 0.22 && d / N < 0.30, `empates ${d / N}`);
  let strong = 0;
  for (let i = 0; i < 5000; i++) { const x = quickResult(55, 65, r); if (x.awayGoals > x.homeGoals) strong++; }
  assert.ok(strong / 5000 > 0.45, `o mais forte vence fora ${strong / 5000}`);
  assert.deepEqual(quickResult(60, 58, createRng('x')), quickResult(60, 58, createRng('x')));
  assert.equal(teamStrength([90, 80]), (90 + 80 + 9 * 30) / 11, 'elenco curto: buracos contam como 30');
});

test('Carreira mista: país simplificado tem só placar (sem relatório, sem efeitos nos jogadores), sem finanças, base, treino nem IA no mercado; o completo segue igual', async () => {
  const { db, user, eng, initial } = await mixed();
  assert.deepEqual(db.prepare('SELECT id, sim_level FROM leagues ORDER BY id').all().map((r) => `${r.id}:${r.sim_level}`), ['bra-1:full', 'bra-2:full', 'eng-1:light', 'eng-2:light']);
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM players WHERE youth_club_id IN (${[...eng].map(() => '?').join(',')})`, ...eng), 0, 'sem categorias de base');
  const condBefore = n(db, `SELECT SUM(condition_pct) AS n FROM players WHERE club_id IN (${[...eng].map(() => '?').join(',')})`, ...eng);
  const attrsBefore = new Map(db.prepare('SELECT id, attributes_json FROM players').all().map((r) => [String(r.id), String(r.attributes_json)]));
  for (let i = 0; i < 80 && scheduled(db) > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  assert.equal(scheduled(db), 0);
  const engFix = db.prepare(`SELECT f.id FROM fixtures f WHERE f.home_club_id IN (${[...eng].map(() => '?').join(',')})`).all(...eng).map((r) => String(r.id));
  assert.ok(engFix.length > 0 && engFix.every((id) => db.prepare("SELECT status FROM fixtures WHERE id = ?").get(id)!.status === 'played'));
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM matches WHERE fixture_id IN (${engFix.map(() => '?').join(',')})`, ...engFix), 0, 'sem relatório lance a lance');
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM matches') > 0, 'o país completo tem relatórios');
  const inEng = `IN (${[...eng].map(() => '?').join(',')})`;
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM player_season_stats WHERE club_id ${inEng}`, ...eng), 0, 'sem estatísticas individuais');
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM player_status ps JOIN players p ON p.id = ps.player_id WHERE p.club_id ${inEng}`, ...eng), 0, 'sem lesões nem cartões');
  assert.equal(n(db, `SELECT SUM(condition_pct) AS n FROM players WHERE club_id ${inEng}`, ...eng), condBefore, 'condição intacta');
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM finance_ledger WHERE club_id ${inEng}`, ...eng), 0, 'sem salários, patrocínios, bilheteria');
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM finance_ledger WHERE club_id = ?', user) > 0);
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM transfers WHERE to_club_id ${inEng}`, ...eng), 0, 'clubes simplificados não compram');
  assert.equal(n(db, `SELECT COUNT(*) AS n FROM sponsor_deals WHERE club_id ${inEng}`, ...eng), 0);
  // a evolução mensal não toca os jogadores do país simplificado (que nem jogaram partidas detalhadas)
  const changed = (ids: string[]) => ids.filter((id) => db.prepare('SELECT attributes_json AS a FROM players WHERE id = ?').get(id)?.a !== attrsBefore.get(id)).length;
  const engPlayers = db.prepare(`SELECT id FROM players WHERE club_id ${inEng}`).all(...eng).map((r) => String(r.id));
  const braPlayers = db.prepare("SELECT p.id FROM players p JOIN clubs c ON c.id = p.club_id WHERE c.country_id = 'bra'").all().map((r) => String(r.id));
  assert.equal(changed(engPlayers), 0, 'simplificado não evolui durante a temporada');
  assert.ok(changed(braPlayers) > braPlayers.length / 3, 'o completo evolui todo mês');
  // virada: acesso e rebaixamento no simplificado, evolução anual, contabilidade íntegra para todos os clubes
  advanceTime(db, 'nextMatchday');
  const leagues = new Map(db.prepare(`SELECT id, league_id FROM clubs WHERE id ${inEng}`).all(...eng).map((r) => [String(r.id), String(r.league_id)]));
  startNextSeason(db);
  assert.ok([...leagues].some(([id, lg]) => db.prepare('SELECT league_id AS l FROM clubs WHERE id = ?').get(id)!.l !== lg), 'houve acesso/rebaixamento na Inglaterra');
  const stillThere = engPlayers.filter((id) => db.prepare('SELECT 1 AS x FROM players WHERE id = ? AND retired = 0').get(id));
  assert.ok(changed(stillThere) > stillThere.length / 2, 'evolução anual na virada');
  for (const [id, start] of initial) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
  for (const id of eng) { const size = n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', id); assert.ok(size >= 18 && size <= 30, `elenco de ${id}: ${size}`); }
  assert.equal(getCareerState(db).season, 2027);
});

test('Carreira mista: o usuário contrata de clube simplificado; vagas e propostas de emprego só em clubes completos; determinismo', async () => {
  const { db, user, eng } = await mixed('mixed-2');
  const target = db.prepare(`SELECT id, market_value FROM players WHERE club_id IN (${[...eng].map(() => '?').join(',')}) AND market_value > 100000 ORDER BY overall DESC LIMIT 1 OFFSET 15`).all(...eng)[0]!;
  db.prepare('UPDATE clubs SET balance = 1e9 WHERE id = ?').run(user);
  db.prepare('UPDATE board_state SET transfer_budget = 1e9, wage_ceiling = 1e9').run(); // diretoria libera: o teste é sobre comprar de clube simplificado
  // sobe a oferta como o usuário faria, até o limite da diretoria (2× o valor)
  const offerFee = [1, 1.2, 1.5, 1.95].map((k) => Math.round((Number(target.market_value) * k) / 1000) * 1000).find((v) => proposeFee(db, String(target.id), v).outcome === 'accepted');
  assert.ok(offerFee, `o clube simplificado aceita vender por algum valor até 2×: ${[1, 1.5, 1.95].map((k) => proposeFee(db, String(target.id), Math.round(Number(target.market_value) * k / 1000) * 1000).message).join(' | ')}`);
  const r = makeOffer(db, { playerId: String(target.id), fee: offerFee, wage: 200_000, years: 3 });
  assert.equal(r.outcome, 'completed', JSON.stringify(r));
  assert.equal(String(db.prepare('SELECT club_id FROM players WHERE id = ?').get(String(target.id))!.club_id), user);
  // uma temporada de vagas na IA: nenhuma em clube simplificado
  // vagas expiram em poucos dias: acompanha rodada a rodada
  const seen = new Set<string>();
  for (let i = 0; i < 80 && scheduled(db) > 0; i++) {
    advanceTime(db, 'nextMatchday'); simulateMatchday(db);
    for (const x of db.prepare('SELECT club_id FROM job_vacancies').all()) seen.add(String(x.club_id));
  }
  // forçar demissões: todos os clubes com reputação máxima (a diretoria espera o título de todos) e revisões mensais da IA
  db.exec('UPDATE clubs SET reputation = 99');
  const { processBoardDay } = await import('../database/repositories/boardRepository.ts');
  for (const d of ['2027-03-01', '2027-04-01', '2027-05-01']) { processBoardDay(db, d); for (const x of db.prepare('SELECT club_id FROM job_vacancies').all()) seen.add(String(x.club_id)); }
  const vac = [...seen];
  assert.ok(vac.length > 0, 'houve vagas na IA (nos clubes completos)');
  const offers = db.prepare('SELECT club_id FROM job_offers').all().map((x) => String(x.club_id));
  assert.ok([...vac, ...offers].every((id) => !eng.has(id)), `vagas/propostas: ${[...vac, ...offers].filter((id) => eng.has(id))}`);
  const again = await mixed('mixed-2');
  advanceTime(again.db, 'nextMatchday'); simulateMatchday(again.db);
  const first = await mixed('mixed-2');
  advanceTime(first.db, 'nextMatchday'); simulateMatchday(first.db);
  const scores = (x: SqlDb) => x.prepare("SELECT id, home_goals, away_goals FROM fixtures WHERE status = 'played' ORDER BY id").all().map((f) => `${f.id}:${f.home_goals}-${f.away_goals}`);
  assert.deepEqual(scores(again.db), scores(first.db), 'mesma carreira, mesmos placares');
});

test('Base fixa (data/base): 16 países com as divisões pedidas, válida, igual a cada carga e independente da semente da carreira', async () => {
  const { baseUniverse } = await import('../services/universeService.node.ts');
  const { BASE_ID, BASE_VERSION } = await import('../game/data-pack/base.ts');
  const { world, applied } = baseUniverse();
  assert.deepEqual(applied, [`${BASE_ID}@${BASE_VERSION}`]);
  const tiers = (code: string) => world.leagues.filter((l) => l.countryId === world.countries.find((c) => c.code === code)!.id).length;
  assert.deepEqual(world.countries.map((c) => c.code).sort(), ['ARG', 'AUT', 'BEL', 'BRA', 'CRO', 'ENG', 'ESP', 'FRA', 'GER', 'IRL', 'ITA', 'JPN', 'MEX', 'NED', 'POR', 'RUS']);
  assert.equal(tiers('BRA'), 4); assert.equal(tiers('ENG'), 4); assert.equal(tiers('ESP'), 3); assert.equal(tiers('GER'), 3);
  for (const c of ['ITA', 'FRA', 'POR', 'NED', 'ARG', 'BEL', 'JPN', 'AUT', 'MEX', 'IRL', 'CRO', 'RUS']) assert.equal(tiers(c), 2, c);
  for (const c of world.clubs) assert.ok(world.players.filter((p) => p.clubId === c.id).length >= 22, c.id);
  // a base é dado congelado: duas cargas iguais; carreiras com sementes diferentes têm o mesmo universo (patches valem para todos)
  const { readPackDir } = await import('../services/packService.node.ts');
  const again = readPackDir('data/base');
  assert.equal(again.data.players.length, world.players.length);
  assert.deepEqual(again.data.players.slice(0, 50).map((p) => p.id), world.players.slice(0, 50).map((p) => p.id));
});

test('Carreira pela base fixa: escolhe os países completos (o do clube entra sempre), semente própria da carreira, universo idêntico', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { createProfile } = await import('../services/profileService.node.ts');
  const { createCareerSave } = await import('../services/saveService.node.ts');
  const { baseUniverse } = await import('../services/universeService.node.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-base-'));
  try {
    const prof = createProfile(dir, 'Teste');
    const club = baseUniverse().world.clubs.find((c) => c.countryId === 'esp')!;
    const c1 = await createCareerSave(dir, { profileId: prof.id, clubId: club.id, coach: { firstName: 'A', lastName: 'B', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' }, fullLeagues: ['bra-1', 'bra-2', 'bra-3', 'bra-4', 'eng-1'] });
    const c2 = await createCareerSave(dir, { profileId: prof.id, clubId: club.id, coach: { firstName: 'A', lastName: 'B', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' }, fullLeagues: ['bra-1', 'bra-2', 'bra-3', 'bra-4', 'eng-1'] });
    const open = async (id: string) => openDatabase(path.join(dir, 'saves', prof.id, id, 'career.db'));
    const [d1, d2] = [await open(c1.id), await open(c2.id)];
    try {
      assert.deepEqual(d1.prepare("SELECT id FROM leagues WHERE sim_level = 'full' ORDER BY id").all().map((r) => r.id), ['bra-1', 'bra-2', 'bra-3', 'bra-4', club.leagueId, 'eng-1'].sort(), 'só as divisões escolhidas + a do clube');
      const seed = (x: SqlDb) => String(x.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get()!.value);
      assert.notEqual(seed(d1), seed(d2), 'cada carreira tem a própria semente (acaso dos jogos)');
      const players = (x: SqlDb) => x.prepare('SELECT id, overall, club_id FROM players WHERE youth_club_id IS NULL ORDER BY id').all().map((r) => `${r.id}:${r.overall}:${r.club_id}`);
      assert.deepEqual(players(d1), players(d2), 'mas o universo (a base) é o mesmo; só os jovens da base de cada clube variam');
      assert.equal(players(d1).length, baseUniverse().world.players.length);
      assert.equal(String(d1.prepare("SELECT value FROM meta WHERE key = 'data_packs'").get()!.value), '["footera-base@1.0.0"]');
    } finally { d1.close(); d2.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Tela de nova carreira: o painel do clube mostra o objetivo que a diretoria realmente cobra, a força e os destaques reais do elenco', async () => {
  const { listClubs } = await import('../services/worldService.ts');
  const { OBJECTIVE_LABEL } = await import('../game/board-engine/board.ts');
  const world = generateWorld({ seed: 'painel', teamsPerLeagueOverride: 8 });
  const list = listClubs(world);
  assert.equal(list.clubs.length, world.clubs.length);
  assert.deepEqual(list.countries.map((c) => [c.id, c.divisions, c.clubs]), [['bra', 2, 16], ['eng', 2, 16]]);
  for (const opt of [list.clubs[0]!, list.clubs[5]!, list.clubs[12]!]) {
    const squad = world.players.filter((p) => p.clubId === opt.id);
    assert.equal(opt.squadSize, squad.length);
    assert.deepEqual(opt.stars.map((s) => s.overall), squad.map((p) => p.overall).sort((a, b) => b - a).slice(0, 3));
    const db = await openDatabase(':memory:');
    createCareer(db, world, coach, opt.id);
    const b = db.prepare('SELECT objective, expected_position FROM board_state').get()!;
    assert.equal(opt.objective, OBJECTIVE_LABEL[String(b.objective) as keyof typeof OBJECTIVE_LABEL], `${opt.name}`);
    assert.equal(opt.expectedPosition, Number(b.expected_position));
  }
});

test('Divisões: só a 1ª divisão completa; quem sobe vira completo, quem cai vira simplificado; o clube do usuário segue completo rebaixado', async () => {
  const { lightClubIds } = await import('../database/repositories/simLevelRepository.ts');
  const world = generateWorld({ seed: 'divisoes', teamsPerLeagueOverride: 6 });
  const db = await openDatabase(':memory:');
  const user = world.clubs.find((c) => c.leagueId === 'bra-1')!.id;
  createCareer(db, world, coach, user, new Date(), [], ['bra-1']);
  const light0 = lightClubIds(db);
  assert.ok(world.clubs.filter((c) => c.leagueId === 'bra-2').every((c) => light0.has(c.id)), 'Série B simplificada');
  assert.ok(world.clubs.filter((c) => c.leagueId === 'bra-1').every((c) => !light0.has(c.id)), 'Série A completa');
  // na 2ª divisão (simplificada) só placar; na 1ª (completa) relatório
  for (let i = 0; i < 80 && scheduled(db) > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); db.exec('UPDATE board_state SET confidence = 100'); }
  const reports = (lg: string) => n(db, 'SELECT COUNT(*) AS n FROM matches m JOIN fixtures f ON f.id = m.fixture_id JOIN clubs h ON h.id = f.home_club_id JOIN competitions c ON c.id = f.competition_id WHERE c.league_id = ?', lg);
  assert.ok(reports('bra-1') > 0); assert.equal(reports('bra-2'), 0);
  // força o usuário a cair: último colocado da Série A
  const comp = String(db.prepare("SELECT id FROM competitions WHERE league_id = 'bra-1'").get()!.id);
  const { getCompetitionTable } = await import('../database/repositories/competitionRepository.ts');
  const relegated = getCompetitionTable(db, comp).rows.slice(-2).map((r) => r.clubId);
  const promotedComp = String(db.prepare("SELECT id FROM competitions WHERE league_id = 'bra-2'").get()!.id);
  const promoted = getCompetitionTable(db, promotedComp).rows.slice(0, 2).map((r) => r.clubId);
  advanceTime(db, 'nextMatchday');
  startNextSeason(db);
  const light1 = lightClubIds(db);
  const k = Math.min(relegated.length, promoted.length);
  assert.ok(k > 0);
  const moved = (id: string) => String(db.prepare('SELECT league_id AS l FROM clubs WHERE id = ?').get(id)!.l);
  for (const id of promoted) if (moved(id) === 'bra-1') assert.ok(!light1.has(id), `promovido ${id} passa a ser completo`);
  for (const id of relegated) if (moved(id) === 'bra-2') assert.equal(light1.has(id), id !== getCareerState(db).clubId, `rebaixado ${id}: simplificado (exceto o do usuário)`);
  // o clube do usuário nunca fica simplificado, mesmo numa divisão simplificada
  assert.equal(getCareerState(db).clubId, user, 'técnico mantido (diretoria satisfeita no teste)');
  db.prepare("UPDATE clubs SET league_id = 'bra-2' WHERE id = ?").run(user);
  assert.ok(!lightClubIds(db).has(user), 'usuário em divisão simplificada continua completo');
  // e a partida dele dentro de uma divisão simplificada continua lance a lance (as outras da divisão, só placar)
  const userLeague = String(db.prepare("SELECT c.league_id AS l FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE (f.home_club_id = ? OR f.away_club_id = ?) AND f.status = 'scheduled' LIMIT 1").get(user, user)!.l);
  db.prepare("UPDATE leagues SET sim_level = 'light' WHERE id = ?").run(userLeague);
  const sides = new Set<string>();
  for (let i = 0; i < 4; i++) { // em casa e fora
    advanceTime(db, 'nextMatchday'); const day = simulateMatchday(db);
    if (!day.userMatch) continue;
    assert.ok(day.userMatch.hasReport, 'partida do usuário com relatório');
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM matches WHERE fixture_id = ?', day.userMatch.fixtureId), 1);
    sides.add(String(db.prepare('SELECT home_club_id AS h FROM fixtures WHERE id = ?').get(day.userMatch.fixtureId)!.h) === user ? 'casa' : 'fora');
    const others = day.results.filter((r) => !r.involvesUser && r.competitionName === day.userMatch!.competitionName);
    assert.ok(others.length > 0 && others.every((r) => !r.hasReport), 'demais jogos da divisão simplificada: só placar');
  }
  assert.deepEqual([...sides].sort(), ['casa', 'fora']);
});

test('História de exemplo do clube: determinística, com os dados reais (cidade, estádio, liga, rival) e sem inventar títulos', async () => {
  const { listClubs } = await import('../services/worldService.ts');
  const world = generateWorld({ seed: 'historias', teamsPerLeagueOverride: 8 });
  const a = listClubs(world), b = listClubs(world);
  assert.deepEqual(a.clubs.map((c) => c.story), b.clubs.map((c) => c.story), 'mesmo clube, mesma história');
  for (const opt of a.clubs) {
    const text = opt.story.text.join(' ');
    assert.ok(text.includes(opt.city) && text.includes(opt.stadium) && text.includes(opt.league) && text.includes(opt.name), opt.id);
    assert.ok(!/campe[ãa]|t[íi]tulo|ta[çc]a|conquist/i.test(text), `sem títulos inventados: ${text}`);
    assert.ok(opt.story.founded >= 1889 && opt.story.founded <= 1972);
  }
  assert.ok(a.clubs.filter((c) => /clássico contra/.test(c.story.text.join(' '))).length > a.clubs.length / 2, 'a maioria tem um rival real do universo');
  assert.ok(new Set(a.clubs.map((c) => c.story.text[0])).size === a.clubs.length, 'histórias diferentes entre clubes');
});
