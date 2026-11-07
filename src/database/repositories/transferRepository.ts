import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { UserError } from '../../shared/errors.ts';
import { createRng, type Rng } from '../../game/rng.ts';
import {
  askingPrice, clubDecision, WELL_KNOWN, groupOf, type PositionGroup, OFFER_VALID_DAYS, playerDecision, playerInterest, sellerWillingness, SQUAD_MAX, SQUAD_MIN, squadStaysValid, wageDemand, windowStatus,
} from '../../game/transfer-engine/transfer.ts';
import { addDays, ageOn } from '../../shared/date.ts';
import type { Player } from '../../shared/types.ts';
import type {
  FeeResultDto, IncomingOfferDto, MarketFilter, MarketPageDto, MarketPlayerDto, MyPlayerDto, NegotiationDto, OfferInput, OfferResultDto, TransferLogDto, TransfersOverviewDto,
} from '../../shared/api.ts';
import { getCareerState } from './careerRepository.ts';
import { addNews } from './newsRepository.ts';
import { knowledgeMap, toScoutedDto } from './scoutRepository.ts';
import { boardVeto, coachOf, getBoardOverview, recordTransferForBoard } from './boardRepository.ts';
import { negotiationMultiplier } from '../../game/coach-engine/coach.ts';
import { contractEndIn } from '../../game/career-engine/calendar.ts';
import { makePoster, type Poster } from './financeRepository.ts';
import { rowToPlayer } from './worldRepository.ts';
import { FULL_CLUBS } from './simLevelRepository.ts';
import { fmtMoney } from '../../shared/money.ts';
import { boardBrief, squadSize } from './newsRepository.ts';
import { POS_NAME } from '../../shared/positions.ts';
import { clubSeasonStart, userSeason } from './countrySeasonRepository.ts';

export class TransferError extends UserError {}

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const fmt = fmtMoney; // dinheiro nas mensagens (moeda única: euro)
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);

