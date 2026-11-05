import type { CoachAttributes, CoachAttrKey } from '../../shared/coachAttributes.ts';
import { COACH_ATTR_BASE } from '../../shared/coachAttributes.ts';

/**
 * Efeitos dos atributos do treinador (1–20) e evolução dele. Regras puras.
 *
 * Cada atributo vira um fator de 0 a 1: 0 na base de criação (5) e 1 no máximo (20). Com todos na base (ou num save sem
 * atributos) o jogo se comporta exatamente como antes — os efeitos só somam vantagens pequenas, para não desfazer as
 * calibrações (a IA não tem atributos de treinador).
 */
export const coachFactor = (v: number | undefined): number => Math.max(0, Math.min(1, ((v ?? COACH_ATTR_BASE) - COACH_ATTR_BASE) / (20 - COACH_ATTR_BASE)));

/** Tamanho máximo de cada efeito (com o atributo em 20). */
export const COACH_EFFECT = {
  /** tática: força do time em campo (soma ao entrosamento) */ tactics: 0.025,
  /** motivação: amplia o efeito bom da conversa no vestiário… */ talkBoost: 0.5,
  /** …e suaviza o efeito ruim */ talkSoften: 0.4,
  /** disciplina: chance de cartão (amarelo e vermelho) dos seus jogadores */ cards: 0.3,
  /** adaptabilidade: rendimento de quem entra ou muda de posição por decisão do técnico */ inGame: 0.05,
  /** adaptabilidade: confiança inicial da diretoria num clube novo (pontos) */ newClub: 8,
  /** jovens: crescimento mensal dos jogadores de até 21 anos do seu clube (elenco e base) */ youth: 0.25,
  /** negociação: taxa pedida pelos clubes, salário pedido por jogadores (contratação e renovação) */ negotiation: 0.08,
} as const;

/** Atributos do treinador que valem dentro da partida. */
export interface CoachMatchAttributes { tactics: number; motivation: number; discipline: number; adaptability: number }

export const tacticsMultiplier = (a?: Partial<CoachAttributes>): number => 1 + COACH_EFFECT.tactics * coachFactor(a?.tactics);
export const cardMultiplier = (a?: Partial<CoachAttributes>): number => 1 - COACH_EFFECT.cards * coachFactor(a?.discipline);
export const inGameMultiplier = (a?: Partial<CoachAttributes>): number => 1 + COACH_EFFECT.inGame * coachFactor(a?.adaptability);
/** Conversa no vestiário: o efeito bom cresce e o ruim diminui com a motivação (arredondado: a moral é inteira). */
export function talkWithMotivation(delta: number, a?: Partial<CoachAttributes>): number {
  const f = coachFactor(a?.motivation);
  return Math.round(delta > 0 ? delta * (1 + COACH_EFFECT.talkBoost * f) : delta * (1 - COACH_EFFECT.talkSoften * f));
}
export const youthGrowthMultiplier = (a: Partial<CoachAttributes> | undefined, age: number): number => (age <= 21 ? 1 + COACH_EFFECT.youth * coachFactor(a?.youth) : 1);
/** Desconto (multiplicador) do que clubes e jogadores pedem ao negociar com o treinador. */
export const negotiationMultiplier = (a?: Partial<CoachAttributes>): number => 1 - COACH_EFFECT.negotiation * coachFactor(a?.negotiation);
export const newClubConfidenceBonus = (a?: Partial<CoachAttributes>): number => Math.round(COACH_EFFECT.newClub * coachFactor(a?.adaptability));

/** Teto de cada atributo do treinador (o mesmo dos jogadores). */
export const COACH_ATTR_CAP = 20;

/**
 * Pontos de atributo ganhos na avaliação da temporada: 1 por temporada completa no cargo, +1 com o objetivo cumprido,
 * +1 por título e +1 por acesso.
 */
export function seasonPoints(a: { met: boolean; champion: boolean; promoted: boolean }): number {
  return 1 + (a.met ? 1 : 0) + (a.champion ? 1 : 0) + (a.promoted ? 1 : 0);
}

/** Gasta um ponto em um atributo (erro em texto, ou null se pode). */
export function spendError(attrs: CoachAttributes, points: number, key: CoachAttrKey): string | null {
  if (points <= 0) return 'Não há pontos de atributo para distribuir.';
  if (attrs[key] >= COACH_ATTR_CAP) return `Este atributo já está no máximo (${COACH_ATTR_CAP}).`;
  return null;
}

/** Reputação inicial do treinador: um técnico desconhecido, um pouco mais visto quando começa num clube grande (15 a 35). */
export const initialCoachReputation = (clubReputation: number): number => Math.max(15, Math.min(35, Math.round(10 + clubReputation * 0.25)));

/**
 * Confiança inicial da diretoria num clube novo: a de sempre, mais crédito para um treinador de reputação acima da do clube
 * (−8 a +8) e o bônus de adaptabilidade.
 */
export function hireConfidence(base: number, coachReputation: number, clubReputation: number, a?: Partial<CoachAttributes>): number {
  return base + Math.max(-8, Math.min(8, Math.round((coachReputation - clubReputation) / 5))) + newClubConfidenceBonus(a);
}
