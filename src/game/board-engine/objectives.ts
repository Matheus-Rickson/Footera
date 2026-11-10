/**
 * Objetivos da diretoria por tamanho e fase do clube (v0.8.10; docs/BOARD_JOBS.md). Regras puras.
 * O objetivo de liga continua sendo o de `board.ts` (`objectiveFor`, essencial, com os pesos próprios em `evaluateSeason`); aqui ficam o
 * tamanho, a fase, os objetivos extras (copa, estadual, finanças, folha, base, elenco) e o peso de cada um pela importância.
 */
import type { Objective } from './board.ts';

export type ClubSize = 'giant' | 'big' | 'medium' | 'small';
export type ClubPhase = 'relegated' | 'promoted' | 'crisis' | 'rebuilding' | 'rising' | 'stable';
export type Importance = 'essential' | 'important' | 'desirable';
export type ObjectiveKind = 'league' | 'cup' | 'state' | 'finance_black' | 'payroll_cut' | 'wage_ceiling' | 'youth_promote' | 'youth_minutes' | 'squad_age';

export const SIZE_LABEL: Record<ClubSize, string> = { giant: 'Gigante', big: 'Grande', medium: 'Médio', small: 'Pequeno' };
export const PHASE_LABEL: Record<ClubPhase, string> = {
  relegated: 'Recém-rebaixado', promoted: 'Recém-promovido', crisis: 'Crise financeira', rebuilding: 'Reconstrução', rising: 'Em ascensão', stable: 'Estável',
};
export const PHASE_TEXT: Record<ClubPhase, string> = {
  relegated: 'O clube caiu na temporada passada: a prioridade é voltar já.',
  promoted: 'O clube acabou de subir: a prioridade é se manter sem comprometer as finanças.',
  crisis: 'O caixa está negativo ou a previsão do ano é de prejuízo pesado: a diretoria quer cortar gastos.',
  rebuilding: 'O elenco está velho ou fraco para o tamanho do clube: a diretoria quer renovar e dar espaço aos jovens.',
  rising: 'A última campanha foi bem acima do esperado: a diretoria quer manter a evolução.',
  stable: 'Sem urgências: a diretoria cobra o que o tamanho do clube pede.',
};
/** Peso na confiança da diretoria na avaliação da temporada (o objetivo de liga tem os pesos próprios de `evaluateSeason`). */
export const IMPORTANCE: Record<Importance, { label: string; met: number; missed: number }> = {
  essential: { label: 'Essencial', met: 10, missed: -15 },
  important: { label: 'Importante', met: 6, missed: -8 },
  desirable: { label: 'Desejável', met: 3, missed: -2 },
};

/** Tamanho: reputação, divisão e posição de reputação no país. */
export function clubSize(a: { reputation: number; tier: number; repRankInCountry: number }): ClubSize {
  if (a.tier === 1 && (a.reputation >= 78 || a.repRankInCountry <= 3)) return 'giant';
  if (a.tier === 1 && (a.reputation >= 64 || a.repRankInCountry <= 8)) return 'big';
  if (a.tier === 1 || (a.tier === 2 && a.reputation >= 42)) return 'medium';
  return 'small';
}

/**
 * Fase (a primeira que se aplica, nesta ordem): rebaixado ou promovido na temporada passada; crise (caixa negativo ou prejuízo previsto
 * acima de 10% da receita anual); reconstrução (idade média dos 18 mais fortes ≥ 29,5 ou força do elenco 4+ posições abaixo da posição
 * de reputação na liga); em ascensão (terminou a temporada passada 3+ posições acima do esperado); estável.
 */
export function clubPhase(a: {
  lastOutcome: 'champion' | 'promoted' | 'relegated' | null; lastPosition: number | null; expected: number;
  balance: number; projectedNet: number; annualIncome: number; squadAge: number; strengthRank: number; repRank: number;
}): ClubPhase {
  if (a.lastOutcome === 'relegated') return 'relegated';
  if (a.lastOutcome === 'promoted') return 'promoted';
  if (a.balance < 0 || a.projectedNet < -0.1 * Math.max(1, a.annualIncome)) return 'crisis';
  if (a.squadAge >= 29.5 || a.strengthRank >= a.repRank + 4) return 'rebuilding';
  if (a.lastPosition !== null && a.lastPosition <= a.expected - 3) return 'rising';
  return 'stable';
}