const monthsLeft = (date: string, end: string) => Math.max(0, (Number(end.slice(0, 4)) - Number(date.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(date.slice(5, 7)));
const clubRow = (db: SqlDb, id: string) => db.prepare('SELECT id, name, reputation, balance, country_id FROM clubs WHERE id = ?').get(id)!;
const squadOf = (db: SqlDb, clubId: string): Player[] => db.prepare('SELECT * FROM players WHERE club_id = ?').all(clubId).map(rowToPlayer);
const keyIds = (squad: Player[]) => new Set([...squad].sort((a, b) => b.overall - a.overall).slice(0, 3).map((p) => p.id));

function priceOf(db: SqlDb, p: Player, date: string): number {
  const seller = squadOf(db, p.clubId!);
  return askingPrice({ marketValue: p.marketValue, age: ageOn(p.birthDate, date), overall: p.overall, potentialHidden: p.potentialHidden, contractMonthsLeft: monthsLeft(date, p.contractEnd), isKey: keyIds(seller).has(p.id) },
    { balance: N(clubRow(db, p.clubId!).balance) });
}

/**
 * Executa a transferência (sem transação própria): move o jogador, atualiza contrato, registra o histórico e lança o dinheiro.
 * ÚNICA porta de entrada de um jogador em um clube (inclui jogadores livres, com `clubId` nulo e taxa zero).
 * O contrato termina no último dia de uma temporada do país do clube (30/jun ou 31/dez), para vencer exatamente numa virada.
 */
export function executeTransfer(db: SqlDb, post: Poster, a: { player: Player; toClubId: string; fee: number; wage: number; years: number; date: string; kind: 'purchase' | 'sale' | 'ai' }): number {
  const from = a.player.clubId;
  if (from === a.toClubId) throw new TransferError('O jogador já pertence a este clube.');
  const end = contractEndIn(a.date, a.years, clubSeasonStart(db, a.toClubId)); // fim da temporada do país do clube comprador
  db.prepare('UPDATE players SET club_id = ?, salary = ?, contract_end = ? WHERE id = ?').run(a.toClubId, a.wage, end, a.player.id);
  db.prepare('DELETE FROM transfer_list WHERE player_id = ?').run(a.player.id);
  db.prepare("UPDATE transfer_offers SET status = 'expired', response_date = ? WHERE status = 'pending' AND player_id = ?").run(a.date, a.player.id);
  const id = N((db.prepare('INSERT INTO transfers (date, player_id, from_club_id, to_club_id, fee, wage, years, kind) VALUES (?,?,?,?,?,?,?,?) RETURNING id')
    .get(a.date, a.player.id, from, a.toClubId, a.fee, a.wage, a.years, a.kind) as { id: number }).id);
  const name = `${a.player.firstName} ${a.player.lastName}`;
  post(a.toClubId, a.date, 'transfer_out', -a.fee, `Compra de ${name}`);
  if (from) post(from, a.date, 'transfer_in', a.fee, `Venda de ${name}`);
  const until = `Contrato até ${end.split('-').reverse().join('/')}, salário de ${fmt(a.wage)} por mês.`;
  if (a.kind === 'purchase' || a.kind === 'sale') recordTransferForBoard(db, a.kind, a.fee);
  if (a.kind === 'purchase') addNews(db, a.date, 'transfer', from ? `Reforço: ${name} contratado por ${fmt(a.fee)}` : `Reforço: ${name} chega sem custo de transferência`, `${name} (${POS_NAME[a.player.position].toLowerCase()}, ${ageOn(a.player.birthDate, a.date)} anos) é o novo reforço${from ? `, vindo do ${S(clubRow(db, from).name)} por ${fmt(a.fee)}` : ', sem custo de transferência'}. ${until}\n\nO elenco principal agora tem ${squadSize(db, a.toClubId)} jogadores. ${boardBrief(db)}\n\nEscale o reforço e escolha a função dele em Táticas.`, { action: 'tactics', actionLabel: 'Escalar em Táticas' });
  if (a.kind === 'sale') addNews(db, a.date, 'transfer', `Venda: ${name} deixa o clube por ${fmt(a.fee)}`, `${name} foi vendido ao ${S(clubRow(db, a.toClubId).name)} por ${fmt(a.fee)}, já creditados no caixa. Metade da taxa volta ao orçamento de transferências.\n\nO elenco principal agora tem ${from ? squadSize(db, from) : 0} jogadores. ${boardBrief(db)}\n\nSe ele era titular, revise a escalação em Táticas.`, { action: 'tactics', actionLabel: 'Revisar a escalação' });
  return id;
}

/**
 * Sem clube, o "salário" do jogador passa a ser a pretensão pelo valor ATUAL (1,2% do valor de mercado). Sem isso, livres levavam o salário
 * antigo como piso (×1,05 no pedido): ingleses dispensados assinavam no Brasil com salário inglês e as folhas subiam em cascata.
 */
export function resetToFreeAgentWage(db: SqlDb, playerId: string): void {
  db.prepare('UPDATE players SET salary = MAX(1500, CAST(ROUND(market_value * 0.012 / 100.0) AS INTEGER) * 100) WHERE id = ?').run(playerId);
}

/**
 * Saída sem destino (fim de contrato ou aposentadoria): o jogador fica sem clube. Não envolve dinheiro.
 * NÃO abre transação.
 */
export function releasePlayer(db: SqlDb, playerId: string, date: string, retire: boolean): void {
  db.prepare('UPDATE players SET club_id = NULL, retired = ? WHERE id = ?').run(retire ? 1 : 0, playerId);
  if (!retire) resetToFreeAgentWage(db, playerId);
  db.prepare('DELETE FROM transfer_list WHERE player_id = ?').run(playerId);
  db.prepare("UPDATE transfer_offers SET status = 'expired', response_date = ? WHERE status = 'pending' AND player_id = ?").run(date, playerId);
}

// ---------------------------------------------------------------- mercado e propostas
export function searchMarket(db: SqlDb, f: MarketFilter): MarketPlayerDto[] {
  return searchMarketPage(db, f).players;
}

/** Mercado com filtros e paginação: filtra tudo (barato) e só monta as estimativas da página pedida. */
export function searchMarketPage(db: SqlDb, f: MarketFilter): MarketPageDto {
  const st = getCareerState(db);
  const know = knowledgeMap(db);
  const shortlisted = new Set(db.prepare('SELECT player_id FROM scout_shortlist').all().map((r) => S(r.player_id)));
  const where = ['p.retired = 0', 'p.youth_club_id IS NULL', f.freeOnly ? 'p.club_id IS NULL' : f.clubOnly ? 'p.club_id IS NOT NULL AND p.club_id <> ?' : '(p.club_id IS NULL OR p.club_id <> ?)'];
  const args: unknown[] = f.freeOnly ? [] : [st.clubId];
  // países presentes no mercado (antes dos demais filtros, para o filtro de nacionalidade não sumir com as opções)
  const nationalities = db.prepare(`SELECT p.nationality AS code, COALESCE(co.name, p.nationality) AS name, COUNT(*) AS n FROM players p LEFT JOIN countries co ON co.code = p.nationality
    WHERE ${where.join(' AND ')} GROUP BY p.nationality ORDER BY n DESC, name`).all(...args).map((r) => ({ code: S(r.code), name: S(r.name), count: N(r.n) }));
  if (f.maxValue !== undefined) { where.push('p.market_value <= ?'); args.push(Math.max(0, Math.floor(f.maxValue))); }
  if (f.maxWage !== undefined) { where.push('p.salary <= ?'); args.push(Math.max(0, Math.floor(f.maxWage))); }
  if (f.name && f.name.trim()) { where.push("(p.first_name || ' ' || p.last_name) LIKE ?"); args.push(`%${f.name.trim().replace(/[%_]/g, '')}%`); }
  if (f.nationalities?.length) { where.push(`p.nationality IN (${f.nationalities.map(() => '?').join(',')})`); args.push(...f.nationalities); }
  if (f.foot) { where.push('p.foot = ?'); args.push(f.foot); }
  if (f.contractEndsBy) { where.push('(p.club_id IS NULL OR p.contract_end <= ?)'); const t = userSeason(db).turnover; args.push(addDays(f.contractEndsBy === 'season' ? t : `${Number(t.slice(0, 4)) + 1}${t.slice(4)}`, -1)); }
  const rows = db.prepare(`SELECT p.*, c.name AS club_name, c.reputation AS club_reputation FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE ${where.join(' AND ')} ORDER BY p.market_value DESC, p.id`).all(...args);
  const wanted = f.positions?.length ? new Set(f.positions) : null;
  const matches: Array<{ r: Record<string, unknown>; id: string }> = [];
  for (const r of rows) {
    const p = rowToPlayer(r), age = ageOn(p.birthDate, st.gameDate);
    if (f.position && (f.position === 'GK' || f.position === 'DEF' || f.position === 'MID' || f.position === 'ATT' ? groupOf(p.position) !== f.position : p.position !== f.position)) continue;
    if (wanted && !wanted.has(p.position) && (f.naturalOnly || !p.secondaryPositions.some((s) => wanted.has(s)))) continue;
    if (f.minAge !== undefined && age < f.minAge) continue;
    if (f.maxAge !== undefined && age > f.maxAge) continue;
    if (f.shortlistedOnly && !shortlisted.has(p.id)) continue;
    if (f.knownOnly && (know.get(p.id) ?? 0) < WELL_KNOWN) continue;
    matches.push({ r, id: p.id });
  }
  const offset = Math.max(0, Math.floor(f.offset ?? 0)), limit = Math.min(500, Math.max(1, Math.floor(f.limit ?? 100)));
  const players = matches.slice(offset, offset + limit).map(({ r, id }) => toScoutedDto(db, r, st.gameDate, know.get(id) ?? 0, shortlisted.has(id)));
  return { total: matches.length, offset, players, nationalities };
}

/** Validações comuns da proposta (sem taxa/salário): devolve o jogador, o clube do usuário e o estado da carreira. */
function offerTarget(db: SqlDb, playerId: string) {
  const st = getCareerState(db);
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!row) throw new TransferError('Jogador não encontrado.');
  if (N(row.retired) === 1) throw new TransferError('Este jogador está aposentado.');
  if (row.youth_club_id != null) throw new TransferError('Jogadores das categorias de base não estão à venda.');
  const p = rowToPlayer(row);
  if (p.clubId === st.clubId) throw new TransferError('Este jogador já é do seu clube.');
  if (squadOf(db, st.clubId).length >= SQUAD_MAX) throw new TransferError(`Seu elenco já tem o máximo de ${SQUAD_MAX} jogadores.`);
  return { st, p, me: clubRow(db, st.clubId) };
}

/** Decisão do clube vendedor sobre a taxa (jogador com clube). Mesma regra usada na proposta completa. */
function clubTerms(db: SqlDb, date: string, p: Player, fee: number, me: Record<string, unknown>): FeeResultDto {
  const win = windowStatus(date);
  if (!win.open) throw new TransferError(`A janela de transferências está fechada. Ela abre em ${win.opensOn!.split('-').reverse().join('/')}.`);
  const seller = clubRow(db, p.clubId!);
  if (fee > N(me.balance)) throw new TransferError(`Caixa insuficiente: você tem ${fmt(N(me.balance))} e a proposta é de ${fmt(fee)}.`);
  const ask = Math.round(priceOf(db, p, date) * negotiationMultiplier(coachOf(db).attributes)); // negociação do treinador
  if (!squadStaysValid(squadOf(db, p.clubId!), p.id, 20)) return { outcome: 'club_rejected', message: `${S(seller.name)} precisa do jogador para manter o elenco completo e recusou negociar.` };
  const cd = clubDecision(fee, ask);
  if (cd.kind === 'reject') return { outcome: 'club_rejected', message: `${S(seller.name)} recusou: a proposta está muito abaixo do que valorizam o jogador.` };
  if (cd.kind === 'counter') return { outcome: 'club_counter', counterFee: cd.fee, message: `${S(seller.name)} pede ${fmt(cd.fee)} pelo jogador.` };
  return { outcome: 'accepted', message: `${S(seller.name)} aceitou a taxa de ${fmt(fee)}. Agora negocie o contrato com o jogador.` };
}

/** Etapa 1 da negociação: consulta o clube vendedor sobre a taxa. Não grava nada; a proposta completa reavalia a taxa. */
export function proposeFee(db: SqlDb, playerId: string, fee: number): FeeResultDto {
  if (!Number.isInteger(fee) || fee < 0) throw new TransferError('Taxa inválida: use um valor inteiro.');
  const { st, p, me } = offerTarget(db, playerId);
  if (!p.clubId) throw new TransferError('Jogador sem clube: não há taxa de transferência.');
  return clubTerms(db, st.gameDate, p, fee, me);
}

export function getNegotiation(db: SqlDb, playerId: string): NegotiationDto {
  const { st, p, me } = offerTarget(db, playerId);
  const row = db.prepare('SELECT p.*, c.name AS club_name, c.reputation AS club_reputation FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE p.id = ?').get(playerId)!;
  const shortlisted = !!db.prepare('SELECT 1 AS x FROM scout_shortlist WHERE player_id = ?').get(playerId);
  const win = windowStatus(st.gameDate);
  const seller = p.clubId ? clubRow(db, p.clubId) : null;
  const budgets = getBoardOverview(db).club?.budgets ?? null;
  const payroll = N(db.prepare('SELECT COALESCE(SUM(salary), 0) AS s FROM players WHERE club_id = ?').get(st.clubId)!.s);
  return {
    player: toScoutedDto(db, row, st.gameDate, knowledgeMap(db).get(playerId) ?? 0, shortlisted),
    buyerName: S(me.name), sellerName: seller ? S(seller.name) : null, windowOpen: win.open, opensOn: win.opensOn,
    balance: N(me.balance), payroll, wageCeiling: budgets?.wageCeiling ?? null, transferBudgetRemaining: budgets?.remaining ?? null,
    clubWillingness: seller ? sellerWillingness({ contractMonthsLeft: monthsLeft(st.gameDate, p.contractEnd), age: ageOn(p.birthDate, st.gameDate), sellerBalance: N(seller.balance), canSell: squadStaysValid(squadOf(db, p.clubId!), p.id, 20) }) : null,
    playerInterest: playerInterest(N(me.reputation), seller ? N(seller.reputation) : N(me.reputation)),
  };
}

export function makeOffer(db: SqlDb, input: OfferInput): OfferResultDto {
  if (![input.fee, input.wage, input.years].every(Number.isInteger) || input.fee < 0 || input.wage <= 0 || input.years < 1 || input.years > 5) throw new TransferError('Proposta inválida: use valores inteiros (anos de 1 a 5).');
  const { st, p, me } = offerTarget(db, input.playerId);
  if (!p.clubId) return signFreeAgent(db, st, p, input, me);
  const club = clubTerms(db, st.gameDate, p, input.fee, me);
  if (club.outcome !== 'accepted') return { outcome: club.outcome, message: club.message, ...(club.counterFee !== undefined ? { counterFee: club.counterFee } : {}) };
  const seller = clubRow(db, p.clubId);

  const ambition = p.personality.ambition;
  const demand = Math.round(wageDemand({ marketValue: p.marketValue, salary: p.salary, ambition }, N(seller.reputation), N(me.reputation)) * negotiationMultiplier(coachOf(db).attributes));
  const pd = playerDecision(input.wage, demand);
  if (pd.kind === 'reject') return { outcome: 'player_rejected', message: `${p.firstName} ${p.lastName} recusou: o salário oferecido está muito abaixo do que ele espera.` };
  if (pd.kind === 'counter') return { outcome: 'player_counter', counterWage: pd.wage, message: `${p.firstName} ${p.lastName} aceita se o salário for de ${fmt(pd.wage)} por mês.` };

  // a diretoria avalia os termos finais (orçamento, teto da folha e valores fora da realidade do clube)
  const veto = boardVeto(db, { fee: input.fee, wage: input.wage, marketValue: p.marketValue });
  if (veto) return { outcome: 'board_rejected', message: veto };
  withTransaction(db, () => executeTransfer(db, makePoster(db, st.clubId), { player: p, toClubId: st.clubId, fee: input.fee, wage: input.wage, years: input.years, date: st.gameDate, kind: 'purchase' }));
  return { outcome: 'completed', message: `Transferência concluída: ${p.firstName} ${p.lastName} é o novo reforço do clube por ${fmt(input.fee)}.` };
}

/** Jogador livre: sem clube vendedor nem taxa, e pode ser contratado fora das janelas. Só o salário é negociado. */
function signFreeAgent(db: SqlDb, st: { clubId: string; gameDate: string }, p: Player, input: OfferInput, me: Record<string, unknown>): OfferResultDto {
  if (input.fee !== 0) throw new TransferError('Jogador sem clube: não há taxa de transferência (use 0).');
  const demand = Math.round(wageDemand({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition }, N(me.reputation), N(me.reputation)) * negotiationMultiplier(coachOf(db).attributes));
  const pd = playerDecision(input.wage, demand);
  if (pd.kind === 'reject') return { outcome: 'player_rejected', message: `${p.firstName} ${p.lastName} recusou: o salário oferecido está muito abaixo do que ele espera.` };
  if (pd.kind === 'counter') return { outcome: 'player_counter', counterWage: pd.wage, message: `${p.firstName} ${p.lastName} aceita se o salário for de ${fmt(pd.wage)} por mês.` };
  const veto = boardVeto(db, { fee: 0, wage: input.wage, marketValue: p.marketValue });
  if (veto) return { outcome: 'board_rejected', message: veto };
  withTransaction(db, () => executeTransfer(db, makePoster(db, st.clubId), { player: p, toClubId: st.clubId, fee: 0, wage: input.wage, years: input.years, date: st.gameDate, kind: 'purchase' }));
  return { outcome: 'completed', message: `${p.firstName} ${p.lastName} assinou com o clube (jogador livre, sem taxa de transferência).` };
}

// ---------------------------------------------------------------- vendas
export function setListed(db: SqlDb, playerId: string, listed: boolean): void {
  const st = getCareerState(db);
  if (!db.prepare('SELECT 1 AS x FROM players WHERE id = ? AND club_id = ?').get(playerId, st.clubId)) throw new TransferError('Só é possível listar jogadores do seu clube.');
  if (listed) db.prepare('INSERT OR IGNORE INTO transfer_list (player_id) VALUES (?)').run(playerId);
  else db.prepare('DELETE FROM transfer_list WHERE player_id = ?').run(playerId);
}

export function respondOffer(db: SqlDb, offerId: number, accept: boolean): void {
  withTransaction(db, () => {
    const st = getCareerState(db);
    const o = db.prepare('SELECT * FROM transfer_offers WHERE id = ?').get(offerId);
    if (!o) throw new TransferError('Proposta não encontrada.');
    if (S(o.status) !== 'pending') throw new TransferError('Esta proposta já foi respondida ou expirou.');
    if (S(o.expires) < st.gameDate) { db.prepare("UPDATE transfer_offers SET status = 'expired', response_date = ? WHERE id = ?").run(st.gameDate, offerId); throw new TransferError('Esta proposta expirou.'); }
    if (!accept) { db.prepare("UPDATE transfer_offers SET status = 'rejected', response_date = ? WHERE id = ?").run(st.gameDate, offerId); return; }
    if (!windowStatus(st.gameDate).open) throw new TransferError('A janela de transferências está fechada.');
    const p = rowToPlayer(db.prepare('SELECT * FROM players WHERE id = ?').get(S(o.player_id))!);
    if (p.clubId !== st.clubId) throw new TransferError('O jogador não pertence mais ao seu clube.');
    if (!squadStaysValid(squadOf(db, st.clubId), p.id, SQUAD_MIN)) throw new TransferError(`Seu elenco ficaria incompleto sem ele (mínimo de ${SQUAD_MIN} jogadores, 2 goleiros e profundidade em cada setor).`);
    const buyer = clubRow(db, S(o.buyer_club_id));
    if (N(buyer.balance) < N(o.fee)) { db.prepare("UPDATE transfer_offers SET status = 'expired', response_date = ? WHERE id = ?").run(st.gameDate, offerId); throw new TransferError(`${S(buyer.name)} não tem mais caixa para pagar a taxa.`); }
    executeTransfer(db, makePoster(db, st.clubId), { player: p, toClubId: S(o.buyer_club_id), fee: N(o.fee), wage: p.salary, years: 3, date: st.gameDate, kind: 'sale' });
    db.prepare("UPDATE transfer_offers SET status = 'accepted', response_date = ? WHERE id = ?").run(st.gameDate, offerId);
    db.prepare("UPDATE transfer_offers SET status = 'expired', response_date = ? WHERE status = 'pending' AND player_id = ?").run(st.gameDate, p.id);
  });
}

// ---------------------------------------------------------------- processamento diário (chamado por advanceTime, dentro da transação dele)
function offersToUser(db: SqlDb, rng: Rng, date: string, userClub: string): void {
  if (!userClub) return; // treinador sem clube
  if (N(db.prepare("SELECT COUNT(*) AS n FROM transfer_offers WHERE status = 'pending'").get()!.n) >= 5) return;
  const me = clubRow(db, userClub);
  const all = squadOf(db, userClub).sort((a, b) => b.marketValue - a.marketValue);
  const listed = new Set(db.prepare('SELECT player_id FROM transfer_list').all().map((r) => S(r.player_id)));
  const top = new Set(all.slice(0, 12).map((p) => p.id));
  // Jogadores listados sempre despertam interesse (independente do valor); entre os demais, só os mais valiosos chamam atenção.
  const squad = all.filter((p) => listed.has(p.id) || top.has(p.id));
  for (const p of squad) {
    if (!rng.chance(listed.has(p.id) ? 0.05 : 0.004)) continue;
    if (db.prepare("SELECT 1 AS x FROM transfer_offers WHERE status = 'pending' AND player_id = ?").get(p.id)) continue;
    const fee = Math.round((p.marketValue * (listed.has(p.id) ? rng.float(0.95, 1.3) : rng.float(0.85, 1.2))) / 1000) * 1000;
    const buyers = rng.shuffle(db.prepare('SELECT id, balance, reputation FROM clubs WHERE id <> ? AND country_id = ?').all(userClub, S(me.country_id)))
      .filter((c) => N(c.balance) >= fee && N(c.reputation) >= N(me.reputation) - 30);
    const buyer = buyers.find((c) => N(db.prepare('SELECT COUNT(*) AS n FROM players WHERE club_id = ?').get(S(c.id))!.n) < SQUAD_MAX);
    if (!buyer || fee <= 0) continue;
    db.prepare('INSERT INTO transfer_offers (date, expires, player_id, buyer_club_id, seller_club_id, fee) VALUES (?,?,?,?,?,?)').run(date, addDays(date, OFFER_VALID_DAYS), p.id, S(buyer.id), userClub, fee);
    const buyerName = S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(S(buyer.id))!.name);
    addNews(db, date, 'market', `Proposta: ${buyerName} oferece ${fmt(fee)} por ${p.firstName} ${p.lastName}`,
      `O ${buyerName} enviou uma proposta oficial de ${fmt(fee)} por ${p.firstName} ${p.lastName}. O valor de mercado dele hoje é ${fmt(p.marketValue)}${listed.has(p.id) ? ' e ele está na lista de transferíveis' : ''}.\n\nA proposta vale até ${addDays(date, OFFER_VALID_DAYS).split('-').reverse().join('/')}. Aceite ou recuse em Transferências (propostas recebidas); sem resposta, ela expira.`,
      { actionLabel: 'Responder em Transferências' });
    return; // no máximo uma proposta nova por dia
  }
}

