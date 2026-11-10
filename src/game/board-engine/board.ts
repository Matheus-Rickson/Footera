import { clamp } from '../rng.ts';

export type Objective = 'title' | 'top4' | 'continental' | 'top_half' | 'survive' | 'promotion' | 'promotion_push';
export const OBJECTIVE_LABEL: Record<Objective, string> = {
  title: 'Brigar pelo título', top4: 'Terminar entre os 4 primeiros', continental: 'Garantir vaga continental', top_half: 'Terminar na metade de cima',
  survive: 'Evitar o rebaixamento', promotion: 'Conquistar o acesso', promotion_push: 'Brigar pelo acesso',
};

/** Posição esperada = posição da reputação do clube entre os clubes da liga (1 = maior reputação). */
export function expectedPosition(clubReputation: number, leagueReputations: readonly number[]): number {
  return 1 + leagueReputations.filter((r) => r > clubReputation).length;
}

/**
 * Objetivo da temporada a partir da posição esperada. `target` = pior posição final que ainda cumpre o objetivo.
 * Liga com acesso (2ª divisão): favoritos devem subir; os demais, brigar pelo acesso ou ficar na metade de cima.
 */
export function objectiveFor(expected: number, teams: number, rules: { promotionSlots: number; relegationSlots: number; continentalSlots: number }): { objective: Objective; target: number } {
  const half = Math.ceil(teams / 2), safe = teams - rules.relegationSlots;
  if (rules.promotionSlots > 0) {
    if (expected <= rules.promotionSlots) return { objective: 'promotion', target: rules.promotionSlots };
    if (expected <= rules.promotionSlots + 3) return { objective: 'promotion_push', target: rules.promotionSlots + 3 };
  } else {
    if (expected <= 2) return { objective: 'title', target: 2 };
    if (expected <= 4) return { objective: 'top4', target: 4 };
    if (rules.continentalSlots > 0 && expected <= rules.continentalSlots) return { objective: 'continental', target: rules.continentalSlots };
  }
  if (expected <= half) return { objective: 'top_half', target: half };
  return { objective: 'survive', target: Math.max(1, safe) };
}

export const CONFIDENCE = { start: 60, newHire: 65, warning: 25, recovered: 35, sack: 10, minMatchesBeforeSack: 6 } as const;

/** Variação de confiança por partida: vitória +1,5, empate 0, derrota −1,5 (−2 para quem tem objetivo de título/acesso). */
export function matchDelta(goalsFor: number, goalsAgainst: number, objective: Objective): number {
  if (goalsFor > goalsAgainst) return 1.5;
  if (goalsFor === goalsAgainst) return 0;
  return objective === 'title' || objective === 'promotion' ? -2 : -1.5;
}

/** Ajuste mensal pela posição na tabela em relação à meta (só depois de 3 jogos). */
export function monthlyDelta(position: number, target: number, played: number): number {
  if (played < 3) return 0;
  if (position <= target) return 2;
  if (position <= target + 2) return 0;
  return -Math.min(6, position - target - 2);
}

export interface SeasonVerdict { met: boolean; confidenceDelta: number; reputationDelta: number; lines: string[] }
/** Objetivo extra já julgado na virada (v0.8.10): o peso na confiança vem da importância (`objectives.ts`, `IMPORTANCE`). */
export interface JudgedObjective { label: string; met: boolean; delta: number }
/**
 * Avaliação na virada: objetivo de liga (pesos próprios) e os demais objetivos. Com `objectives` (v0.8.10), cada objetivo extra soma o
 * peso da sua importância; sem eles (saves e testes antigos), valem os dois secundários fixos de antes (caixa no azul e base, ±5 cada).
 */
