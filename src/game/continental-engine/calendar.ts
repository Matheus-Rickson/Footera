/**
 * Calendário da CONMEBOL (anexo de calendário do manual da Libertadores 2026, LIB p. 276), puro. As datas do anexo são semanas (jogos de
 * terça a quinta, LIB p. 65); aqui cada semana é guardada pela quarta-feira. As finais são sábados fixos (2026: Sul-Americana 21/11,
 * Libertadores 28/11). Nos anos seguintes, cada data vai para o mesmo dia da semana mais próximo da mesma data do ano (ADAPT: o
 * calendário de cada ano é aprovado pela CONMEBOL).
 */
import { addDays, daysBetween, weekday } from '../../shared/date.ts';
import { LIB_ID, RECOPA_ID, SUD_ID } from './formats.ts';

const GROUPS = ['2026-04-08', '2026-04-15', '2026-04-29', '2026-05-06', '2026-05-20', '2026-05-27'];
const KO = { r16: ['2026-08-12', '2026-08-19'], qf: ['2026-09-09', '2026-09-16'], sf: ['2026-10-14', '2026-10-21'] };
/** Semanas de 2026 de cada fase (quarta-feira da semana; as finais são o dia do jogo). */
export const CONMEBOL_2026: Record<string, Record<string, string[]>> = {
  [LIB_ID]: { f1: ['2026-02-04', '2026-02-11'], f2: ['2026-02-18', '2026-02-25'], f3: ['2026-03-04', '2026-03-11'], g: GROUPS, ...KO, final: ['2026-11-28'] },
  [SUD_ID]: { p1: ['2026-03-04'], g: GROUPS, po: ['2026-07-22', '2026-07-29'], ...KO, final: ['2026-11-21'] },
  [RECOPA_ID]: { f: ['2026-02-18', '2026-02-25'] },
};

/** A mesma data num outro ano, no mesmo dia da semana (o mais próximo). */
export function shiftToSeason(anchor: string, season: number): string {
  const target = `${season}${anchor.slice(4)}`;
  let diff = (weekday(anchor) - weekday(target) + 7) % 7;
  if (diff > 3) diff -= 7;
  return addDays(target, diff);
}

/** Datas (semanas ou dia da final) de uma fase na temporada; null se o formato ou a fase não têm calendário. */
export function conmebolStageDates(formatId: string, stageId: string, season: number): string[] | null {
  const list = CONMEBOL_2026[formatId]?.[stageId];
  return list ? list.map((d) => shiftToSeason(d, season)) : null;
}

/** Todas as semanas continentais da temporada (quartas-feiras; inclui as finais), para as copas nacionais evitarem. */
export function conmebolWeeks(season: number): string[] {
  const out = new Set<string>();
  for (const f of Object.values(CONMEBOL_2026)) for (const list of Object.values(f)) for (const d of list) out.add(shiftToSeason(d, season));
  return [...out].sort();
}

/** Primeira data continental da temporada (fase 1 da Libertadores): depois dela não dá mais para criar as competições do ano. */
export const conmebolFirstDate = (season: number): string => conmebolStageDates(LIB_ID, 'f1', season)![0]!;

/**
 * Dia do jogo dentro da semana (terça, quarta ou quinta): o que deixa mais descanso para os dois clubes (maior distância até o jogo mais
 * próximo de qualquer um deles); empate → quarta, quinta, terça. `busy` = datas dos outros jogos dos dois clubes.
 */
export function pickMatchDay(wednesday: string, busy: readonly string[]): string {
  const options = [wednesday, addDays(wednesday, 1), addDays(wednesday, -1)];
  let best = options[0]!, bestGap = -1;
  for (const d of options) {
    const gap = busy.reduce((m, b) => Math.min(m, Math.abs(daysBetween(d, b))), 7);
    if (gap > bestGap) { best = d; bestGap = gap; }
  }
  return best;
}