function aiDeals(db: SqlDb, post: Poster, rng: Rng, date: string, userClub: string): void {
  const clubs = db.prepare(`SELECT id, balance, reputation, country_id FROM clubs WHERE id <> ? AND id IN ${FULL_CLUBS} ORDER BY rowid`).all(userClub);
  for (const c of clubs) {
    if (!rng.chance(0.012)) continue;
    const squad = squadOf(db, S(c.id)).sort((a, b) => b.overall - a.overall);
    if (squad.length < 21) continue;
    const p = rng.pick(squad.slice(11, 21));
    if (!squadStaysValid(squad, p.id, 20)) continue;
    const buyers = rng.shuffle(clubs.filter((b) => S(b.country_id) === S(c.country_id) && S(b.id) !== S(c.id) && N(b.reputation) >= N(c.reputation) - 15));
    const ask = priceOf(db, p, date);
    const fee = Math.round((ask * rng.float(0.9, 1.05)) / 1000) * 1000;
    const buyer = buyers.find((b) => N(b.balance) >= fee * 1.5 && squadOf(db, S(b.id)).length < 28);
    if (!buyer) continue;
    const wage = wageDemand({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition }, N(c.reputation), N(buyer.reputation));
    executeTransfer(db, post, { player: p, toClubId: S(buyer.id), fee, wage, years: rng.int(2, 4), date, kind: 'ai' });
  }
}

