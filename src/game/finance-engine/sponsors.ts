/**
 * Patrocínios negociáveis do clube do usuário (v0.8.10). Regras puras e determinísticas (o acaso vem do `Rng` recebido).
 * Clubes da IA continuam com a renovação automática de `financeRepository.settleFinances`.
 *
 * Cada cota (camisa, material esportivo, naming rights) recebe de 2 a 3 propostas de empresas. O valor de referência de uma cota é
 * `sponsorTotalMonthly × SPONSOR_SHARE` (o mesmo da renovação automática, para não mexer na margem calibrada em docs/FINANCE.md).
 * Perfis:
 * - **fixo alto**: 102–110% da referência, sem bônus;
 * - **fixo menor + bônus**: 82–90% da referência e bônus por metas (título, acesso, posição, copa), pagos quando acontecem.
 * O usuário pede um valor (contraproposta); a empresa tem um teto que não mostra e responde como o jogador da renegociação de contrato
 * (`career-engine/contracts.ts`), espelhado: até 3 pedidos acima do teto, depois desiste da conversa por 30 dias.
 */
import type { Rng } from '../rng.ts';
import { SPONSOR_SHARE, type SponsorKind } from './finance.ts';

export type SponsorBonusTrigger = 'league_title' | 'promotion' | 'position' | 'cup_title';
export interface SponsorBonus { trigger: SponsorBonusTrigger; amount: number; /** `position`: terminar a liga nesta posição ou melhor */ target?: number }
export type SponsorProfile = 'fixed' | 'bonus';

export interface SponsorOfferDraft {
  sponsor: string; profile: SponsorProfile; monthly: number; years: number; bonuses: SponsorBonus[];
  /** máximo mensal que a empresa aceita pagar (escondido do usuário) */ ceiling: number;
}

export const SPONSOR_RULES = {
  /** propostas chegam este número de dias antes de a cota vencer */ windowDays: 60,
  /** "Buscar patrocinador" numa cota vaga: no máximo uma vez a cada N dias */ searchCooldownDays: 30,
  /** empresa que desistiu da conversa: dias sem voltar a negociar */ lockDays: 30,
  maxRounds: 3,
  /** a empresa sobe 40% da diferença entre o que oferece e o que o usuário pede, até o teto */ counterShare: 0.4,
  fixed: { low: 1.02, high: 1.1 },
  bonus: { low: 0.82, high: 0.9 },
  /** teto escondido: valor inicial × (1,06–1,15) */ ceiling: { low: 1.06, high: 1.15 },
  minYears: 1, maxYears: 4,
  /** rescisão pelo clube: multa de 3 mensalidades (nunca mais do que o que resta do contrato) */ terminationMonths: 3,
  /** bônus em múltiplos da mensalidade de referência da cota */
  bonusMultiple: { league_title: 4, promotion: 3, position: 1.5, cup_title: 2 } as Record<SponsorBonusTrigger, number>,
} as const;

export const BONUS_LABEL: Record<SponsorBonusTrigger, string> = {
  league_title: 'Título da liga', promotion: 'Acesso à divisão de cima', position: 'Terminar a liga entre os primeiros', cup_title: 'Título da copa nacional',
};

export const SPONSOR_KIND_LABEL: Record<SponsorKind, string> = { shirt: 'Patrocínio master (camisa)', kit: 'Fornecedora de material esportivo', stadium: 'Naming rights do estádio' };
export const SPONSOR_NAMES: Record<SponsorKind, string[]> = {
  shirt: ['Banco Aurora', 'Telecom Nova', 'Seguros Horizonte', 'Energia Solaris', 'Rede Atlântica', 'Construtora Pilar', 'Aero Cumulus', 'Cervejaria Vale', 'Mineração Meridional', 'Financeira Prisma'],
  kit: ['Kinetic', 'Vexa', 'Orbita', 'Lumo', 'Stride', 'Zefir', 'Nuvem Sports'],
  stadium: ['Arena Cobalto', 'Grupo Savana', 'Laticínios Serra', 'Hotéis Lagoa', 'Supermercados Faro', 'Tecnologia Íris'],
};


const round100 = (v: number) => Math.round(v / 100) * 100;

/** Valor de referência mensal de uma cota (sem ruído). */
export const sponsorReference = (totalMonthly: number, kind: SponsorKind): number => Math.round(totalMonthly * SPONSOR_SHARE[kind]);

/**
 * Bônus de uma proposta "fixo menor + bônus". `tier` = divisão do clube: na 1ª há título e posição; nas de baixo, acesso e título.
 * `targetPosition` = posição-alvo da diretoria (o bônus de posição só existe na 1ª divisão).
 */
