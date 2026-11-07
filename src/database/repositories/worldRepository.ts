import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import type { World, Club, League, Player, Stadium, Country, WorldCup } from '../../shared/types.ts';
import { withGoalkeeper } from '../../game/world/goalkeeper.ts';
import { defaultCups } from '../../game/cup-engine/catalog.ts';

export function saveWorld(db: SqlDb, w: World): void {
  withTransaction(db, () => {
    const set = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    set.run('world_seed', w.seed);
    set.run('position_set', 'v3'); // universo com meias abertos (ME/MD), alas (AE/AD), segundo atacante (SA) e centroavante (CA): a base também os gera
    set.run('world_start_date', w.startDate);

    // season_start vem da migração 19 (testes de migração gravam o mundo num banco mais antigo)
    const hasStart = db.prepare('PRAGMA table_info(countries)').all().some((r) => String(r.name) === 'season_start');
    const insCountry = db.prepare(hasStart ? 'INSERT INTO countries (id, code, name, economy, season_start) VALUES (?, ?, ?, ?, ?)' : 'INSERT INTO countries (id, code, name, economy) VALUES (?, ?, ?, ?)');
    for (const c of w.countries) insCountry.run(...[c.id, c.code, c.name, c.economy, ...(hasStart ? [c.seasonStart ?? '07-01'] : [])]);

    const insLeague = db.prepare('INSERT INTO leagues (id, country_id, name, tier, team_count, rules_json) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of w.leagues) insLeague.run(l.id, l.countryId, l.name, l.tier, l.teamCount, JSON.stringify(l.rules));

    const insStadium = db.prepare('INSERT INTO stadiums (id, name, city, capacity) VALUES (?, ?, ?, ?)');
    for (const s of w.stadiums) insStadium.run(s.id, s.name, s.city, s.capacity);

    const insClub = db.prepare(
      'INSERT INTO clubs (id, name, short_name, country_id, city, league_id, stadium_id, reputation, balance, fans, facilities_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const c of w.clubs) {
      insClub.run(c.id, c.name, c.shortName, c.countryId, c.city, c.leagueId, c.stadiumId, c.reputation, c.balance, c.fans, JSON.stringify(c.facilities));
    }

    const insPlayer = playerInserter(db);
    for (const p of w.players) insPlayer(p);

    // copas e supercopas do universo (editáveis no editor de dados); a criação de cada edição lê daqui (migração 19)
    if (db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'cup_formats'").get()) {
      const insCup = db.prepare('INSERT INTO cup_formats (id, country_id, kind, format_json) VALUES (?, ?, ?, ?)');
      for (const k of w.cups ?? defaultCups(w.countries)) insCup.run(k.id, k.countryId, k.kind, JSON.stringify(k));
    }
  });
}

/** Insere jogadores (universo inicial e jovens da base). NÃO abre transação. */
export function playerInserter(db: SqlDb): (p: Player) => void {
  const ins = db.prepare(
    `INSERT INTO players (id, club_id, first_name, last_name, birth_date, nationality, extra_nationalities_json, position,
      secondary_positions_json, foot, height_cm, weight_kg, attributes_json, personality_json, potential_estimated,
      potential_hidden, condition_pct, fatigue, morale, form, market_value, salary, contract_end, overall, season_start_overall)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  return (p) => {
    ins.run(p.id, p.clubId, p.firstName, p.lastName, p.birthDate, p.nationality, JSON.stringify(p.extraNationalities),
      p.position, JSON.stringify(p.secondaryPositions), p.foot, p.heightCm, p.weightKg, JSON.stringify(p.attributes),
      JSON.stringify(p.personality), p.potentialEstimated, p.potentialHidden, p.condition, p.fatigue, p.morale, p.form,
      p.marketValue, p.salary, p.contractEnd, p.overall, p.overall);
  };
}

const s = (v: unknown) => String(v);
const n = (v: unknown) => Number(v);

export function loadWorld(db: SqlDb): World {
  const meta = (k: string) => {
    const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(k);
    if (!r) throw new Error(`Metadado ausente: ${k}`);
    return s(r.value);
  };
  const countries: Country[] = db.prepare('SELECT * FROM countries ORDER BY rowid').all()
    .map((r) => ({ id: s(r.id), code: s(r.code), name: s(r.name), economy: n(r.economy), ...(r.season_start === '01-01' ? { seasonStart: '01-01' as const } : {}) }));
  const leagues: League[] = db.prepare('SELECT * FROM leagues ORDER BY rowid').all().map((r) => ({
    id: s(r.id), countryId: s(r.country_id), name: s(r.name), tier: n(r.tier), teamCount: n(r.team_count),
    rules: JSON.parse(s(r.rules_json)),
  }));
  const stadiums: Stadium[] = db.prepare('SELECT * FROM stadiums ORDER BY rowid').all()
    .map((r) => ({ id: s(r.id), name: s(r.name), city: s(r.city), capacity: n(r.capacity) }));
  const clubs: Club[] = db.prepare('SELECT * FROM clubs ORDER BY rowid').all().map((r) => ({
    id: s(r.id), name: s(r.name), shortName: s(r.short_name), countryId: s(r.country_id), city: s(r.city),
    leagueId: s(r.league_id), stadiumId: s(r.stadium_id), reputation: n(r.reputation), balance: n(r.balance),
    fans: n(r.fans), facilities: JSON.parse(s(r.facilities_json)),
  }));
  const players: Player[] = db.prepare('SELECT * FROM players ORDER BY rowid').all().map(rowToPlayer);
  // copas e supercopas gravadas (saves anteriores ao editor de copas não têm: ficam de fora, e a criação usa as padrão)
  const hasCups = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'cup_formats'").get();
  const cups = hasCups ? db.prepare('SELECT format_json FROM cup_formats ORDER BY rowid').all().map((r) => JSON.parse(s(r.format_json)) as WorldCup) : [];
  return { seed: meta('world_seed'), startDate: meta('world_start_date'), countries, leagues, stadiums, clubs, players, ...(cups.length ? { cups } : {}) };
}

export function rowToPlayer(r: Record<string, unknown>): Player {
  return {
    id: s(r.id), clubId: r.club_id == null ? null : s(r.club_id), firstName: s(r.first_name), lastName: s(r.last_name),
    birthDate: s(r.birth_date), nationality: s(r.nationality), extraNationalities: JSON.parse(s(r.extra_nationalities_json)),
    position: s(r.position) as Player['position'], secondaryPositions: JSON.parse(s(r.secondary_positions_json)),
    foot: s(r.foot) as Player['foot'], heightCm: n(r.height_cm), weightKg: n(r.weight_kg),
    attributes: withGoalkeeper(JSON.parse(s(r.attributes_json)), s(r.id)), personality: JSON.parse(s(r.personality_json)),
    potentialEstimated: n(r.potential_estimated), potentialHidden: n(r.potential_hidden), condition: n(r.condition_pct),
    fatigue: n(r.fatigue), morale: n(r.morale), form: n(r.form), marketValue: n(r.market_value), salary: n(r.salary),
    contractEnd: s(r.contract_end), overall: n(r.overall),
  };
}
