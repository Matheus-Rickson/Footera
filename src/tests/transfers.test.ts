import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { activateScheme, autoLineup, saveScheme } from '../database/repositories/tacticsRepository.ts';
import { aiSignFreeAgents, FREE_AGENT_LEVEL, getNegotiation, getTransfersOverview, makeOffer, processMarketDay, proposeFee, respondOffer, searchMarket, setListed, TransferError } from '../database/repositories/transferRepository.ts';
import {
  askingPrice, clubDecision, estimateRange, groupOf, playerDecision, playerInterest, sellerWillingness, squadStaysValid, wageDemand, windowStatus,
} from '../game/transfer-engine/transfer.ts';
import { addDays } from '../shared/date.ts';
import { createRng } from '../game/rng.ts';
import { makePoster } from '../database/repositories/financeRepository.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach, Position } from '../shared/types.ts';
import type { MarketPlayerDto } from '../shared/api.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'tr-test') {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, world, clubId: world.clubs[0]!.id, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const balance = (db: SqlDb, id: string) => n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id);
function assertBooksBalance(db: SqlDb, initial: Map<string, number>) {
  for (const [id, start] of initial) assert.equal(balance(db, id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
}
const days = (db: SqlDb, from: string, to: string) => { for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) processMarketDay(db, d); };
/** Jogador do mercado que o clube do usuário consegue pagar mesmo na pior hipótese (taxa até 4× o valor de mercado). */
const target = (db: SqlDb, clubId: string): MarketPlayerDto => searchMarket(db, { maxValue: Math.floor(balance(db, clubId) / 4) }).find((p) => p.marketValue > 100_000)!;

test('Janelas: verão (1º/jul–31/ago) e inverno (janeiro) abrem e fecham nas datas certas', () => {
  const cases: Array<[string, boolean, string | null, string | null]> = [
    ['2026-07-01', true, null, '2026-09-01'], ['2026-08-31', true, null, '2026-09-01'], ['2026-09-01', false, '2027-01-01', null],
    ['2026-12-31', false, '2027-01-01', null], ['2027-01-01', true, null, '2027-02-01'], ['2027-02-01', false, '2027-07-01', null], ['2026-03-15', false, '2026-07-01', null],
  ];
  for (const [d, open, opens, closes] of cases) assert.deepEqual(windowStatus(d), { open, opensOn: opens, closesOn: closes }, d);
});

test('Regras: preço pedido, salário exigido, decisões, estimativas e validade do elenco', () => {
  const base = { marketValue: 10_000_000, age: 27, overall: 70, potentialHidden: 70, contractMonthsLeft: 36, isKey: false };
  const rich = { balance: 1e7 }, poor = { balance: -1 };
  assert.ok(askingPrice({ ...base, contractMonthsLeft: 4 }, rich) < askingPrice({ ...base, contractMonthsLeft: 10 }, rich));
  assert.ok(askingPrice({ ...base, contractMonthsLeft: 10 }, rich) < askingPrice(base, rich));
  assert.ok(askingPrice({ ...base, isKey: true }, rich) > askingPrice(base, rich));
  assert.ok(askingPrice({ ...base, age: 21, potentialHidden: 90 }, rich) > askingPrice({ ...base, age: 21 }, rich), 'promessa custa mais');
  assert.ok(askingPrice({ ...base, age: 34 }, rich) < askingPrice(base, rich));
  assert.ok(askingPrice(base, poor) < askingPrice(base, rich), 'clube no vermelho vende mais barato');
  assert.equal(askingPrice(base, rich) % 1000, 0);
  const pl = { marketValue: 10_000_000, salary: 100_000, ambition: 10 };
  assert.ok(wageDemand(pl, 40, 70) < wageDemand(pl, 60, 60), 'clube mais prestigioso paga menos');
  assert.ok(wageDemand(pl, 70, 40) > wageDemand(pl, 60, 60), 'clube menos prestigioso paga mais');
  assert.ok(wageDemand({ ...pl, ambition: 20 }, 50, 50) > wageDemand({ ...pl, ambition: 1 }, 50, 50));
  assert.deepEqual(clubDecision(100, 100), { kind: 'accept' }); assert.deepEqual(clubDecision(86, 100), { kind: 'counter', fee: 100 }); assert.deepEqual(clubDecision(84, 100), { kind: 'reject' });
  assert.deepEqual(playerDecision(97, 100), { kind: 'accept' }); assert.deepEqual(playerDecision(85, 100), { kind: 'counter', wage: 100 }); assert.deepEqual(playerDecision(79, 100), { kind: 'reject' });
  for (let ov = 1; ov <= 100; ov += 3) { const e = estimateRange(ov, ov + 5, 's', `p${ov}`); assert.ok(e.overall.low <= ov && ov <= e.overall.high, `faixa contém o real (${ov})`); assert.deepEqual(e, estimateRange(ov, ov + 5, 's', `p${ov}`)); }
  const sq = (spec: Array<[Position, number]>) => spec.flatMap(([pos, k], i) => Array.from({ length: k }, (_, j) => ({ id: `${i}-${j}`, position: pos })));
  const ok = sq([['GK', 3], ['CB', 4], ['LB', 2], ['CM', 4], ['AM', 2], ['ST', 3], ['LW', 2]]);
  assert.equal(squadStaysValid(ok, '0-0', 18), true);
  assert.equal(squadStaysValid(ok, '0-0', 21), false, 'tamanho mínimo');
  assert.equal(squadStaysValid(sq([['GK', 2], ['CB', 6], ['CM', 5], ['ST', 4], ['LB', 3]]), '0-0', 18), false, 'ficaria com 1 goleiro');
  assert.equal(groupOf('LB'), 'DEF'); assert.equal(groupOf('AM'), 'MID'); assert.equal(groupOf('RW'), 'ATT');
});

test('Mercado: só estimativas (nunca os atributos reais), sem jogadores do próprio clube, filtros e ordenação corretos', async () => {
  const { db, clubId, world } = await setup();
  const all = searchMarket(db, {});
  assert.equal(all.length, 100);
  for (const p of all) {
    assert.ok(!('overall' in p) && !('potentialHidden' in p) && !('attributes' in p), 'não pode vazar valores reais');
    const real = world.players.find((x) => x.id === p.id)!;
    assert.ok(p.estOverall.low <= real.overall && real.overall <= p.estOverall.high, 'faixa estimada contém o valor real');
    assert.notEqual(p.clubId, clubId);
  }
  assert.deepEqual(all.map((p) => p.marketValue), [...all].map((p) => p.marketValue).sort((a, b) => b - a));
  assert.ok(searchMarket(db, { position: 'GK' }).every((p) => p.position === 'GK'));
  assert.ok(searchMarket(db, { position: 'DEF' }).every((p) => ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(p.position)));
  assert.ok(searchMarket(db, { minAge: 30 }).every((p) => p.age >= 30));
  assert.ok(searchMarket(db, { maxAge: 20 }).every((p) => p.age <= 20));
  assert.ok(searchMarket(db, { maxValue: 500_000 }).every((p) => p.marketValue <= 500_000));
  const one = all[0]!;
  assert.deepEqual(searchMarket(db, { name: one.name.slice(2, 8) }).map((p) => p.id).includes(one.id), true);
  assert.deepEqual(searchMarket(db, { name: "x'; DROP TABLE players;--" }), [], 'busca por texto é parametrizada');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players') > 0, true);
  assert.deepEqual(searchMarket(db, {}), all, 'determinística');
});

test('Proposta: erros de regra (janela, valores, jogador próprio, elenco cheio, caixa) não alteram nada', async () => {
  const { db, clubId } = await setup();
  const t = target(db, clubId);
  const own = db.prepare('SELECT id FROM players WHERE club_id = ? LIMIT 1').get(clubId)!.id as string;
  const snap = () => JSON.stringify([db.prepare('SELECT id, club_id, salary FROM players ORDER BY id').all(), db.prepare('SELECT id, balance FROM clubs ORDER BY id').all(), n(db, 'SELECT COUNT(*) AS n FROM transfers')]);
  const before = snap();
  const bad: Array<[string, () => unknown, RegExp]> = [
    ['valor inválido', () => makeOffer(db, { playerId: t.id, fee: -1, wage: 1000, years: 3 }), /inválida/],
    ['anos 0', () => makeOffer(db, { playerId: t.id, fee: 1000, wage: 1000, years: 0 }), /inválida/],
    ['anos 6', () => makeOffer(db, { playerId: t.id, fee: 1000, wage: 1000, years: 6 }), /inválida/],
    ['fracionado', () => makeOffer(db, { playerId: t.id, fee: 1000.5, wage: 1000, years: 3 }), /inválida/],
    ['jogador inexistente', () => makeOffer(db, { playerId: 'plr_zzz', fee: 1000, wage: 1000, years: 3 }), /não encontrado/],
    ['jogador do próprio clube', () => makeOffer(db, { playerId: own, fee: 1000, wage: 1000, years: 3 }), /já é do seu clube/],
    ['caixa insuficiente', () => makeOffer(db, { playerId: t.id, fee: 9_999_999_999, wage: 1000, years: 3 }), /Caixa insuficiente/],
  ];
  for (const [label, fn, re] of bad) assert.throws(fn, (e) => e instanceof TransferError && re.test(e.message), label);
  assert.equal(snap(), before);
  db.exec("UPDATE career SET game_date = '2026-10-10'");
  assert.throws(() => makeOffer(db, { playerId: t.id, fee: 1000, wage: 1000, years: 3 }), /janela de transferências está fechada.*01\/01\/2027/);
  db.exec("UPDATE career SET game_date = '2026-07-10'");
  const others = db.prepare("SELECT id FROM players WHERE club_id <> ? LIMIT 11").all(clubId).map((r) => String(r.id)).filter((id) => id !== t.id);
  for (const id of others.slice(0, 10)) db.prepare('UPDATE players SET club_id = ? WHERE id = ?').run(clubId, id);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', clubId), 35);
  assert.throws(() => makeOffer(db, { playerId: t.id, fee: 1000, wage: 1000, years: 3 }), /máximo de 35/);
});

test('Negociação completa: clube e jogador respondem (recusa → contraproposta → aceite) e a contabilidade fecha', async () => {
  const { db, clubId, initial } = await setup();
  const t = target(db, clubId);
  const p0 = db.prepare('SELECT * FROM players WHERE id = ?').get(t.id)!;
  const seller = String(p0.club_id), money0 = [balance(db, clubId), balance(db, seller)];
  assert.equal(makeOffer(db, { playerId: t.id, fee: 1, wage: 1_000_000, years: 3 }).outcome, 'club_rejected');
  // sobe a oferta até o clube negociar: tem que haver contraproposta com o preço pedido
  let counter = null as null | { counterFee?: number };
  for (let fee = Math.round(t.marketValue * 0.3); fee < t.marketValue * 4; fee += Math.max(1000, Math.round(t.marketValue * 0.02))) {
    const r = makeOffer(db, { playerId: t.id, fee, wage: 1_000_000, years: 3 });
    if (r.outcome !== 'club_rejected') { assert.equal(r.outcome, 'club_counter', 'primeiro passo acima da recusa é uma contraproposta'); counter = r; break; }
  }
  assert.ok(counter && counter.counterFee! > 0);
  const ask = counter!.counterFee!;
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM transfers'), 0, 'nada acontece até haver acordo');
  assert.equal(makeOffer(db, { playerId: t.id, fee: ask, wage: 1, years: 3 }).outcome, 'player_rejected');
  const pc = makeOffer(db, { playerId: t.id, fee: ask, wage: 1, years: 3 });
  assert.equal(pc.outcome, 'player_rejected');
  // descobre o salário exigido
  let demand = 0;
  for (let w = 1000; w < 5_000_000_000 && !demand; w = Math.ceil(w * 1.05)) { const r = makeOffer(db, { playerId: t.id, fee: ask, wage: w, years: 3 }); if (r.outcome === 'player_counter') demand = r.counterWage!; if (r.outcome === 'completed') assert.fail('aceitou sem passar pela contraproposta'); }
  assert.ok(demand > 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM transfers'), 0);
  const done = makeOffer(db, { playerId: t.id, fee: ask, wage: demand, years: 4 });
  assert.equal(done.outcome, 'completed');
  const p1 = db.prepare('SELECT * FROM players WHERE id = ?').get(t.id)!;
  assert.equal(p1.club_id, clubId); assert.equal(Number(p1.salary), demand);
  assert.equal(p1.contract_end, addDays(getCareerState(db).gameDate, 4 * 365));
  const log = db.prepare('SELECT * FROM transfers').get()!;
  assert.deepEqual([log.player_id, log.from_club_id, log.to_club_id, Number(log.fee), Number(log.wage), Number(log.years), log.kind], [t.id, seller, clubId, ask, demand, 4, 'purchase']);
  assert.equal(balance(db, clubId), money0[0]! - ask); assert.equal(balance(db, seller), money0[1]! + ask);
  assert.equal(n(db, "SELECT SUM(amount) AS n FROM finance_ledger WHERE category = 'transfer_out'"), -ask);
  assert.equal(n(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ? AND category = 'transfer_in'", seller), ask);
  assertBooksBalance(db, initial);
  assert.throws(() => makeOffer(db, { playerId: t.id, fee: ask, wage: demand, years: 4 }), /já é do seu clube/);
  assert.equal(getTransfersOverview(db).squadSize, 26);
  assert.equal(searchMarket(db, {}).some((p) => p.id === t.id), false, 'sai do mercado depois de contratado');
});

test('Clube vendedor com elenco no limite recusa negociar', async () => {
  const { db, clubId } = await setup();
  const t = target(db, clubId);
  const seller = String(db.prepare('SELECT club_id FROM players WHERE id = ?').get(t.id)!.club_id);
  db.prepare('UPDATE players SET club_id = NULL WHERE club_id = ? AND id <> ? AND id NOT IN (SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 19)').run(seller, t.id, seller);
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', seller) <= 20);
  const r = makeOffer(db, { playerId: t.id, fee: t.marketValue * 4, wage: 9_000_000, years: 3 });
  assert.equal(r.outcome, 'club_rejected'); assert.match(r.message, /precisa do jogador/);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM transfers'), 0);
  assert.notEqual(clubId, seller);
});

test('Vendas: propostas chegam pelos transferíveis, podem ser aceitas/recusadas/expirar e o elenco mínimo é protegido', async () => {
  const { db, clubId, initial } = await setup();
  const top = db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY market_value DESC LIMIT 6 OFFSET 8').all(clubId).map((r) => String(r.id));
  for (const id of top) setListed(db, id, true);
  assert.equal(getTransfersOverview(db).mine.filter((p) => p.listed).length, 6);
  assert.throws(() => setListed(db, String(db.prepare('SELECT id FROM players WHERE club_id <> ? LIMIT 1').get(clubId)!.id), true), /seu clube/);
  days(db, '2026-07-01', '2026-07-31');
  const ov = getTransfersOverview(db);
  assert.ok(ov.incoming.length >= 1 && ov.incoming.length <= 5, `propostas: ${ov.incoming.length}`);
  for (const o of ov.incoming) assert.ok(o.fee > 0 && o.expires === addDays(o.date, 7));
  const [first, second] = ov.incoming;
  const money = balance(db, clubId);
  respondOffer(db, first!.id, true);
  assert.equal(balance(db, clubId), money + first!.fee);
  assert.equal(String(db.prepare('SELECT club_id FROM players WHERE id = ?').get(first!.playerId)!.club_id) !== clubId, true);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM transfers WHERE kind = 'sale' AND fee = ?", first!.fee), 1);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM transfer_list WHERE player_id = ?", first!.playerId), 0, 'sai da lista de transferíveis');
  assertBooksBalance(db, initial);
  assert.throws(() => respondOffer(db, first!.id, true), /já foi respondida/);
  if (second) { respondOffer(db, second.id, false); assert.equal(String(db.prepare('SELECT status FROM transfer_offers WHERE id = ?').get(second.id)!.status), 'rejected'); }
  assert.throws(() => respondOffer(db, 99999, true), /não encontrada/);
  // expira em 7 dias
  const pend = db.prepare("SELECT id, expires FROM transfer_offers WHERE status = 'pending' LIMIT 1").get();
  if (pend) { days(db, '2026-07-31', addDays(String(pend.expires), 1)); assert.equal(String(db.prepare('SELECT status FROM transfer_offers WHERE id = ?').get(pend.id)!.status), 'expired'); assert.throws(() => respondOffer(db, Number(pend.id), true), /respondida ou expirou|expirou/); }
});

test('Vendas: não é possível aceitar se o elenco ficaria incompleto ou com a janela fechada', async () => {
  const { db, clubId } = await setup('tr-guard');
  const pid = String(db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY market_value DESC LIMIT 1 OFFSET 8').get(clubId)!.id);
  const buyer = String(db.prepare('SELECT id FROM clubs WHERE id <> ? LIMIT 1').get(clubId)!.id);
  db.prepare("INSERT INTO transfer_offers (date, expires, player_id, buyer_club_id, seller_club_id, fee) VALUES ('2026-07-01', '2026-12-31', ?, ?, ?, 1000000)").run(pid, buyer, clubId);
  const offerId = Number(db.prepare('SELECT id FROM transfer_offers').get()!.id);
  // elenco com exatamente 18 jogadores: sem o vendido, ficaria com 17 (< mínimo de 18)
  db.prepare('UPDATE players SET club_id = NULL WHERE club_id = ? AND id <> ? AND id NOT IN (SELECT id FROM players WHERE club_id = ? AND id <> ? ORDER BY id LIMIT 17)').run(clubId, pid, clubId, pid);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', clubId), 18);
  assert.throws(() => respondOffer(db, offerId, true), /elenco ficaria incompleto/);
  assert.equal(String(db.prepare('SELECT status FROM transfer_offers WHERE id = ?').get(offerId)!.status), 'pending', 'a proposta continua pendente');
  assert.equal(String(db.prepare('SELECT club_id FROM players WHERE id = ?').get(pid)!.club_id), clubId);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM transfers'), 0);
  db.prepare('UPDATE players SET club_id = ? WHERE club_id IS NULL').run(clubId); // elenco completo de novo
  db.exec("UPDATE career SET game_date = '2026-10-01'");
  assert.throws(() => respondOffer(db, offerId, true), /janela de transferências está fechada/);
  db.exec("UPDATE career SET game_date = '2026-07-20'");
  respondOffer(db, offerId, true); // com elenco completo e janela aberta, o aceite funciona
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM transfers'), 1);
});

test('Mercado da IA: ocorre só dentro das janelas, respeita limites de elenco, fecha as contas e é determinístico', async () => {
  const [a, b] = [await setup('tr-ai'), await setup('tr-ai')];
  for (const { db } of [a, b]) days(db, '2026-07-01', '2026-08-31');
  const ai = n(a.db, "SELECT COUNT(*) AS n FROM transfers WHERE kind = 'ai'");
  assert.ok(ai >= 8 && ai <= 150, `transferências da IA: ${ai}`);
  const dump = (db: SqlDb) => JSON.stringify([db.prepare('SELECT * FROM transfers ORDER BY id').all(), db.prepare('SELECT id, club_id, salary, contract_end FROM players ORDER BY id').all(), db.prepare('SELECT id, balance FROM clubs ORDER BY id').all()]);
  assert.equal(dump(a.db), dump(b.db), 'mesma semente, mesmo mercado');
  for (const c of a.world.clubs) {
    const sq = a.db.prepare('SELECT id, position FROM players WHERE club_id = ?').all(c.id).map((r) => ({ id: String(r.id), position: String(r.position) as Position }));
    if (c.id === a.clubId) { assert.equal(sq.length, 25, 'o clube do usuário não é mexido pela IA'); continue; }
    assert.ok(sq.length >= 20 && sq.length <= 30, `${c.name}: ${sq.length} jogadores`);
    assert.equal(squadStaysValid(sq, '__nenhum__', 20), true, `${c.name} ficou com elenco desequilibrado`);
  }
  assert.equal(n(a.db, "SELECT COUNT(*) AS n FROM transfers WHERE from_club_id = ? OR to_club_id = ?", a.clubId, a.clubId), 0);
  assertBooksBalance(a.db, a.initial);
  const after = n(a.db, 'SELECT COUNT(*) AS n FROM transfers');
  days(a.db, '2026-08-31', '2026-12-31');
  assert.equal(n(a.db, 'SELECT COUNT(*) AS n FROM transfers'), after, 'nada acontece com a janela fechada');
  days(a.db, '2026-12-31', '2027-01-31');
  assert.ok(n(a.db, 'SELECT COUNT(*) AS n FROM transfers') > after, 'a janela de inverno reabre o mercado');
  assert.equal(n(a.db, 'SELECT COUNT(*) AS n FROM (SELECT player_id FROM transfers GROUP BY player_id HAVING COUNT(*) > 6)'), 0, 'ninguém vira "bola de pingue-pongue"');
});

test('Avançar o tempo: saltar até a rodada equivale a avançar dia a dia (mercado e cobrança na mesma ordem)', async () => {
  const [a, b] = [await setup('tr-step'), await setup('tr-step')];
  assert.equal(advanceTime(b.db, 'nextMatchday').toDate, '2026-08-01');
  for (let i = 0; i < 31; i++) assert.equal(advanceTime(a.db, 'day').advanced, true);
  assert.equal(getCareerState(a.db).gameDate, '2026-08-01');
  const dump = (db: SqlDb) => JSON.stringify([db.prepare('SELECT * FROM transfers ORDER BY id').all(), db.prepare('SELECT id, club_id, salary FROM players ORDER BY id').all(),
    db.prepare('SELECT id, balance FROM clubs ORDER BY id').all(), db.prepare('SELECT * FROM finance_months ORDER BY club_id, month, category').all(), db.prepare('SELECT * FROM transfer_offers ORDER BY id').all()]);
  assert.equal(dump(a.db), dump(b.db));
  assertBooksBalance(b.db, b.initial);
});

test('Integração com a escalação: jogador vendido some do esquema manual e o jogo avisa o ajuste', async () => {
  const { db, clubId } = await setup('tr-lineup');
  const lineup = autoLineup(db, '4-3-3');
  const s = saveScheme(db, { name: 'Manual', formation: '4-3-3', settings: { mentality: 'balanced', tempo: 3, width: 3, defensiveLine: 3, pressing: 3, buildUp: 'mixed' }, lineup });
  activateScheme(db, s.id);
  const star = lineup[10]!; // atacante titular
  setListed(db, star, true);
  db.prepare("INSERT INTO transfer_offers (date, expires, player_id, buyer_club_id, seller_club_id, fee) VALUES ('2026-07-01', '2026-12-31', ?, ?, ?, 1000000)")
    .run(star, String(db.prepare('SELECT id FROM clubs WHERE id <> ? LIMIT 1').get(clubId)!.id), clubId);
  respondOffer(db, Number(db.prepare('SELECT id FROM transfer_offers').get()!.id), true);
  advanceTime(db, 'nextMatchday');
  const sim = simulateMatchday(db);
  assert.equal(sim.notes.length, 1);
  assert.match(sim.notes[0]!, /Escalação ajustada/);
});

test('Negociação em etapas: a consulta da taxa decide como a proposta completa, não grava nada; janela mostra só dados públicos', async () => {
  const { db, clubId } = await setup();
  const t = target(db, clubId);
  const snap = () => JSON.stringify([db.prepare('SELECT club_id, salary FROM players WHERE id = ?').get(t.id), n(db, 'SELECT COUNT(*) AS n FROM transfers'), n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_ledger')]);
  const before = snap();
  // a etapa 1 tem que dar exatamente a mesma resposta do clube que a proposta completa (com salário que o jogador recusa, para não concluir)
  for (const k of [0.3, 0.7, 0.9, 1, 1.3, 2]) {
    const fee = Math.round(t.marketValue * k);
    const a = proposeFee(db, t.id, fee), b = makeOffer(db, { playerId: t.id, fee, wage: 1, years: 3 });
    if (a.outcome === 'accepted') assert.equal(b.outcome, 'player_rejected', `taxa ${k}`);
    else { assert.equal(b.outcome, a.outcome, `taxa ${k}`); assert.equal(b.counterFee, a.counterFee); }
  }
  assert.equal(snap(), before, 'consultar a taxa não altera nada');
  assert.throws(() => proposeFee(db, t.id, -5), /inválida/);
  db.exec("UPDATE career SET game_date = '2026-10-10'");
  assert.throws(() => proposeFee(db, t.id, t.marketValue), /janela de transferências está fechada/);
  const closed = getNegotiation(db, t.id);
  assert.equal(closed.windowOpen, false); assert.equal(closed.opensOn, '2027-01-01');
  db.exec("UPDATE career SET game_date = '2026-07-10'");
  const free = db.prepare('SELECT id FROM players WHERE club_id IS NOT NULL AND club_id <> ? LIMIT 1').get(clubId)!.id as string;
  db.prepare('UPDATE players SET club_id = NULL WHERE id = ?').run(free);
  assert.throws(() => proposeFee(db, free, 0), /sem clube/);
  assert.equal(getNegotiation(db, free).clubWillingness, null, 'livre: sem clube vendedor');

  const neg = getNegotiation(db, t.id);
  assert.equal(neg.player.id, t.id); assert.ok(!('overall' in neg.player));
  assert.equal(neg.balance, balance(db, clubId));
  assert.equal(neg.payroll, n(db, 'SELECT SUM(salary) AS n FROM players WHERE club_id = ?', clubId));
  assert.ok(neg.clubWillingness! > 0 && neg.playerInterest > 0);
  // regras puras: contrato perto do fim e veterano aumentam a disposição; clube que não pode vender = 0; prestígio guia o interesse
  const w = (o: Partial<Parameters<typeof sellerWillingness>[0]>) => sellerWillingness({ contractMonthsLeft: 36, age: 26, sellerBalance: 1, canSell: true, ...o });
  assert.ok(w({ contractMonthsLeft: 5 }) > w({ contractMonthsLeft: 11 }) && w({ contractMonthsLeft: 11 }) > w({ contractMonthsLeft: 20 }) && w({ contractMonthsLeft: 20 }) > w({}));
  assert.ok(w({ age: 33 }) > w({})); assert.ok(w({ sellerBalance: -1 }) > w({})); assert.equal(w({ canSell: false }), 0);
  assert.ok(playerInterest(70, 40) > playerInterest(50, 50) && playerInterest(50, 50) > playerInterest(40, 70));
  assert.equal(playerInterest(50, 50), 50);
});

test('Mercado: situação pública do jogador (lesão em curso, suspensão e cartões da temporada)', async () => {
  const { db, clubId } = await setup();
  const t = target(db, clubId);
  const st = (id: string) => searchMarket(db, { name: db.prepare("SELECT first_name || ' ' || last_name AS n FROM players WHERE id = ?").get(id)!.n as string }).find((p) => p.id === id)!.status;
  assert.deepEqual(st(t.id), { injuredUntil: null, suspension: 0, yellows: 0, reds: 0 });
  const comp = db.prepare('SELECT id FROM competitions WHERE season = ? LIMIT 1').get(getCareerState(db).season)!.id;
  db.prepare("INSERT INTO player_status (player_id, injury_until, injury_note, suspension_matches, yellow_cards) VALUES (?, '2026-08-01', 'x', 2, 1)").run(t.id);
  db.prepare('INSERT INTO player_season_stats (player_id, competition_id, club_id, yellow_cards, red_cards) VALUES (?,?,?,3,1)').run(t.id, comp, t.clubId);
  assert.deepEqual(st(t.id), { injuredUntil: '2026-08-01', suspension: 2, yellows: 3, reds: 1 });
  db.exec("UPDATE career SET game_date = '2026-08-01'");
  assert.equal(st(t.id).injuredUntil, null, 'lesão que termina hoje já não aparece');
});

test('Mercado: atributos resumidos são estimativas (faixas que contêm o real), iguais aos da ficha, largas sem conhecimento e exatas com 100%', async () => {
  const { summarizeRanges } = await import('../shared/attributeSummary.ts');
  const { getPlayerProfile } = await import('../database/repositories/scoutRepository.ts');
  const { db, world } = await setup();
  const all = searchMarket(db, {});
  const [a, b] = [all[0]!, all[1]!];
  db.prepare("INSERT OR REPLACE INTO scout_knowledge (player_id, knowledge, updated_on) VALUES (?, 100, '2026-07-01'), (?, 60, '2026-07-01')").run(a.id, b.id);
  const again = searchMarket(db, {});
  const est = again.find((p) => p.id === b.id)!.estSummary;
  const none = all.find((p) => p.id === b.id)!.estSummary; // antes de observar (0%)
  assert.ok(Object.keys(none).every((k) => none[k as keyof typeof none].high - none[k as keyof typeof none].low >= est[k as keyof typeof est].high - est[k as keyof typeof est].low), 'observar estreita as faixas');
  const exact = (g: object) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { low: v as number, high: v as number }]));
  const ra = world.players.find((x) => x.id === b.id)!.attributes;
  const real = summarizeRanges({ technical: exact(ra.technical), mental: exact(ra.mental), physical: exact(ra.physical), goalkeeper: exact(ra.goalkeeper!) });
  for (const k of Object.keys(real) as Array<keyof typeof real>) {
    assert.ok(est[k].low <= real[k].low && real[k].low <= est[k].high, `${k}: real ${real[k].low} fora de ${est[k].low}–${est[k].high}`);
    assert.ok(est[k].high > est[k].low, `${k}: é faixa, não o valor real`);
  }
  assert.deepEqual(est, summarizeRanges(getPlayerProfile(db, b.id).attributes), 'mesma estimativa da ficha');
  const ea = world.players.find((x) => x.id === a.id)!.attributes;
  assert.deepEqual(again.find((p) => p.id === a.id)!.estSummary, summarizeRanges({ technical: exact(ea.technical), mental: exact(ea.mental), physical: exact(ea.physical), goalkeeper: exact(ea.goalkeeper!) }), '100%: resumo exato');
});

test('Mercado paginado: todos os disponíveis, várias posições (natural ou secundária), nacionalidade, contrato, situação, salário, pé e olheiros', async () => {
  const { searchMarketPage } = await import('../database/repositories/transferRepository.ts');
  const { db, clubId } = await setup();
  const pool = Number(db.prepare('SELECT COUNT(*) AS n FROM players WHERE retired = 0 AND youth_club_id IS NULL AND (club_id IS NULL OR club_id <> ?)').get(clubId)!.n);
  const first = searchMarketPage(db, {});
  assert.equal(first.total, pool, 'total = todos os jogadores disponíveis (não só 100)');
  // páginas cobrem tudo, sem repetir
  const ids = new Set<string>();
  for (let off = 0; off < first.total; off += 250) for (const p of searchMarketPage(db, { offset: off, limit: 250 }).players) ids.add(p.id);
  assert.equal(ids.size, pool);
  assert.ok(first.nationalities.length >= 1 && first.nationalities.reduce((s, n) => s + n.count, 0) === pool);
  // várias posições: natural OU secundária em qualquer uma
  const all = (f: Parameters<typeof searchMarketPage>[1]) => searchMarketPage(db, { ...f, limit: 500, offset: 0 });
  const want = new Set(['CB', 'DM'] as const);
  const multi = all({ positions: ['CB', 'DM'] });
  assert.ok(multi.players.every((p) => want.has(p.position as 'CB') || p.secondaryPositions.some((s) => want.has(s as 'CB'))));
  const viaSecondary = multi.players.filter((p) => !want.has(p.position as 'CB'));
  assert.ok(viaSecondary.length > 0, 'aparece quem tem a posição como secundária');
  const natural = all({ positions: ['CB', 'DM'], naturalOnly: true });
  assert.ok(natural.players.every((p) => want.has(p.position as 'CB')));
  assert.equal(natural.total + viaSecondary.length, multi.total);
  assert.ok(all({ positions: ['CB'] }).total < multi.total, 'somar posições amplia a busca');
  // nacionalidade (várias)
  const code = first.nationalities[0]!.code;
  const byNat = all({ nationalities: [code] });
  assert.equal(byNat.total, first.nationalities[0]!.count);
  assert.ok(byNat.players.every((p) => p.nationality === code));
  assert.equal(all({ nationalities: first.nationalities.map((n) => n.code) }).total, pool);
  // contrato, situação, salário, pé
  const season = getCareerState(db).season;
  assert.ok(all({ contractEndsBy: 'season' }).players.every((p) => p.clubId === null || p.contractEnd <= `${season + 1}-06-30`));
  assert.ok(all({ contractEndsBy: 'season' }).total < all({ contractEndsBy: 'next' }).total);
  const club = all({ clubOnly: true }), free = all({ freeOnly: true });
  assert.ok(club.players.every((p) => p.clubId !== null) && free.players.every((p) => p.clubId === null));
  assert.equal(club.total + free.total, pool);
  assert.ok(all({ maxWage: 20000 }).players.every((p) => p.salary <= 20000));
  assert.ok(all({ foot: 'left' }).players.every((p) => p.foot === 'left'));
  // olheiros
  const [a, b] = first.players;
  db.prepare("INSERT OR REPLACE INTO scout_knowledge (player_id, knowledge, updated_on) VALUES (?, 60, '2026-07-01')").run(a!.id);
  db.prepare("INSERT OR REPLACE INTO scout_shortlist (player_id, added_on) VALUES (?, '2026-07-01')").run(b!.id);
  assert.ok(all({ knownOnly: true }).players.some((p) => p.id === a!.id) && all({ knownOnly: true }).players.every((p) => p.knowledge >= 25));
  assert.deepEqual(all({ shortlistedOnly: true }).players.map((p) => p.id), [b!.id]);
});

test('Livres acima do nível 12 são contratados por um clube em que sejam reforço; os comuns ficam no mercado', async () => {
  const { db, clubId, initial } = await setup('tr-strong-free');
  const ids = db.prepare('SELECT id FROM players WHERE club_id IS NOT NULL AND club_id <> ? ORDER BY overall DESC LIMIT 6').all(clubId).map((r) => String(r.id));
  const strong = ids.slice(0, 3), weak = ids.slice(3);
  for (const id of ids) db.prepare('UPDATE players SET club_id = NULL WHERE id = ?').run(id);
  for (const id of weak) db.prepare('UPDATE players SET overall = ? WHERE id = ?').run(FREE_AGENT_LEVEL, id);
  assert.ok(strong.every((id) => n(db, 'SELECT overall AS n FROM players WHERE id = ?', id) > FREE_AGENT_LEVEL));
  const date = getCareerState(db).gameDate;
  // não é certeza (um ou outro livre forte pode sobrar): em algumas viradas seguidas, todos acabam contratados
  for (let k = 0; k < 6; k++) aiSignFreeAgents(db, makePoster(db, clubId), createRng(`strong:${k}`), date, clubId, true);
  for (const id of strong) {
    const to = db.prepare('SELECT club_id FROM players WHERE id = ?').get(id)!.club_id;
    assert.ok(to && to !== clubId, `livre forte ${id} contratado pela IA`);
  }
  assert.ok(weak.every((id) => db.prepare('SELECT club_id FROM players WHERE id = ?').get(id)!.club_id === null), 'livres no nível ficam livres (elencos sem carência)');
  assertBooksBalance(db, initial);
});
