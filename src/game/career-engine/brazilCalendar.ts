/**
 * Calendário brasileiro no modelo 2026 (decisão do usuário, 07/11/2026; docs/ESTADUAIS.md): Série A a partir de 28/01 (18 rodadas até
 * 31/05, pausa para a Copa do Mundo de 11/06 a 19/07, volta em 22/07, fim em 02/12), Série B de 21/03 a 28/11, Série C de 04/04 (1ª fase
 * até 29/08, 2ª fase em setembro, final em outubro) e Série D nas datas da tabela básica da CBF (05/04 a 13/09). Estaduais em janeiro a
 * março nas datas livres (etapa 5). Fontes: tabela básica da Série D 2026 (CBF, REG); datas-âncora das Séries A, B e C pela imprensa
 * (SEC); a distribuição das rodadas entre as âncoras é adaptada (ADAPT): sábados, com quartas-feiras quando faltam datas.
 * A pausa da Copa do Mundo só existe nos anos de Copa (2026, 2030…). Puro e determinístico.
 */
import { addDays, nextWeekdayOnOrAfter } from '../../shared/date.ts';

type IsoDate = string;
const SAT = 6, WED = 3;

/** Ano de Copa do Mundo (a Série A para entre o fim de maio e o fim de julho). */
export const worldCupYear = (year: number): boolean => year % 4 === 2;

/**
 * `n` datas entre `from` e `to` (MM-DD do mesmo ano), começando em `first` se informada: sábados; se não bastarem, quartas-feiras
 * espaçadas entre eles. Com datas sobrando, escolhe sábados espaçados por igual (a última data é sempre a mais próxima de `to`).
 */
export function spreadDates(year: number, from: string, to: string, n: number, first?: string, last = false): IsoDate[] {
  // `last`: a última rodada cai na própria data final, se ela for quarta-feira ou fim de semana (Série A 2026: quarta, 02/12)
  const finalDay = new Date(`${year}-${to}T00:00:00Z`).getUTCDay();
  if (last && n >= 2 && [WED, SAT, 0].includes(finalDay)) return [...spreadDates(year, from, `${addDays(`${year}-${to}`, -3).slice(5)}`, n - 1, first), `${year}-${to}`];
  const start = `${year}-${from}`, end = `${year}-${to}`;
  const sats: IsoDate[] = [];
  for (let d = nextWeekdayOnOrAfter(start, SAT); d <= end; d = addDays(d, 7)) sats.push(d);
  const head = first ? [`${year}-${first}`] : [];
  let pool = sats.filter((d) => !head.includes(d) && (!head.length || d > head[0]!));
  const need = n - head.length;
  if (pool.length < need) {
    const weds: IsoDate[] = [];
    for (let d = nextWeekdayOnOrAfter(start, WED); d <= end; d = addDays(d, 7)) if (!head.includes(d) && (!head.length || d > head[0]!)) weds.push(d);
    const extra = need - pool.length;
    if (extra > weds.length) throw new Error(`Calendário: ${n} rodadas não cabem entre ${from} e ${to}.`);
    const step = weds.length / extra;
    pool = [...pool, ...Array.from({ length: extra }, (_, i) => weds[Math.floor(i * step + step / 2)]!)].sort();
  } else if (pool.length > need) {
    const step = (pool.length - 1) / Math.max(1, need - 1);
    pool = need === 1 ? [pool[pool.length - 1]!] : Array.from({ length: need }, (_, i) => pool[Math.round(i * step)]!);
  }
  return [...head, ...pool];
}

/** Datas das rodadas das Séries A e B (pontos corridos) no ano da temporada; null para as demais ligas. */
export function brazilLeagueDates(leagueId: string, year: number, rounds: number): IsoDate[] | null {
  if (leagueId === 'bra-1') {
    if (!worldCupYear(year)) return spreadDates(year, '01-28', '12-02', rounds, '01-28', true);
    const before = Math.min(18, rounds);
    return [...spreadDates(year, '01-28', '05-31', before, '01-28'), ...(rounds > before ? spreadDates(year, '07-22', '12-02', rounds - before, '07-22', true) : [])];
  }
  if (leagueId === 'bra-2') return spreadDates(year, '03-21', '11-28', rounds, '03-21');
  return null;
}

/** Datas da Série D 2026 (tabela básica da CBF; opção de sábado de cada data-base). */
const SERIE_D: Record<string, string[]> = {
  f1: ['04-04', '04-11', '04-18', '04-25', '05-02', '05-09', '05-16', '05-23', '05-30', '06-13'],
  f2: ['06-20', '06-27'], f3: ['07-04', '07-11'], f4: ['07-18', '07-25'], f5: ['08-08', '08-15'],
  sf: ['08-22', '08-29'], po: ['08-26', '09-02'], final: ['09-05', '09-12'],
};

/**
 * Datas de uma fase das Séries C e D no ano da temporada (rodadas relativas da fase), ou null (o jogo usa uma por semana).
 * Série C: 1ª fase de 04/04 a 29/08; 2ª fase (ou quartas e semis, a partir de 2028) em setembro e outubro; final em outubro.
 */
export function brazilStageDates(formatId: string, stageId: string, year: number, rounds: number, size: number): IsoDate[] | null {
  if (formatId === 'bra-serie-d') {
    const d = SERIE_D[stageId];
    return d && d.length === rounds ? d.map((x) => `${year}-${x}`) : null;
  }
  if (formatId === 'bra-serie-c') {
    if (stageId === 'f1') return spreadDates(year, '04-04', '08-29', rounds, '04-04');
    // 20 ou 24 clubes: 2ª fase (6 rodadas) e final; 28 clubes (2028 em diante): quartas, semifinal e final
    const tail: Record<string, string[]> = size < 28
      ? { f2: ['09-05', '09-12', '09-19', '09-26', '10-03', '10-10'], final: ['10-17', '10-24'] }
      : { qf: ['09-05', '09-12'], sf: ['09-19', '09-26'], final: ['10-03', '10-10'] };
    const d = tail[stageId];
    return d && d.length === rounds ? d.map((x) => `${year}-${x}`) : null;
  }
  return null;
}
