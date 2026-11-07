import type { ClubList } from '../shared/api.ts';
import type { World } from '../shared/types.ts';
import { ageOn } from '../shared/date.ts';
import { expectedPosition, OBJECTIVE_LABEL, objectiveFor } from '../game/board-engine/board.ts';
import { clubStory } from '../game/world/clubStory.ts';
import { clubCoach } from '../game/coach-engine/worldCoaches.ts';
import type { WorldCoach } from '../shared/types.ts';

/** Clubes e países do universo (a base fixa, na tela de nova carreira), com o resumo do painel do clube. */
export function listClubs(w: World, origin?: ReadonlyMap<string, { created: string | null; edited: string[] }>): ClubList {
  const league = new Map(w.leagues.map((l) => [l.id, l]));
  const country = new Map(w.countries.map((c) => [c.id, c.name]));
  const stadium = new Map(w.stadiums.map((s) => [s.id, s]));
  const code = new Map(w.countries.map((c) => [c.id, c.code]));
  const coachOf = new Map<string, WorldCoach>((w.coaches ?? []).filter((k) => k.clubId).map((k) => [k.clubId!, k]));
  const squads = new Map<string, World['players']>();
  for (const p of w.players) if (p.clubId) squads.set(p.clubId, [...(squads.get(p.clubId) ?? []), p]);
  const repsByLeague = new Map<string, number[]>();
  for (const c of w.clubs) repsByLeague.set(c.leagueId, [...(repsByLeague.get(c.leagueId) ?? []), c.reputation]);
  // rival: o clube mais forte da mesma cidade (no mesmo país); sem vizinho, o de reputação mais próxima na mesma liga
  const rivalOf = (c: World['clubs'][number]) =>
    w.clubs.filter((x) => x.id !== c.id && x.countryId === c.countryId && x.city === c.city).sort((a, b) => b.reputation - a.reputation)[0]
    ?? w.clubs.filter((x) => x.id !== c.id && x.leagueId === c.leagueId).sort((a, b) => Math.abs(a.reputation - c.reputation) - Math.abs(b.reputation - c.reputation) || a.id.localeCompare(b.id))[0];
  return {
    startDate: w.startDate,
    countries: w.countries.map((c) => ({
      id: c.id, code: c.code, name: c.name, seasonStart: c.seasonStart ?? '07-01',
      divisions: w.leagues.filter((l) => l.countryId === c.id).length, clubs: w.clubs.filter((x) => x.countryId === c.id).length,
      leagues: w.leagues.filter((l) => l.countryId === c.id).sort((a, b) => a.tier - b.tier).map((l) => ({ id: l.id, name: l.name, tier: l.tier, clubs: w.clubs.filter((x) => x.leagueId === l.id).length })),
    })),
    clubs: w.clubs.map((c) => {
      const l = league.get(c.leagueId)!, st = stadium.get(c.stadiumId)!, squad = squads.get(c.id) ?? [];
      const reps = repsByLeague.get(c.leagueId)!;
      const expected = expectedPosition(c.reputation, reps);
      const obj = objectiveFor(expected, reps.length, l.rules);
      return {
        id: c.id, countryId: c.countryId, leagueId: c.leagueId, name: c.name, league: l.name, leagueTier: l.tier, country: country.get(c.countryId) ?? '?',
        reputation: c.reputation, avgOverall: Math.round((squad.reduce((s, p) => s + p.overall, 0) / Math.max(1, squad.length)) * 10) / 10,
        stadium: st.name, stadiumId: st.id, capacity: st.capacity, city: c.city, fans: c.fans, balance: c.balance, facilities: { ...c.facilities },
        objective: OBJECTIVE_LABEL[obj.objective], expectedPosition: expected, teamCount: reps.length,
        squadSize: squad.length, avgAge: Math.round((squad.reduce((s, p) => s + ageOn(p.birthDate, w.startDate), 0) / Math.max(1, squad.length)) * 10) / 10,
        stars: [...squad].sort((a, b) => b.overall - a.overall).slice(0, 3).map((p) => ({ name: `${p.firstName} ${p.lastName}`, position: p.position, overall: p.overall })),
        origin: { created: origin?.get(c.id)?.created ?? null, edited: [...(origin?.get(c.id)?.edited ?? [])] },
        coach: (() => { const k = coachOf.get(c.id) ?? clubCoach({ id: c.id, reputation: c.reputation, countryCode: code.get(c.countryId) ?? 'BRA' }, w.startDate); return { id: k.id, name: `${k.firstName} ${k.lastName}`, nationality: k.nationality, age: ageOn(k.birthDate, w.startDate), reputation: k.reputation }; })(),
        story: clubStory({ id: c.id, name: c.name, city: c.city, country: country.get(c.countryId) ?? '', league: l.name, tier: l.tier, stadium: st.name, capacity: st.capacity, fans: c.fans, reputation: c.reputation, rival: rivalOf(c)?.name ?? null }),
      };
    }),
  };
}
