import { generateWorld } from '../game/world/generator.ts';
import type { ClubList } from '../shared/api.ts';

export function listClubs(seed: string): ClubList {
  const w = generateWorld({ seed });
  const league = new Map(w.leagues.map((l) => [l.id, l]));
  const country = new Map(w.countries.map((c) => [c.id, c.name]));
  const stadium = new Map(w.stadiums.map((s) => [s.id, s]));
  const agg = new Map<string, { sum: number; n: number }>();
  for (const p of w.players) {
    if (!p.clubId) continue;
    const a = agg.get(p.clubId) ?? { sum: 0, n: 0 };
    a.sum += p.overall; a.n++; agg.set(p.clubId, a);
  }
  return {
    seed, startDate: w.startDate,
    countries: w.countries.map((c) => ({ code: c.code, name: c.name })),
    clubs: w.clubs.map((c) => {
      const l = league.get(c.leagueId)!, st = stadium.get(c.stadiumId)!, a = agg.get(c.id)!;
      return {
        id: c.id, name: c.name, league: l.name, leagueTier: l.tier, country: country.get(c.countryId) ?? '?',
        reputation: c.reputation, avgOverall: Math.round((a.sum / a.n) * 10) / 10, stadium: st.name, capacity: st.capacity,
      };
    }),
  };
}
