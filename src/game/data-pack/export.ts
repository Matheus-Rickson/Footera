/**
 * Exporta um universo como pacote de dados completo ("base": "none"): todos os campos, inclusive os internos do motor, para que
 * montar o universo a partir do pacote reproduza exatamente o original. Serve de ponto de partida para quem cria patches.
 * As funções por entidade também alimentam o editor de dados (registro completo de uma entidade, no formato do pacote).
 */
import type { Club, Country, League, Player, Stadium, World, WorldCoach } from '../../shared/types.ts';
import { PACK_FORMAT, type CoachRec, type ClubRec, type CountryRec, type LeagueRec, type Pack, type PackManifest, type PlayerRec, type StadiumRec } from './format.ts';

export const countryRec = (c: Country): CountryRec => ({ id: c.id, code: c.code, name: c.name, economy: c.economy });
export function leagueRec(l: League): LeagueRec {
  const { tiebreakers: _t, calendar, ...rules } = l.rules;
  return { id: l.id, country: l.countryId, name: l.name, tier: l.tier, rules: { ...rules, ...(calendar ? { calendar } : {}) } };
}
export const stadiumRec = (s: Stadium): StadiumRec => ({ id: s.id, name: s.name, city: s.city, capacity: s.capacity });
export const clubRec = (c: Club): ClubRec => ({
  id: c.id, name: c.name, shortName: c.shortName, country: c.countryId, league: c.leagueId, city: c.city, stadium: c.stadiumId,
  reputation: c.reputation, balance: c.balance, fans: c.fans, facilities: { ...c.facilities },
});
/** `internal`: inclui os valores do motor (exportação exata); o editor usa sem eles. */
export function playerRec(p: Player, internal = true): PlayerRec {
  return {
    id: p.id, firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate, nationality: p.nationality, extraNationalities: [...p.extraNationalities],
    club: p.clubId, position: p.position, secondaryPositions: [...p.secondaryPositions], foot: p.foot, heightCm: p.heightCm, weightKg: p.weightKg,
    attributes: { technical: { ...p.attributes.technical }, mental: { ...p.attributes.mental }, physical: { ...p.attributes.physical }, ...(p.attributes.goalkeeper ? { goalkeeper: { ...p.attributes.goalkeeper } } : {}) },
    personality: { ...p.personality }, contract: { salary: p.salary, end: p.contractEnd }, marketValue: p.marketValue,
    ...(internal ? { internal: { potentialHidden: p.potentialHidden, potentialEstimated: p.potentialEstimated, condition: p.condition, fatigue: p.fatigue, morale: p.morale, form: p.form } } : {}),
  };
}

export const coachRec = (k: WorldCoach): CoachRec => ({
  id: k.id, firstName: k.firstName, lastName: k.lastName, birthDate: k.birthDate, nationality: k.nationality, club: k.clubId,
  reputation: k.reputation, methodology: k.methodology, attributes: { ...k.attributes },
});

export function exportUniverse(world: World, manifest: Partial<PackManifest> = {}): Pack {
  return {
    manifest: { format: PACK_FORMAT, id: manifest.id ?? 'base', name: manifest.name ?? `Base gerada (semente ${world.seed})`, version: manifest.version ?? '1.0.0', ...manifest, base: 'none' },
    data: {
      countries: world.countries.map(countryRec),
      leagues: world.leagues.map(leagueRec),
      stadiums: world.stadiums.map(stadiumRec),
      clubs: world.clubs.map(clubRec),
      players: world.players.map((p) => playerRec(p)),
      coaches: (world.coaches ?? []).map(coachRec),
    },
  };
}