/** Composição mínima que a IA mantém (folga sobre o mínimo de `squadStaysValid`). */
export const AI_SQUAD_TARGET = { size: 22, GK: 3, DEF: 7, MID: 6, ATT: 4 } as const;
const GROUPS: PositionGroup[] = ['GK', 'DEF', 'MID', 'ATT'];

/** Setor mais carente do elenco (ou null se o elenco já atende à composição mínima da IA). */
export function neededGroup(squad: ReadonlyArray<{ position: Player['position'] }>): PositionGroup | null {
  const count = (g: PositionGroup) => squad.filter((p) => groupOf(p.position) === g).length;
  const missing = GROUPS.filter((g) => count(g) < AI_SQUAD_TARGET[g]);
  if (missing.length) return missing[0]!;
  if (squad.length >= AI_SQUAD_TARGET.size) return null;
  return [...GROUPS].sort((a, b) => count(a) / AI_SQUAD_TARGET[a] - count(b) / AI_SQUAD_TARGET[b])[0]!;
}

/**
 * Clubes da IA contratam jogadores livres para cobrir carências do elenco. `fill` = virada de temporada: completa todos os elencos
 * enquanto houver livres adequados; caso contrário, no máximo uma contratação por clube, com pouca chance por dia.
 * Devolve as carências que o mercado de livres não conseguiu cobrir.
 */
