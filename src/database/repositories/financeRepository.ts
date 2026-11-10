import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { createRng } from '../../game/rng.ts';
import {
  attendance, expectedFill, gateRevenue, maintenanceMonthly, merchMonthly, operationsMonthly, SPONSOR_SHARE, sponsorFloorOf, sponsorTotalMonthly, minSalary, rebasedFloorSalary, staffMonthly, staffUserMonthly, ticketPrice, tvMonthly,
  type ClubEcon, type FinanceCategory, type SponsorKind, type Weather,
} from '../../game/finance-engine/finance.ts';
import { addDays } from '../../shared/date.ts';
import { SPONSOR_KIND_LABEL as KIND_LABEL, SPONSOR_NAMES } from '../../game/finance-engine/sponsors.ts';
import type { FinanceLedgerDto, FinanceOverviewDto } from '../../shared/api.ts';
import { seasonLabelFor } from '../../game/career-engine/calendar.ts';
import { getCareerState } from './careerRepository.ts';
import { FULL_CLUBS } from './simLevelRepository.ts';
import { CURRENT_COMP, userSeason } from './countrySeasonRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const KINDS: SponsorKind[] = ['shirt', 'kit', 'stadium'];
const monthOf = (date: string) => date.slice(0, 7);
function nextMonth(m: string): string {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}
const prevMonth = (m: string): string => {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};
export { prevMonth };

const getMeta = (db: SqlDb, key: string): string | null => { const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key); return r ? S(r.value) : null; };
const setMeta = (db: SqlDb, key: string, value: string) => { db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value); };

interface ClubRow { id: string; name: string; econ: ClubEcon }
const ECON_SQL = `SELECT c.id, c.name, c.reputation, c.fans, c.facilities_json, st.capacity, l.tier, co.economy
  FROM clubs c JOIN stadiums st ON st.id = c.stadium_id JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = c.country_id`;
const toClub = (r: Record<string, unknown>): ClubRow => ({
  id: S(r.id), name: S(r.name),
  econ: { econ: N(r.economy), tier: N(r.tier), reputation: N(r.reputation), fans: N(r.fans), capacity: N(r.capacity), facilities: JSON.parse(S(r.facilities_json)) },
});
export const loadClubEcon = (db: SqlDb, clubId: string): ClubEcon => {
  const r = db.prepare(`${ECON_SQL} WHERE c.id = ?`).get(clubId);
  if (!r) throw new Error('Clube não encontrado.');
  return toClub(r).econ;
};

export type Poster = (clubId: string, date: string, category: FinanceCategory, amount: number, description: string, fixtureId?: string | null) => void;

/** ÚNICA porta de entrada de dinheiro: atualiza saldo, resumo mensal (todos os clubes) e extrato (clube do usuário). */
export function makePoster(db: SqlDb, userClub: string): Poster {
  const bal = db.prepare('UPDATE clubs SET balance = balance + ? WHERE id = ?');
  const up = db.prepare('INSERT INTO finance_months (club_id, month, category, amount) VALUES (?,?,?,?) ON CONFLICT(club_id, month, category) DO UPDATE SET amount = amount + excluded.amount');
  const led = db.prepare('INSERT INTO finance_ledger (club_id, date, category, amount, description, fixture_id) VALUES (?,?,?,?,?,?)');
  return (clubId, date, category, amount, description, fixtureId = null) => {
    if (!Number.isInteger(amount)) throw new Error(`Valor financeiro inválido: ${amount}`);
    if (amount === 0) return;
    bal.run(amount, clubId);
    up.run(clubId, monthOf(date), category, amount);
    if (clubId === userClub) led.run(clubId, date, category, amount, description, fixtureId);
  };
}

function createDeal(db: SqlDb, seed: string, econ: ClubEcon, clubId: string, kind: SponsorKind, start: string, days: number) {
  const rng = createRng(`sponsor:${seed}:${clubId}:${kind}:${start}`);
  const amount = Math.round(sponsorTotalMonthly(econ) * SPONSOR_SHARE[kind] * rng.float(0.88, 1.12));
  db.prepare('INSERT INTO sponsor_deals (id, club_id, kind, sponsor_name, monthly_amount, start_date, end_date) VALUES (?,?,?,?,?,?,?)')
    .run(`spn_${clubId}_${kind}_${start}`, clubId, kind, rng.pick(SPONSOR_NAMES[kind]), amount, start, addDays(start, days));
}
const coveringDeal = (db: SqlDb, clubId: string, kind: SponsorKind, date: string) =>
  db.prepare('SELECT * FROM sponsor_deals WHERE club_id = ? AND kind = ? AND start_date <= ? AND end_date >= ? ORDER BY end_date DESC LIMIT 1').get(clubId, kind, date, date);

