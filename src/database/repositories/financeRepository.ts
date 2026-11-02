import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { createRng } from '../../game/rng.ts';
import {
  attendance, expectedFill, gateRevenue, maintenanceMonthly, merchMonthly, operationsMonthly, SPONSOR_SHARE, sponsorTotalMonthly, staffMonthly, tvMonthly,
  type ClubEcon, type FinanceCategory, type SponsorKind, type Weather,
} from '../../game/finance-engine/finance.ts';
import { addDays } from '../../shared/date.ts';
import type { FinanceOverviewDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const KINDS: SponsorKind[] = ['shirt', 'kit', 'stadium'];
const KIND_LABEL: Record<SponsorKind, string> = { shirt: 'Patrocínio master (camisa)', kit: 'Fornecedora de material esportivo', stadium: 'Naming rights do estádio' };
const SPONSOR_NAMES: Record<SponsorKind, string[]> = {
  shirt: ['Banco Aurora', 'Telecom Nova', 'Seguros Horizonte', 'Energia Solaris', 'Rede Atlântica', 'Construtora Pilar', 'Aero Cumulus', 'Cervejaria Vale', 'Mineração Meridional', 'Financeira Prisma'],
  kit: ['Kinetic', 'Vexa', 'Orbita', 'Lumo', 'Stride', 'Zefir', 'Nuvem Sports'],
  stadium: ['Arena Cobalto', 'Grupo Savana', 'Laticínios Serra', 'Hotéis Lagoa', 'Supermercados Faro', 'Tecnologia Íris'],
};

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

const worldSeed = (db: SqlDb) => getMeta(db, 'world_seed') ?? 'sem-semente';

/** Cria contratos de patrocínio iniciais (vencimentos escalonados) para clubes sem contrato vigente na data. */
export function ensureSponsorDeals(db: SqlDb, date: string): void {
  const seed = worldSeed(db);
  for (const c of db.prepare(ECON_SQL).all().map(toClub)) {
    for (const kind of KINDS) {
      if (coveringDeal(db, c.id, kind, date)) continue;
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
    ensureSponsorDeals(db, st.gameDate);
  });
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
    for (const c of db.prepare(ECON_SQL).all().map(toClub)) {
      const label = c.id === st.clubId;
      post(c.id, date, 'tv', tvMonthly(c.econ), 'Direitos de transmissão (TV)');
      post(c.id, date, 'merchandising', merchMonthly(c.econ), 'Produtos oficiais e licenciamento');
      for (const kind of KINDS) {
        let deal = coveringDeal(db, c.id, kind, date);
        if (!deal) {
          createDeal(db, seed, c.econ, c.id, kind, date, createRng(`sponsor-renew:${seed}:${c.id}:${kind}:${date}`).int(730, 1460));
          deal = coveringDeal(db, c.id, kind, date)!;
        }
        post(c.id, date, 'sponsorship', N(deal.monthly_amount), label ? `${KIND_LABEL[kind]}: ${S(deal.sponsor_name)}` : '');
      }
      post(c.id, date, 'wages', -(wages.get(c.id) ?? 0), 'Salários dos jogadores');
      post(c.id, date, 'staff', -staffMonthly(c.econ), 'Comissão técnica e categorias de base');
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

export function getFinanceOverview(db: SqlDb): FinanceOverviewDto {
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
  const deals = db.prepare('SELECT * FROM sponsor_deals WHERE club_id = ? AND end_date >= ? AND start_date <= ? ORDER BY kind').all(st.clubId, st.gameDate, st.gameDate);
  const sponsorsMonthly = deals.reduce((s, d) => s + N(d.monthly_amount), 0);
  // Bilheteria: média dos últimos jogos em casa (se houver ao menos 3) ou estimativa pela fórmula; anualizada pelos jogos em casa da temporada.
  const gateRows = db.prepare('SELECT gate_revenue FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.home_club_id = ? AND m.gate_revenue IS NOT NULL ORDER BY f.match_date DESC LIMIT 10').all(st.clubId);
  const homeGames = N(db.prepare('SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE f.home_club_id = ? AND c.season = ?').get(st.clubId, st.season)!.n);
  const gateEstimated = gateRows.length < 3;
  const avgGate = gateEstimated ? gateRevenue(Math.round(econ.capacity * expectedFill(econ.reputation, 50, 'clear')), econ) : gateRows.reduce((a, r) => a + N(r.gate_revenue), 0) / gateRows.length;
  const gateMonthly = Math.round((avgGate * homeGames) / 12);
  const income = tvMonthly(econ) + merchMonthly(econ) + sponsorsMonthly + gateMonthly;
  const expense = wageBill + youthBill + scoutBill + staffMonthly(econ) + maintenanceMonthly(econ) + operationsMonthly(econ);
  const net = income - expense;
  return {
    balance, lastSettledMonth: lastMonth, last12, lastMonth: breakdown,
    projection: { income, expense, net, wageBill, youthBill, scoutBill, gate: gateMonthly, gateEstimated },
    runwayMonths: net < 0 && balance > 0 ? Math.floor(balance / -net) : null,
    sponsors: deals.map((d) => ({ id: S(d.id), kind: S(d.kind) as SponsorKind, sponsor: S(d.sponsor_name), monthly: N(d.monthly_amount), start: S(d.start_date), end: S(d.end_date) })),
    gates: db.prepare(`SELECT m.fixture_id, f.match_date, a.name AS away, m.attendance, st.capacity, m.gate_revenue FROM matches m JOIN fixtures f ON f.id = m.fixture_id
      JOIN clubs a ON a.id = f.away_club_id JOIN clubs h ON h.id = f.home_club_id JOIN stadiums st ON st.id = h.stadium_id
      WHERE f.home_club_id = ? AND m.attendance IS NOT NULL ORDER BY f.match_date DESC LIMIT 10`).all(st.clubId)
      .map((r) => ({ fixtureId: S(r.fixture_id), date: S(r.match_date), opponent: S(r.away), attendance: N(r.attendance), capacity: N(r.capacity), revenue: N(r.gate_revenue) })),
    ledger: db.prepare('SELECT date, category, amount, description FROM finance_ledger WHERE club_id = ? ORDER BY id DESC LIMIT 60').all(st.clubId)
      .map((r) => ({ date: S(r.date), category: S(r.category) as FinanceCategory, amount: N(r.amount), description: S(r.description) })),
  };
}
