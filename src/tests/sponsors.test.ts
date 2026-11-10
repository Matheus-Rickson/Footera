import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { createRng } from '../game/rng.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { getLedgerPage, makePoster, settleFinancesTx } from '../database/repositories/financeRepository.ts';
import {
  acceptSponsorOffer, getFinancePage, negotiateSponsor, paySponsorBonuses, searchSponsors, sponsorSlots, terminateSponsor,
} from '../database/repositories/sponsorRepository.ts';
import { bonusesDue, monthsLeft, offerBonuses, SPONSOR_NAMES, sponsorOffers, sponsorReply, terminationFee } from '../game/finance-engine/sponsors.ts';
import { addDays } from '../shared/date.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'spn-test') {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
function assertBooksBalance(db: SqlDb, initial: Map<string, number>) {
  for (const [id, start] of initial) {
    assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
  }
}
/** faz a cota de camisa do usuário vencer em `days` dias */
function shirtEndsIn(db: SqlDb, clubId: string, days: number) {
  const date = getCareerState(db).gameDate;
  db.prepare("UPDATE sponsor_deals SET end_date = ? WHERE club_id = ? AND kind = 'shirt' AND start_date <= ? AND end_date >= ?").run(addDays(date, days), clubId, date, date);
}

test('Propostas: 2–3 empresas diferentes por cota, perfis fixo e com bônus nas faixas, determinísticas', () => {
  const a = sponsorOffers({ reference: 100_000, kind: 'shirt', tier: 1, targetPosition: 4, names: SPONSOR_NAMES.shirt }, createRng('x'));
  const b = sponsorOffers({ reference: 100_000, kind: 'shirt', tier: 1, targetPosition: 4, names: SPONSOR_NAMES.shirt }, createRng('x'));
  assert.deepEqual(a, b);
  let fixed = 0, bonus = 0, nf = 0, nb = 0;
  for (let i = 0; i < 300; i++) {
    const offers = sponsorOffers({ reference: 100_000, kind: 'kit', tier: 2, targetPosition: 6, names: SPONSOR_NAMES.kit }, createRng(`o${i}`));
    assert.ok(offers.length >= 2 && offers.length <= 3);
    assert.equal(new Set(offers.map((o) => o.sponsor)).size, offers.length, 'empresas diferentes');
    for (const o of offers) {
      assert.ok(o.ceiling > o.monthly && o.years >= 2 && o.years <= 4);
      if (o.profile === 'fixed') { assert.ok(o.monthly >= 102_000 && o.monthly <= 110_000); assert.equal(o.bonuses.length, 0); fixed += o.monthly; nf++; }
      else { assert.ok(o.monthly >= 82_000 && o.monthly <= 90_000); assert.deepEqual(o.bonuses.map((x) => x.trigger), ['league_title', 'promotion', 'cup_title']); bonus += o.monthly; nb++; }
    }
  }
  assert.ok(Math.abs(fixed / nf - 106_000) < 1500 && Math.abs(bonus / nb - 86_000) < 1500, 'médias no meio das faixas');
  assert.deepEqual(offerBonuses(10_000, 1, 3).map((x) => [x.trigger, x.amount, x.target]), [['league_title', 40_000, undefined], ['position', 15_000, 3], ['cup_title', 20_000, undefined]]);
});

test('Resposta da empresa: aceita até o teto, sobe 40% da diferença até o teto e desiste no 3º pedido acima', () => {
  assert.deepEqual(sponsorReply({ asked: 24_000, standing: 25_000, ceiling: 30_000, round: 0 }), { kind: 'accept', monthly: 24_000 });
  assert.deepEqual(sponsorReply({ asked: 29_000, standing: 25_000, ceiling: 30_000, round: 0 }), { kind: 'accept', monthly: 29_000 });
  assert.deepEqual(sponsorReply({ asked: 35_000, standing: 25_000, ceiling: 30_000, round: 0 }), { kind: 'counter', monthly: 29_000, roundsLeft: 2 });
  assert.deepEqual(sponsorReply({ asked: 35_000, standing: 29_000, ceiling: 30_000, round: 1 }), { kind: 'counter', monthly: 30_000, roundsLeft: 1 });
  assert.deepEqual(sponsorReply({ asked: 35_000, standing: 30_000, ceiling: 30_000, round: 2 }), { kind: 'walkout' });
  assert.equal(monthsLeft('2026-07-10', '2026-09-09'), 2);
  assert.equal(monthsLeft('2026-07-10', '2028-07-09'), 24);
  assert.equal(terminationFee(10_000, '2026-07-10', '2028-07-09'), 30_000);
  assert.equal(terminationFee(10_000, '2026-07-10', '2026-08-01'), 10_000, 'limitada ao que resta');
  const bonuses = offerBonuses(10_000, 1, 4);
  assert.deepEqual(bonusesDue(bonuses, { champion: true, position: 1 }).map((b) => b.trigger), ['league_title', 'position']);
  assert.deepEqual(bonusesDue(bonuses, { position: 5 }), []);
  assert.deepEqual(bonusesDue(bonuses, { cupTitle: true }).map((b) => b.trigger), ['cup_title']);
});

