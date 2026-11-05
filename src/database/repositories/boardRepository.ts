import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng } from '../../game/rng.ts';
import { addDays, daysBetween } from '../../shared/date.ts';
import { computeStandings, type MatchResult } from '../../game/competition-engine/standings.ts';
import { annualEstimate } from '../../game/finance-engine/finance.ts';
import {
  aiSackChance, CONFIDENCE, eligibleForCoach, evaluateSeason, expectedPosition, matchDelta, monthlyDelta, OBJECTIVE_LABEL, objectiveFor, OFFER_DAYS,
  seasonBudgets, VACANCY_FILL_DAYS, vetoReason, youthTargetFor, type Objective, type SeasonVerdict,
} from '../../game/board-engine/board.ts';
import type { Coach, LeagueRules } from '../../shared/types.ts';
import type { BoardOverviewDto, BoardStatus, MatchSummaryDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { loadClubEcon } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';
import { FULL_CLUBS } from './simLevelRepository.ts';
import { fmtMoney } from '../../shared/money.ts';

export class BoardError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const fmt = fmtMoney; // dinheiro nas mensagens (moeda única: euro)
const br = (d: string) => d.split('-').reverse().join('/');
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const clubName = (db: SqlDb, id: string) => S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)?.name ?? '?');
const balanceOf = (db: SqlDb, id: string) => N(db.prepare('SELECT balance FROM clubs WHERE id = ?').get(id)!.balance);
const payrollOf = (db: SqlDb, id: string) => N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS w FROM players WHERE club_id = ?').get(id)!.w);

// ---------------------------------------------------------------- treinador
export function coachOf(db: SqlDb): Coach { return JSON.parse(S(db.prepare('SELECT coach_json FROM career WHERE id = 1').get()!.coach_json)) as Coach; }
function changeReputation(db: SqlDb, delta: number): number {
  const c = coachOf(db);
  c.reputation = Math.max(1, Math.min(100, Math.round(c.reputation + delta)));
  db.prepare('UPDATE career SET coach_json = ? WHERE id = 1').run(JSON.stringify(c));
  return c.reputation;
}

// ---------------------------------------------------------------- tabela (derivada das partidas; sem depender do competitionRepository)
interface LeagueSituation { position: number; played: number; teams: number; expected: number; rules: LeagueRules; tier: number; competitionId: string }
export function leagueSituation(db: SqlDb, clubId: string, season: number): LeagueSituation | null {
  const c = db.prepare(`SELECT c.id, l.rules_json, l.tier FROM competitions c JOIN leagues l ON l.id = c.league_id
    WHERE c.season = ? AND c.id IN (SELECT competition_id FROM fixtures WHERE home_club_id = ? OR away_club_id = ?) LIMIT 1`).get(season, clubId, clubId);
  if (!c) return null;
  const rules = JSON.parse(S(c.rules_json)) as LeagueRules;
  const teams = db.prepare(`SELECT id, reputation FROM clubs WHERE id IN (SELECT home_club_id FROM fixtures WHERE competition_id = ? UNION SELECT away_club_id FROM fixtures WHERE competition_id = ?)`).all(S(c.id), S(c.id));
  const results: MatchResult[] = db.prepare("SELECT home_club_id, away_club_id, home_goals, away_goals FROM fixtures WHERE competition_id = ? AND status = 'played'").all(S(c.id))
    .map((r) => ({ home: S(r.home_club_id), away: S(r.away_club_id), homeGoals: N(r.home_goals), awayGoals: N(r.away_goals) }));
  const table = computeStandings(teams.map((t) => S(t.id)), results, rules);
  const row = table.find((r) => r.teamId === clubId)!;
  const rep = N(teams.find((t) => S(t.id) === clubId)!.reputation);
  return { position: row.position, played: row.played, teams: teams.length, expected: expectedPosition(rep, teams.map((t) => N(t.reputation))), rules, tier: N(c.tier), competitionId: S(c.id) };
}

