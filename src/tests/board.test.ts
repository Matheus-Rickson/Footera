import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState, moveClock } from '../database/repositories/competitionRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import {
  aiSackChance, eligibleForCoach, evaluateSeason, expectedPosition, matchDelta, monthlyDelta, objectiveFor, seasonBudgets, vetoReason,
} from '../game/board-engine/board.ts';
import { boardApprovesConstruction, coachOf, getBoardOverview, requestBudget, respondJobOffer } from '../database/repositories/boardRepository.ts';
import { makeOffer, searchMarket } from '../database/repositories/transferRepository.ts';
import { renegotiateContract, startNextSeason } from '../database/repositories/seasonRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import { isEmployed } from '../database/repositories/careerRepository.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'bd', teams = 6) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const clockTo = (db: SqlDb, to: string) => withTransaction(db, () => moveClock(db, getCareerState(db).gameDate, to, new Date('2030-01-01T00:00:00Z')));
function assertBooksBalance(db: SqlDb, initial: Map<string, number>) {
  for (const [id, start] of initial) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
}
const playAll = (db: SqlDb) => { for (let i = 0; i < 80 && n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); } };

test('Regras puras: posição esperada, objetivos por divisão, confiança, avaliação, orçamentos, veto, elegibilidade e demissões da IA', () => {
  assert.equal(expectedPosition(70, [80, 70, 60, 50]), 2);
  const top = { promotionSlots: 0, relegationSlots: 4, continentalSlots: 7 }, second = { promotionSlots: 4, relegationSlots: 4, continentalSlots: 0 };
  assert.deepEqual(objectiveFor(1, 20, top), { objective: 'title', target: 2 });
  assert.deepEqual(objectiveFor(3, 20, top), { objective: 'top4', target: 4 });
  assert.deepEqual(objectiveFor(6, 20, top), { objective: 'continental', target: 7 });
  assert.deepEqual(objectiveFor(9, 20, top), { objective: 'top_half', target: 10 });
  assert.deepEqual(objectiveFor(18, 20, top), { objective: 'survive', target: 16 });
  assert.deepEqual(objectiveFor(2, 20, second), { objective: 'promotion', target: 4 });
  assert.deepEqual(objectiveFor(6, 20, second), { objective: 'promotion_push', target: 7 });
  assert.equal(matchDelta(2, 0, 'top_half'), 1.5); assert.equal(matchDelta(1, 1, 'title'), 0); assert.equal(matchDelta(0, 1, 'title'), -2); assert.equal(matchDelta(0, 1, 'survive'), -1.5);
  assert.equal(monthlyDelta(10, 4, 2), 0, 'sem jogos suficientes'); assert.equal(monthlyDelta(3, 4, 5), 2); assert.equal(monthlyDelta(6, 4, 5), 0); assert.equal(monthlyDelta(15, 4, 5), -6);
  const base = { objective: 'top4' as const, target: 4, champion: false, promoted: false, relegated: false, balance: 1, youthTarget: 1, youthPromoted: 1 };
  const ok = evaluateSeason({ ...base, position: 3 }), bad = evaluateSeason({ ...base, position: 12, balance: -1, youthPromoted: 0 });
  assert.ok(ok.met && ok.confidenceDelta > 0 && ok.reputationDelta > 0);
  assert.ok(!bad.met && bad.confidenceDelta <= -30 && bad.reputationDelta < 0);
  assert.ok(evaluateSeason({ ...base, position: 1, champion: true }).reputationDelta > ok.reputationDelta);
  const rel = evaluateSeason({ ...base, position: 12, relegated: true }), norel = evaluateSeason({ ...base, position: 12 });
  assert.ok(rel.confidenceDelta < norel.confidenceDelta && rel.reputationDelta < norel.reputationDelta && rel.lines.includes('Rebaixamento.'));
  assert.deepEqual(seasonBudgets(10_000_000, 1_000_000, 500_000), { transfer: 4_000_000, wageCeiling: 550_000 });
  assert.equal(seasonBudgets(-5, 1_000_000, 900_000).transfer, 0);
  assert.match(vetoReason({ fee: 2_100_000, marketValue: 1_000_000 })!, /2× o valor/);
  assert.equal(vetoReason({ fee: 1_900_000, marketValue: 1_000_000 }), null);
  assert.match(vetoReason({ wage: 30_000, marketValue: 1_000_000 })!, /salário/);
  assert.ok(eligibleForCoach(40, 20, false) && !eligibleForCoach(50, 20, false) && eligibleForCoach(35, 20, true) && !eligibleForCoach(40, 20, true));
  assert.equal(aiSackChance(18, 5, 20, 4), 0); assert.ok(aiSackChance(18, 5, 20, 10) > 0); assert.equal(aiSackChance(7, 5, 20, 10), 0);
});

