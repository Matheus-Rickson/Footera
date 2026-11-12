import { clamp } from '../rng.ts';
import type { Attributes } from '../../shared/types.ts';

/**
 * Treino por sessões (v0.8.12, docs/TRAINING_STAFF.md): uma grade semanal com uma sessão por dia, ajustada sozinha aos jogos. Cada sessão
 * tem carga (custo de condição), efeito na taxa de recuperação, peso no crescimento de cada grupo de atributos, ritmo de jogo, domínio das
 * funções, moral e risco de lesão. Lógica pura e determinística.
 */
export type Session = 'physical' | 'technical' | 'tactical' | 'prematch' | 'recovery' | 'rest' | 'match';
/** sessões que o técnico (ou o preparador) pode marcar na grade; "jogo" é automática */
export type PlanSession = Exclude<Session, 'match'>;
export const PLAN_SESSIONS: PlanSession[] = ['physical', 'technical', 'tactical', 'prematch', 'recovery', 'rest'];
export type GrowthGroup = 'physical' | 'technical' | 'mental';
export const GROWTH_GROUPS: GrowthGroup[] = ['physical', 'technical', 'mental'];

export interface SessionDef {
  /** pontos de condição gastos no dia (antes da intensidade) */ load: number;
  /** soma na taxa diária de recuperação */ rate: number;
  /** peso no crescimento de cada grupo (a soma é 3 nas sessões de treino: o total se conserva, muda a distribuição) */ growth: Record<GrowthGroup, number>;
  /** ritmo de jogo ganho no dia */ sharp: number;
  /** peso no domínio da função treinada */ role: number;
  /** moral ganha no dia */ morale: number;
  /** multiplicador do risco de lesão no treino (0 = não treina) */ injury: number;
}
export const SESSION: Record<Session, SessionDef> = {
  physical: { load: 6, rate: -0.10, growth: { physical: 1.6, technical: 0.7, mental: 0.7 }, sharp: 0, role: 1, morale: 0, injury: 1.3 },
  technical: { load: 3, rate: 0, growth: { physical: 0.7, technical: 1.6, mental: 0.7 }, sharp: 0, role: 1, morale: 0, injury: 1 },
  tactical: { load: 3, rate: 0, growth: { physical: 0.7, technical: 0.7, mental: 1.6 }, sharp: 1, role: 2, morale: 0, injury: 1 },
  prematch: { load: 1, rate: 0, growth: { physical: 0.4, technical: 0.5, mental: 0.6 }, sharp: 1, role: 0.5, morale: 0, injury: 0.5 },
  recovery: { load: 0, rate: 0.12, growth: { physical: 0, technical: 0, mental: 0 }, sharp: 0, role: 0, morale: 0, injury: 0 },
  rest: { load: 0, rate: 0.08, growth: { physical: 0, technical: 0, mental: 0 }, sharp: 0, role: 0, morale: 0.5, injury: 0 },
  // dia de jogo: só a ativação da manhã (a partida gasta a condição e dá ritmo à parte)
  match: { load: 0, rate: -0.2, growth: { physical: 0, technical: 0, mental: 0 }, sharp: 0, role: 0, morale: 0, injury: 0 },
};
export const SESSION_LABEL: Record<Session, string> = {
  physical: 'Físico', technical: 'Técnico', tactical: 'Tático', prematch: 'Pré-jogo', recovery: 'Recuperação', rest: 'Folga', match: 'Jogo',
};

