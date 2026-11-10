/**
 * Patrocínios negociáveis do clube do usuário (v0.8.10; regras puras em `game/finance-engine/sponsors.ts`, docs/FINANCE.md).
 * - 60 dias antes de uma cota vencer chegam 2–3 propostas (e-mail na Caixa de entrada); numa cota vaga, "Buscar patrocinador".
 * - O usuário aceita o que a empresa oferece ou pede mais (até 3 pedidos acima do teto escondido; depois ela desiste por 30 dias).
 * - Vencimento sem decisão: a melhor proposta aberta é aceita automaticamente (a cota nunca fica vazia sem o usuário querer).
 * - Rescisão: multa de 3 mensalidades via `makePoster`; a cota fica vaga até o usuário fechar outro contrato.
 * - Bônus por metas pagos via `makePoster` quando acontecem (virada da temporada e título de copa).
 * Clubes da IA não usam nada disto (renovação automática em `settleFinances`).
 */
import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng } from '../../game/rng.ts';
import { addDays, daysBetween } from '../../shared/date.ts';
import { fmtMoney } from '../../shared/money.ts';
import { sponsorTotalMonthly, type SponsorKind } from '../../game/finance-engine/finance.ts';
import {
  BONUS_LABEL, bonusesDue, SPONSOR_KIND_LABEL, SPONSOR_NAMES, SPONSOR_RULES, sponsorOffers, sponsorReference, sponsorReply, terminationFee,
  type SponsorBonus,
} from '../../game/finance-engine/sponsors.ts';
import type { FinanceOverviewDto, SponsorBonusDto, SponsorDealDto, SponsorNegotiationDto, SponsorOfferDto, SponsorSlotDto } from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { getFinanceOverview, loadClubEcon, makePoster, vacatedByUser, type Poster } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
export const SPONSOR_KINDS: SponsorKind[] = ['shirt', 'kit', 'stadium'];
const SENDER = 'Departamento comercial';

export class SponsorError extends UserError {}

const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const getMeta = (db: SqlDb, key: string): string | null => { const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key); return r ? S(r.value) : null; };
const setMeta = (db: SqlDb, key: string, value: string) => { db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value); };
const fastForwarding = (db: SqlDb) => db.prepare("SELECT 1 AS x FROM meta WHERE key = 'fast_forward'").get() !== undefined;
const parseBonuses = (v: unknown): SponsorBonus[] => (v == null ? [] : (JSON.parse(S(v)) as SponsorBonus[]));
const bonusDto = (b: SponsorBonus): SponsorBonusDto => ({ trigger: b.trigger, label: BONUS_LABEL[b.trigger], amount: b.amount, target: b.target ?? null });
/** valor esperado aproximado dos bônus por mês (para escolher a melhor proposta no aceite automático): soma ÷ 24 */
const bonusMonthlyEv = (b: SponsorBonus[]) => b.reduce((s, x) => s + x.amount, 0) / 24;

function covering(db: SqlDb, clubId: string, kind: SponsorKind, date: string) {
  return db.prepare('SELECT * FROM sponsor_deals WHERE club_id = ? AND kind = ? AND start_date <= ? AND end_date >= ? ORDER BY end_date DESC LIMIT 1').get(clubId, kind, date, date);
}
function upcoming(db: SqlDb, clubId: string, kind: SponsorKind, date: string) {
  return db.prepare('SELECT * FROM sponsor_deals WHERE club_id = ? AND kind = ? AND start_date > ? ORDER BY start_date LIMIT 1').get(clubId, kind, date);
}

/** Posição-alvo da diretoria (bônus de posição) e divisão do clube. */
function clubContext(db: SqlDb, clubId: string): { tier: number; target: number } {
  const tier = N(db.prepare('SELECT l.tier FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.id = ?').get(clubId)?.tier ?? 1);
  const b = db.prepare('SELECT target_position FROM board_state WHERE id = 1 AND club_id = ?').get(clubId);
  return { tier, target: b ? N(b.target_position) : 4 };
}