test('Diretoria: objetivos e orçamentos no início, passagem aberta, e a tela resume confiança, metas e orçamentos', async () => {
  const { db, clubId } = await setup('bd-start');
  const b = getBoardOverview(db);
  assert.equal(b.employed, true);
  assert.ok(b.club && b.club.confidence === 60 && b.club.objective.target >= 1 && b.club.budgets.transfer > 0 && b.club.budgets.wageCeiling >= b.club.budgets.payroll);
  assert.equal(b.spells.length, 1); assert.equal(b.spells[0]!.end, null);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM board_state WHERE club_id = ?', clubId), 1);
});

test('Diretoria veta: orçamento de transferências, teto da folha e taxa fora da realidade; compras consomem e vendas devolvem metade', async () => {
  const { db, clubId, initial } = await setup('bd-veto', 8);
  const cash = n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', clubId);
  const target = searchMarket(db, { maxValue: Math.floor(cash / 10) }).find((p) => p.clubId !== null && p.marketValue > 200_000)!;
  const buy = (fee: number, wage: number) => makeOffer(db, { playerId: target.id, fee, wage, years: 2 });
  db.prepare('UPDATE board_state SET transfer_budget = 0').run();
  const big = { fee: target.marketValue * 3, wage: Math.round(target.marketValue * 0.02) };
  assert.equal(buy(big.fee, big.wage).outcome, 'board_rejected', 'sem orçamento');
  db.prepare('UPDATE board_state SET transfer_budget = 1000000000, wage_ceiling = 1').run();
  const r1 = buy(big.fee, big.wage);
  assert.equal(r1.outcome, 'board_rejected'); assert.match(r1.message, /folha/);
  db.prepare('UPDATE board_state SET wage_ceiling = 1000000000').run();
  const r2 = buy(big.fee, big.wage);
  assert.equal(r2.outcome, 'board_rejected'); assert.match(r2.message, /2× o valor/);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM transfers WHERE player_id = ?', target.id), 0, 'nada se moveu');
  const fair = Math.round(target.marketValue * 1.2 / 1000) * 1000;
  const negotiate = () => {
    let res = buy(fair, Math.round(target.marketValue * 0.02));
    if (res.outcome === 'club_counter') res = buy(res.counterFee!, Math.round(target.marketValue * 0.02));
    if (res.outcome === 'player_counter') res = buy(res.counterFee ?? fair, res.counterWage!);
    return res;
  };
  db.prepare('UPDATE board_state SET transfer_budget = 0').run();
  const noBudget = negotiate();
  assert.equal(noBudget.outcome, 'board_rejected'); assert.match(noBudget.message, /orçamento/, 'termos justos, mas sem orçamento');
  db.prepare('UPDATE board_state SET transfer_budget = 1000000000').run();
  const res = negotiate();
  assert.equal(res.outcome, 'completed', res.message);
  const fee = n(db, 'SELECT fee AS n FROM transfers WHERE player_id = ?', target.id);
  assert.equal(n(db, 'SELECT transfer_spent AS n FROM board_state'), fee);
  assertBooksBalance(db, initial);
  // renovação com salário absurdo
  const mine = rowToPlayer(db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY birth_date DESC LIMIT 1').get(clubId)!);
  db.prepare("UPDATE players SET contract_end = '2027-07-01' WHERE id = ?").run(mine.id);
  const rr = renegotiateContract(db, { playerId: mine.id, wage: Math.round(mine.marketValue * 0.05) + 100_000, years: 1 });
  assert.equal(rr.outcome, 'rejected'); assert.match(rr.message, /diretoria/);
});

test('Diretoria: pedidos de orçamento (uma vez por temporada, dependem da confiança) e aprovação de obras grandes', async () => {
  const { db, clubId } = await setup('bd-req');
  db.prepare('UPDATE board_state SET confidence = 50').run();
  assert.equal(requestBudget(db, 'wage').approved, false);
  assert.throws(() => requestBudget(db, 'wage'), /já analisou/);
  db.prepare('UPDATE board_state SET confidence = 80').run();
  const before = getBoardOverview(db).club!.budgets.transfer;
  const r = requestBudget(db, 'transfer');
  assert.equal(r.approved, true, r.message);
  assert.equal(getBoardOverview(db).club!.budgets.transfer, before + Math.round(before * 0.25 / 1000) * 1000);
  const balance = n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', clubId);
  assert.equal(boardApprovesConstruction(db, Math.round(balance * 0.2)), null, 'obra pequena não precisa de aprovação');
  db.prepare('UPDATE board_state SET confidence = 40').run();
  assert.match(boardApprovesConstruction(db, Math.round(balance * 0.5))!, /confiança/);
});

test('Confiança: cada partida do usuário e o fechamento do mês mexem nela; abaixo de 25 vem o aviso', async () => {
  const { db } = await setup('bd-conf');
  advanceTime(db, 'nextMatchday');
  const c0 = getBoardOverview(db).club!.confidence;
  const res = simulateMatchday(db).userMatch!;
  const st = getCareerState(db);
  const home = String(db.prepare('SELECT home_club_id AS h FROM fixtures WHERE id = ?').get(res.fixtureId)!.h) === st.clubId;
  const gf = home ? res.homeGoals : res.awayGoals, ga = home ? res.awayGoals : res.homeGoals;
  assert.equal(getBoardOverview(db).club!.confidence, c0 + matchDelta(gf, ga, (db.prepare('SELECT objective FROM board_state').get()!.objective as never)));
  assert.equal(n(db, 'SELECT matches AS n FROM board_state'), 1);
  db.prepare('UPDATE board_state SET confidence = 26').run();
  db.exec("UPDATE fixtures SET status = 'played', home_goals = 0, away_goals = 3 WHERE status = 'scheduled' AND match_date < '2026-09-01'");
  db.prepare('UPDATE clubs SET balance = -1000000 WHERE id = ?').run(st.clubId); // caixa negativo pesa no fechamento do mês
  clockTo(db, '2026-09-02');
  assert.ok(getBoardOverview(db).club!.confidence < 26, 'caixa negativo no fechamento do mês derruba a confiança');
  db.prepare('UPDATE board_state SET confidence = 24').run();
  clockTo(db, '2026-09-03');
  assert.ok(getNews(db).some((x) => x.title.startsWith('Diretoria em alerta')));
});

test('Demissão e recolocação: demitido fica sem clube (comissão e listas zeradas, vaga aberta), o jogo segue, chega proposta e ele assume outro clube', async () => {
  const { db, clubId, initial } = await setup('bd-sack');
  db.exec("INSERT INTO staff (id, role, first_name, last_name, nationality, ability, salary, hired_on, contract_end) VALUES ('stf_x', 'doctor', 'A', 'B', 'BRA', 10, 1000, '2026-07-01', '2028-07-01')");
  db.prepare('UPDATE board_state SET confidence = 5, matches = 6').run();
  clockTo(db, '2026-07-02');
  assert.equal(isEmployed(db), false);
  assert.equal(getCareerState(db).clubId, '');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM staff'), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM job_vacancies WHERE club_id = ?', clubId), 1);
  const spell = db.prepare('SELECT end_date, end_reason FROM coach_spells WHERE club_id = ?').get(clubId)!;
  assert.deepEqual([spell.end_date, spell.end_reason], ['2026-07-02', 'sacked']);
  assert.ok(coachOf(db).reputation < 20);
  assert.equal(getBoardOverview(db).club, null);
  // o tempo e as partidas seguem sem clube do usuário
  playAll(db);
  assertBooksBalance(db, initial);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM finance_ledger WHERE date > ?', '2026-07-02'), 0, 'sem clube, sem extrato');
  const offers = getBoardOverview(db).offers;
  assert.ok(offers.length >= 1 || getNews(db).some((x) => x.kind === 'offer'), 'propostas para o desempregado');
  const pending = db.prepare("SELECT id, club_id FROM job_offers WHERE status = 'pending' ORDER BY id LIMIT 1").get()
    ?? (clockTo(db, getCareerState(db).gameDate.slice(0, 8) + '28'), db.prepare("SELECT id, club_id FROM job_offers WHERE status = 'pending' ORDER BY id LIMIT 1").get());
  assert.ok(pending, 'há proposta pendente');
  respondJobOffer(db, Number(pending!.id), true);
  assert.equal(getCareerState(db).clubId, String(pending!.club_id));
  const b = getBoardOverview(db);
  // confiança inicial: 65 ± crédito pela reputação do treinador em relação à do clube (−8..+8) + adaptabilidade
  const { hireConfidence } = await import('../game/coach-engine/coach.ts');
  const clubRep = Number(db.prepare('SELECT reputation FROM clubs WHERE id = ?').get(String(pending!.club_id))!.reputation);
  assert.equal(b.club!.confidence, hireConfidence(65, b.coachReputation, clubRep, b.coachAttributes));
  assert.ok(b.club!.confidence >= 57 && b.club!.confidence <= 81);
  assert.equal(b.spells.filter((s) => s.end === null).length, 1);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM job_vacancies WHERE club_id = ?', String(pending!.club_id)), 0);
});

