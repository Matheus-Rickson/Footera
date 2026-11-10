import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { createRng } from '../game/rng.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { getMatchReport, simulateMatchday } from '../database/repositories/matchRepository.ts';
import { ensureFinance, getFinanceOverview, loadClubEcon, settleFinancesTx } from '../database/repositories/financeRepository.ts';
import {
  annualEstimate, attendance, expectedFill, fairSalary, gateRevenue, maintenanceMonthly, merchMonthly, minSalary, operationsMonthly, sponsorFloorOf, sponsorTotalMonthly, staffMonthly, staffUserMonthly, ticketPrice, tvMonthly,
  type ClubEcon,
} from '../game/finance-engine/finance.ts';
import { composeBar } from '../shared/financeChart.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(teams = 8, seed = 'fin-test') {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, world, clubId: world.clubs[0]!.id, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const econ = (over: Partial<ClubEcon> = {}): ClubEcon => ({ econ: 1, tier: 1, reputation: 65, fans: 200_000, capacity: 50_000, facilities: { training: 10, youth: 10, medical: 10, stadium: 10 }, ...over });

function assertBooksBalance(db: SqlDb, initial: Map<string, number>) {
  for (const [id, start] of initial) {
    const flows = n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id);
    assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + flows, `saldo de ${id} diverge dos lançamentos`);
  }
}

test('Fórmulas: receitas e custos crescem com a reputação, e a economia do país escala tudo', () => {
  const lo = econ({ reputation: 40 }), hi = econ({ reputation: 75 });
  for (const f of [tvMonthly, merchMonthly, sponsorTotalMonthly, operationsMonthly, ticketPrice]) assert.ok(f(hi) >= f(lo), f.name);
  const rich = econ({ econ: 2 });
  for (const f of [tvMonthly, sponsorTotalMonthly, staffMonthly, maintenanceMonthly, operationsMonthly, merchMonthly]) assert.ok(Math.abs(f(rich) / f(econ()) - 2) < 0.01, `${f.name} não escala com a economia`);
  assert.ok(tvMonthly(econ({ tier: 1, reputation: 65 })) > 2 * tvMonthly(econ({ tier: 2, reputation: 44 })), 'TV de um clube típico da 1ª divisão é mais que o dobro da 2ª');
  assert.ok(tvMonthly(econ({ tier: 1 })) > tvMonthly(econ({ tier: 2 })), 'mesma reputação: 1ª divisão paga mais');
  assert.ok(maintenanceMonthly(econ({ capacity: 60_000 })) > maintenanceMonthly(econ({ capacity: 20_000 })));
});

test('Público: nunca passa da capacidade, cresce com reputação e adversário, cai com mau tempo e é determinístico', () => {
  const c = econ();
  const sample = (rep: number, away: number, w: 'clear' | 'rain') => Array.from({ length: 300 }, (_, i) => attendance(econ({ reputation: rep }), away, w, createRng(`a${i}`)));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  for (const a of [...sample(95, 90, 'clear'), ...sample(5, 5, 'rain')]) assert.ok(a >= 0 && a <= c.capacity);
  assert.ok(mean(sample(80, 50, 'clear')) > mean(sample(40, 50, 'clear')));
  assert.ok(mean(sample(60, 85, 'clear')) > mean(sample(60, 20, 'clear')));
  assert.ok(mean(sample(60, 50, 'rain')) < mean(sample(60, 50, 'clear')));
  assert.equal(attendance(c, 50, 'clear', createRng('x')), attendance(c, 50, 'clear', createRng('x')));
  assert.ok(expectedFill(65, 50, 'clear') > 0.7 && expectedFill(65, 50, 'clear') < 0.85);
  assert.equal(gateRevenue(40_000, c), Math.round(40_000 * ticketPrice(c)));
});