export function aiSignFreeAgents(db: SqlDb, post: Poster, rng: Rng, date: string, userClub: string, fill: boolean, onlyClubs?: ReadonlySet<string>): Array<{ clubId: string; group: PositionGroup }> {
  const unmet: Array<{ clubId: string; group: PositionGroup }> = [];
  const pool = db.prepare('SELECT * FROM players WHERE club_id IS NULL AND youth_club_id IS NULL AND retired = 0 ORDER BY overall DESC, id').all().map(rowToPlayer);
  if (!fill && pool.length === 0) return unmet;
  const taken = new Set<string>();
  for (const c of db.prepare(`SELECT id, reputation FROM clubs WHERE id <> ?${fill ? '' : ` AND id IN ${FULL_CLUBS}`} ORDER BY rowid`).all(userClub)) {
    if (onlyClubs && !onlyClubs.has(S(c.id))) continue;
    if (!fill && !rng.chance(0.15)) continue;
    const squad = squadOf(db, S(c.id));
    const ceiling = Math.max(40, ...squad.map((p) => p.overall)) + 3; // não contrata livres muito acima do próprio nível
    const budget = 1.5 * (squad.reduce((s, p) => s + p.salary, 0) / Math.max(1, squad.length)); // nem salários fora da realidade da folha
    for (let guard = 0; guard < (fill ? 12 : 1); guard++) {
      const g = neededGroup(squad);
      if (!g) break;
      const demandOf = (x: Player) => wageDemand({ marketValue: x.marketValue, salary: x.salary, ambition: x.personality.ambition }, N(c.reputation), N(c.reputation));
      const p = pool.find((x) => !taken.has(x.id) && groupOf(x.position) === g && x.overall <= ceiling && demandOf(x) <= budget);
      if (!p) { unmet.push({ clubId: S(c.id), group: g }); break; }
      taken.add(p.id);
      const wage = demandOf(p);
      executeTransfer(db, post, { player: p, toClubId: S(c.id), fee: 0, wage, years: ageOn(p.birthDate, date) >= 32 ? 1 : rng.int(1, 3), date, kind: 'ai' });
      squad.push({ ...p, clubId: S(c.id) });
    }
  }
  signStrongFreeAgents(db, post, rng.fork('strong'), date, userClub, fill, pool.filter((x) => !taken.has(x.id)), onlyClubs);
  return unmet;
}