test('Virada sem clube funciona; com clube, a avaliação mexe na reputação e pode demitir quem fracassou', async () => {
  const a = await setup('bd-turn-u');
  db_fire(a.db);
  playAll(a.db); advanceTime(a.db, 'nextMatchday');
  const r = startNextSeason(a.db);
  assert.equal(r.previous, null); assert.equal(r.board, null);
  assertBooksBalance(a.db, a.initial);
  const b = await setup('bd-turn-e');
  playAll(b.db); advanceTime(b.db, 'nextMatchday');
  db_setGoal(b.db, 1); // meta impossível de cumprir (a não ser que seja campeão)
  b.db.prepare('UPDATE board_state SET confidence = 20').run();
  const rep0 = coachOf(b.db).reputation, pts0 = coachOf(b.db).attributePoints ?? 0;
  const r2 = startNextSeason(b.db);
  assert.ok(r2.board);
  // a avaliação dá pontos de atributo ao treinador: 1 pela temporada (+1 objetivo, +1 título, +1 acesso)
  assert.ok((coachOf(b.db).attributePoints ?? 0) >= pts0 + 1, 'pontos de atributo na avaliação');
  if (!r2.board!.met) { assert.equal(r2.board!.sacked, true); assert.equal(isEmployed(b.db), false); assert.ok(coachOf(b.db).reputation < rep0); }
  assertBooksBalance(b.db, b.initial);
});
function db_fire(db: SqlDb) { db.prepare('UPDATE board_state SET confidence = 5, matches = 6').run(); clockTo(db, '2026-07-02'); assert.equal(isEmployed(db), false); }
function db_setGoal(db: SqlDb, target: number) { db.prepare('UPDATE board_state SET target_position = ?').run(target); }