export interface ObjectiveDef { kind: ObjectiveKind; importance: Importance; label: string; target: Record<string, number> }

export interface ObjectiveContext {
  league: { objective: Objective; target: number; label: string } | null;
  /** copa nacional da temporada: nomes das fases e fase de estreia do clube */ cup: { name: string; stages: string[]; entry: number } | null;
  /** estadual (Brasil) do clube na temporada */ state: { name: string; teams: number; relegationSlots: number } | null;
  payroll: number; wageCeiling: number; youthTarget: number; squadAge: number; tier: number;
}

const cupTargetStage = (size: ClubSize, stages: number, entry: number): number => {
  const want = size === 'giant' ? stages - 1 : size === 'big' ? stages - 2 : size === 'medium' ? stages - 3 : entry + 1;
  return Math.max(Math.min(entry + 1, stages - 1), Math.min(stages - 1, want));
};

/** Objetivos da temporada (4 a 6): liga essencial + extras conforme o tamanho e a fase. */
export function seasonObjectives(size: ClubSize, phase: ClubPhase, ctx: ObjectiveContext): ObjectiveDef[] {
  const out: ObjectiveDef[] = [];
  if (ctx.league) out.push({ kind: 'league', importance: 'essential', label: ctx.league.label, target: { position: ctx.league.target } });
  if (ctx.cup) {
    const t = cupTargetStage(size, ctx.cup.stages.length, ctx.cup.entry);
    const final = t === ctx.cup.stages.length - 1;
    out.push({ kind: 'cup', importance: size === 'giant' || size === 'big' ? 'important' : 'desirable', target: { stage: t },
      label: final ? `${ctx.cup.name}: chegar à final` : `${ctx.cup.name}: chegar à ${ctx.cup.stages[t]!.toLowerCase()}` });
  }
  if (ctx.state) {
    if (size === 'giant' || size === 'big') out.push({ kind: 'state', importance: size === 'giant' ? 'important' : 'desirable', label: `${ctx.state.name}: ser campeão`, target: { champion: 1 } });
    else if (size === 'medium') out.push({ kind: 'state', importance: 'desirable', label: `${ctx.state.name}: terminar a 1ª fase entre os 4`, target: { position: 4 } });
    else if (ctx.state.relegationSlots > 0) out.push({ kind: 'state', importance: 'desirable', label: `${ctx.state.name}: não ser rebaixado`, target: { position: ctx.state.teams - ctx.state.relegationSlots } });
  }
  if (phase === 'crisis') {
    const cut = Math.round((ctx.payroll * 0.9) / 1000) * 1000;
    out.push({ kind: 'payroll_cut', importance: 'important', label: 'Reduzir a folha salarial em 10%', target: { payroll: cut } });
    out.push({ kind: 'finance_black', importance: 'important', label: 'Terminar a temporada com o caixa positivo', target: { balance: 0 } });
  } else {
    out.push({ kind: 'finance_black', importance: phase === 'promoted' || size === 'small' ? 'important' : 'desirable', label: 'Terminar a temporada no azul', target: { balance: 0 } });
    out.push({ kind: 'wage_ceiling', importance: 'desirable', label: 'Manter a folha dentro do teto salarial', target: { payroll: ctx.wageCeiling } });
  }
  if (phase === 'rebuilding') {
    out.push({ kind: 'youth_minutes', importance: 'important', label: 'Dar 25 jogos a jogadores de até 21 anos', target: { appearances: 25 } });
    out.push({ kind: 'squad_age', importance: 'desirable', label: `Baixar a idade média do elenco titular para ${(Math.floor(ctx.squadAge * 2) / 2 - 0.5).toLocaleString('pt-BR')} anos`, target: { age: Math.floor(ctx.squadAge * 2) / 2 - 0.5 } });
  } else if (ctx.youthTarget > 0) {
    out.push({ kind: 'youth_promote', importance: 'desirable', label: `Promover ${ctx.youthTarget} jovem(ns) da base`, target: { count: ctx.youthTarget } });
  }
  return out.slice(0, 6);
}