/** Livres acima deste nível (0–100; 12 na escala 1–20) não ficam muito tempo sem clube: algum clube em que sejam reforço os contrata. */
export const FREE_AGENT_LEVEL = 62;
/**
 * Chance de um livre acima do nível ser contratado: na virada (`fill`) e por dia de janela aberta. Não é certeza, para que um ou outro
 * jogador acima de 12 continue disponível no mercado de livres por algum tempo.
 */
const STRONG_FREE_CHANCE = { fill: 0.7, daily: 0.06 } as const;

/**
 * Livres bons (acima de `FREE_AGENT_LEVEL`) são contratados mesmo sem carência no elenco, pelo clube de maior reputação em que entrariam
 * entre os 11 melhores, sem passar muito do próprio nível (melhor + 3), com vaga no elenco e salário pedido até 3× a média da folha.
 */
function signStrongFreeAgents(db: SqlDb, post: Poster, rng: Rng, date: string, userClub: string, fill: boolean, pool: Player[], onlyClubs?: ReadonlySet<string>): void {
  const strong = pool.filter((p) => p.overall > FREE_AGENT_LEVEL); // o pool já vem do mais forte para o mais fraco
  if (!strong.length) return;
  const clubs = db.prepare(`SELECT id, reputation FROM clubs WHERE id <> ?${fill ? '' : ` AND id IN ${FULL_CLUBS}`} ORDER BY reputation DESC, rowid`).all(userClub)
    .filter((c) => !onlyClubs || onlyClubs.has(S(c.id)));
  const squads = new Map<string, Player[]>();
  const squadFor = (id: string) => { let s = squads.get(id); if (!s) { s = squadOf(db, id).sort((a, b) => b.overall - a.overall); squads.set(id, s); } return s; };
  for (const p of strong) {
    if (!rng.chance(fill ? STRONG_FREE_CHANCE.fill : STRONG_FREE_CHANCE.daily)) continue;
    for (const c of clubs) {
      const id = S(c.id), squad = squadFor(id);
      if (squad.length >= 28 || squad.length < 11) continue;
      if (p.overall > squad[0]!.overall + 3 || p.overall <= squad[10]!.overall) continue;
      const wage = wageDemand({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition }, N(c.reputation), N(c.reputation));
      if (wage > 3 * (squad.reduce((s, x) => s + x.salary, 0) / squad.length)) continue;
      executeTransfer(db, post, { player: p, toClubId: id, fee: 0, wage, years: ageOn(p.birthDate, date) >= 32 ? 1 : rng.int(1, 3), date, kind: 'ai' });
      squad.push({ ...p, clubId: id }); squad.sort((a, b) => b.overall - a.overall);
      break;
    }
  }
}

