/**
 * Temporada corrente de cada país (Fase 9). Cada país tem a sua (jul–jun ou ano civil) e vira na sua data; o treinador segue a
 * temporada do país do seu clube (desempregado: a do último clube). Ver game/career-engine/calendar.ts.
 */
import type { SqlDb } from '../types.ts';
import { seasonBounds, seasonLabelFor, type SeasonStart } from '../../game/career-engine/calendar.ts';
import { seasonYearOf } from '../../game/career-engine/contracts.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);

export interface CountrySeason { countryId: string; season: number; starts: string; turnover: string; transition: boolean; start: SeasonStart; label: string }

/** Competição da temporada corrente do seu país (fragmento SQL; a tabela de competições precisa do apelido `c`). */
export const CURRENT_COMP = '(c.season = (SELECT cs.season FROM country_seasons cs WHERE cs.country_id = c.country_id))';

const rowTo = (r: Record<string, unknown>): CountrySeason => {
  const start = S(r.season_start) as SeasonStart, transition = N(r.transition) === 1;
  // transição: rotulada pelo ano em que é disputada (jan–jun/2026 de um país de julho pertence à numeração 2025)
  return { countryId: S(r.country_id), season: N(r.season), starts: S(r.starts), turnover: S(r.turnover), transition, start, label: seasonLabelFor(transition ? N(S(r.starts).slice(0, 4)) : N(r.season), start, transition) };
};

/**
 * Cria a temporada corrente dos países que ainda não têm (carreira nova ou save anterior). Um país cujo calendário ainda não começou na
 * data de início do universo fica parado até a sua virada (`transition = 1`, sem jogos); em saves antigos, todos seguem a temporada do
 * treinador. NÃO abre transação.
 */
export function ensureCountrySeasons(db: SqlDb): void {
  const career = db.prepare('SELECT season, game_date, club_id, season_country FROM career WHERE id = 1').get();
  if (!career) return;
  const legacy = N(db.prepare("SELECT COUNT(*) AS n FROM competitions WHERE kind = 'league'").get()!.n) > 0
    && !db.prepare('SELECT 1 AS x FROM country_seasons LIMIT 1').get(); // save anterior à temporada por país: calendário já criado em julho
  const ins = db.prepare('INSERT OR IGNORE INTO country_seasons (country_id, season, starts, turnover, transition) VALUES (?,?,?,?,?)');
  for (const c of db.prepare('SELECT id, season_start FROM countries ORDER BY rowid').all()) {
    const start = (legacy ? '07-01' : S(c.season_start)) as SeasonStart;
    if (legacy && S(c.season_start) !== '07-01') db.prepare("UPDATE countries SET season_start = '07-01' WHERE id = ?").run(S(c.id));
    const season = N(career.season), date = S(career.game_date);
    if (start === '07-01') {
      // julho: universo começando em janeiro (carreira em clube de julho) → parado até 1º/jul
      if (date.slice(5) < '07-01') { ins.run(S(c.id), seasonYearOf(date), date, `${date.slice(0, 4)}-07-01`, 1); continue; }
      const b = seasonBounds(season, start); ins.run(S(c.id), season, b.starts, b.turnover, 0); continue;
    }
    // ano civil: universo começando em julho (carreira em clube de ano civil) → parado até 1º/jan
    if (date.slice(5) >= '07-01') ins.run(S(c.id), seasonYearOf(date), date, `${Number(date.slice(0, 4)) + 1}-01-01`, 1);
    else { const y = Number(date.slice(0, 4)), b = seasonBounds(y, start); ins.run(S(c.id), y, b.starts, b.turnover, 0); }
  }
  if (career.season_country == null && career.club_id != null && S(career.club_id) !== '') {
    db.prepare('UPDATE career SET season_country = (SELECT country_id FROM clubs WHERE id = ?) WHERE id = 1').run(S(career.club_id));
  }
}

export function countrySeason(db: SqlDb, countryId: string): CountrySeason {
  const r = db.prepare('SELECT cs.*, co.season_start FROM country_seasons cs JOIN countries co ON co.id = cs.country_id WHERE cs.country_id = ?').get(countryId);
  if (!r) throw new Error(`País sem temporada corrente: ${countryId}.`);
  return rowTo(r);
}
export function allCountrySeasons(db: SqlDb): CountrySeason[] {
  return db.prepare('SELECT cs.*, co.season_start FROM country_seasons cs JOIN countries co ON co.id = cs.country_id ORDER BY co.rowid').all().map(rowTo);
}

/** País cuja temporada o treinador segue (o do clube; desempregado: o do último clube; sem nenhum: o primeiro país). */
export function userCountry(db: SqlDb): string {
  const r = db.prepare('SELECT c.club_id, c.season_country, cl.country_id FROM career c LEFT JOIN clubs cl ON cl.id = c.club_id WHERE c.id = 1').get();
  if (r?.country_id != null) return S(r.country_id);
  if (r?.season_country != null) return S(r.season_country);
  return S(db.prepare('SELECT id FROM countries ORDER BY rowid LIMIT 1').get()!.id);
}
/** Temporada do treinador (a do seu país). */
export const userSeason = (db: SqlDb): CountrySeason => countrySeason(db, userCountry(db));

/** Passa o país para a temporada seguinte (a transição vira a 1ª temporada normal). NÃO abre transação. */
export function advanceCountrySeason(db: SqlDb, countryId: string): CountrySeason {
  const cur = countrySeason(db, countryId);
  const next = cur.transition ? Number(cur.turnover.slice(0, 4)) : cur.season + 1;
  const b = seasonBounds(next, cur.start);
  db.prepare('UPDATE country_seasons SET season = ?, starts = ?, turnover = ?, transition = 0 WHERE country_id = ?').run(next, b.starts, b.turnover, countryId);
  return countrySeason(db, countryId);
}

/** O treinador passou a seguir outro país (troca de clube): a temporada dele é a desse país. NÃO abre transação. */
export function followCountry(db: SqlDb, countryId: string): void {
  const cs = countrySeason(db, countryId);
  db.prepare('UPDATE career SET season_country = ?, season = ? WHERE id = 1').run(countryId, cs.season);
}

/** Calendário (jul–jun ou ano civil) do país do clube: define o fim dos contratos assinados com ele. */
export function clubSeasonStart(db: SqlDb, clubId: string): SeasonStart {
  const r = db.prepare('SELECT co.season_start AS s FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id = ?').get(clubId);
  return r && S(r.s) === '01-01' ? '01-01' : '07-01';
}