test('Calibração: margem anual realista nos 320 clubes de 4 universos (mediana ~0, nem falência nem lucro absurdo)', () => {
  const margins: number[] = [], byTier: Record<number, number[]> = { 1: [], 2: [] };
  for (const seed of ['econ', 'a', 'b', 'c']) {
    const w = generateWorld({ seed });
    const lg = new Map(w.leagues.map((l) => [l.id, l])), st = new Map(w.stadiums.map((s) => [s.id, s])), ct = new Map(w.countries.map((x) => [x.id, x]));
    for (const c of w.clubs) {
      const wages = w.players.filter((p) => p.clubId === c.id).reduce((s, p) => s + p.salary, 0);
      const e = annualEstimate({ econ: ct.get(c.countryId)!.economy, tier: lg.get(c.leagueId)!.tier, reputation: c.reputation, fans: c.fans, capacity: st.get(c.stadiumId)!.capacity, facilities: c.facilities }, wages);
      const m = e.net / e.income; margins.push(m); byTier[lg.get(c.leagueId)!.tier]!.push(m);
    }
  }
  const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)]!;
  assert.ok(q(margins, 0.5) > -0.04 && q(margins, 0.5) < 0.08, `mediana ${q(margins, 0.5).toFixed(3)}`);
  assert.ok(q(margins, 0.1) > -0.35 && q(margins, 0.9) < 0.4, `p10=${q(margins, 0.1).toFixed(2)} p90=${q(margins, 0.9).toFixed(2)}`);
  const neg = margins.filter((m) => m < 0).length / margins.length;
  assert.ok(neg > 0.2 && neg < 0.65, `clubes no vermelho: ${(neg * 100).toFixed(0)}%`);
  for (const t of [1, 2]) assert.ok(Math.abs(q(byTier[t]!, 0.5)) < 0.1, `divisão ${t}: mediana ${q(byTier[t]!, 0.5).toFixed(3)}`);
});

test('Patrocínios: 3 contratos por clube, valores coerentes e vencimentos escalonados; ponto de partida financeiro definido', async () => {
  const { db } = await setup();
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM sponsor_deals'), 32 * 3);
  assert.equal(String(db.prepare("SELECT value FROM meta WHERE key = 'finance_last_month'").get()!.value), '2026-06');
  assert.ok(n(db, 'SELECT COUNT(DISTINCT end_date) AS n FROM sponsor_deals') > 20, 'vencimentos escalonados');
  for (const d of db.prepare('SELECT club_id, kind, monthly_amount FROM sponsor_deals').all()) {
    const total = sponsorTotalMonthly(loadClubEcon(db, String(d.club_id)));
    const share = { shirt: 0.55, kit: 0.3, stadium: 0.15 }[String(d.kind) as 'shirt'];
    const ratio = Number(d.monthly_amount) / (total * share);
    assert.ok(ratio > 0.87 && ratio < 1.13, `valor fora da faixa (${ratio.toFixed(3)})`);
  }
});