export function processMarketDay(db: SqlDb, date: string): void {
  const st = getCareerState(db);
  db.prepare("UPDATE transfer_offers SET status = 'expired', response_date = ? WHERE status = 'pending' AND expires < ?").run(date, date);
  if (!windowStatus(date).open) return;
  const rng = createRng(`market:${seedOf(db)}:${date}`);
  const post = makePoster(db, st.clubId);
  offersToUser(db, rng, date, st.clubId);
  aiDeals(db, post, rng, date, st.clubId);
  aiSignFreeAgents(db, post, rng.fork('free'), date, st.clubId, false);
}

// ---------------------------------------------------------------- visão da tela
export function getTransfersOverview(db: SqlDb): TransfersOverviewDto {
  const st = getCareerState(db);
  const squad = squadOf(db, st.clubId);
  const listed = new Set(db.prepare('SELECT player_id FROM transfer_list').all().map((r) => S(r.player_id)));
  const mine: MyPlayerDto[] = [...squad].sort((a, b) => b.marketValue - a.marketValue).map((p) => ({
    id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, age: ageOn(p.birthDate, st.gameDate), marketValue: p.marketValue, salary: p.salary, contractEnd: p.contractEnd, listed: listed.has(p.id),
  }));
  const incoming: IncomingOfferDto[] = db.prepare(`SELECT o.*, p.first_name, p.last_name, p.position, p.birth_date, p.market_value, c.name AS buyer FROM transfer_offers o
    JOIN players p ON p.id = o.player_id JOIN clubs c ON c.id = o.buyer_club_id WHERE o.status = 'pending' AND o.expires >= ? ORDER BY o.id`).all(st.gameDate)
    .map((r) => ({ id: N(r.id), date: S(r.date), expires: S(r.expires), playerId: S(r.player_id), playerName: `${S(r.first_name)} ${S(r.last_name)}`, position: S(r.position) as Player['position'],
      age: ageOn(S(r.birth_date), st.gameDate), marketValue: N(r.market_value), buyerClubName: S(r.buyer), fee: N(r.fee) }));
  const recent: TransferLogDto[] = db.prepare(`SELECT t.*, p.first_name, p.last_name, f.name AS from_name, c.name AS to_name FROM transfers t JOIN players p ON p.id = t.player_id
    LEFT JOIN clubs f ON f.id = t.from_club_id JOIN clubs c ON c.id = t.to_club_id ORDER BY t.date DESC, t.id DESC LIMIT 25`).all()
    .map((r) => ({ id: N(r.id), date: S(r.date), playerName: `${S(r.first_name)} ${S(r.last_name)}`, fromClub: r.from_name == null ? null : S(r.from_name), toClub: S(r.to_name), fee: N(r.fee), kind: S(r.kind) as TransferLogDto['kind'] }));
  return { window: windowStatus(st.gameDate), balance: N(clubRow(db, st.clubId).balance), squadSize: squad.length, squadMin: SQUAD_MIN, squadMax: SQUAD_MAX, incoming, mine, recent };
}
