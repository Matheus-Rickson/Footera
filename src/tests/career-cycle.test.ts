import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState, getCompetitionTable, listCompetitions } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { makeOffer, searchMarket, TransferError } from '../database/repositories/transferRepository.ts';
import {
  getContracts, getHistory, getSeasonStatus, getTrophies, isSeasonComplete, renewContract, SeasonError, startNextSeason,
} from '../database/repositories/seasonRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import { PEAK_AGE, prizeMoney } from '../game/career-engine/development.ts';
import { renewalDemand } from '../game/career-engine/contracts.ts';
import { squadStaysValid } from '../game/transfer-engine/transfer.ts';
import { ageOn } from '../shared/date.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';
import { cupPrizesPaid } from '../database/repositories/cupRepository.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'cycle', teams = 6) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const scheduled = (db: SqlDb) => n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'");
function assertBooksBalance(db: SqlDb, initial: Map<string, number>) {
  for (const [id, start] of initial) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
}
/** Joga todas as partidas da temporada corrente (sem passar da última rodada). */
function playSeason(db: SqlDb) {
  for (let i = 0; i < 80 && scheduled(db) > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  assert.equal(scheduled(db), 0);
}
const toTurnover = (db: SqlDb) => { const r = advanceTime(db, 'nextMatchday'); assert.equal(r.toDate, `${getCareerState(db).season + 1}-07-01`); };
const leagueOf = (db: SqlDb, clubId: string) => String(db.prepare('SELECT league_id AS l FROM clubs WHERE id = ?').get(clubId)!.l);

test('Virada: só com todas as partidas disputadas e no dia 1º/jul; a entressafra avança dia a dia até lá e para', async () => {
  const { db } = await setup('cycle-gate');
  assert.throws(() => startNextSeason(db), SeasonError);
  playSeason(db);
  assert.equal(isSeasonComplete(db), true);
  assert.throws(() => startNextSeason(db), /1º\/jul|01\/07\/2027/);
  assert.equal(getSeasonStatus(db).canStart, false);
  const d = advanceTime(db, 'day');
  assert.ok(d.advanced && d.message.includes('Temporada encerrada'));
  toTurnover(db);
  assert.equal(advanceTime(db, 'day').reason, 'season_complete', 'não passa da virada');
  // o dia da virada (mercado e cobrança de julho) fica para a ação do usuário
  assert.equal(String(db.prepare("SELECT value FROM meta WHERE key = 'finance_last_month'").get()!.value), '2027-06');
  const st = getSeasonStatus(db);
  assert.deepEqual([st.complete, st.canStart, st.matchesLeft], [true, true, 0]);
  const report = startNextSeason(db);
  assert.equal(report.season, 2027);
  assert.equal(String(db.prepare("SELECT value FROM meta WHERE key = 'finance_last_month'").get()!.value), '2027-07');
  assert.deepEqual([getCareerState(db).season, getCareerState(db).gameDate], [2027, '2027-07-01']);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE season = 2027 AND kind = 'league'"), 4);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE season = 2027 AND kind = 'cup' AND id LIKE 'cup%'"), 2, 'copas nacionais da nova temporada');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE season = 2027 AND id LIKE 'sup%'"), 2, 'supercopas (campeões de 2026/27)');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.season = 2027 AND f.status = 'scheduled' AND c.kind = 'league'"), 4 * 30);
  assert.equal(advanceTime(db, 'nextMatchday').toDate, '2027-07-26', 'a temporada nova abre com as supercopas (fim de julho)');
  assert.throws(() => startNextSeason(db), SeasonError, 'não vira duas vezes');
});

