/**
 * Exporta um universo como pacote de dados completo ("base": "none"): todos os campos, inclusive os internos do motor, para que
 * montar o universo a partir do pacote reproduza exatamente o original. Serve de ponto de partida para quem cria patches.
 */
import type { World } from '../../shared/types.ts';
import { PACK_FORMAT, type Pack, type PackManifest } from './format.ts';

export function exportUniverse(world: World, manifest: Partial<PackManifest> = {}): Pack {
  return {
    manifest: { format: PACK_FORMAT, id: manifest.id ?? 'base', name: manifest.name ?? `Base gerada (semente ${world.seed})`, version: manifest.version ?? '1.0.0', ...manifest, base: 'none' },
    data: {
      countries: world.countries.map((c) => ({ id: c.id, code: c.code, name: c.name, economy: c.economy })),
      leagues: world.leagues.map((l) => {
        const { tiebreakers: _t, calendar, ...rules } = l.rules;
        return { id: l.id, country: l.countryId, name: l.name, tier: l.tier, rules: { ...rules, ...(calendar ? { calendar } : {}) } };
      }),
      stadiums: world.stadiums.map((s) => ({ id: s.id, name: s.name, city: s.city, capacity: s.capacity })),
      clubs: world.clubs.map((c) => ({
        id: c.id, name: c.name, shortName: c.shortName, country: c.countryId, league: c.leagueId, city: c.city, stadium: c.stadiumId,
        reputation: c.reputation, balance: c.balance, fans: c.fans, facilities: { ...c.facilities },
      })),
      players: world.players.map((p) => ({
        id: p.id, firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate, nationality: p.nationality, extraNationalities: p.extraNationalities,
        club: p.clubId, position: p.position, secondaryPositions: p.secondaryPositions, foot: p.foot, heightCm: p.heightCm, weightKg: p.weightKg,
        attributes: { technical: { ...p.attributes.technical }, mental: { ...p.attributes.mental }, physical: { ...p.attributes.physical } },
        personality: { ...p.personality }, contract: { salary: p.salary, end: p.contractEnd }, marketValue: p.marketValue,
        internal: { potentialHidden: p.potentialHidden, potentialEstimated: p.potentialEstimated, condition: p.condition, fatigue: p.fatigue, morale: p.morale, form: p.form },
      })),
    },
  };
}