test('Determinismo: diretoria, vagas e propostas idênticas com a mesma semente', async () => {
  const dump = async () => {
    const { db } = await setup('bd-det');
    db.prepare('UPDATE board_state SET confidence = 5, matches = 6').run();
    playAll(db);
    return JSON.stringify([db.prepare('SELECT * FROM job_offers ORDER BY id').all(), db.prepare('SELECT * FROM job_vacancies ORDER BY club_id').all(), db.prepare('SELECT * FROM coach_spells ORDER BY id').all(), db.prepare('SELECT coach_json FROM career').get()]);
  };
  assert.equal(await dump(), await dump());
});

test('Propostas com o treinador empregado: raras e seletivas (clube maior ou igual, 30 dias entre propostas, mesmo clube só depois de 90 dias)', async () => {
  const world = generateWorld({ seed: 'bd-pace', teamsPerLeagueOverride: 6 });
  const db = await openDatabase(':memory:');
  const small = [...world.clubs].sort((a, b) => a.reputation - b.reputation || a.id.localeCompare(b.id))[Math.floor(world.clubs.length / 4)]!;
  createCareer(db, world, { ...coach, reputation: 60 }, small.id);
  const { addDays: plus } = await import('../shared/date.ts');
  let d = getCareerState(db).gameDate;
  // todo clube completo com vaga aberta o tempo todo (pior caso para o excesso de propostas)
  for (let i = 0; i < 24; i++) {
    db.prepare(`INSERT OR IGNORE INTO job_vacancies (club_id, opened_on) SELECT id, ? FROM clubs WHERE id <> ?`).run(d, small.id);
    db.prepare('UPDATE board_state SET confidence = 80').run();
    const to = plus(d, 10);
    if (to >= '2027-06-30') break;
    clockTo(db, to); d = to;
    // responde nada: as propostas expiram sozinhas
  }
  assert.equal(getCareerState(db).clubId, small.id, 'continuou empregado');
  const offers = db.prepare('SELECT o.club_id, o.date, c.reputation FROM job_offers o JOIN clubs c ON c.id = o.club_id ORDER BY o.date, o.id').all()
    .map((r) => ({ club: String(r.club_id), date: String(r.date), rep: Number(r.reputation) }));
  assert.ok(offers.length >= 2, `amostra com propostas: ${offers.length}`);
  assert.ok(offers.length <= 9, `raras: ${offers.length} em 240 dias`);
  const myRep = Number(db.prepare('SELECT reputation FROM clubs WHERE id = ?').get(small.id)!.reputation);
  assert.ok(offers.every((o) => o.rep >= myRep), 'só clubes do mesmo tamanho ou maiores');
  const { daysBetween } = await import('../shared/date.ts');
  for (let i = 1; i < offers.length; i++) assert.ok(daysBetween(offers[i - 1]!.date, offers[i]!.date) >= 30, `espaço entre propostas: ${offers[i - 1]!.date} → ${offers[i]!.date}`);
  for (let i = 0; i < offers.length; i++) for (let j = i + 1; j < offers.length; j++) if (offers[i]!.club === offers[j]!.club) assert.ok(daysBetween(offers[i]!.date, offers[j]!.date) >= 90, `mesmo clube cedo demais: ${offers[i]!.club}`);
});