test('Virada: rebaixados e promovidos trocam de liga por país, troféus e registro batem com a tabela derivada das partidas', async () => {
  const { db, clubId } = await setup('cycle-moves');
  playSeason(db); toTurnover(db);
  // este teste é sobre acesso, rebaixamento, troféus e histórico: a diretoria não demite (senão o histórico do treinador fica vazio por causa do sorteio)
  db.prepare('UPDATE board_state SET confidence = 100').run();
  const comps = listCompetitions(db).competitions.filter((c) => c.kind === 'league');
  const before = new Map(comps.map((c) => [c.id, getCompetitionTable(db, c.id)]));
  const report = startNextSeason(db);
  const byName = (prefix: string) => before.get(comps.find((c) => c.name.startsWith(prefix))!.id)!;
  for (const [top, second, k] of [['Série A', 'Série B', 4], ['Premier', 'Championship', 3]] as const) {
    const a = byName(top), b = byName(second);
    const leagueA = leagueOf(db, a.rows[0]!.clubId), leagueB = leagueOf(db, b.rows.at(-1)!.clubId);
    for (const r of a.rows.slice(-k)) assert.equal(leagueOf(db, r.clubId), leagueB, `${r.clubName} rebaixado`);
    for (const r of b.rows.slice(0, k)) assert.equal(leagueOf(db, r.clubId), leagueA, `${r.clubName} promovido`);
    for (const r of a.rows.slice(0, a.rows.length - k)) assert.equal(leagueOf(db, r.clubId), leagueA);
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM clubs WHERE league_id = ?', leagueA), 6, 'tamanho da liga preservado');
  }
  assert.equal(report.movements.length, 2);
  // registro oficial = tabela derivada; troféu = 1º colocado
  for (const [compId, t] of before) {
    for (const r of t.rows) assert.equal(n(db, 'SELECT position AS n FROM season_results WHERE season = 2026 AND club_id = ?', r.clubId), r.position);
    assert.equal(String(db.prepare('SELECT club_id AS c FROM trophies WHERE competition_id = ?').get(compId)!.c), t.rows[0]!.clubId);
  }
  // a tabela de uma temporada passada continua com os participantes originais, mesmo depois da troca de divisão
  for (const [compId, t] of before) assert.deepEqual(getCompetitionTable(db, compId).rows.map((r) => [r.clubId, r.points]), t.rows.map((r) => [r.clubId, r.points]));
  const hist = getHistory(db);
  assert.equal(hist[0]!.current, true);
  const prev = hist.find((h) => h.season === 2026)!;
  assert.equal(prev.position, report.previous!.position);
  assert.equal(prev.prize, report.previous!.prize);
  const room = getTrophies(db);
  assert.equal(room.champions.length, 6, '4 ligas + 2 copas nacionais');
  assert.equal(room.mine.length, n(db, 'SELECT COUNT(*) AS n FROM trophies WHERE club_id = ?', clubId));
  assert.ok(room.mine.every((t) => t.clubName === String(db.prepare('SELECT name FROM clubs WHERE id = ?').get(clubId)!.name)));
});