export function evaluateSeason(a: {
  objective: Objective; target: number; position: number; champion: boolean; promoted: boolean; relegated: boolean; balance: number; youthTarget: number; youthPromoted: number;
  objectives?: JudgedObjective[];
}): SeasonVerdict {
  const met = a.position <= a.target;
  // superar a meta com folga também conta para a reputação (+1 por posição acima da meta, até +4)
  const beyond = met ? Math.min(4, a.target - a.position) : 0;
  let conf = met ? 15 : -20, rep = met ? 5 + beyond : -4;
  const lines = [met ? `Objetivo cumprido: ${OBJECTIVE_LABEL[a.objective].toLowerCase()} (${a.position}º, meta até ${a.target}º).` : `Objetivo NÃO cumprido: ${OBJECTIVE_LABEL[a.objective].toLowerCase()} (${a.position}º, meta até ${a.target}º).`];
  if (beyond >= 2) lines.push(`Campanha acima do esperado: ${beyond} posições melhor que a meta.`);
  if (a.champion) { conf += 10; rep += 10; lines.push('Título conquistado.'); }
  if (a.promoted) { conf += 5; rep += 6; lines.push('Acesso conquistado.'); }
  if (a.relegated) { conf -= 15; rep -= 8; lines.push('Rebaixamento.'); }
  if (a.objectives) {
    for (const o of a.objectives) { conf += o.delta; lines.push(`${o.met ? 'Cumprido' : 'Não cumprido'}: ${o.label} (${o.delta > 0 ? '+' : ''}${o.delta} de confiança).`); }
    return { met, confidenceDelta: conf, reputationDelta: rep, lines };
  }
  if (a.balance >= 0) { conf += 5; lines.push('Finanças: o clube terminou a temporada no azul.'); } else { conf -= 5; lines.push('Finanças: o clube terminou a temporada no vermelho.'); }
  if (a.youthTarget > 0) {
    if (a.youthPromoted >= a.youthTarget) { conf += 5; lines.push(`Base: ${a.youthPromoted} jovem(ns) promovido(s) (meta ${a.youthTarget}).`); }
    else { conf -= 5; lines.push(`Base: ${a.youthPromoted} jovem(ns) promovido(s), abaixo da meta de ${a.youthTarget}.`); }
  }
  return { met, confidenceDelta: conf, reputationDelta: rep, lines };
}

/** Orçamentos da temporada: transferências = 40% do caixa (nada se negativo); teto de folha = maior entre folha atual +8% e 55% da receita mensal. */
export function seasonBudgets(balance: number, monthlyIncome: number, payroll: number): { transfer: number; wageCeiling: number } {
  return {
    transfer: Math.max(0, Math.round((balance * 0.4) / 1000) * 1000),
    wageCeiling: Math.round(Math.max(payroll * 1.08, monthlyIncome * 0.55) / 100) * 100,
  };
}

/** Meta de jovens promovidos: só para bases razoáveis (nível 8+). */
export const youthTargetFor = (academyLevel: number): number => (academyLevel >= 14 ? 2 : academyLevel >= 8 ? 1 : 0);

/** Veto da diretoria a valores fora da realidade do clube (autonomia pedida pelo usuário). */
export const FEE_VETO_FACTOR = 2;      // taxa acima de 2× o valor de mercado
export const WAGE_VETO_FACTOR = 2.2;   // salário acima de 2,2× o salário justo (1,2% do valor)
export function vetoReason(a: { fee?: number; marketValue: number; wage?: number }): string | null {
  if (a.fee !== undefined && a.fee > FEE_VETO_FACTOR * Math.max(a.marketValue, 1)) return `a taxa passa de ${FEE_VETO_FACTOR}× o valor de mercado do jogador`;
  const fair = Math.max(a.marketValue * 0.012, 1500);
  if (a.wage !== undefined && a.wage > WAGE_VETO_FACTOR * fair) return 'o salário está muito acima do que o jogador vale';
  return null;
}

/** Faixa de reputação de clubes que se interessam pelo treinador (desempregado aceita descer mais e é chamado por menos). */
export function eligibleForCoach(clubReputation: number, coachReputation: number, unemployed: boolean): boolean {
  return clubReputation <= coachReputation + (unemployed ? 15 : 25) && clubReputation >= coachReputation - (unemployed ? 60 : 30);
}

/** Chance mensal de um clube da IA demitir o técnico, quando está bem abaixo do esperado. */
export function aiSackChance(position: number, expected: number, teams: number, played: number): number {
  if (played < 6) return 0;
  const gap = position - expected;
  return gap >= Math.max(3, Math.round(teams / 4)) ? clamp(0.1 + gap * 0.02, 0, 0.4) : 0;
}

export const OFFER_DAYS = 10;
/**
 * Ritmo das propostas de emprego. Desempregado: frequentes (precisa voltar a trabalhar). Empregado: raras e seletivas — só clubes
 * de reputação igual ou maior que a do clube atual, no máximo uma pendente, pelo menos 30 dias desde a última proposta e o mesmo
 * clube não volta a chamar em 90 dias (respondida, expirada ou recusada).
 */
export const OFFER_PACE = {
  unemployed: { daily: 0.08, maxPending: 3, gapDays: 0, sameClubDays: 60 },
  employed: { daily: 0.012, maxPending: 1, gapDays: 30, sameClubDays: 90 },
} as const;
/** Empregado só recebe proposta de clube pelo menos do tamanho do atual. */
export const worthLeaving = (clubReputation: number, currentClubReputation: number): boolean => clubReputation >= currentClubReputation;
export const VACANCY_FILL_DAYS = 30;