export function offerBonuses(reference: number, tier: number, targetPosition: number): SponsorBonus[] {
  const m = SPONSOR_RULES.bonusMultiple;
  const list: SponsorBonus[] = [{ trigger: 'league_title', amount: round100(reference * m.league_title) }];
  if (tier <= 1) list.push({ trigger: 'position', amount: round100(reference * m.position), target: Math.max(1, targetPosition) });
  else list.push({ trigger: 'promotion', amount: round100(reference * m.promotion) });
  list.push({ trigger: 'cup_title', amount: round100(reference * m.cup_title) });
  return list;
}

/** De 2 a 3 propostas para uma cota, de empresas diferentes (`names` = nomes possíveis da cota, sem repetir). */
export function sponsorOffers(a: { reference: number; kind: SponsorKind; tier: number; targetPosition: number; names: readonly string[]; exclude?: readonly string[] }, rng: Rng): SponsorOfferDraft[] {
  const pool = a.names.filter((n) => !(a.exclude ?? []).includes(n));
  const names = rng.shuffle([...(pool.length >= 2 ? pool : a.names)]);
  const n = Math.min(names.length, rng.int(2, 3));
  const out: SponsorOfferDraft[] = [];
  for (let i = 0; i < n; i++) {
    const profile: SponsorProfile = i === 0 ? 'fixed' : i === 1 ? 'bonus' : rng.chance(0.5) ? 'fixed' : 'bonus';
    const r = profile === 'fixed' ? SPONSOR_RULES.fixed : SPONSOR_RULES.bonus;
    const monthly = Math.max(100, round100(a.reference * rng.float(r.low, r.high)));
    out.push({
      sponsor: names[i]!, profile, monthly, years: rng.int(SPONSOR_RULES.minYears + 1, SPONSOR_RULES.maxYears),
      bonuses: profile === 'bonus' ? offerBonuses(a.reference, a.tier, a.targetPosition) : [],
      ceiling: round100(monthly * rng.float(SPONSOR_RULES.ceiling.low, SPONSOR_RULES.ceiling.high)),
    });
  }
  return out;
}

export type SponsorReply = { kind: 'accept'; monthly: number } | { kind: 'counter'; monthly: number; roundsLeft: number } | { kind: 'walkout' };
/**
 * Resposta da empresa ao valor pedido pelo usuário. `standing` = o que ela oferece hoje (proposta inicial ou última contraproposta);
 * `round` = pedidos acima do teto já feitos nesta conversa. Pedido até o teto: aceita (pelo valor pedido). Acima: sobe 40% da diferença
 * entre o que oferece e o pedido, sem passar do teto; no 3º pedido acima do teto desiste.
 */
export function sponsorReply(a: { asked: number; standing: number; ceiling: number; round: number }): SponsorReply {
  if (a.asked <= a.standing) return { kind: 'accept', monthly: a.asked };
  if (a.asked <= a.ceiling) return { kind: 'accept', monthly: round100(a.asked) };
  if (a.round + 1 >= SPONSOR_RULES.maxRounds) return { kind: 'walkout' };
  const monthly = Math.min(a.ceiling, round100(a.standing + SPONSOR_RULES.counterShare * (a.asked - a.standing)));
  if (monthly <= a.standing) return { kind: 'counter', monthly: a.standing, roundsLeft: SPONSOR_RULES.maxRounds - (a.round + 1) };
  return { kind: 'counter', monthly, roundsLeft: SPONSOR_RULES.maxRounds - (a.round + 1) };
}

/** Meses cheios entre duas datas (aaaa-mm-dd), arredondando para cima o mês começado. */
export function monthsLeft(from: string, to: string): number {
  if (to < from) return 0;
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + (d2 >= d1 ? 1 : 0));
}

/** Multa de rescisão pelo clube: 3 mensalidades, limitada aos meses que restam. */
export const terminationFee = (monthly: number, date: string, end: string): number =>
  monthly * Math.min(SPONSOR_RULES.terminationMonths, monthsLeft(date, end));

/** Bônus devidos por um resultado de temporada (liga) ou título de copa. */
export function bonusesDue(bonuses: readonly SponsorBonus[], r: { champion?: boolean; promoted?: boolean; position?: number; cupTitle?: boolean }): SponsorBonus[] {
  return bonuses.filter((b) =>
    (b.trigger === 'league_title' && r.champion === true)
    || (b.trigger === 'promotion' && r.promoted === true)
    || (b.trigger === 'position' && r.position !== undefined && b.target !== undefined && r.position <= b.target)
    || (b.trigger === 'cup_title' && r.cupTitle === true));
}