test('Virada: prêmios passam por makePoster e saldo = saldo inicial + lançamentos para TODOS os clubes, também na temporada seguinte', async () => {
  const { db, clubId, initial } = await setup('cycle-money');
  playSeason(db); toTurnover(db);
  startNextSeason(db);
  assertBooksBalance(db, initial);
  // prêmios = liga (registro da temporada) + copas (recalculados dos confrontos)
  const cupPaid = db.prepare("SELECT id FROM competitions WHERE kind = 'cup'").all().reduce((s, r) => s + cupPrizesPaid(db, String(r.id)), 0);
  assert.ok(cupPaid > 0);
  assert.equal(n(db, "SELECT SUM(amount) AS n FROM finance_months WHERE category = 'prize'"), n(db, 'SELECT SUM(prize) AS n FROM season_results') + cupPaid);
  const champ = db.prepare(`SELECT sr.club_id, sr.prize, co.economy, l.tier FROM season_results sr JOIN competitions c ON c.id = sr.competition_id
    JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = l.country_id WHERE sr.position = 1 AND l.tier = 1`).all();
  for (const r of champ) assert.equal(Number(r.prize), prizeMoney(Number(r.economy), 1, 1, 6));
  const mine = n(db, "SELECT amount AS n FROM finance_ledger WHERE category = 'prize' AND description LIKE 'Premiação:%'");
  assert.equal(mine, n(db, 'SELECT prize AS n FROM season_results WHERE club_id = ?', clubId), 'prêmio no extrato do usuário');
  for (let i = 0; i < 6; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  assertBooksBalance(db, initial);
  assert.equal(n(db, 'SELECT SUM(amount) AS n FROM finance_ledger'), n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', clubId) - initial.get(clubId)!);
});

test('Virada: contratos — o usuário perde quem não renovou; a IA renova ou libera; ninguém fica com contrato vencido; elencos jogáveis', async () => {
  const { db, clubId } = await setup('cycle-contracts');
  playSeason(db); toTurnover(db);
  const mine = db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY overall DESC').all(clubId).map(rowToPlayer);
  const [keep, leave] = [mine[0]!, mine[1]!];
  db.prepare("UPDATE players SET contract_end = '2027-06-30' WHERE id IN (?, ?)").run(keep.id, leave.id);
  const offer = renewalDemand({ marketValue: keep.marketValue, salary: keep.salary, ambition: keep.personality.ambition, loyalty: keep.personality.loyalty });
  const age = ageOn(keep.birthDate, '2027-07-01');
  const r = renewContract(db, { playerId: keep.id, wage: offer, years: age >= 30 ? 1 : 2 });
  assert.equal(r.outcome, 'accepted', r.message);
  const expiringUser = getContracts(db).filter((c) => c.expiresThisSeason).map((c) => c.id);
  assert.ok(expiringUser.includes(leave.id) && !expiringUser.includes(keep.id));
  const report = startNextSeason(db);
  assert.equal(String(db.prepare('SELECT club_id AS c FROM players WHERE id = ?').get(keep.id)!.c), clubId, 'renovado fica');
  const left = db.prepare('SELECT club_id, retired FROM players WHERE id = ?').get(leave.id)!;
  assert.notEqual(left.club_id, clubId, 'não renovado sai de graça (pode até assinar com outro clube como livre)');
  assert.ok(report.releasedUser.length + report.retiredUser.length >= 1);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM players WHERE club_id IS NOT NULL AND contract_end <= '2027-07-01'"), 0, 'nenhum contrato vencido em clube');
  assert.ok(report.aiRenewed > 0 && report.aiReleased > 0);
  for (const c of db.prepare('SELECT id FROM clubs').all()) {
    const squad = db.prepare('SELECT id, position FROM players WHERE club_id = ?').all(String(c.id)).map((p) => ({ id: String(p.id), position: p.position as never }));
    assert.ok(squad.length <= 30, `elenco de ${String(c.id)} com ${squad.length}`);
    assert.ok(squadStaysValid([...squad, { id: 'x', position: 'GK' }], 'x', 18), `elenco de ${String(c.id)} incompleto (${squad.length})`);
  }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE retired = 1 AND club_id IS NOT NULL'), 0, 'aposentado não tem clube');
});

test('Virada: desenvolvimento respeita o teto antes dos 28, snapshot registrado, jovens da base chegam e suspensões zeram', async () => {
  const { db, clubId } = await setup('cycle-dev');
  playSeason(db); toTurnover(db);
  const active = n(db, 'SELECT COUNT(*) AS n FROM players WHERE retired = 0');
  db.exec("UPDATE player_status SET suspension_matches = 2, yellow_cards = 3");
  // a safra de março chega às categorias de base, não ao elenco principal (na virada, uma carência pode promovê-la — regra própria)
  const safraNoPrincipal = n(db, "SELECT COUNT(*) AS n FROM players WHERE id LIKE 'plr_y2027_%' AND club_id IS NOT NULL AND youth_club_id IS NULL");
  const report = startNextSeason(db);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM player_development WHERE season = 2026'), active - report.retiredTotal);
  for (const r of db.prepare('SELECT * FROM players WHERE retired = 0').all()) {
    const p = rowToPlayer(r);
    assert.ok(p.potentialHidden >= p.overall, `${p.id}: potencial abaixo da força`);
    assert.ok(p.potentialEstimated >= p.overall);
  }
  const grown = db.prepare('SELECT d.overall_after, p.potential_hidden FROM player_development d JOIN players p ON p.id = d.player_id WHERE d.age < ?').all(PEAK_AGE);
  assert.ok(grown.every((g) => Number(g.overall_after) <= Number(g.potential_hidden)));
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM player_development WHERE overall_after > overall_before AND age < 24') > n(db, 'SELECT COUNT(*) AS n FROM player_development WHERE overall_after < overall_before AND age < 24'), 'jovens mais crescem do que regridem');
  // a safra chega na peneira de março, às categorias de base (fora do elenco principal)
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM players WHERE id LIKE 'plr_y2027_%' AND youth_club_id = ?", clubId) >= 2);
  assert.equal(safraNoPrincipal, 0, 'a safra chega à base, não direto ao principal');
  for (const c of db.prepare('SELECT id FROM clubs').all()) assert.ok(n(db, "SELECT COUNT(*) AS n FROM players WHERE youth_club_id = ?", String(c.id)) >= 1, `${String(c.id)}: base vazia`);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE youth_club_id IS NOT NULL AND birth_date <= ?', '2008-07-01'), 0, 'ninguém com 19+ fica na base depois da virada');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM player_status WHERE suspension_matches > 0 OR yellow_cards > 0'), 0);
  assert.ok(getNews(db).some((x) => x.kind === 'youth'));
});