/**
 * Cota do clube do usuário que ele mesmo deixou vaga (rescindiu o último contrato e ainda não fechou outro): não é preenchida
 * automaticamente. Contrato que só venceu continua sendo renovado (propostas e aceite automático em `sponsorRepository`).
 */
export function vacatedByUser(db: SqlDb, clubId: string, kind: SponsorKind): boolean {
  const last = db.prepare('SELECT terminated_on FROM sponsor_deals WHERE club_id = ? AND kind = ? ORDER BY start_date DESC, rowid DESC LIMIT 1').get(clubId, kind);
  return last != null && last.terminated_on != null;
}

const worldSeed = (db: SqlDb) => getMeta(db, 'world_seed') ?? 'sem-semente';

/** Cria contratos de patrocínio iniciais (vencimentos escalonados) para clubes sem contrato vigente na data. */
export function ensureSponsorDeals(db: SqlDb, date: string): void {
  const seed = worldSeed(db);
  for (const c of db.prepare(`${ECON_SQL} WHERE c.id IN ${FULL_CLUBS}`).all().map(toClub)) {
    for (const kind of KINDS) {
      if (coveringDeal(db, c.id, kind, date)) continue;
      if (vacatedByUser(db, c.id, kind)) continue;
      const rng = createRng(`sponsor-len:${seed}:${c.id}:${kind}:${date}`);
      createDeal(db, seed, c.econ, c.id, kind, date, rng.int(180, 1460));
    }
  }
}

/** Idempotente: prepara patrocínios e marca o ponto de partida da cobrança mensal (saves antigos não são cobrados retroativamente). */
export function ensureFinance(db: SqlDb): void {
  withTransaction(db, () => {
    const st = getCareerState(db);
    if (getMeta(db, 'finance_last_month') === null) setMeta(db, 'finance_last_month', monthOf(st.gameDate));
    applySponsorFloor(db, st.gameDate);
    applySalaryFloor(db);
    ensureSponsorDeals(db, st.gameDate);
  });
}