// ---------------------------------------------------------------- objetivos e orçamentos da temporada
/** Define objetivos, orçamentos e confiança para o clube atual (início de temporada ou contratação). NÃO abre transação. */
export function setBoardForSeason(db: SqlDb, confidence: number): void {
  const st = getCareerState(db);
  if (!st.clubId) { db.exec('DELETE FROM board_state'); return; }
  const sit = leagueSituation(db, st.clubId, st.season);
  const goal = sit ? objectiveFor(sit.expected, sit.teams, sit.rules) : { objective: 'top_half' as Objective, target: 10 };
  const econ = loadClubEcon(db, st.clubId);
  const payroll = payrollOf(db, st.clubId);
  const b = seasonBudgets(balanceOf(db, st.clubId), annualEstimate(econ, payroll).income / 12, payroll);
  db.exec('DELETE FROM board_state');
  db.prepare(`INSERT INTO board_state (id, club_id, season, objective, target_position, expected_position, confidence, transfer_budget, wage_ceiling, youth_target)
    VALUES (1,?,?,?,?,?,?,?,?,?)`).run(st.clubId, st.season, goal.objective, goal.target, sit?.expected ?? goal.target, confidence, b.transfer, b.wageCeiling, youthTargetFor(econ.facilities.youth));
}

/** Garante diretoria e passagem atual (carreiras novas e saves anteriores à Fase 8D). Idempotente. */
export function ensureBoard(db: SqlDb): void {
  const st = getCareerState(db);
  if (!st.clubId) return;
  const row = db.prepare('SELECT club_id, season, confidence FROM board_state WHERE id = 1').get();
  const spell = db.prepare('SELECT club_id FROM coach_spells WHERE end_date IS NULL').get();
  if (row && S(row.club_id) === st.clubId && N(row.season) === st.season && spell) return;
  withTransaction(db, () => {
    if (!spell) {
      const start = S((db.prepare("SELECT value FROM meta WHERE key = 'world_start_date'").get() ?? { value: st.gameDate }).value);
      db.prepare('INSERT INTO coach_spells (club_id, start_date) VALUES (?, ?)').run(st.clubId, start);
    }
    if (!row || S(row.club_id) !== st.clubId || N(row.season) !== st.season) setBoardForSeason(db, row && S(row.club_id) === st.clubId ? N(row.confidence ?? CONFIDENCE.start) : CONFIDENCE.start);
  });
}

function board(db: SqlDb) { return db.prepare('SELECT * FROM board_state WHERE id = 1').get(); }
function setConfidence(db: SqlDb, value: number) { db.prepare('UPDATE board_state SET confidence = ? WHERE id = 1').run(Math.max(0, Math.min(100, Math.round(value * 10) / 10))); }

// ---------------------------------------------------------------- reações da diretoria
/** Depois de cada rodada: a partida do clube do usuário mexe na confiança. NÃO abre transação. */
export function applyMatchesToBoard(db: SqlDb, results: MatchSummaryDto[]): void {
  const st = getCareerState(db);
  const b = board(db);
  if (!st.clubId || !b) return;
  for (const r of results) {
    if (!r.involvesUser) continue;
    const f = db.prepare('SELECT home_club_id FROM fixtures WHERE id = ?').get(r.fixtureId)!;
    const home = S(f.home_club_id) === st.clubId;
    setConfidence(db, N(board(db)!.confidence) + matchDelta(home ? r.homeGoals : r.awayGoals, home ? r.awayGoals : r.homeGoals, S(b.objective) as Objective));
    db.prepare('UPDATE board_state SET matches = matches + 1 WHERE id = 1').run();
  }
}

/** Compras e vendas do usuário mexem no orçamento: compra consome a taxa; venda devolve metade da taxa ao orçamento. NÃO abre transação. */
export function recordTransferForBoard(db: SqlDb, kind: 'purchase' | 'sale', fee: number): void {
  if (!board(db)) return;
  if (kind === 'purchase') db.prepare('UPDATE board_state SET transfer_spent = transfer_spent + ? WHERE id = 1').run(fee);
  else db.prepare('UPDATE board_state SET transfer_budget = transfer_budget + ? WHERE id = 1').run(Math.round(fee / 2));
}
export const recordYouthPromotionForBoard = (db: SqlDb): void => { db.prepare('UPDATE board_state SET youth_promoted = youth_promoted + 1 WHERE id = 1').run(); };

/**
 * Autorização da diretoria para uma contratação/renovação. Devolve o motivo do veto (ou null): orçamento de transferências, teto da folha e valores fora da
 * realidade do clube (taxa > 2× o valor; salário > 2,2× o justo).
 */
