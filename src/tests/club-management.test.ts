/**
 * Pedidos de 09/11/2026: caixa das divisões de baixo e folhas fora da realidade, aposentadoria anunciada no início da temporada,
 * elenco de até 35, contraproposta em propostas recebidas e rescisão de contrato.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { counterOffer, getTransfersOverview, makeOffer, releasePlayer, searchMarket, TransferError } from '../database/repositories/transferRepository.ts';
import { getContracts, renegotiateContract, SeasonError, startNextSeason, terminateContract } from '../database/repositories/seasonRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import { makePoster } from '../database/repositories/financeRepository.ts';
import { annualEstimate, F, fairSalary, maintenanceMonthly, merchMonthly, minSalary, participationOf, rebasedFloorSalary, sizeFactor, sponsorFloorOf, sponsorTotalMonthly, staffMonthly, tvMonthly, WAGE_CAP, wageCapFactor, type ClubEcon } from '../game/finance-engine/finance.ts';
import { wageDemand } from '../game/transfer-engine/transfer.ts';
import { aiRenewalWage, renewalDemand } from '../game/career-engine/contracts.ts';
import { buyerReply, MAX_COUNTER_ROUNDS, SQUAD_MAX } from '../game/transfer-engine/transfer.ts';
import { terminationCost } from '../game/career-engine/contracts.ts';
import { compileUniverse } from '../game/data-pack/compile.ts';
import { EMPTY_WORLD, basePack } from '../services/universeService.node.ts';
import { addYears } from '../shared/date.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';
import type { Pack } from '../game/data-pack/format.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed: string, teams = 6) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const balance = (db: SqlDb, id: string) => n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id);
function assertBooksBalance(db: SqlDb, initial: Map<string, number>) {
  for (const [id, start] of initial) assert.equal(balance(db, id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]!; };
function playSeason(db: SqlDb) {
  for (let i = 0; i < 80 && n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  advanceTime(db, 'nextMatchday'); // até a virada
}

// ---------------------------------------------------------------- 1. financeiro
test('Finanças: cota de participação só da 3ª divisão para baixo, e a base fixa fica perto do equilíbrio em todas as divisões', () => {
  const e = (tier: number): ClubEcon => ({ econ: 1, tier, reputation: 20, fans: 50_000, capacity: 10_000, facilities: { training: 8, youth: 8, medical: 8, stadium: 8 } });
  assert.deepEqual([participationOf(1), participationOf(2)], [0, 0], '1ª e 2ª divisões não mudam (calibração antiga)');
  for (const t of [3, 4, 5]) assert.equal(participationOf(t), F.participation[t]);
  assert.equal(participationOf(9), F.participation[5], 'abaixo da 5ª vale a da 5ª');
  assert.equal(tvMonthly({ ...e(4), econ: 2 }) - 2 * tvMonthly(e(4)) <= 1, true, 'a cota também escala com a economia');
  // piso de patrocínio: só da 3ª divisão para baixo (abaixo da 5ª vale o da 5ª)
  assert.deepEqual([sponsorFloorOf(1), sponsorFloorOf(2)], [0, 0]);
  for (const t of [3, 4, 5]) assert.equal(sponsorFloorOf(t), F.sponsorFloor[t]);
  assert.equal(sponsorFloorOf(8), F.sponsorFloor[5]);
  // clube da Série D com reputação 15 (Brasiliense, economia 0,6): o patrocínio passa a ser receita relevante
  const d = { ...e(4), econ: 0.6, reputation: 15, fans: 57_079, capacity: 5_700 };
  assert.ok(sponsorTotalMonthly(d) >= 30_000, `patrocínio da Série D: ${sponsorTotalMonthly(d)}`);
  assert.ok(sponsorTotalMonthly(d) > tvMonthly(d) * 0.5);
  const w = compileUniverse(EMPTY_WORLD, [basePack()]).world;
  const lg = new Map(w.leagues.map((l) => [l.id, l])), co = new Map(w.countries.map((c) => [c.id, c])), st = new Map(w.stadiums.map((s) => [s.id, s]));
  const byTier = new Map<number, number[]>();
  for (const c of w.clubs) {
    const l = lg.get(c.leagueId)!;
    const wages = w.players.filter((p) => p.clubId === c.id).reduce((s, p) => s + p.salary, 0);
    const a = annualEstimate({ econ: co.get(c.countryId)!.economy, tier: l.tier, reputation: c.reputation, fans: c.fans, capacity: st.get(c.stadiumId)!.capacity, facilities: c.facilities }, wages);
    byTier.set(l.tier, [...(byTier.get(l.tier) ?? []), a.net / a.income]);
  }
  for (const [t, m] of byTier) assert.ok(q(m, 0.5) > -0.08 && q(m, 0.5) < 0.12, `divisão ${t}: margem mediana ${(100 * q(m, 0.5)).toFixed(1)}% (antes: 3ª −40%, 4ª −150%, 5ª −330%)`);
  // calibração das divisões de baixo (v0.8.10): o orçamento de um clube brasileiro da Série D / sem divisão fica na ordem do real
  const bra = w.countries.find((c) => c.code === 'BRA')!;
  const incomeOf = (tier: number) => w.clubs.filter((c) => c.countryId === bra.id && lg.get(c.leagueId)!.tier === tier).map((c) =>
    annualEstimate({ econ: bra.economy, tier, reputation: c.reputation, fans: c.fans, capacity: st.get(c.stadiumId)!.capacity, facilities: c.facilities }, w.players.filter((p) => p.clubId === c.id).reduce((s, p) => s + p.salary, 0)).income);
  const d4 = q(incomeOf(4), 0.5), d5 = q(incomeOf(5), 0.5);
  assert.ok(d4 > 500_000 && d4 < 1_000_000, `receita mediana da Série D: ${Math.round(d4)} (antes ~1,3 milhão)`);
  assert.ok(d5 > 300_000 && d5 < 700_000, `receita mediana dos clubes sem divisão: ${Math.round(d5)} (antes ~1,1 milhão)`);
  // salários da base: ninguém do Brasil fica no piso antigo de 1.500 se o valor dá menos; o mínimo é o do país
  const braPlayers = w.players.filter((p) => w.clubs.find((c) => c.id === p.clubId)?.countryId === bra.id);
  assert.ok(braPlayers.every((p) => p.salary >= minSalary(bra.economy)));
  assert.ok(!braPlayers.some((p) => p.salary === 1500 && Math.round((p.marketValue * 0.012) / 100) * 100 < 1500), 'piso antigo rebaixado ao mínimo do país');
  assert.ok(braPlayers.some((p) => p.salary < 1500), 'há salários abaixo do piso antigo');
});

test('Finanças: salário mínimo por país, porte do clube e pedidos de salário pelo país do clube (v0.8.10)', () => {
  assert.deepEqual([minSalary(0.6), minSalary(1.6), minSalary(0.05), minSalary(1)], [600, 1500, 100, 1000]);
  assert.equal(fairSalary(20_000, 0.6), 600, 'valor baixo: mínimo do país');
  assert.equal(fairSalary(1_000_000, 0.6), 12_000, '1,2% do valor');
  assert.equal(rebasedFloorSalary(1500, 20_000, 0.6), 600, 'piso antigo → mínimo do país');
  assert.equal(rebasedFloorSalary(1500, 125_000, 0.6), 1500, 'quem vale 1.500 mantém');
  assert.equal(rebasedFloorSalary(1600, 20_000, 0.6), 1600, 'acima do piso antigo não muda');
  assert.equal(rebasedFloorSalary(1500, 20_000, 1.6), 1500, 'país rico: o mínimo já é 1.500');
  // porte: reputação 30+ paga a estrutura cheia; abaixo, proporcional, com piso de 20%
  assert.deepEqual([sizeFactor(65), sizeFactor(30), sizeFactor(15), sizeFactor(1)], [1, 1, 0.5, 0.2]);
  const c = (reputation: number): ClubEcon => ({ econ: 1, tier: 4, reputation, fans: 50_000, capacity: 10_000, facilities: { training: 8, youth: 8, medical: 8, stadium: 8 } });
  assert.equal(staffMonthly(c(15)), Math.round(staffMonthly(c(30)) / 2), 'estrutura cai pela metade com reputação 15');
  assert.ok(maintenanceMonthly(c(15)) < maintenanceMonthly(c(30)) && merchMonthly(c(15)) < merchMonthly({ ...c(15), reputation: 30 }));
  // pedidos: o piso é o mínimo do país do clube (padrão = piso antigo)
  const cheap = { marketValue: 20_000, salary: 600, ambition: 10, loyalty: 10 };
  assert.ok(wageDemand(cheap, 20, 20, 600) < 1000 && wageDemand(cheap, 20, 20) >= 1500);
  assert.ok(renewalDemand(cheap, 600) < 1000 && renewalDemand(cheap) >= 1500);
  assert.ok(aiRenewalWage(cheap, 600) <= 660 && aiRenewalWage({ ...cheap, salary: 1500 }) >= 1400);
});

test('Finanças: folha acima de 80% da receita (salários reais de pacote) é reduzida a 65% na montagem do universo, com aviso', () => {
  const c: ClubEcon = { econ: 1, tier: 1, reputation: 60, fans: 150_000, capacity: 40_000, facilities: { training: 10, youth: 10, medical: 10, stadium: 10 } };
  const income = annualEstimate(c, 0).income;
  assert.equal(wageCapFactor(c, (0.5 * income) / 12), 1, 'folha normal não muda');
  const f = wageCapFactor(c, (4 * income) / 12);
  assert.ok(Math.abs(f * 4 - WAGE_CAP.to) < 1e-9, 'folha 4× a receita cai para 65%');
  const base = compileUniverse(EMPTY_WORLD, [basePack()]).world;
  const club = base.clubs.find((x) => base.leagues.find((l) => l.id === x.leagueId)!.tier === 1)!;
  const squad = base.players.filter((p) => p.clubId === club.id);
  const pack: Pack = { manifest: { format: 1, id: 'folha-alta', name: 'Folha alta', version: '1.0.0' }, data: { countries: [], leagues: [], stadiums: [], clubs: [], coaches: [], cups: [], players: squad.map((p) => ({ id: p.id, contract: { salary: 3_000_000 } })) } } as unknown as Pack;
  const r = compileUniverse(EMPTY_WORLD, [basePack(), pack]);
  const after = r.world.players.filter((p) => p.clubId === club.id);
  const ce: ClubEcon = { econ: r.world.countries.find((x) => x.id === club.countryId)!.economy, tier: 1, reputation: club.reputation, fans: club.fans, capacity: r.world.stadiums.find((s) => s.id === club.stadiumId)!.capacity, facilities: club.facilities };
  const wages = after.reduce((s, p) => s + p.salary, 0);
  assert.ok(12 * wages <= WAGE_CAP.over * annualEstimate(ce, wages).income, 'folha cabe na receita');
  assert.ok(after.every((p) => p.salary < 3_000_000) && new Set(after.map((p) => p.salary)).size === 1, 'redução proporcional (todos iguais continuam iguais)');
  assert.ok(r.warnings.some((w) => w.record === club.id && /salários reduzidos/.test(w.message)));
});

test('Finanças: salário de 1.500 vindo de pacote (piso exportado por versões anteriores) também cai ao mínimo do país; livres pela nacionalidade', () => {
  const base = compileUniverse(EMPTY_WORLD, [basePack()]).world;
  const bra = base.countries.find((c) => c.code === 'BRA')!;
  const [a, b] = base.players.filter((p) => base.clubs.find((c) => c.id === p.clubId)?.countryId === bra.id && p.nationality === 'BRA');
  const pack = { manifest: { format: 1, id: 'piso', name: 'Piso', version: '1.0.0' }, data: { countries: [], leagues: [], stadiums: [], clubs: [], coaches: [], cups: [],
    players: [{ id: a!.id, marketValue: 20_000, contract: { salary: 1500 } }, { id: b!.id, club: null, marketValue: 30_000, contract: { salary: 1500 } }] } } as unknown as Pack;
  const w = compileUniverse(EMPTY_WORLD, [basePack(), pack]).world;
  const pa = w.players.find((p) => p.id === a!.id)!, pb = w.players.find((p) => p.id === b!.id)!;
  assert.equal(pa.salary, minSalary(bra.economy));
  assert.equal(pb.clubId, null);
  assert.equal(pb.salary, fairSalary(30_000, bra.economy));
});

test('Finanças: livre barato assina pelo salário mínimo do país do clube que contrata (v0.8.10)', async () => {
  const { db, clubId } = await setup('cm-floor');
  db.prepare('UPDATE countries SET economy = 0.6 WHERE id = (SELECT country_id FROM clubs WHERE id = ?)').run(clubId);
  const id = String(db.prepare('SELECT id FROM players WHERE club_id IS NOT NULL AND club_id <> ? ORDER BY id LIMIT 1').get(clubId)!.id);
  // dispensado: a pretensão vira o salário pelo valor, com o mínimo do país da nacionalidade (aqui, economia 0,6)
  const code = String(db.prepare('SELECT co.code FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(clubId)!.code);
  db.prepare('UPDATE players SET salary = 5000, market_value = 20000, nationality = ?, retire_planned = 0 WHERE id = ?').run(code, id);
  releasePlayer(db, id, getCareerState(db).gameDate, false);
  assert.equal(n(db, 'SELECT salary AS n FROM players WHERE id = ? AND club_id IS NULL', id), 600);
  const r = makeOffer(db, { playerId: id, fee: 0, wage: 900, years: 2 });
  assert.equal(r.outcome, 'completed', `${r.outcome}: ${r.message}`);
  assert.equal(n(db, 'SELECT salary AS n FROM players WHERE id = ?', id), 900);
  db.close();
});

// ---------------------------------------------------------------- 2. aposentadoria anunciada
test('Aposentadoria: ninguém se aposenta no 1º dia; quem anunciou sai no fim da temporada; o treinador é avisado no início dela', async () => {
  const { db, clubId, initial } = await setup('cm-retire');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE retired = 1'), 0, 'nenhuma aposentadoria na criação da carreira');
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM players WHERE retire_planned = 1') > 0, 'sorteio do fim da 1ª temporada já feito');
  // um jogador do usuário anunciou; outro, com 39 anos (fará 40), não anunciou: só o primeiro sai nesta virada
  const [a, b] = db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY contract_end DESC, id LIMIT 2').all(clubId).map((r) => String(r.id)); // contratos longos: não saem por fim de contrato
  const date = getCareerState(db).gameDate;
  db.prepare('UPDATE players SET retire_planned = 1 WHERE id = ?').run(a);
  db.prepare('UPDATE players SET retire_planned = 0, birth_date = ? WHERE id = ?').run(addYears(date, -39), b);
  assert.throws(() => renegotiateContract(db, { playerId: a!, wage: 10_000, years: 1 }), SeasonError, 'quem vai se aposentar não renova');
  assert.equal(getContracts(db).find((c) => c.id === a)!.retiring, true);
  assert.equal(getContracts(db).find((c) => c.id === a)!.canRenew, false);
  const planned = db.prepare('SELECT id FROM players WHERE retire_planned = 1 AND club_id IS NOT NULL').all().map((r) => String(r.id));
  playSeason(db);
  startNextSeason(db);
  const row = (id: string) => db.prepare('SELECT club_id, retired, retire_planned FROM players WHERE id = ?').get(id)!;
  assert.deepEqual([row(a!).retired, row(a!).club_id], [1, null], 'anunciou: aposentado na virada');
  for (const id of planned) assert.equal(row(id).retired, 1, `todo anunciado se aposenta (${id})`);
  assert.equal(row(b!).retired, 0, 'não anunciou: cumpre mais uma temporada');
  assert.equal(row(b!).retire_planned, 1, 'aos 40 anos no fim da temporada nova, anuncia agora');
  const mail = getNews(db).find((x) => x.kind === 'retirement' && /ao fim da temporada/.test(x.title));
  assert.ok(mail && mail.body.includes(String(db.prepare("SELECT first_name || ' ' || last_name AS n FROM players WHERE id = ?").get(b)!.n)), 'e-mail com o anúncio');
  assertBooksBalance(db, initial);
});

test('Aposentadoria: save anterior à migração 027 (sem sorteio feito) usa a regra antiga uma última vez', async () => {
  const { db, clubId } = await setup('cm-legacy');
  db.prepare("DELETE FROM meta WHERE key LIKE 'retire_plan:%'").run();
  db.prepare('UPDATE players SET retire_planned = 0').run();
  const old = String(db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY overall LIMIT 1').get(clubId)!.id);
  db.prepare('UPDATE players SET birth_date = ? WHERE id = ?').run(addYears(getCareerState(db).gameDate, -41), old);
  playSeason(db);
  startNextSeason(db);
  assert.equal(n(db, 'SELECT retired AS n FROM players WHERE id = ?', old), 1, 'regra antiga: 40+ se aposenta na virada');
  assert.ok(n(db, "SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'retire_plan:%'") > 0, 'e a partir daí o país sorteia no início da temporada');
});

// ---------------------------------------------------------------- 3. elenco de 35
test('Elenco: limite de 35 jogadores nas contratações', async () => {
  const { db, clubId } = await setup('cm-squad');
  assert.equal(SQUAD_MAX, 35);
  assert.equal(getTransfersOverview(db).squadMax, 35);
  const fill = db.prepare('SELECT id FROM players WHERE club_id IS NOT NULL AND club_id <> ? LIMIT 40').all(clubId).map((r) => String(r.id));
  const size = n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', clubId);
  for (const id of fill.slice(0, 35 - size)) db.prepare('UPDATE players SET club_id = ? WHERE id = ?').run(clubId, id);
  const other = searchMarket(db, {})[0]!;
  assert.throws(() => makeOffer(db, { playerId: other.id, fee: 0, wage: 50_000, years: 1 }), /máximo de 35/);
});

// ---------------------------------------------------------------- 4. contraproposta
test('Contraproposta: o comprador aceita até o teto, cobre com valor intermediário ou desiste; nunca acima do caixa', () => {
  const base = { offer: 1_000_000, marketValue: 1_000_000, buyerBalance: 1e9, rounds: 0 };
  assert.deepEqual(buyerReply({ ...base, asked: 1_100_000 }, 0), { kind: 'accept' }, '10% acima: dentro do teto mínimo');
  assert.deepEqual(buyerReply({ ...base, asked: 1_350_000 }, 1), { kind: 'accept' }, 'teto máximo 35% acima');
  assert.deepEqual(buyerReply({ ...base, asked: 1_300_000 }, 0), { kind: 'counter', fee: 1_100_000 }, 'acima do teto: cobre até o teto');
  assert.deepEqual(buyerReply({ ...base, asked: 3_000_000 }, 0), { kind: 'withdraw' }, 'muito acima: desiste');
  assert.deepEqual(buyerReply({ ...base, asked: 1_300_000, rounds: MAX_COUNTER_ROUNDS }, 0), { kind: 'withdraw' }, 'sem rodadas: não cobre mais');
  assert.deepEqual(buyerReply({ ...base, asked: 1_200_000, buyerBalance: 1_050_000 }, 1), { kind: 'counter', fee: 1_050_000 }, 'teto limitado pelo caixa');
  const r = buyerReply({ ...base, asked: 1_250_000 }, 0.2);
  assert.ok(r.kind !== 'counter' || (r.fee > base.offer && r.fee < 1_250_000));
});

test('Contraproposta no jogo: venda pelo valor pedido, nova taxa na proposta ou desistência; livros fechados', async () => {
  const { db, clubId, initial } = await setup('cm-counter');
  const date = getCareerState(db).gameDate; // 1º/jul: janela aberta
  const buyer = String(db.prepare('SELECT id FROM clubs WHERE id <> ? ORDER BY balance DESC LIMIT 1').get(clubId)!.id);
  const squad = db.prepare('SELECT id, market_value FROM players WHERE club_id = ? ORDER BY overall DESC').all(clubId);
  const offer = (pid: string, fee: number) => {
    db.prepare("INSERT INTO transfer_offers (date, expires, player_id, buyer_club_id, seller_club_id, fee) VALUES (?, '2026-12-31', ?, ?, ?, ?)").run(date, pid, buyer, clubId, fee);
    return Number(db.prepare('SELECT MAX(id) AS id FROM transfer_offers').get()!.id);
  };
  // pedido modesto: aceito, venda sai pelo valor pedido
  const p1 = squad[5]!, fee1 = Math.max(100_000, Math.round(Number(p1.market_value) * 0.9 / 1000) * 1000);
  const id1 = offer(String(p1.id), fee1);
  const before = balance(db, clubId);
  const r1 = counterOffer(db, id1, fee1 + 1000);
  assert.equal(r1.outcome, 'accepted');
  assert.equal(String(db.prepare('SELECT club_id FROM players WHERE id = ?').get(p1.id)!.club_id), buyer);
  assert.equal(balance(db, clubId) - before, fee1 + 1000, 'recebe o valor pedido');
  assert.throws(() => counterOffer(db, id1, fee1 + 5000), TransferError, 'proposta já resolvida');
  // pedido absurdo: o comprador desiste
  const p2 = squad[6]!, id2 = offer(String(p2.id), 500_000);
  assert.equal(counterOffer(db, id2, Number(p2.market_value) * 10 + 10_000_000).outcome, 'withdrawn');
  assert.equal(String(db.prepare('SELECT status FROM transfer_offers WHERE id = ?').get(id2)!.status), 'rejected');
  // pedido acima do teto: cobre (ou aceita/desiste conforme o sorteio fixo); depois de 2 rodadas, só aceitar ou recusar
  const p3 = squad[7]!, base3 = Math.max(Number(p3.market_value), 400_000), id3 = offer(String(p3.id), base3);
  assert.throws(() => counterOffer(db, id3, base3), /aceite a proposta/, 'pedir o mesmo valor não é contraproposta');
  let rounds = 0;
  for (; rounds < MAX_COUNTER_ROUNDS; rounds++) {
    const cur = n(db, 'SELECT fee AS n FROM transfer_offers WHERE id = ?', id3);
    const r = counterOffer(db, id3, Math.round(cur * 1.6 / 1000) * 1000);
    if (r.outcome !== 'counter') break;
    assert.ok(r.fee! > cur && n(db, 'SELECT fee AS n FROM transfer_offers WHERE id = ?', id3) === r.fee, 'taxa nova gravada');
  }
  if (rounds === MAX_COUNTER_ROUNDS) assert.throws(() => counterOffer(db, id3, 99_000_000), /não aceita mais contrapropostas/);
  assertBooksBalance(db, initial);
});

// ---------------------------------------------------------------- 5. rescisão
test('Rescisão: paga os salários restantes, o jogador sai livre, o elenco precisa continuar jogável e o caixa cobrir o valor', async () => {
  const { db, clubId, initial } = await setup('cm-terminate');
  const c = getContracts(db).sort((x, y) => y.monthsLeft - x.monthsLeft)[0]!;
  assert.equal(c.terminationCost, terminationCost(c.salary, c.monthsLeft));
  assert.equal(terminationCost(1000, 0), 1000, 'no mínimo um mês');
  const before = balance(db, clubId);
  const r = terminateContract(db, c.id);
  assert.equal(r.cost, c.salary * Math.max(1, c.monthsLeft));
  assert.equal(before - balance(db, clubId), r.cost);
  const row = db.prepare('SELECT club_id, retired FROM players WHERE id = ?').get(c.id)!;
  assert.deepEqual([row.club_id, row.retired], [null, 0], 'livre, não aposentado');
  assert.ok(searchMarket(db, { freeOnly: true }).some((p) => p.id === c.id), 'aparece no mercado de livres');
  assert.ok(getNews(db).some((x) => x.kind === 'contract' && x.title.startsWith('Rescisão')));
  assert.throws(() => terminateContract(db, c.id), SeasonError, 'não é mais do clube');
  // caixa insuficiente (despesa lançada pelo poster, livros continuam fechando)
  const next = getContracts(db)[0]!;
  makePoster(db, clubId)(clubId, getCareerState(db).gameDate, 'operations', -(balance(db, clubId) - next.terminationCost + 1), 'teste: caixa baixo');
  assert.throws(() => terminateContract(db, next.id), /Caixa insuficiente/);
  // elenco no mínimo: não deixa ficar incompleto
  const keep = db.prepare('SELECT id FROM players WHERE club_id = ?').all(clubId).map((x) => String(x.id));
  for (const id of keep.slice(18)) db.prepare('UPDATE players SET club_id = NULL WHERE id = ?').run(id);
  assert.throws(() => terminateContract(db, keep[0]!), /incompleto/);
  assertBooksBalance(db, initial);
});
