import type { LeagueCalendar } from '../../shared/types.ts';
import { addDays, nextWeekdayOnOrAfter } from '../../shared/date.ts';
import type { Rng } from '../rng.ts';
import { generateRounds } from './roundRobin.ts';

export const DEFAULT_CALENDAR: LeagueCalendar = { seasonStart: '08-01', matchWeekday: 6, intervalDays: 7 };

export interface ScheduledMatch { round: number; date: string; home: string; away: string }

export function firstMatchday(year: number, cal: LeagueCalendar): string {
  return nextWeekdayOnOrAfter(`${year}-${cal.seasonStart}`, cal.matchWeekday);
}

export function scheduleLeague(teamIds: readonly string[], legs: number, year: number, cal: LeagueCalendar, rng: Rng): ScheduledMatch[] {
  if (cal.intervalDays < 1) throw new Error('intervalDays deve ser >= 1');
  const start = firstMatchday(year, cal);
  const out: ScheduledMatch[] = [];
  for (const r of generateRounds(teamIds, legs, rng)) {
    const date = addDays(start, (r.round - 1) * cal.intervalDays);
    for (const m of r.matches) out.push({ round: r.round, date, home: m.home, away: m.away });
  }
  return out;
}