export function boardVeto(db: SqlDb, a: { fee: number; wage: number; marketValue: number; replacesSalary?: number }): string | null {
  const st = getCareerState(db);
  const b = board(db);
  if (!b) return null;
  const remaining = N(b.transfer_budget) - N(b.transfer_spent);
  if (a.fee > remaining) return `A diretoria não autoriza: a taxa de ${fmt(a.fee)} supera o orçamento de transferências restante (${fmt(Math.max(0, remaining))}).`;
  const payroll = payrollOf(db, st.clubId) - (a.replacesSalary ?? 0) + a.wage;
  if (payroll > N(b.wage_ceiling)) return `A diretoria não autoriza: a folha salarial passaria de ${fmt(payroll)}, acima do teto de ${fmt(N(b.wage_ceiling))} por mês.`;
  const why = vetoReason({ fee: a.fee > 0 ? a.fee : undefined, marketValue: a.marketValue, wage: a.wage });
  return why ? `A diretoria vetou a negociação: ${why}.` : null;
}

/** Obras grandes (mais de 30% do caixa) precisam de aprovação: só com confiança 50+ e se sobrar caixa para 3 meses de folha. */
export function boardApprovesConstruction(db: SqlDb, cost: number): string | null {
  const st = getCareerState(db);
  const b = board(db);
  const balance = balanceOf(db, st.clubId);
  if (!b || cost <= balance * 0.3) return null;
  if (N(b.confidence) < 50) return `A diretoria negou a obra: com a confiança em ${Math.round(N(b.confidence))}, não aprova investimentos acima de 30% do caixa.`;
  if (balance - cost < 3 * payrollOf(db, st.clubId)) return 'A diretoria negou a obra: o caixa ficaria abaixo de 3 meses de salários.';
  return null;
}

/** Pedido de mais orçamento (uma vez por temporada cada): aceito com confiança 65+ e caixa folgado. */
export function requestBudget(db: SqlDb, kind: 'transfer' | 'wage'): { approved: boolean; message: string } {
  const st = getCareerState(db);
  const b = board(db);
  if (!st.clubId || !b) throw new BoardError('Você está sem clube.');
  const used = kind === 'transfer' ? N(b.transfer_request_used) : N(b.wage_request_used);
  if (used) throw new BoardError('A diretoria já analisou um pedido desse tipo nesta temporada.');
  db.prepare(`UPDATE board_state SET ${kind === 'transfer' ? 'transfer_request_used' : 'wage_request_used'} = 1 WHERE id = 1`).run();
  const conf = N(b.confidence), balance = balanceOf(db, st.clubId);
  if (conf < 65) return { approved: false, message: `Pedido negado: a diretoria só amplia orçamentos com confiança de 65 ou mais (hoje ${Math.round(conf)}).` };
  if (kind === 'transfer') {
    const extra = Math.round((N(b.transfer_budget) * 0.25) / 1000) * 1000;
    if (N(b.transfer_budget) - N(b.transfer_spent) + extra > balance * 0.7) return { approved: false, message: 'Pedido negado: o caixa não comporta um orçamento maior.' };
    db.prepare('UPDATE board_state SET transfer_budget = transfer_budget + ? WHERE id = 1').run(extra);
    return { approved: true, message: `Pedido aprovado: +${fmt(extra)} no orçamento de transferências.` };
  }
  const extra = Math.round((N(b.wage_ceiling) * 0.1) / 100) * 100;
  db.prepare('UPDATE board_state SET wage_ceiling = wage_ceiling + ? WHERE id = 1').run(extra);
  return { approved: true, message: `Pedido aprovado: teto da folha +${fmt(extra)} por mês.` };
}

// ---------------------------------------------------------------- troca de clube e demissão
/** Sai do clube atual: o que era "do usuário" (comissão, olheiros, rotina, listas) fica para trás; obras em andamento seguem com o clube. NÃO abre transação. */
function leaveClub(db: SqlDb, date: string, reason: 'sacked' | 'left'): void {
  const st = getCareerState(db);
  db.prepare('UPDATE coach_spells SET end_date = ?, end_reason = ? WHERE end_date IS NULL').run(date, reason);
  db.exec(`DELETE FROM staff; DELETE FROM scouts; DELETE FROM scout_knowledge; DELETE FROM scout_shortlist; DELETE FROM player_training; DELETE FROM transfer_list;
    UPDATE training_settings SET intensity = 'normal', delegated = 0 WHERE id = 1; UPDATE tactic_schemes SET lineup_json = NULL; DELETE FROM board_state;`);
  db.prepare("UPDATE transfer_offers SET status = 'expired', response_date = ? WHERE status = 'pending'").run(date);
  if (st.clubId) db.prepare('INSERT OR REPLACE INTO job_vacancies (club_id, opened_on) VALUES (?, ?)').run(st.clubId, date);
}