test('Janela de renovação: propostas chegam 60 dias antes com e-mail; contraproposta, aceite e contrato que começa após o atual', async () => {
  const { db, clubId, initial } = await setup();
  shirtEndsIn(db, clubId, 62);
  advanceTime(db, 'day');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM sponsor_offers WHERE kind = 'shirt'"), 0, 'a 61 dias ainda não');
  advanceTime(db, 'day');
  const slot = sponsorSlots(db).find((s) => s.kind === 'shirt')!;
  assert.ok(slot.offers.length >= 2, 'propostas na janela');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM news WHERE title LIKE 'Patrocínio:%camisa%'"), 1, 'e-mail do departamento comercial');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM sponsor_offers WHERE club_id <> ?', clubId), 0, 'clubes da IA não recebem propostas');
  const offer = slot.offers[0]!;
  const ceiling = n(db, 'SELECT ceiling AS n FROM sponsor_offers WHERE id = ?', offer.id);
  const c = negotiateSponsor(db, { offerId: offer.id, monthly: ceiling * 2, years: 3 });
  assert.equal(c.outcome, 'counter');
  assert.ok(c.monthly! > offer.standing && c.monthly! <= ceiling);
  const ok = negotiateSponsor(db, { offerId: offer.id, monthly: ceiling, years: 3 });
  assert.equal(ok.outcome, 'accepted');
  const cur = sponsorSlots(db).find((s) => s.kind === 'shirt')!;
  assert.equal(cur.upcoming!.monthly, ceiling);
  assert.equal(cur.upcoming!.start, addDays(cur.current!.end, 1), 'começa no dia seguinte ao fim do atual');
  assert.equal(cur.offers.length, 0, 'as outras propostas da cota são encerradas');
  assertBooksBalance(db, initial);
});

test('Desistência: no 3º pedido acima do teto a empresa encerra a conversa por 30 dias', async () => {
  const { db, clubId } = await setup();
  shirtEndsIn(db, clubId, 30);
  advanceTime(db, 'day');
  const offer = sponsorSlots(db).find((s) => s.kind === 'shirt')!.offers[0]!;
  const big = offer.standing * 3;
  assert.equal(negotiateSponsor(db, { offerId: offer.id, monthly: big, years: 2 }).outcome, 'counter');
  assert.equal(negotiateSponsor(db, { offerId: offer.id, monthly: big, years: 2 }).outcome, 'counter');
  const w = negotiateSponsor(db, { offerId: offer.id, monthly: big, years: 2 });
  assert.equal(w.outcome, 'walkout');
  assert.throws(() => acceptSponsorOffer(db, offer.id, 2), /encerrou a conversa/);
  const shown = sponsorSlots(db).find((s) => s.kind === 'shirt')!.offers.find((o) => o.id === offer.id)!;
  assert.deepEqual([shown.status, shown.lockedUntil], ['walkout', addDays(getCareerState(db).gameDate, 30)]);
});

test('Vencimento sem decisão: a melhor proposta é aceita automaticamente e a cota não fica sem receita', async () => {
  const { db, clubId, initial } = await setup();
  shirtEndsIn(db, clubId, 1);
  advanceTime(db, 'day'); // propostas chegam (janela)
  advanceTime(db, 'day'); // venceu ontem? ainda vale hoje
  advanceTime(db, 'day'); // hoje sem contrato: aceite automático
  const slot = sponsorSlots(db).find((s) => s.kind === 'shirt')!;
  assert.ok(slot.current && slot.current.negotiated, 'contrato novo vindo das propostas');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM news WHERE title LIKE 'Patrocínio renovado automaticamente%'"), 1);
  settleFinancesTx(db, '2026-08-01');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_ledger WHERE category = 'sponsorship' AND date = '2026-08-01'"), 3, 'as 3 cotas pagas no mês');
  assertBooksBalance(db, initial);
});