test('Jogadores livres: aparecem no mercado sem clube, contratação sem taxa (também fora da janela); aposentados nunca', async () => {
  const { db, clubId } = await setup('cycle-free');
  playSeason(db); toTurnover(db);
  startNextSeason(db);
  const free = searchMarket(db, { freeOnly: true });
  assert.ok(free.length > 0, 'há livres depois da virada');
  assert.ok(free.every((p) => p.clubId === null && p.clubName === null));
  const retiredIds = new Set(db.prepare('SELECT id FROM players WHERE retired = 1').all().map((r) => String(r.id)));
  assert.ok(retiredIds.size > 0);
  assert.ok(searchMarket(db, {}).every((p) => !retiredIds.has(p.id)) && free.every((p) => !retiredIds.has(p.id)));
  assert.throws(() => makeOffer(db, { playerId: [...retiredIds][0]!, fee: 0, wage: 10_000, years: 1 }), /aposentado/);
  db.prepare("UPDATE career SET game_date = '2027-10-10' WHERE id = 1").run(); // janela fechada
  const target = free.at(-1)!; // o mais barato: o teto de folha da diretoria (Fase 8D) barraria os mais caros
  assert.throws(() => makeOffer(db, { playerId: target.id, fee: 1000, wage: 10_000, years: 1 }), TransferError);
  const low = makeOffer(db, { playerId: target.id, fee: 0, wage: 100, years: 1 });
  assert.equal(low.outcome, 'player_rejected');
  // ofertas um pouco abaixo do pedido rendem contraproposta; aceitar a contraproposta conclui
  const ask = makeOffer(db, { playerId: target.id, fee: 0, wage: Math.round(Math.max(target.salary, target.marketValue * 0.012) * 0.95), years: 1 });
  assert.notEqual(ask.outcome, 'player_rejected', ask.message);
  const done = ask.outcome === 'completed' ? ask : makeOffer(db, { playerId: target.id, fee: 0, wage: ask.counterWage!, years: 1 });
  assert.equal(done.outcome, 'completed', done.message);
  const t = db.prepare('SELECT * FROM transfers WHERE player_id = ? ORDER BY id DESC LIMIT 1').get(target.id)!;
  assert.deepEqual([t.from_club_id, String(t.to_club_id), Number(t.fee)], [null, clubId, 0]);
  assert.equal(String(db.prepare('SELECT contract_end AS c FROM players WHERE id = ?').get(target.id)!.c), '2028-06-30');
});