/** Grade semanal: índice = dia da semana (0 = domingo … 6 = sábado, como `weekday`). */
export type Week = Session[];
export type TemplateId = 'balanced' | 'preseason' | 'tactical' | 'double' | 'recovery';
export const TEMPLATES: Record<TemplateId, { label: string; week: Week }> = {
  balanced: { label: 'Equilibrada', week: ['rest', 'technical', 'physical', 'tactical', 'technical', 'tactical', 'prematch'] },
  preseason: { label: 'Pré-temporada', week: ['rest', 'physical', 'technical', 'physical', 'tactical', 'physical', 'technical'] },
  tactical: { label: 'Tática', week: ['rest', 'tactical', 'tactical', 'technical', 'tactical', 'tactical', 'prematch'] },
  double: { label: 'Semana com 2 jogos', week: ['rest', 'recovery', 'tactical', 'prematch', 'recovery', 'tactical', 'prematch'] },
  recovery: { label: 'Recuperação', week: ['rest', 'recovery', 'technical', 'recovery', 'tactical', 'recovery', 'prematch'] },
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export interface MatchAround { today: boolean; yesterday: boolean; tomorrow: boolean }
/**
 * Sessão efetiva do dia. Dia de jogo é sempre "Jogo". Com o ajuste automático: dia seguinte a um jogo → Recuperação; véspera → Pré-jogo
 * (a recuperação vence quando o dia está entre dois jogos). Sem o ajuste, vale a grade.
 */
export function sessionFor(planned: Session, m: MatchAround, autoAdjust: boolean): Session {
  if (m.today) return 'match';
  if (!autoAdjust) return planned === 'match' ? 'rest' : planned;
  if (m.yesterday) return 'recovery';
  if (m.tomorrow) return 'prematch';
  return planned;
}
/** A semana inteira ajustada aos jogos (`matchDays` = dias da semana com jogo). */
export function adjustWeek(week: Week, matchDays: ReadonlySet<number>, autoAdjust = true): Week {
  return week.map((s, d) => sessionFor(s, { today: matchDays.has(d), yesterday: matchDays.has((d + 6) % 7), tomorrow: matchDays.has((d + 1) % 7) }, autoAdjust));
}

/** Carga de um jogo para a carga aguda (90 minutos ≈ 10). */
export const MATCH_LOAD = 10;
/** Carga aguda: média móvel exponencial de 7 dias (cada dia mantém e^(−1/7) do anterior). */
export const ACUTE_KEEP = Math.exp(-1 / 7);

/**
 * Multiplicadores mensais por grupo: o que a grade efetiva do mês deu (`actual`, já com a intensidade) dividido pelo que a semana
 * "Equilibrada" teria dado com os MESMOS jogos (`ref`). Equilibrada + intensidade normal = 1 exato (o crescimento calibrado de antes);
 * semanas cheias de jogos não penalizam (a referência também perde dias). Limitado a 0,75–1,30.
 */
export function monthlyMultipliers(acc: { actual: Record<string, number>; ref: Record<string, number> }): Record<GrowthGroup | 'role', number> {
  const m = (k: string, lo: number, hi: number) => { const r = acc.ref[k] ?? 0, a = acc.actual[k] ?? 0; return r > 0 ? clamp(a / r, lo, hi) : 1; };
  return { physical: m('physical', 0.75, 1.3), technical: m('technical', 0.75, 1.3), mental: m('mental', 0.75, 1.3), role: m('role', 0.5, 2) };
}

// ---------------------------------------------------------------- goleiros
export type GkSession = 'reflexes' | 'aerial' | 'distribution';
export const GK_SESSIONS: GkSession[] = ['reflexes', 'aerial', 'distribution'];
export const GK_SESSION_LABEL: Record<GkSession, string> = { reflexes: 'Reflexos', aerial: 'Saídas e jogo aéreo', distribution: 'Jogo com os pés' };
/** Atributos priorizados (×1,35, os demais ×0,9 — o mesmo princípio do foco individual). */
export const GK_SESSION_KEYS: Record<GkSession, readonly string[]> = {
  reflexes: ['reflexes', 'oneOnOne', 'agility'],
  aerial: ['rushingOut', 'aerial', 'handling', 'jumping'],
  distribution: ['kicking', 'passing', 'firstTouch', 'composure'],
};
/** Sessão de goleiros escolhida pelo treinador de goleiros: a do grupo mais fraco do goleiro. */
export function bestGkSession(a: Attributes): GkSession {
  const g = a.goalkeeper;
  if (!g) return 'reflexes';
  const avg: Record<GkSession, number> = {
    reflexes: (g.reflexes + g.oneOnOne) / 2,
    aerial: (g.rushingOut + g.aerial + g.handling) / 3,
    distribution: (g.kicking + a.technical.passing) / 2,
  };
  return GK_SESSIONS.reduce((best, s) => (avg[s] < avg[best] ? s : best), 'reflexes' as GkSession);
}
/** Ganho dos goleiros pelo treinador de goleiros (clube do usuário): 0,80 + 0,30 × qualidade/20 (sem ninguém = qualidade 5 → 0,875). */
export const gkCoachFactor = (q: number): number => 0.8 + (0.3 * clamp(q, 0, 20)) / 20;