/** Demissão: o treinador fica sem clube; a carreira continua (propostas de emprego). NÃO abre transação. */
export function fireCoach(db: SqlDb, date: string, why: string): void {
  const st = getCareerState(db);
  const name = clubName(db, st.clubId);
  leaveClub(db, date, 'sacked');
  db.prepare('UPDATE career SET club_id = NULL WHERE id = 1').run();
  changeReputation(db, -6);
  db.prepare("UPDATE job_offers SET status = 'expired' WHERE status = 'pending'").run();
  addNews(db, date, 'season', `DEMITIDO: ${name} encerra o trabalho do treinador`, `${why} A carreira continua: aguarde propostas de emprego na aba Diretoria.`);
}

/** Assume outro clube (proposta aceita). NÃO abre transação. */
function takeJob(db: SqlDb, clubId: string, date: string): void {
  const st = getCareerState(db);
  const from = st.clubId ? clubName(db, st.clubId) : null;
  if (st.clubId) leaveClub(db, date, 'left');
  db.prepare('UPDATE career SET club_id = ? WHERE id = 1').run(clubId);
  db.prepare('DELETE FROM job_vacancies WHERE club_id = ?').run(clubId);
  db.prepare('INSERT INTO coach_spells (club_id, start_date) VALUES (?, ?)').run(clubId, date);
  db.prepare("UPDATE job_offers SET status = 'expired' WHERE status = 'pending'").run();
  setBoardForSeason(db, CONFIDENCE.newHire);
  addNews(db, date, 'season', `Novo clube: o treinador assume o ${clubName(db, clubId)}`, from ? `Deixou o ${from}. A diretoria já definiu os objetivos da temporada.` : 'A diretoria já definiu os objetivos da temporada.');
}

export function respondJobOffer(db: SqlDb, offerId: number, accept: boolean): void {
  const st = getCareerState(db);
  const o = db.prepare('SELECT * FROM job_offers WHERE id = ?').get(offerId);
  if (!o || S(o.status) !== 'pending') throw new BoardError('Proposta não encontrada ou já respondida.');
  if (S(o.expires) < st.gameDate) throw new BoardError('Esta proposta expirou.');
  withTransaction(db, () => {
    if (!accept) { db.prepare("UPDATE job_offers SET status = 'declined' WHERE id = ?").run(offerId); return; }
    db.prepare("UPDATE job_offers SET status = 'accepted' WHERE id = ?").run(offerId);
    takeJob(db, S(o.club_id), st.gameDate);
  });
}

// ---------------------------------------------------------------- dia a dia (chamado por moveClock)
/**
 * Diretoria no dia a dia: ajuste mensal da confiança (tabela e caixa), aviso e demissão; vagas na IA (mensal) e preenchimento; propostas de emprego.
 * NÃO abre transação.
 */