test('Renovação: validações, contraproposta, recusa por duração e aceite que estende a partir do fim atual', async () => {
  const { db, clubId } = await setup('cycle-renew');
  const other = String(db.prepare('SELECT id FROM players WHERE club_id <> ? LIMIT 1').get(clubId)!.id);
  assert.throws(() => renewContract(db, { playerId: other, wage: 1000, years: 1 }), /seu clube/);
  const p = rowToPlayer(db.prepare("SELECT * FROM players WHERE club_id = ? ORDER BY birth_date DESC LIMIT 1").get(clubId)!);
  db.prepare("UPDATE players SET contract_end = '2030-07-01' WHERE id = ?").run(p.id);
  assert.throws(() => renewContract(db, { playerId: p.id, wage: p.salary * 2, years: 2 }), /ainda é longo/);
  db.prepare("UPDATE players SET contract_end = '2027-07-01' WHERE id = ?").run(p.id);
  const demand = renewalDemand({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition, loyalty: p.personality.loyalty });
  assert.equal(renewContract(db, { playerId: p.id, wage: Math.round(demand * 0.5), years: 2 }).outcome, 'rejected');
  const c = renewContract(db, { playerId: p.id, wage: Math.round(demand * 0.85), years: 2 });
  assert.deepEqual([c.outcome, c.counterWage], ['counter', demand]);
  const ok = renewContract(db, { playerId: p.id, wage: c.counterWage!, years: 2 });
  assert.deepEqual([ok.outcome, ok.contractEnd], ['accepted', '2029-06-30']);
  const row = db.prepare('SELECT salary, contract_end FROM players WHERE id = ?').get(p.id)!;
  assert.deepEqual([Number(row.salary), String(row.contract_end)], [demand, '2029-06-30']);
  const old = rowToPlayer(db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY birth_date LIMIT 1').get(clubId)!);
  if (ageOn(old.birthDate, '2026-07-01') >= 34) {
    db.prepare("UPDATE players SET contract_end = '2027-07-01' WHERE id = ?").run(old.id);
    assert.match(renewContract(db, { playerId: old.id, wage: old.salary * 3, years: 3 }).message, /no máximo 1/);
  }
  assert.ok(getNews(db).some((x) => x.kind === 'contract' && x.title.includes(p.lastName)));
});

test('Determinismo: mesma semente, mesma temporada e mesma virada (jogadores, clubes, finanças e registro idênticos)', async () => {
  const dump = async () => {
    const { db } = await setup('cycle-det', 6);
    playSeason(db); toTurnover(db);
    const report = startNextSeason(db, new Date('2030-01-01T00:00:00Z'));
    return JSON.stringify([report, db.prepare('SELECT * FROM players ORDER BY id').all(), db.prepare('SELECT id, league_id, reputation, balance FROM clubs ORDER BY id').all(),
      db.prepare('SELECT * FROM finance_months ORDER BY club_id, month, category').all(), db.prepare('SELECT * FROM season_results ORDER BY season, club_id').all(),
      db.prepare('SELECT * FROM transfers ORDER BY id').all(), db.prepare('SELECT id, home_club_id, away_club_id, match_date FROM fixtures ORDER BY id').all()]);
  };
  assert.equal(await dump(), await dump());
});

test('Duas viradas seguidas: contabilidade, elencos e calendário continuam íntegros (e a IA renova sem inflacionar salários)', async () => {
  const { db, initial } = await setup('cycle-two', 6);
  for (const season of [2026, 2027]) {
    // diretoria satisfeita: este teste é sobre contabilidade e elencos; a demissão tem testes próprios (o histórico precisa das duas temporadas)
    for (let i = 0; i < 80 && scheduled(db) > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); db.exec('UPDATE board_state SET confidence = 100'); }
    toTurnover(db);
    const r = startNextSeason(db);
    assert.equal(r.season, season + 1);
    assertBooksBalance(db, initial);
    for (const c of db.prepare('SELECT id FROM clubs').all()) {
      const size = n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', String(c.id));
      assert.ok(size >= 18 && size <= 30, `elenco com ${size}`);
    }
    assert.equal(n(db, 'SELECT COUNT(DISTINCT league_id) AS n FROM clubs'), 4);
    for (const lg of db.prepare('SELECT id FROM leagues').all()) assert.equal(n(db, 'SELECT COUNT(*) AS n FROM clubs WHERE league_id = ?', String(lg.id)), 6);
  }
  assert.equal(getHistory(db).filter((h) => !h.current).length, 2);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM trophies'), 14, '2 temporadas × (4 ligas + 2 copas) + 2 supercopas na 2ª');
});

test('Contratos: a data exibida antes de renovar (renewBaseYear + N) é a mesma que a renovação grava', async () => {
  const { db, clubId } = await setup('cycle-preview');
  const p = rowToPlayer(db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY birth_date DESC LIMIT 1').get(clubId)!);
  db.prepare("UPDATE players SET contract_end = '2027-07-01' WHERE id = ?").run(p.id);
  const row = getContracts(db).find((c) => c.id === p.id)!;
  const demand = renewalDemand({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition, loyalty: p.personality.loyalty });
  const r = renewContract(db, { playerId: p.id, wage: demand, years: 2 });
  assert.equal(r.contractEnd, `${row.renewBaseYear + 2}-06-30`);
  assert.equal(r.contractEnd, '2029-06-30');
});