test('Liquidação: cada mês é cobrado uma só vez e os valores batem com as fórmulas', async () => {
  const { db, clubId, initial } = await setup();
  assert.equal(advanceTime(db, 'day').toDate, '2026-07-02');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_months WHERE category NOT IN ('transfer_in', 'transfer_out')"), 32 * 8, '8 categorias recorrentes por clube (sem bilheteria, transferências nem olheiros)');
  const e = loadClubEcon(db, clubId);
  const get = (cat: string) => n(db, "SELECT amount AS n FROM finance_months WHERE club_id = ? AND month = '2026-07' AND category = ?", clubId, cat);
  assert.equal(get('tv'), tvMonthly(e)); assert.equal(get('merchandising'), merchMonthly(e));
  assert.equal(get('sponsorship'), n(db, 'SELECT SUM(monthly_amount) AS n FROM sponsor_deals WHERE club_id = ?', clubId));
  assert.equal(get('wages'), -n(db, 'SELECT SUM(salary) AS n FROM players WHERE club_id = ?', clubId));
  assert.equal(get('staff'), -staffUserMonthly(e), 'usuário: só a estrutura (a comissão é contratada à parte)');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_months WHERE category = 'coaching'"), 0, 'sem comissão contratada: nada a pagar'); assert.equal(get('maintenance'), -maintenanceMonthly(e)); assert.equal(get('operations'), -operationsMonthly(e));
  assert.equal(get('youth'), -n(db, 'SELECT SUM(salary) AS n FROM players WHERE youth_club_id = ?', clubId), 'salários da base');
  assertBooksBalance(db, initial);
  // extrato detalhado só do clube do usuário, somando exatamente a variação do saldo
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM finance_ledger WHERE club_id <> ?', clubId), 0);
  assert.equal(n(db, 'SELECT SUM(amount) AS n FROM finance_ledger'), n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', clubId) - initial.get(clubId)!);
  // avançar de novo no mesmo mês não cobra de novo
  advanceTime(db, 'day'); advanceTime(db, 'day');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_months WHERE category NOT IN ('transfer_in', 'transfer_out')"), 32 * 8);
  assertBooksBalance(db, initial);
});

test('Liquidação: saltar vários meses de uma vez equivale a avançar aos poucos', async () => {
  const [a, b] = [await setup(), await setup()];
  for (const d of ['2026-07-15', '2026-08-20', '2026-09-05']) settleFinancesTx(a.db, d);
  assert.equal(settleFinancesTx(b.db, '2026-09-05'), 3);
  assert.equal(settleFinancesTx(b.db, '2026-09-05'), 0, 'idempotente');
  const dump = (db: SqlDb) => JSON.stringify([db.prepare('SELECT * FROM finance_months ORDER BY club_id, month, category').all(), db.prepare('SELECT id, balance FROM clubs ORDER BY id').all(), db.prepare('SELECT * FROM sponsor_deals ORDER BY id').all()]);
  assert.equal(dump(a.db), dump(b.db));
  assertBooksBalance(a.db, a.initial);
});

test('Bilheteria: público ≤ capacidade, renda vai só para o mandante e os livros continuam fechando', async () => {
  const { db, clubId, initial } = await setup();
  advanceTime(db, 'nextMatchday');
  const sim = simulateMatchday(db);
  assert.equal(sim.simulated, 16);
  const rows = db.prepare(`SELECT m.fixture_id, m.attendance, m.gate_revenue, f.home_club_id, f.away_club_id, st.capacity FROM matches m JOIN fixtures f ON f.id = m.fixture_id
    JOIN clubs h ON h.id = f.home_club_id JOIN stadiums st ON st.id = h.stadium_id`).all();
  assert.equal(rows.length, 16);
  for (const r of rows) {
    assert.ok(Number(r.attendance) > 0 && Number(r.attendance) <= Number(r.capacity));
    assert.equal(n(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ? AND month = '2026-08' AND category = 'gate'", String(r.home_club_id)), Number(r.gate_revenue));
    assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_months WHERE club_id = ? AND category = 'gate'", String(r.away_club_id)) > 0, rows.some((x) => x.home_club_id === r.away_club_id), 'visitante não recebe bilheteria');
  }
  assertBooksBalance(db, initial);
  const mine = rows.find((r) => r.home_club_id === clubId || r.away_club_id === clubId)!;
  const ledgerGate = n(db, "SELECT COUNT(*) AS n FROM finance_ledger WHERE category = 'gate'");
  assert.equal(ledgerGate, mine.home_club_id === clubId ? 1 : 0);
  const rep = getMatchReport(db, String(mine.fixture_id));
  assert.deepEqual(rep.attendance, { attendance: Number(mine.attendance), capacity: Number(mine.capacity), revenue: Number(mine.gate_revenue) });
  const ov = getFinanceOverview(db);
  assert.equal(ov.balance, n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', clubId));
  assert.ok(ov.last12.length >= 1 && ov.sponsors.length === 3 && ov.projection.wageBill > 0);
});

test('Temporada completa: saldo = saldo inicial + lançamentos para TODOS os clubes; salários e bilheteria somam certo', async () => {
  const { db, clubId, initial } = await setup(8, 'fin-season');
  for (let i = 0; i < 40; i++) {
    if (n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND tie_id IS NULL") === 0) break; // fim da liga (as copas seguem até maio)
    const a = advanceTime(db, 'nextMatchday');
    if (a.reason === 'season_complete') break;
    simulateMatchday(db);
  }
  assert.equal(getCareerState(db).gameDate, '2026-10-31');
  assertBooksBalance(db, initial);
  assert.equal(String(db.prepare("SELECT value FROM meta WHERE key = 'finance_last_month'").get()!.value), '2026-10');
  for (const id of initial.keys()) {
    // o mercado da IA (jul–ago) muda folhas; depois do fechamento da janela (1º/set) a folha é estável e igual à atual
    const finalPayroll = n(db, 'SELECT SUM(salary) AS n FROM players WHERE club_id = ?', id);
    for (const m of ['2026-09', '2026-10']) assert.equal(n(db, 'SELECT amount AS n FROM finance_months WHERE club_id = ? AND month = ? AND category = ?', id, m, 'wages'), -finalPayroll, `folha de ${m}`);
    for (const m of ['2026-07', '2026-08']) {
      const w = -n(db, 'SELECT amount AS n FROM finance_months WHERE club_id = ? AND month = ? AND category = ?', id, m, 'wages');
      assert.ok(w > finalPayroll * 0.6 && w < finalPayroll * 1.6, `folha de ${m} fora de proporção (${w} vs ${finalPayroll})`);
    }
    assert.equal(n(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ? AND category = 'gate'", id),
      n(db, 'SELECT COALESCE(SUM(m.gate_revenue), 0) AS n FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.home_club_id = ?', id));
  }
  assert.equal(n(db, 'SELECT SUM(amount) AS n FROM finance_ledger'), n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', clubId) - initial.get(clubId)!);
  const ov = getFinanceOverview(db);
  assert.equal(ov.last12.length, 4);
  assert.equal(ov.gates.length, 7);
});

test('Longo prazo: patrocínios são renovados sem lacunas por 4 anos e as renovações seguem a fórmula', async () => {
  const { db, initial } = await setup(4, 'fin-long');
  assert.equal(settleFinancesTx(db, '2031-01-01'), 55);
  assertBooksBalance(db, initial);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM finance_months WHERE category = 'sponsorship' AND amount > 0"), 16 * 55);
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM sponsor_deals') > 16 * 3, 'houve renovações');
  const deals = db.prepare('SELECT club_id, kind, start_date, end_date, monthly_amount FROM sponsor_deals ORDER BY club_id, kind, start_date').all();
  for (let i = 1; i < deals.length; i++) {
    const [p, c] = [deals[i - 1]!, deals[i]!];
    if (p.club_id === c.club_id && p.kind === c.kind) assert.ok(String(c.start_date) > String(p.end_date), 'contratos do mesmo tipo não se sobrepõem');
  }
  const first = deals[0]!;
  const share = { shirt: 0.55, kit: 0.3, stadium: 0.15 }[String(first.kind) as 'shirt'];
  const ratio = Number(first.monthly_amount) / (sponsorTotalMonthly(loadClubEcon(db, String(first.club_id))) * share);
  assert.ok(ratio > 0.87 && ratio < 1.13);
});

test('Saves antigos: não há cobrança retroativa; a partir do mês seguinte a cobrança começa normalmente', async () => {
  const { db, initial } = await setup();
  db.exec("DELETE FROM meta WHERE key = 'finance_last_month'; DELETE FROM sponsor_deals; UPDATE career SET game_date = '2026-08-15'");
  ensureFinance(db);
  assert.equal(String(db.prepare("SELECT value FROM meta WHERE key = 'finance_last_month'").get()!.value), '2026-08');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM sponsor_deals'), 32 * 3);
  assert.equal(settleFinancesTx(db, '2026-08-31'), 0);
  assert.equal(settleFinancesTx(db, '2026-09-01'), 1);
  assertBooksBalance(db, initial);
});

test('Gráfico: composição de cada barra soma o total, ordena do maior para o menor e separa receitas de despesas', () => {
  const items = [{ category: 'tv', amount: 600 }, { category: 'gate', amount: 300 }, { category: 'sponsorship', amount: 100 }, { category: 'wages', amount: -800 }, { category: 'staff', amount: -200 }];
  const inc = composeBar(items, 'income'), exp = composeBar(items, 'expense');
  assert.equal(inc.total, 1000); assert.equal(exp.total, 1000);
  assert.deepEqual(inc.parts.map((p) => p.category), ['tv', 'gate', 'sponsorship']);
  assert.deepEqual(exp.parts.map((p) => [p.category, p.amount, p.pct]), [['wages', 800, 80], ['staff', 200, 20]]);
  assert.ok(Math.abs(inc.parts.reduce((a, p) => a + p.pct, 0) - 100) < 1e-9);
  assert.deepEqual(composeBar([], 'income'), { total: 0, parts: [] });
  assert.deepEqual(composeBar([{ category: 'x', amount: -5 }], 'income'), { total: 0, parts: [] });
});

test('Gráfico: os itens de cada mês fechados com receitas/despesas; mês sem cobrança mensal é marcado como parcial', async () => {
  const { db } = await setup(8, 'fin-chart');
  for (let i = 0; i < 60 && !(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND tie_id IS NULL") === 0); i++) { const a = advanceTime(db, 'nextMatchday'); if (a.reason === 'season_complete') break; simulateMatchday(db); }
  const ov = getFinanceOverview(db);
  assert.equal(ov.last12.length, 4);
  for (const m of ov.last12) {
    assert.equal(composeBar(m.items, 'income').total, m.income, `receitas de ${m.month}`);
    assert.equal(composeBar(m.items, 'expense').total, m.expense, `despesas de ${m.month}`);
    assert.equal(m.settled, true);
    assert.ok(m.items.some((i) => i.category === 'gate') || m.month === '2026-07', `bilheteria em ${m.month}`);
  }
  assert.equal(ov.last12[0]!.items.some((i) => i.category === 'gate'), false, 'julho não tem jogos');
  // save anterior às finanças: o mês corrente só tem bilheteria e deve ser marcado como parcial
  const legacy = await setup(8, 'fin-chart2');
  legacy.db.exec("DELETE FROM meta WHERE key = 'finance_last_month'; DELETE FROM sponsor_deals; UPDATE career SET game_date = '2026-08-01'");
  ensureFinance(legacy.db);
  simulateMatchday(legacy.db);
  const lo = getFinanceOverview(legacy.db);
  assert.equal(lo.last12.length, 1);
  assert.equal(lo.last12[0]!.settled, false);
  assert.deepEqual([...new Set(lo.last12[0]!.items.map((i) => i.category))], ['gate']);
});

test('Projeção mensal inclui a bilheteria (estimada antes de 3 jogos em casa, pela média depois) e o caixa/resultado a refletem', async () => {
  const { db, clubId } = await setup(8, 'fin-proj');
  const before = getFinanceOverview(db);
  assert.equal(before.projection.gateEstimated, true);
  assert.ok(before.projection.gate > 0);
  const e = loadClubEcon(db, clubId);
  const home = n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE home_club_id = ?", clubId);
  assert.equal(before.projection.gate, Math.round((gateRevenue(Math.round(e.capacity * expectedFill(e.reputation, 50, 'clear')), e) * home) / 12));
  const deals = n(db, 'SELECT SUM(monthly_amount) AS n FROM sponsor_deals WHERE club_id = ?', clubId);
  assert.equal(before.projection.income, tvMonthly(e) + merchMonthly(e) + deals + before.projection.gate, 'receita projetada = TV + produtos + patrocínios + bilheteria');
  assert.equal(before.projection.youthBill, n(db, 'SELECT SUM(salary) AS n FROM players WHERE youth_club_id = ?', clubId));
  assert.equal(before.projection.expense, before.projection.wageBill + before.projection.youthBill + before.projection.scoutBill + before.projection.coachingBill + staffUserMonthly(e) + maintenanceMonthly(e) + operationsMonthly(e));
  assert.equal(before.projection.net, before.projection.income - before.projection.expense);
  for (let i = 0; i < 40 && !(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") === 0); i++) { const a = advanceTime(db, 'nextMatchday'); if (a.reason === 'season_complete') break; simulateMatchday(db); }
  const after = getFinanceOverview(db);
  assert.equal(after.projection.gateEstimated, after.gates.length < 3);
  const avg = after.gates.reduce((a, g) => a + g.revenue, 0) / after.gates.length;
  const homeNow = n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE home_club_id = ?", clubId); // a copa sorteia jogos novos ao longo da temporada
  assert.equal(after.projection.gate, Math.round((avg * homeNow) / 12));
});

test('Piso de patrocínio (v0.8.10): save antigo da 3ª divisão para baixo tem os contratos em vigor reajustados uma vez; carreira nova já nasce com o piso', async () => {
  const { db } = await setup();
  assert.ok(db.prepare("SELECT 1 AS x FROM meta WHERE key = 'sponsor_floor'").get(), 'carreira nova marca o reajuste como feito');
  // simula um save antigo com uma liga de 3ª divisão (os contratos foram feitos sem o piso)
  const lg = String(db.prepare('SELECT league_id AS l FROM clubs LIMIT 1').get()!.l);
  db.prepare('UPDATE leagues SET tier = 3 WHERE id = ?').run(lg);
  db.exec("DELETE FROM meta WHERE key = 'sponsor_floor'");
  const today = getCareerState(db).gameDate;
  const before = new Map(db.prepare('SELECT d.id, d.kind, d.monthly_amount, c.league_id, co.economy FROM sponsor_deals d JOIN clubs c ON c.id = d.club_id JOIN countries co ON co.id = c.country_id WHERE d.end_date >= ?').all(today)
    .map((r) => [String(r.id), r]));
  ensureFinance(db);
  ensureFinance(db); // idempotente
  for (const [id, r] of before) {
    const now = Number(db.prepare('SELECT monthly_amount AS m FROM sponsor_deals WHERE id = ?').get(id)!.m);
    const share = { shirt: 0.55, kit: 0.3, stadium: 0.15 }[String(r.kind) as 'shirt'];
    const want = Number(r.monthly_amount) + (r.league_id === lg ? Math.round(Number(r.economy) * sponsorFloorOf(3) * share) : 0);
    assert.equal(now, want, `${id}: só a 3ª divisão sobe, pela parte do piso da cota`);
  }
  db.close();
});

test('Salário mínimo por país (v0.8.10): save antigo tem o piso de 1.500 rebaixado uma vez; livres pela nacionalidade; base e quem vale mais não mudam', async () => {
  const { db, clubId } = await setup();
  assert.ok(db.prepare("SELECT 1 AS x FROM meta WHERE key = 'salary_floor'").get(), 'carreira nova marca a correção como feita');
  const cty = String(db.prepare('SELECT country_id AS c FROM clubs WHERE id = ?').get(clubId)!.c);
  db.prepare('UPDATE countries SET economy = 0.6 WHERE id = ?').run(cty);
  const code = String(db.prepare('SELECT code FROM countries WHERE id = ?').get(cty)!.code);
  const ids = db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 3').all(clubId).map((r) => String(r.id));
  const [cheap, rich, same] = ids as [string, string, string];
  db.prepare('UPDATE players SET salary = 1500, market_value = 20000 WHERE id = ?').run(cheap);
  db.prepare('UPDATE players SET salary = 1500, market_value = 200000 WHERE id = ?').run(rich); // vale 2.400: o piso antigo não era a causa
  db.prepare('UPDATE players SET salary = 1600, market_value = 20000 WHERE id = ?').run(same);
  const free = String(db.prepare('SELECT id FROM players WHERE club_id IS NOT NULL AND club_id <> ? ORDER BY id LIMIT 1').get(clubId)!.id);
  db.prepare('UPDATE players SET club_id = NULL, youth_club_id = NULL, salary = 1500, market_value = 30000, nationality = ? WHERE id = ?').run(code, free);
  const youth = db.prepare('SELECT id FROM players WHERE youth_club_id IS NOT NULL ORDER BY id LIMIT 1').get();
  if (youth) db.prepare('UPDATE players SET salary = 1500, market_value = 1000 WHERE id = ?').run(String(youth.id));
  db.exec("DELETE FROM meta WHERE key = 'salary_floor'");
  ensureFinance(db);
  const sal = (id: string) => n(db, 'SELECT salary AS n FROM players WHERE id = ?', id);
  assert.equal(sal(cheap), minSalary(0.6), 'piso antigo → mínimo do país do clube');
  assert.equal(sal(rich), 1500);
  assert.equal(sal(same), 1600);
  assert.equal(sal(free), fairSalary(30_000, 0.6), 'livre: mínimo do país da nacionalidade');
  if (youth) assert.equal(sal(String(youth.id)), 1500, 'jovem da base não muda');
  db.prepare('UPDATE players SET salary = 1500 WHERE id = ?').run(cheap);
  ensureFinance(db);
  assert.equal(sal(cheap), 1500, 'uma vez por save');
  db.close();
});
