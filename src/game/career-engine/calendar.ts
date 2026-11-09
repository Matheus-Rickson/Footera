/**
 * Temporada por país (Fase 9). A maioria dos países joga de julho a junho; alguns jogam no ano civil (janeiro a dezembro, com a
 * pré-temporada em janeiro): Brasil, Argentina e Irlanda na base. A virada de cada país acontece na sua data (1º/jul ou 1º/jan).
 *
 * Numeração: temporada `S` de julho = 1º/jul/S a 30/jun/S+1 ("2026/27"); temporada `S` de ano civil = 1º/jan a 31/dez de S ("2027").
 * Início da carreira (`careerWorld`): sempre no início da temporada do país do clube (1º/jan/2026 no ano civil, 1º/jul/2026 em julho), com
 * os países do outro calendário na metade da temporada deles (seis meses simulados na criação). Antes da 1ª temporada, um país fica
 * parado (`country_seasons.transition = 1`, sem jogos). Saves antigos podem ter um "torneio de transição" já criado: a virada dele não
 * tem acesso/rebaixamento.
 */
import { contractBaseYear, contractEndFor, seasonYearOf } from './contracts.ts';

export type SeasonStart = '07-01' | '01-01';
export const SEASON_STARTS: readonly SeasonStart[] = ['07-01', '01-01'];
/** Países da base no ano civil (decisão do usuário, 06/11/2026). O Japão mudou para ago–mai em 2026/27 (J.League) e fica em julho. */
export const CALENDAR_YEAR_CODES: readonly string[] = ['BRA', 'ARG', 'IRL', 'URU', 'COL', 'ECU', 'PAR', 'CHI', 'PER', 'BOL', 'VEN'];
export const defaultSeasonStart = (code: string): SeasonStart => (CALENDAR_YEAR_CODES.includes(code) ? '01-01' : '07-01');

/** Início e virada (dia seguinte ao fim) da temporada `season`. */
export function seasonBounds(season: number, start: SeasonStart): { starts: string; turnover: string } {
  return start === '01-01' ? { starts: `${season}-01-01`, turnover: `${season + 1}-01-01` } : { starts: `${season}-07-01`, turnover: `${season + 1}-07-01` };
}
/** Temporada que contém a data. */
export const seasonOfDate = (date: string, start: SeasonStart): number => (start === '01-01' ? Number(date.slice(0, 4)) : seasonYearOf(date));
/** Rótulo da temporada ("2026/27" ou "2027"; período parado antes da 1ª temporada: "2026 (transição)"). */
export const seasonLabelFor = (season: number, start: SeasonStart, transition = false): string =>
  transition ? `${season} (transição)` : start === '01-01' ? String(season) : `${season}/${String(season + 1).slice(2)}`;

/** Fim de um contrato assinado em `date` por `years` temporadas do país: sempre no último dia de uma temporada. */
export function contractEndIn(date: string, years: number, start: SeasonStart): string {
  return start === '01-01' ? `${seasonOfDate(date, start) + years - 1}-12-31` : contractEndFor(date, years);
}
/** Novo fim ao renovar por `years` temporadas além da temporada em que o contrato atual termina. */
export function renewedEnd(contractEnd: string, years: number, start: SeasonStart): string {
  if (start === '07-01') return `${contractBaseYear(contractEnd) + years}-06-30`;
  // ano civil: o contrato atual vence na virada seguinte ao seu fim (um fim em 1º/jan conta para o ano anterior)
  const endSeason = Number(contractEnd.slice(0, 4)) - (contractEnd.slice(5) === '01-01' ? 1 : 0);
  return `${endSeason + years}-12-31`;
}

/** Ano civil de uma data MM-DD dentro da temporada (julho: MM-DD a partir de 07-01 no ano S, antes disso em S+1; ano civil: sempre S). */
export const yearInSeason = (mmdd: string, season: number, start: SeasonStart): number => (start === '01-01' ? season : mmdd >= '07-01' ? season : season + 1);

/** 1ª rodada da liga num país de ano civil: depois de ~4 semanas de pré-temporada (sábado a partir de 31/jan). */
export const CALENDAR_YEAR_LEAGUE_START = '01-31';