export type ObjectiveStatus = 'pending' | 'on_track' | 'close' | 'off_track' | 'met' | 'missed';
/** Situação atual de um objetivo; `final` = fim da temporada (só cumprido ou não). `actual` = valores medidos no jogo. */
export function objectiveStatus(o: ObjectiveDef, actual: {
  position?: number | null; played?: number; cupStage?: number | null; cupEliminated?: boolean; cupChampion?: boolean; stateChampion?: boolean; stateFinished?: boolean;
  balance?: number; payroll?: number; youthPromoted?: number; youthAppearances?: number; squadAge?: number;
}, final: boolean): ObjectiveStatus {
  const t = o.target;
  const done = (ok: boolean): ObjectiveStatus => (ok ? 'met' : 'missed');
  switch (o.kind) {
    case 'league': {
      if (actual.position == null || !actual.played) return final ? 'missed' : 'pending';
      if (final) return done(actual.position <= t.position!);
      return actual.position <= t.position! ? 'on_track' : actual.position <= t.position! + 2 ? 'close' : 'off_track';
    }
    case 'cup': {
      if (actual.cupChampion || (actual.cupStage != null && actual.cupStage >= t.stage!)) return 'met';
      if (actual.cupEliminated) return 'missed';
      return final ? 'missed' : actual.cupStage == null ? 'pending' : 'on_track';
    }
    case 'state': {
      if (t.champion) { if (actual.stateChampion) return 'met'; return final || actual.stateFinished ? 'missed' : actual.position == null ? 'pending' : actual.position <= 2 ? 'on_track' : 'close'; }
      if (actual.position == null || !actual.played) return final || actual.stateFinished ? 'missed' : 'pending';
      if (final || actual.stateFinished) return done(actual.position <= t.position!);
      return actual.position <= t.position! ? 'on_track' : actual.position <= t.position! + 2 ? 'close' : 'off_track';
    }
    case 'finance_black': return final ? done((actual.balance ?? 0) >= t.balance!) : (actual.balance ?? 0) >= t.balance! ? 'on_track' : 'off_track';
    case 'payroll_cut':
    case 'wage_ceiling': return final ? done((actual.payroll ?? 0) <= t.payroll!) : (actual.payroll ?? 0) <= t.payroll! ? 'on_track' : (actual.payroll ?? 0) <= t.payroll! * 1.05 ? 'close' : 'off_track';
    case 'youth_promote': return (actual.youthPromoted ?? 0) >= t.count! ? 'met' : final ? 'missed' : 'pending';
    case 'youth_minutes': return (actual.youthAppearances ?? 0) >= t.appearances! ? 'met' : final ? 'missed' : (actual.youthAppearances ?? 0) > 0 ? 'on_track' : 'pending';
    case 'squad_age': return final ? done((actual.squadAge ?? 99) <= t.age!) : (actual.squadAge ?? 99) <= t.age! ? 'on_track' : 'off_track';
  }
}

/** Andamento 0–1 para a barra da tela (aproximado; o status é o que vale). */
export function objectiveProgress(o: ObjectiveDef, actual: Parameters<typeof objectiveStatus>[1]): number {
  const t = o.target, clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  switch (o.kind) {
    case 'league': case 'state': return actual.position == null ? 0 : t.champion ? (actual.stateChampion ? 1 : 0.5) : clamp01(1 - (actual.position - t.position!) / Math.max(4, t.position!));
    case 'cup': return actual.cupChampion ? 1 : clamp01(((actual.cupStage ?? -1) + 1) / (t.stage! + 1));
    case 'finance_black': return (actual.balance ?? 0) >= 0 ? 1 : 0.2;
    case 'payroll_cut': case 'wage_ceiling': return clamp01(t.payroll! / Math.max(1, actual.payroll ?? 1));
    case 'youth_promote': return clamp01((actual.youthPromoted ?? 0) / t.count!);
    case 'youth_minutes': return clamp01((actual.youthAppearances ?? 0) / t.appearances!);
    case 'squad_age': return clamp01(1 - ((actual.squadAge ?? t.age!) - t.age!) / 3);
  }
}