/** Salário mínimo do país do clube (`minSalary`): piso dos pedidos de salário de quem joga ou vai jogar nele. */
export function wageFloorOf(db: SqlDb, clubId: string): number {
  return minSalary(N(db.prepare('SELECT co.economy FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(clubId)?.economy ?? 1));
}

/** Economia do país de uma nacionalidade (1 para quem não é de um país do universo). */
export function nationEconomy(db: SqlDb, code: string): number {
  return N(db.prepare('SELECT economy FROM countries WHERE code = ?').get(code)?.economy ?? 1);
}

/**
 * Saves anteriores ao salário mínimo por país (v0.8.10): quem ganha exatamente o piso antigo (1.500) porque o valor dava menos passa ao
 * salário pelo valor com o mínimo do país do clube (livres: da nacionalidade). Jovens da base não mudam. Uma vez por save. NÃO abre transação.
 */
function applySalaryFloor(db: SqlDb): void {
  if (getMeta(db, 'salary_floor') !== null) return;
  const up = db.prepare('UPDATE players SET salary = ? WHERE id = ?');
  const rows = db.prepare(`SELECT p.id, p.salary, p.market_value, p.nationality, co.economy AS club_econ FROM players p
    LEFT JOIN clubs cl ON cl.id = p.club_id LEFT JOIN countries co ON co.id = cl.country_id
    WHERE p.salary = 1500 AND (p.club_id IS NOT NULL OR p.youth_club_id IS NULL)`).all();
  for (const r of rows) {
    const econ = r.club_econ != null ? N(r.club_econ) : nationEconomy(db, S(r.nationality));
    const next = rebasedFloorSalary(N(r.salary), N(r.market_value), econ);
    if (next !== N(r.salary)) up.run(next, S(r.id));
  }
  setMeta(db, 'salary_floor', '1');
}

/**
 * Saves anteriores ao piso de patrocínio (v0.8.10): a cota de participação da TV caiu pelo valor do piso, então os contratos em vigor dos
 * clubes da 3ª divisão para baixo sobem a parte do piso de cada cota (mesma receita total de antes). Uma vez por save; carreira nova só
 * marca (os contratos já nascem com o piso). NÃO abre transação.
 */
function applySponsorFloor(db: SqlDb, date: string): void {
  if (getMeta(db, 'sponsor_floor') !== null) return;
  const up = db.prepare('UPDATE sponsor_deals SET monthly_amount = monthly_amount + ? WHERE id = ?');
  for (const c of db.prepare(ECON_SQL).all().map(toClub)) {
    const floor = sponsorFloorOf(c.econ.tier);
    if (!floor) continue;
    for (const d of db.prepare("SELECT id, kind FROM sponsor_deals WHERE club_id = ? AND end_date >= ? AND (terminated_on IS NULL OR terminated_on = '')").all(c.id, date)) {
      up.run(Math.round(c.econ.econ * floor * SPONSOR_SHARE[S(d.kind) as SponsorKind]), S(d.id));
    }
  }
  setMeta(db, 'sponsor_floor', '1');
}

/** Liquida (uma única vez) cada mês cujo dia 1 já passou. NÃO abre transação: chame dentro de uma. */
export function settleFinances(db: SqlDb, upTo: string): number {
  let last = getMeta(db, 'finance_last_month');
  if (last === null) return 0;
  const st = getCareerState(db);
  const seed = worldSeed(db);
  const post = makePoster(db, st.clubId);
  let settled = 0;
  for (let m = nextMonth(last); `${m}-01` <= upTo; m = nextMonth(m)) {
    const date = `${m}-01`;
    const wages = new Map(db.prepare('SELECT club_id, SUM(salary) AS w FROM players WHERE club_id IS NOT NULL GROUP BY club_id').all().map((r) => [S(r.club_id), N(r.w)]));
    const youth = new Map(db.prepare('SELECT youth_club_id, SUM(salary) AS w FROM players WHERE youth_club_id IS NOT NULL GROUP BY youth_club_id').all().map((r) => [S(r.youth_club_id), N(r.w)]));
    const scouts = N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS w FROM scouts').get()!.w); // só o clube do usuário tem olheiros
    const coaching = N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS w FROM staff').get()!.w); // e comissão técnica contratada
    for (const c of db.prepare(`${ECON_SQL} WHERE c.id IN ${FULL_CLUBS}`).all().map(toClub)) {
      const label = c.id === st.clubId;
      post(c.id, date, 'tv', tvMonthly(c.econ), 'Direitos de transmissão (TV)');
      post(c.id, date, 'merchandising', merchMonthly(c.econ), 'Produtos oficiais e licenciamento');
      for (const kind of KINDS) {
        let deal = coveringDeal(db, c.id, kind, date);
        if (!deal && vacatedByUser(db, c.id, kind)) continue; // cota rescindida pelo usuário: sem receita até um contrato novo
        if (!deal) {
          createDeal(db, seed, c.econ, c.id, kind, date, createRng(`sponsor-renew:${seed}:${c.id}:${kind}:${date}`).int(730, 1460));
          deal = coveringDeal(db, c.id, kind, date)!;
        }
        post(c.id, date, 'sponsorship', N(deal.monthly_amount), label ? `${KIND_LABEL[kind]}: ${S(deal.sponsor_name)}` : '');
      }
      post(c.id, date, 'wages', -(wages.get(c.id) ?? 0), 'Salários dos jogadores');
      if (label) {
        post(c.id, date, 'staff', -staffUserMonthly(c.econ), 'Estrutura: categorias de base e instalações');
        post(c.id, date, 'coaching', -coaching, 'Salários da comissão técnica');
      } else post(c.id, date, 'staff', -staffMonthly(c.econ), 'Comissão técnica e categorias de base');
      post(c.id, date, 'youth', -(youth.get(c.id) ?? 0), 'Salários das categorias de base');
      if (label) post(c.id, date, 'scouting', -scouts, 'Salários dos olheiros');
      post(c.id, date, 'maintenance', -maintenanceMonthly(c.econ), 'Estádio e instalações');
      post(c.id, date, 'operations', -operationsMonthly(c.econ), 'Administração, viagens e marketing');
    }
    setMeta(db, 'finance_last_month', m);
    last = m; settled++;
  }
  return settled;
}

export const settleFinancesTx = (db: SqlDb, upTo: string): number => withTransaction(db, () => settleFinances(db, upTo));

/** Bilheteria de uma partida em casa: público, renda, atualização do jogo e lançamento. */
export function recordGate(db: SqlDb, post: Poster, f: { id: string; date: string; homeId: string; awayId: string; awayName: string }, weather: Weather, seed: string): { attendance: number; revenue: number } {
  const home = loadClubEcon(db, f.homeId);
  const awayRep = N(db.prepare('SELECT reputation FROM clubs WHERE id = ?').get(f.awayId)!.reputation);
  const att = attendance(home, awayRep, weather, createRng(`gate:${seed}:${f.id}`));
  const revenue = gateRevenue(att, home);
  db.prepare('UPDATE matches SET attendance = ?, gate_revenue = ? WHERE fixture_id = ?').run(att, revenue, f.id);
  post(f.homeId, f.date, 'gate', revenue, `Bilheteria vs ${f.awayName} (${att.toLocaleString('pt-BR')} pagantes)`, f.id);
  return { attendance: att, revenue };
}

export function getFinanceOverview(db: SqlDb): Omit<FinanceOverviewDto, 'sponsorSlots'> {
  const st = getCareerState(db);
  const club = db.prepare(`${ECON_SQL} WHERE c.id = ?`).get(st.clubId)!;
  const econ = toClub(club).econ;
  const balance = N(db.prepare('SELECT balance FROM clubs WHERE id = ?').get(st.clubId)!.balance);
  const months = db.prepare(`SELECT month, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income, SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS expense
    FROM finance_months WHERE club_id = ? GROUP BY month ORDER BY month DESC LIMIT 12`).all(st.clubId).reverse()
    .map((r) => ({ month: S(r.month), income: N(r.income), expense: N(r.expense), net: N(r.income) - N(r.expense) }));
  const itemsByMonth = new Map<string, Array<{ category: string; amount: number }>>();
  if (months.length) {
    for (const r of db.prepare('SELECT month, category, amount FROM finance_months WHERE club_id = ? AND month >= ? ORDER BY month, category').all(st.clubId, months[0]!.month)) {
      const list = itemsByMonth.get(S(r.month)) ?? [];
      list.push({ category: S(r.category), amount: N(r.amount) });
      itemsByMonth.set(S(r.month), list);
    }
  }
  const last12 = months.map((m) => { const items = itemsByMonth.get(m.month) ?? []; return { ...m, items, settled: items.some((i) => i.category === 'wages') }; });
  const lastMonth = months.at(-1)?.month ?? null;
  const breakdown = lastMonth ? db.prepare('SELECT category, amount FROM finance_months WHERE club_id = ? AND month = ? ORDER BY category').all(st.clubId, lastMonth)
    .map((r) => ({ category: S(r.category) as FinanceCategory, amount: N(r.amount) })) : [];
  const wageBill = N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS w FROM players WHERE club_id = ?').get(st.clubId)!.w);
  const youthBill = N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS w FROM players WHERE youth_club_id = ?').get(st.clubId)!.w);
  const scoutBill = N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS w FROM scouts').get()!.w);
  const coachingBill = N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS w FROM staff').get()!.w);
  const staffFixed = staffUserMonthly(econ);
  const deals = db.prepare('SELECT * FROM sponsor_deals WHERE club_id = ? AND end_date >= ? AND start_date <= ? ORDER BY kind').all(st.clubId, st.gameDate, st.gameDate);
  const sponsorsMonthly = deals.reduce((s, d) => s + N(d.monthly_amount), 0);
  // Bilheteria: média dos últimos jogos em casa (se houver ao menos 3) ou estimativa pela fórmula; anualizada pelos jogos em casa da temporada.
  const gateRows = db.prepare('SELECT gate_revenue FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.home_club_id = ? AND m.gate_revenue IS NOT NULL ORDER BY f.match_date DESC LIMIT 10').all(st.clubId);
  const homeGames = N(db.prepare(`SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE f.home_club_id = ? AND ${CURRENT_COMP}`).get(st.clubId)!.n);
  const gateEstimated = gateRows.length < 3;
  const avgGate = gateEstimated ? gateRevenue(Math.round(econ.capacity * expectedFill(econ.reputation, 50, 'clear')), econ) : gateRows.reduce((a, r) => a + N(r.gate_revenue), 0) / gateRows.length;
  const gateMonthly = Math.round((avgGate * homeGames) / 12);
  const income = tvMonthly(econ) + merchMonthly(econ) + sponsorsMonthly + gateMonthly;
  const expense = wageBill + youthBill + scoutBill + coachingBill + staffFixed + maintenanceMonthly(econ) + operationsMonthly(econ);
  const net = income - expense;
  // saldo no fim de cada mês: de trás para frente a partir do saldo de hoje (o mês corrente termina no saldo atual)
  const monthTotals = db.prepare('SELECT month, SUM(amount) AS t FROM finance_months WHERE club_id = ? GROUP BY month ORDER BY month DESC LIMIT 24').all(st.clubId);
  const balanceHistory: Array<{ month: string; balance: number }> = [];
  let running = balance;
  for (const r of monthTotals) { balanceHistory.push({ month: S(r.month), balance: running }); running -= N(r.t); }
  balanceHistory.reverse();
  // temporada corrente × anterior (janelas da temporada do país do clube)
  const cs = userSeason(db);
  const prevStarts = `${Number(cs.starts.slice(0, 4)) - 1}${cs.starts.slice(4)}`;
  const byCategory = (fromMonth: string, toMonth: string | null) => db.prepare(`SELECT category, SUM(amount) AS a FROM finance_months WHERE club_id = ? AND month >= ? ${toMonth ? 'AND month < ?' : ''} GROUP BY category ORDER BY category`)
    .all(...(toMonth ? [st.clubId, fromMonth, toMonth] : [st.clubId, fromMonth])).map((r) => ({ category: S(r.category), amount: N(r.a) }));
  const previous = byCategory(prevStarts.slice(0, 7), cs.starts.slice(0, 7));
  const b = db.prepare('SELECT transfer_budget, transfer_spent, wage_ceiling FROM board_state WHERE id = 1 AND club_id = ?').get(st.clubId);
  return {
    balanceHistory,
    season: { label: cs.label, current: byCategory(cs.starts.slice(0, 7), null), previousLabel: previous.length ? seasonLabelFor(cs.season - 1, cs.start, false) : null, previous },
    budgets: b ? { transfer: N(b.transfer_budget), spent: N(b.transfer_spent), remaining: Math.max(0, N(b.transfer_budget) - N(b.transfer_spent)), wageCeiling: N(b.wage_ceiling), payroll: wageBill } : null,
    ticketPrice: ticketPrice(econ), capacity: econ.capacity,
    balance, lastSettledMonth: lastMonth, last12, lastMonth: breakdown,
    projection: { income, expense, net, wageBill, youthBill, scoutBill, coachingBill, staffFixed, gate: gateMonthly, gateEstimated },
    runwayMonths: net < 0 && balance > 0 ? Math.floor(balance / -net) : null,
    sponsors: deals.map((d) => ({ id: S(d.id), kind: S(d.kind) as SponsorKind, sponsor: S(d.sponsor_name), monthly: N(d.monthly_amount), start: S(d.start_date), end: S(d.end_date) })),
    gates: db.prepare(`SELECT m.fixture_id, f.match_date, a.name AS away, m.attendance, st.capacity, m.gate_revenue FROM matches m JOIN fixtures f ON f.id = m.fixture_id
      JOIN clubs a ON a.id = f.away_club_id JOIN clubs h ON h.id = f.home_club_id JOIN stadiums st ON st.id = h.stadium_id
      WHERE f.home_club_id = ? AND m.attendance IS NOT NULL ORDER BY f.match_date DESC LIMIT 24`).all(st.clubId)
      .map((r) => ({ fixtureId: S(r.fixture_id), date: S(r.match_date), opponent: S(r.away), attendance: N(r.attendance), capacity: N(r.capacity), revenue: N(r.gate_revenue) })),
  };
}

export const LEDGER_PAGE_SIZE = 14;
/** Extrato do clube do usuário, paginado (mais recente primeiro) e filtrado por categoria. */
export function getLedgerPage(db: SqlDb, page: number, category?: string): FinanceLedgerDto {
  const st = getCareerState(db);
  const where = category ? 'club_id = ? AND category = ?' : 'club_id = ?';
  const args = category ? [st.clubId, category] : [st.clubId];
  const total = N(db.prepare(`SELECT COUNT(*) AS n FROM finance_ledger WHERE ${where}`).get(...args)!.n);
  const pages = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE));
  const p = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const rows = db.prepare(`SELECT date, category, amount, description FROM finance_ledger WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, LEDGER_PAGE_SIZE, p * LEDGER_PAGE_SIZE)
    .map((r) => ({ date: S(r.date), category: S(r.category), amount: N(r.amount), description: S(r.description) }));
  return { rows, total, page: p, pageSize: LEDGER_PAGE_SIZE };
}