test('Rescisão: multa via makePoster, cota vaga sem receita até buscar e fechar outro contrato (que começa hoje)', async () => {
  const { db, clubId, initial } = await setup();
  const before = sponsorSlots(db).find((s) => s.kind === 'kit')!.current!;
  const bal = n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', clubId);
  terminateSponsor(db, 'kit');
  assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', clubId), bal - before.terminationFee);
  assert.equal(before.terminationFee, before.monthly * Math.min(3, monthsLeft(getCareerState(db).gameDate, before.end)));
  const vacant = sponsorSlots(db).find((s) => s.kind === 'kit')!;
  assert.ok(vacant.vacant && vacant.canSearch && !vacant.current);
  // um mês inteiro sem decidir: nada é pago nem criado para a cota vaga
  for (let i = 0; i < 25; i++) advanceTime(db, 'day');
  settleFinancesTx(db, '2026-08-01');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_ledger WHERE category = 'sponsorship' AND date = '2026-08-01' AND description LIKE '%material esportivo%'"), 0);
  assert.ok(sponsorSlots(db).find((s) => s.kind === 'kit')!.vacant, 'continua vaga');
  searchSponsors(db, 'kit');
  assert.throws(() => searchSponsors(db, 'kit'), /propostas abertas/);
  const offer = sponsorSlots(db).find((s) => s.kind === 'kit')!.offers[0]!;
  acceptSponsorOffer(db, offer.id, 2);
  const now = sponsorSlots(db).find((s) => s.kind === 'kit')!;
  assert.equal(now.current!.start, getCareerState(db).gameDate);
  assert.equal(now.current!.monthly, offer.standing);
  assertBooksBalance(db, initial);
  const ledger = getLedgerPage(db, 0, 'sponsorship');
  assert.ok(ledger.rows.some((r) => r.description.startsWith('Rescisão do patrocínio') && r.amount === -before.terminationFee));
});

test('Bônus: título e posição pagos uma vez por contrato com bônus, via makePoster', async () => {
  const { db, clubId, initial } = await setup();
  const date = getCareerState(db).gameDate;
  db.prepare("UPDATE sponsor_deals SET bonus_json = ? WHERE club_id = ? AND kind = 'shirt'").run(JSON.stringify(offerBonuses(10_000, 1, 4)), clubId);
  const post = makePoster(db, clubId);
  assert.equal(paySponsorBonuses(db, post, date, clubId, { champion: true, position: 1 }), 40_000 + 15_000);
  assert.equal(paySponsorBonuses(db, post, date, clubId, { position: 9 }), 0);
  assert.equal(paySponsorBonuses(db, post, date, clubId, { cupTitle: true }), 20_000);
  assertBooksBalance(db, initial);
});

test('Tela de finanças: saldo mês a mês fecha com o saldo atual, temporada por categoria, extrato paginado', async () => {
  const { db, clubId } = await setup();
  for (let i = 0; i < 70; i++) advanceTime(db, 'day');
  const f = getFinancePage(db);
  assert.equal(f.balanceHistory.at(-1)!.balance, f.balance);
  const months = db.prepare('SELECT month, SUM(amount) AS t FROM finance_months WHERE club_id = ? GROUP BY month ORDER BY month').all(clubId);
  for (let i = 1; i < f.balanceHistory.length; i++) assert.equal(f.balanceHistory[i]!.balance - f.balanceHistory[i - 1]!.balance, Number(months[i]!.t));
  assert.equal(f.season.current.reduce((s, c) => s + c.amount, 0), n(db, "SELECT SUM(amount) AS n FROM finance_months WHERE club_id = ? AND month >= '2026-07'", clubId));
  assert.equal(f.sponsorSlots.length, 3);
  const total = n(db, 'SELECT COUNT(*) AS n FROM finance_ledger WHERE club_id = ?', clubId);
  const p0 = getLedgerPage(db, 0), last = getLedgerPage(db, 999);
  assert.equal(p0.total, total);
  assert.equal(p0.rows.length, Math.min(total, p0.pageSize));
  assert.equal(last.page, Math.ceil(total / p0.pageSize) - 1, 'página além do fim vai para a última');
  assert.ok(getLedgerPage(db, 0, 'wages').rows.every((r) => r.category === 'wages'));
});