export function processBoardDay(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  const seed = seedOf(db);
  db.prepare("UPDATE job_offers SET status = 'expired' WHERE status = 'pending' AND expires < ?").run(date);
  const b = board(db);
  if (st.clubId && b) {
    if (date.slice(8) === '01') {
      const sit = leagueSituation(db, st.clubId, st.season);
      let delta = sit ? monthlyDelta(sit.position, N(b.target_position), sit.played) : 0;
      if (balanceOf(db, st.clubId) < 0) delta -= 3;
      setConfidence(db, N(b.confidence) + delta);
    }
    const conf = N(board(db)!.confidence);
    if (conf < CONFIDENCE.warning && !N(b.warned)) {
      db.prepare('UPDATE board_state SET warned = 1 WHERE id = 1').run();
      addNews(db, date, 'season', 'Diretoria em alerta: o cargo do treinador está ameaçado', `Confiança em ${Math.round(conf)}. Melhore os resultados para evitar a demissão.`);
    } else if (conf >= CONFIDENCE.recovered && N(b.warned)) db.prepare('UPDATE board_state SET warned = 0 WHERE id = 1').run();
    if (conf <= CONFIDENCE.sack && N(b.matches) >= CONFIDENCE.minMatchesBeforeSack) fireCoach(db, date, `A confiança da diretoria chegou a ${Math.round(conf)}.`);
  }

  // vagas na IA: mensalmente, clubes muito abaixo do esperado podem demitir o técnico; vagas são preenchidas pela IA depois de um tempo
  const now = getCareerState(db);
  if (date.slice(8) === '01') {
    const rng = createRng(`ai-sack:${seed}:${date}`);
    for (const c of db.prepare(`SELECT id FROM clubs WHERE id IN ${FULL_CLUBS} ORDER BY rowid`).all()) {
      const id = S(c.id);
      if (id === now.clubId || db.prepare('SELECT 1 AS x FROM job_vacancies WHERE club_id = ?').get(id)) { rng.next(); continue; }
      const sit = leagueSituation(db, id, now.season);
      if (rng.next() < (sit ? aiSackChance(sit.position, sit.expected, sit.teams, sit.played) : 0)) db.prepare('INSERT INTO job_vacancies (club_id, opened_on) VALUES (?, ?)').run(id, date);
    }
  }
  db.prepare('DELETE FROM job_vacancies WHERE opened_on <= ? AND club_id NOT IN (SELECT club_id FROM job_offers WHERE status = \'pending\')').run(addDays(date, -VACANCY_FILL_DAYS));

  // propostas ao treinador
  const coachRep = coachOf(db).reputation;
  const unemployed = !now.clubId;
  const pending = N(db.prepare("SELECT COUNT(*) AS n FROM job_offers WHERE status = 'pending'").get()!.n);
  if (pending < 3) {
    const rng = createRng(`job-offers:${seed}:${date}`);
    for (const v of db.prepare('SELECT v.club_id, c.reputation FROM job_vacancies v JOIN clubs c ON c.id = v.club_id ORDER BY v.club_id').all()) {
      const roll = rng.next();
      if (S(v.club_id) === now.clubId || !eligibleForCoach(N(v.reputation), coachRep, unemployed)) continue;
      if (db.prepare("SELECT 1 AS x FROM job_offers WHERE club_id = ? AND (status = 'pending' OR (status = 'declined' AND date > ?))").get(S(v.club_id), addDays(date, -60))) continue;
      if (roll >= (unemployed ? 0.08 : 0.03)) continue;
      offerJob(db, S(v.club_id), date);
      break; // no máximo uma proposta nova por dia
    }
    // desempregado há 15+ dias sem propostas: algum clube pequeno chama (abre a vaga se preciso)
    if (unemployed && pending === 0 && !db.prepare("SELECT 1 AS x FROM job_offers WHERE status = 'pending'").get()) {
      const lastEnd = S(db.prepare('SELECT MAX(end_date) AS d FROM coach_spells').get()!.d ?? date);
      if (daysBetween(lastEnd, date) >= 15 && daysBetween(lastEnd, date) % 15 === 0) {
        const small = db.prepare(`SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.id IN ${FULL_CLUBS} ORDER BY l.tier DESC, c.reputation, c.id LIMIT 6`).all().map((r) => S(r.id));
        const pick = createRng(`job-fallback:${seed}:${date}`).pick(small);
        db.prepare('INSERT OR IGNORE INTO job_vacancies (club_id, opened_on) VALUES (?, ?)').run(pick, date);
        offerJob(db, pick, date);
      }
    }
  }
}

function offerJob(db: SqlDb, clubId: string, date: string): void {
  db.prepare('INSERT INTO job_offers (club_id, date, expires) VALUES (?,?,?)').run(clubId, date, addDays(date, OFFER_DAYS));
  addNews(db, date, 'offer', `Proposta de emprego: ${clubName(db, clubId)} quer contratar o treinador`, `Responda até ${br(addDays(date, OFFER_DAYS))} na aba Diretoria.`);
}

// ---------------------------------------------------------------- virada de temporada
/**
 * Avaliação da temporada (na virada, antes do calendário novo): ajusta confiança e reputação do treinador; demite se a confiança acabar.
 * Também abre vagas em clubes rebaixados da IA. NÃO abre transação.
 */
