/**
 * Conversas e promessas: regras puras (sem I/O, sem acaso). O repositório aplica os efeitos na moral/forma dos jogadores e na confiança
 * da diretoria, e cobra as promessas no prazo. Calibração e textos em docs/PROMISES.md.
 */

export type PlayerTopic = 'praise' | 'demand' | 'promise_minutes' | 'promise_renewal';
export type BoardTopic = 'promise_position' | 'promise_wins';
export type PromiseKind = 'minutes' | 'renewal' | 'position' | 'wins';

export const TALK = {
  /** dias entre duas conversas com o mesmo jogador / com a diretoria */
  playerCooldown: 14, boardCooldown: 30,
  /** renovação: só se o contrato termina em até 18 meses; prazo para renovar */
  renewalWindowDays: 548, renewalDays: 60,
  /** minutos: julgados depois de 5 jogos do clube (ou no prazo, com os jogos que houve); exige 45 min por jogo em média */
  minutesMatches: 5, minutesDays: 60, minutesPerMatch: 45,
  /** vitórias: 3 nos próximos 5 jogos do clube (ou proporcional no prazo) */
  winsMatches: 5, winsNeeded: 3, winsDays: 75,
  /** posição: 2 acima da meta da diretoria; só até 3/4 da liga disputada */
  positionAboveTarget: 2, positionMaxShare: 0.75,
} as const;

/** Efeitos (moral e forma 0–100; confiança da diretoria 0–100). */
export const EFFECT = {
  minutes: { now: 8, kept: 4, broken: -15 },
  renewal: { now: 6, kept: 4, broken: -15 },
  position: { now: 5, kept: 10, broken: -15 },
  wins: { now: 3, kept: 6, broken: -8 },
} as const satisfies Record<PromiseKind, { now: number; kept: number; broken: number }>;

export interface TalkResult { moraleDelta: number; formDelta: number; text: string }

/** Elogiar ou cobrar: o efeito depende da fase do jogador (forma) e do humor dele (moral). */
export function talkOutcome(topic: 'praise' | 'demand', p: { form: number; morale: number }): TalkResult {
  if (topic === 'praise') {
    if (p.form >= 60) return { moraleDelta: 6, formDelta: 0, text: 'Gostou do reconhecimento: a moral subiu bastante.' };
    if (p.form >= 45) return { moraleDelta: 2, formDelta: 0, text: 'Agradeceu o elogio: a moral subiu um pouco.' };
    return { moraleDelta: -3, formDelta: 0, text: 'Achou o elogio fora de hora, sabendo que não vive boa fase: a moral caiu um pouco.' };
  }
  if (p.form >= 50) return { moraleDelta: -5, formDelta: 0, text: 'Achou a cobrança injusta, porque vem jogando bem: a moral caiu.' };
  if (p.morale >= 50) return { moraleDelta: -2, formDelta: 6, text: 'Ouviu a cobrança e prometeu reagir: a forma melhorou, a moral caiu um pouco.' };
  return { moraleDelta: -6, formDelta: 0, text: 'Já desanimado, recebeu mal a cobrança: a moral caiu.' };
}

/** Minutos: cumprida se o jogador teve em média 45 minutos por jogo do clube desde a promessa. Sem jogos: anulada. */
export function judgeMinutes(minutes: number, clubMatches: number): 'kept' | 'broken' | 'void' {
  if (clubMatches <= 0) return 'void';
  return minutes >= TALK.minutesPerMatch * clubMatches ? 'kept' : 'broken';
}

/** Vitórias: 3 de 5 jogos (no prazo, com menos jogos, a mesma proporção). Sem jogos: anulada. */
export function judgeWins(wins: number, matches: number): 'kept' | 'broken' | 'void' {
  if (matches <= 0) return 'void';
  return wins * TALK.winsMatches >= TALK.winsNeeded * matches ? 'kept' : 'broken';
}

/** Posição prometida à diretoria: 2 acima da meta (no mínimo o 1º lugar); sem margem quando a meta já é o título. */
export function promisedPosition(target: number): number | null {
  return target <= 1 ? null : Math.max(1, target - TALK.positionAboveTarget);
}