/** Gera as propostas de uma cota. `forDeal` = contrato que elas substituem (janela de renovação) ou null (cota vaga). */
export function generateOffers(db: SqlDb, clubId: string, kind: SponsorKind, date: string, forDeal: string | null, expires: string): number {
  const ref = sponsorReference(sponsorTotalMonthly(loadClubEcon(db, clubId)), kind);
  const ctx = clubContext(db, clubId);
  const locked = db.prepare("SELECT sponsor_name FROM sponsor_offers WHERE club_id = ? AND kind = ? AND locked_until IS NOT NULL AND locked_until > ?").all(clubId, kind, date).map((r) => S(r.sponsor_name));
  const drafts = sponsorOffers({ reference: ref, kind, tier: ctx.tier, targetPosition: ctx.target, names: SPONSOR_NAMES[kind], exclude: locked },
    createRng(`sponsor-offer:${seedOf(db)}:${clubId}:${kind}:${date}`));
  const ins = db.prepare(`INSERT INTO sponsor_offers (id, club_id, kind, sponsor_name, profile, monthly, standing, ceiling, years, bonus_json, for_deal, created, expires)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  drafts.forEach((d, i) => ins.run(`spo_${clubId}_${kind}_${date}_${i}`, clubId, kind, d.sponsor, d.profile, d.monthly, d.monthly, d.ceiling, d.years, JSON.stringify(d.bonuses), forDeal, date, expires));
  return drafts.length;
}

function closeOffers(db: SqlDb, clubId: string, kind: SponsorKind, exceptId: string | null) {
  db.prepare("UPDATE sponsor_offers SET status = 'declined' WHERE club_id = ? AND kind = ? AND status = 'open' AND id <> ?").run(clubId, kind, exceptId ?? '');
}

/** Fecha o contrato de uma proposta pelo valor mensal dado: começa hoje (cota vaga) ou no dia seguinte ao fim do contrato atual. */
function signOffer(db: SqlDb, offer: Record<string, unknown>, monthly: number, years: number, date: string): { start: string; end: string } {
  const clubId = S(offer.club_id), kind = S(offer.kind) as SponsorKind;
  const cur = covering(db, clubId, kind, date);
  const start = cur ? addDays(S(cur.end_date), 1) : date;
  const end = addDays(addDays(start, Math.round(years * 365.25)), -1);
  db.prepare('INSERT INTO sponsor_deals (id, club_id, kind, sponsor_name, monthly_amount, start_date, end_date, bonus_json, negotiated) VALUES (?,?,?,?,?,?,?,?,1)')
    .run(`spn_${clubId}_${kind}_${start}_n`, clubId, kind, S(offer.sponsor_name), monthly, start, end, S(offer.bonus_json));
  db.prepare("UPDATE sponsor_offers SET status = 'accepted', standing = ? WHERE id = ?").run(monthly, S(offer.id));
  closeOffers(db, clubId, kind, S(offer.id));
  return { start, end };
}

/**
 * Rotina diária (dentro do `moveClock`, antes da cobrança mensal), só para o clube do usuário: propostas vencidas expiram; a 60 dias
 * do fim de uma cota chegam as propostas; cota que venceu sem decisão recebe a melhor proposta aberta (ou uma nova). NÃO abre transação.
 */
export function processSponsorsDay(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  if (!st.clubId) return;
  const clubId = st.clubId;
  db.prepare("UPDATE sponsor_offers SET status = 'expired' WHERE club_id = ? AND status = 'open' AND expires < ?").run(clubId, date);
  const ff = fastForwarding(db);
  for (const kind of SPONSOR_KINDS) {
    const cur = covering(db, clubId, kind, date);
    if (cur) {
      if (ff || upcoming(db, clubId, kind, date)) continue;
      const end = S(cur.end_date);
      if (daysBetween(date, end) > SPONSOR_RULES.windowDays) continue;
      if (db.prepare('SELECT 1 AS x FROM sponsor_offers WHERE for_deal = ? LIMIT 1').get(S(cur.id))) continue;
      const n = generateOffers(db, clubId, kind, date, S(cur.id), end);
      addNews(db, date, 'board', `Patrocínio: ${n} proposta(s) para ${SPONSOR_KIND_LABEL[kind].toLowerCase()}`,
        `O contrato com ${S(cur.sponsor_name)} vence em ${end.split('-').reverse().join('/')}. ${n} empresa(s) enviaram proposta para a cota. Negocie em Finanças → Patrocínios: você pode aceitar, pedir mais (até 3 vezes por empresa) ou deixar vencer — sem decisão, a melhor proposta é aceita automaticamente no vencimento.`,
        { sender: SENDER, action: 'finance', actionLabel: 'Abrir finanças' });
      continue;
    }
    if (vacatedByUser(db, clubId, kind) || upcoming(db, clubId, kind, date)) continue;
    // venceu sem decisão: melhor proposta aberta (valor mensal + bônus esperado) ou uma nova rodada de propostas
    let open = db.prepare("SELECT * FROM sponsor_offers WHERE club_id = ? AND kind = ? AND status = 'open'").all(clubId, kind);
    if (!open.length) { generateOffers(db, clubId, kind, date, null, addDays(date, SPONSOR_RULES.windowDays)); open = db.prepare("SELECT * FROM sponsor_offers WHERE club_id = ? AND kind = ? AND status = 'open'").all(clubId, kind); }
    const best = open.sort((a, b) => (N(b.standing) + bonusMonthlyEv(parseBonuses(b.bonus_json))) - (N(a.standing) + bonusMonthlyEv(parseBonuses(a.bonus_json))) || S(a.id).localeCompare(S(b.id)))[0];
    if (!best) continue;
    const t = signOffer(db, best, N(best.standing), N(best.years), date);
    if (!ff) addNews(db, date, 'board', `Patrocínio renovado automaticamente: ${S(best.sponsor_name)}`,
      `A cota de ${SPONSOR_KIND_LABEL[kind].toLowerCase()} venceu sem decisão e a diretoria aceitou a melhor proposta: ${S(best.sponsor_name)}, ${fmtMoney(N(best.standing))} por mês até ${t.end.split('-').reverse().join('/')}.`,
      { sender: SENDER, action: 'finance', actionLabel: 'Abrir finanças' });
  }
}

function userOffer(db: SqlDb, offerId: string): Record<string, unknown> {
  const st = getCareerState(db);
  const o = db.prepare('SELECT * FROM sponsor_offers WHERE id = ?').get(offerId);
  if (!o || S(o.club_id) !== st.clubId) throw new SponsorError('Proposta de patrocínio não encontrada.');
  if (S(o.status) === 'walkout' && o.locked_until != null && S(o.locked_until) > st.gameDate) throw new SponsorError(`A empresa encerrou a conversa e só volta a negociar a partir de ${S(o.locked_until).split('-').reverse().join('/')}.`);
  if (S(o.status) !== 'open') throw new SponsorError('Esta proposta não está mais aberta.');
  return o;
}
const checkYears = (y: number) => {
  if (!Number.isInteger(y) || y < SPONSOR_RULES.minYears || y > SPONSOR_RULES.maxYears) throw new SponsorError(`Duração inválida: de ${SPONSOR_RULES.minYears} a ${SPONSOR_RULES.maxYears} temporadas.`);
};

/** Aceita o que a empresa oferece hoje. */
export function acceptSponsorOffer(db: SqlDb, offerId: string, years: number): { message: string } {
  return withTransaction(db, () => {
    const o = userOffer(db, offerId);
    checkYears(years);
    const t = signOffer(db, o, N(o.standing), years, getCareerState(db).gameDate);
    return { message: `Contrato fechado com ${S(o.sponsor_name)}: ${fmtMoney(N(o.standing))} por mês, de ${t.start.split('-').reverse().join('/')} a ${t.end.split('-').reverse().join('/')}.` };
  });
}

/** Pede um valor mensal (contraproposta). A empresa aceita até o teto, sobe o que oferece ou, no 3º pedido acima do teto, desiste. */
export function negotiateSponsor(db: SqlDb, input: { offerId: string; monthly: number; years: number }): SponsorNegotiationDto {
  return withTransaction(db, () => {
    const o = userOffer(db, input.offerId);
    checkYears(input.years);
    if (!Number.isFinite(input.monthly) || input.monthly <= 0) throw new SponsorError('Valor mensal inválido.');
    const date = getCareerState(db).gameDate;
    const r = sponsorReply({ asked: Math.round(input.monthly), standing: N(o.standing), ceiling: N(o.ceiling), round: N(o.rounds) });
    if (r.kind === 'accept') {
      const t = signOffer(db, o, r.monthly, input.years, date);
      return { outcome: 'accepted', monthly: r.monthly, roundsLeft: 0, message: `${S(o.sponsor_name)} aceitou: ${fmtMoney(r.monthly)} por mês até ${t.end.split('-').reverse().join('/')}.` };
    }
    if (r.kind === 'walkout') {
      const until = addDays(date, SPONSOR_RULES.lockDays);
      db.prepare("UPDATE sponsor_offers SET status = 'walkout', rounds = rounds + 1, locked_until = ? WHERE id = ?").run(until, S(o.id));
      return { outcome: 'walkout', monthly: null, roundsLeft: 0, message: `${S(o.sponsor_name)} achou o pedido alto demais e encerrou a conversa. Só volta a negociar a partir de ${until.split('-').reverse().join('/')}.` };
    }
    db.prepare('UPDATE sponsor_offers SET standing = ?, rounds = rounds + 1 WHERE id = ?').run(r.monthly, S(o.id));
    return { outcome: 'counter', monthly: r.monthly, roundsLeft: r.roundsLeft, message: r.monthly > N(o.standing)
      ? `${S(o.sponsor_name)} subiu a proposta para ${fmtMoney(r.monthly)} por mês. Restam ${r.roundsLeft} pedido(s) antes de ela desistir.`
      : `${S(o.sponsor_name)} não sobe mais do que ${fmtMoney(r.monthly)} por mês. Restam ${r.roundsLeft} pedido(s) antes de ela desistir.` };
  });
}

/** Rescinde o contrato vigente de uma cota: multa de 3 mensalidades (limitada ao que resta) e a cota fica vaga. */
export function terminateSponsor(db: SqlDb, kind: SponsorKind): { message: string } {
  return withTransaction(db, () => {
    const st = getCareerState(db);
    if (!st.clubId) throw new SponsorError('Você não comanda nenhum clube.');
    const cur = covering(db, st.clubId, kind, st.gameDate);
    if (!cur) throw new SponsorError('Esta cota não tem contrato vigente.');
    const fee = terminationFee(N(cur.monthly_amount), st.gameDate, S(cur.end_date));
    makePoster(db, st.clubId)(st.clubId, st.gameDate, 'sponsorship', -fee, `Rescisão do patrocínio: ${S(cur.sponsor_name)} (${SPONSOR_KIND_LABEL[kind].toLowerCase()})`);
    // termina ontem (contrato que começou hoje: início e fim ontem, para a cota ficar vaga já hoje)
    const yesterday = addDays(st.gameDate, -1);
    db.prepare('UPDATE sponsor_deals SET start_date = MIN(start_date, ?), end_date = ?, terminated_on = ? WHERE id = ?').run(yesterday, yesterday, st.gameDate, S(cur.id));
    db.prepare('DELETE FROM sponsor_deals WHERE club_id = ? AND kind = ? AND start_date > ?').run(st.clubId, kind, st.gameDate); // contrato futuro já fechado
    db.prepare("UPDATE sponsor_offers SET status = 'declined' WHERE club_id = ? AND kind = ? AND status = 'open'").run(st.clubId, kind);
    return { message: `Contrato com ${S(cur.sponsor_name)} rescindido. Multa paga: ${fmtMoney(fee)}. A cota fica vaga até você fechar um contrato novo (Buscar patrocinador).` };
  });
}

/** Data a partir da qual "Buscar patrocinador" volta a valer para a cota (null = já pode). */
function searchFrom(db: SqlDb, clubId: string, kind: SponsorKind, date: string): string | null {
  const last = getMeta(db, `sponsor_search:${clubId}:${kind}`);
  if (!last) return null;
  const next = addDays(last, SPONSOR_RULES.searchCooldownDays);
  return next > date ? next : null;
}

/** Busca propostas para uma cota vaga ou para a janela de renovação sem propostas abertas (no máximo uma vez a cada 30 dias). */
export function searchSponsors(db: SqlDb, kind: SponsorKind): { message: string } {
  return withTransaction(db, () => {
    const st = getCareerState(db);
    if (!st.clubId) throw new SponsorError('Você não comanda nenhum clube.');
    const slot = sponsorSlots(db).find((s) => s.kind === kind)!;
    if (!slot.canSearch) throw new SponsorError(slot.searchFrom ? `Uma nova busca só é possível a partir de ${slot.searchFrom.split('-').reverse().join('/')}.` : 'Esta cota já tem contrato ou propostas abertas.');
    const cur = covering(db, st.clubId, kind, st.gameDate);
    const n = generateOffers(db, st.clubId, kind, st.gameDate, cur ? S(cur.id) : null, cur ? S(cur.end_date) : addDays(st.gameDate, SPONSOR_RULES.windowDays));
    setMeta(db, `sponsor_search:${st.clubId}:${kind}`, st.gameDate);
    return { message: `${n} empresa(s) enviaram proposta para ${SPONSOR_KIND_LABEL[kind].toLowerCase()}.` };
  });
}

/**
 * Paga os bônus dos contratos vigentes do clube por um resultado: fim da liga (título, acesso, posição) ou título de copa nacional.
 * `post` = o lançador da transação em curso. NÃO abre transação.
 */
export function paySponsorBonuses(db: SqlDb, post: Poster, date: string, clubId: string, r: { champion?: boolean; promoted?: boolean; position?: number; cupTitle?: boolean }): number {
  let total = 0;
  for (const d of db.prepare('SELECT * FROM sponsor_deals WHERE club_id = ? AND bonus_json IS NOT NULL AND start_date <= ? AND end_date >= ?').all(clubId, date, addDays(date, -1))) {
    for (const b of bonusesDue(parseBonuses(d.bonus_json), r)) {
      post(clubId, date, 'sponsorship', b.amount, `Bônus de patrocínio (${S(d.sponsor_name)}): ${BONUS_LABEL[b.trigger].toLowerCase()}${b.target ? ` (até ${b.target}º)` : ''}`);
      total += b.amount;
    }
  }
  return total;
}

const dealDto = (d: Record<string, unknown>, date: string): SponsorDealDto => ({
  id: S(d.id), kind: S(d.kind) as SponsorKind, sponsor: S(d.sponsor_name), monthly: N(d.monthly_amount), start: S(d.start_date), end: S(d.end_date),
  bonuses: parseBonuses(d.bonus_json).map(bonusDto), negotiated: N(d.negotiated) === 1,
  terminationFee: S(d.start_date) <= date ? terminationFee(N(d.monthly_amount), date, S(d.end_date)) : 0,
});

/** As 3 cotas do clube do usuário: contrato vigente, próximo contrato, propostas e se pode buscar patrocinador. */
export function sponsorSlots(db: SqlDb): SponsorSlotDto[] {
  const st = getCareerState(db);
  if (!st.clubId) return [];
  const date = st.gameDate, clubId = st.clubId;
  const total = sponsorTotalMonthly(loadClubEcon(db, clubId));
  return SPONSOR_KINDS.map((kind) => {
    const cur = covering(db, clubId, kind, date), next = upcoming(db, clubId, kind, date);
    const offers: SponsorOfferDto[] = db.prepare(`SELECT * FROM sponsor_offers WHERE club_id = ? AND kind = ? AND (status = 'open' OR (status = 'walkout' AND locked_until > ?)) ORDER BY created DESC, id`)
      .all(clubId, kind, date).map((o) => ({
        id: S(o.id), kind, sponsor: S(o.sponsor_name), profile: S(o.profile) as 'fixed' | 'bonus', initial: N(o.monthly), standing: N(o.standing), years: N(o.years),
        bonuses: parseBonuses(o.bonus_json).map(bonusDto), roundsLeft: Math.max(0, SPONSOR_RULES.maxRounds - N(o.rounds)), expires: S(o.expires),
        status: S(o.status) as 'open' | 'walkout', lockedUntil: o.locked_until == null ? null : S(o.locked_until),
      }));
    const vacant = !cur;
    const inWindow = cur != null && !next && daysBetween(date, S(cur.end_date)) <= SPONSOR_RULES.windowDays;
    const from = searchFrom(db, clubId, kind, date);
    const hasOpen = offers.some((o) => o.status === 'open');
    return {
      kind, label: SPONSOR_KIND_LABEL[kind], current: cur ? dealDto(cur, date) : null, upcoming: next ? dealDto(next, date) : null, offers,
      reference: sponsorReference(total, kind), vacant: vacant && !next,
      canSearch: (vacant && !next || inWindow) && !hasOpen && from === null, searchFrom: (vacant || inWindow) && !hasOpen ? from : null,
    };
  });
}

/** Tela de Finanças: visão financeira + as cotas de patrocínio. */
export const getFinancePage = (db: SqlDb): FinanceOverviewDto => ({ ...getFinanceOverview(db), sponsorSlots: sponsorSlots(db) });