export function reviewSeason(db: SqlDb, date: string, a: { position: number; champion: boolean; promoted: boolean; relegated: boolean } | null, relegatedClubs: string[]): { verdict: SeasonVerdict; sacked: boolean } | null {
  const st = getCareerState(db);
  const rng = createRng(`ai-sack-turnover:${seedOf(db)}:${date}`);
  const full = new Set(db.prepare(FULL_CLUBS.slice(1, -1)).all().map((r) => S(r.id)));
  for (const id of relegatedClubs) if (id !== st.clubId && full.has(id) && rng.chance(0.5)) db.prepare('INSERT OR IGNORE INTO job_vacancies (club_id, opened_on) VALUES (?, ?)').run(id, date);
  const b = board(db);
  if (!st.clubId || !b || !a) return null;
  const verdict = evaluateSeason({ objective: S(b.objective) as Objective, target: N(b.target_position), ...a, balance: balanceOf(db, st.clubId), youthTarget: N(b.youth_target), youthPromoted: N(b.youth_promoted) });
  const conf = Math.max(0, Math.min(100, N(b.confidence) + verdict.confidenceDelta));
  changeReputation(db, verdict.reputationDelta);
  addNews(db, date, 'season', verdict.met ? 'Diretoria satisfeita com a temporada' : 'Diretoria insatisfeita com a temporada', verdict.lines.join(' '));
  if (conf <= CONFIDENCE.sack + 5 && !verdict.met) { fireCoach(db, date, 'A diretoria não renovou a confiança depois da avaliação da temporada.'); return { verdict, sacked: true }; }
  setConfidence(db, conf);
  return { verdict, sacked: false };
}

/** Objetivos e orçamentos da temporada nova (depois do calendário), mantendo a confiança. NÃO abre transação. */
export function startBoardSeason(db: SqlDb): void {
  const b = board(db);
  if (getCareerState(db).clubId) setBoardForSeason(db, b ? N(b.confidence) : CONFIDENCE.start);
}

// ---------------------------------------------------------------- tela
export function getBoardOverview(db: SqlDb): BoardOverviewDto {
  const st = getCareerState(db);
  const coach = coachOf(db);
  const spells = db.prepare('SELECT s.*, c.name FROM coach_spells s JOIN clubs c ON c.id = s.club_id ORDER BY s.start_date DESC, s.id DESC').all()
    .map((r) => ({ clubName: S(r.name), start: S(r.start_date), end: r.end_date == null ? null : S(r.end_date), reason: r.end_reason == null ? null : (S(r.end_reason) as 'sacked' | 'left') }));
  const offers = db.prepare(`SELECT o.id, o.date, o.expires, c.name, c.reputation, l.name AS league, co.name AS country FROM job_offers o JOIN clubs c ON c.id = o.club_id
    JOIN leagues l ON l.id = c.league_id JOIN countries co ON co.id = c.country_id WHERE o.status = 'pending' AND o.expires >= ? ORDER BY o.id`).all(st.gameDate)
    .map((r) => ({ id: N(r.id), clubName: S(r.name), league: `${S(r.league)} (${S(r.country)})`, reputation: N(r.reputation), date: S(r.date), expires: S(r.expires) }));
  const base = { employed: !!st.clubId, coachReputation: coach.reputation, spells, offers };
  const b = board(db);
  if (!st.clubId || !b) return { ...base, club: null };
  const sit = leagueSituation(db, st.clubId, st.season);
  const payroll = payrollOf(db, st.clubId);
  const target = N(b.target_position);
  const status: BoardStatus = !sit || sit.played === 0 ? 'pending' : sit.position <= target ? 'on_track' : sit.position <= target + 2 ? 'close' : 'off_track';
  return {
    ...base,
    club: {
      name: clubName(db, st.clubId), confidence: N(b.confidence), warning: N(b.confidence) < CONFIDENCE.warning,
      objective: { label: OBJECTIVE_LABEL[S(b.objective) as Objective], target, expected: N(b.expected_position), position: sit?.played ? sit.position : null, played: sit?.played ?? 0, status },
      secondary: [
        { label: 'Terminar a temporada no azul', status: balanceOf(db, st.clubId) >= 0 ? 'on_track' : 'off_track', detail: `Caixa atual: ${fmt(balanceOf(db, st.clubId))}` },
        ...(N(b.youth_target) > 0 ? [{ label: `Promover ${N(b.youth_target)} jovem(ns) da base`, status: N(b.youth_promoted) >= N(b.youth_target) ? 'on_track' : 'pending', detail: `${N(b.youth_promoted)} promovido(s) por você nesta temporada` }] : []),
      ] as Array<{ label: string; status: BoardStatus; detail: string }>,
      budgets: { transfer: N(b.transfer_budget), spent: N(b.transfer_spent), remaining: Math.max(0, N(b.transfer_budget) - N(b.transfer_spent)), wageCeiling: N(b.wage_ceiling), payroll },
      requests: { transfer: !N(b.transfer_request_used), wage: !N(b.wage_request_used) },
    },
  };
}
