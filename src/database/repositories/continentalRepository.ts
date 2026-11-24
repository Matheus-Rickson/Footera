/**
 * Continentais da CONMEBOL no banco (v0.8.13, docs/CONTINENTAIS.md): ranking de clubes, vagas por país, criação da Libertadores, da
 * Sul-Americana e da Recopa da temporada, datas no calendário (terça a quinta das semanas do anexo; finais em sede neutra), remarcação
 * dos jogos nacionais que caem a 1 dia ou menos de um jogo continental, premiação (regra 1: tudo por `makePoster`) e encerramento
 * (troféu, `continental_results`, notícias). Regras puras em game/continental-engine. NÃO abre transação.
 */
import type { SqlDb } from '../types.ts';
import type { ConmebolRankingDto } from '../../shared/api.ts';
import { addDays, daysBetween, weekday } from '../../shared/date.ts';
import { finalRanking, outcomes, resolveRef, stageComplete, stageOf, stageTables, tieOutcome, type FormatDef, type FormatState, type Fixture } from '../../game/format-engine/engine.ts';
import { LIB_ID, LIB_SEEDS, LIB_TO_SUD, libertadores, RECOPA_ID, recopa, SUD_ID, SUD_SEEDS, sulAmericana } from '../../game/continental-engine/formats.ts';
import { CONMEBOL_COUNTRY_CODES, countryOrder, distributeQualifiers } from '../../game/continental-engine/slots.ts';
import { historyPoints, rankingPoints, rankOrder, REACH_ORDER, type EditionRow, type ReachStage } from '../../game/continental-engine/ranking.ts';
import { conmebolFirstDate, conmebolStageDates, conmebolWeeks, pickMatchDay } from '../../game/continental-engine/calendar.ts';
import { finalPrizes, groupMatchPrize, stageEntryPrize, usdToEur, PRIZES_USD } from '../../game/continental-engine/prizes.ts';
import type { PresetContext } from '../../game/continental-engine/preset.ts';
import { createFormatCompetition, formatOutcomesOf, formatStateOf, type FormatMeta } from './formatRepository.ts';
import { previousChampions } from './cupRepository.ts';
import { makePoster } from './financeRepository.ts';
import { addNews } from './newsRepository.ts';
import { paySponsorBonuses } from './sponsorRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const CODES_SQL = CONMEBOL_COUNTRY_CODES.map((c) => `'${c}'`).join(', ');
export const CONFEDERATION = 'CONMEBOL';
/** suspensão por acúmulo: 3 amarelos (LIB/SUD 3.8.2); o acúmulo até as quartas zera nas semifinais */
export const CONMEBOL_YELLOW_LIMIT = 3;
const PREFIX: Record<string, string> = { [LIB_ID]: 'lib', [SUD_ID]: 'sud', [RECOPA_ID]: 'rec' };
export const continentalCompId = (formatId: string, season: number) => `${PREFIX[formatId]}_${season}`;

const userClubOf = (db: SqlDb): string => S(db.prepare('SELECT club_id FROM career WHERE id = 1').get()?.club_id ?? '');
const gameDateOf = (db: SqlDb, season: number): string => S(db.prepare('SELECT game_date FROM career WHERE id = 1').get()?.game_date ?? `${season}-01-01`);
const nameOf = (db: SqlDb, id: string) => S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)?.name ?? '?');

/** País (código) de cada clube dos países da CONMEBOL. */
export function conmebolCountryOf(db: SqlDb, ids?: readonly string[]): Map<string, string> {
  const rows = ids?.length
    ? db.prepare(`SELECT cl.id, co.code FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE cl.id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : db.prepare(`SELECT cl.id, co.code FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE co.code IN (${CODES_SQL})`).all();
  return new Map(rows.map((r) => [S(r.id), S(r.code)]));
}

// ---------------------------------------------------------------- ranking

/** Grava o "ano histórico" inicial (ADAPT) dos clubes da CONMEBOL que ainda não têm: pela reputação, valendo na temporada `season`. */
export function ensureContinentalHistory(db: SqlDb, season: number): void {
  db.prepare(`INSERT OR IGNORE INTO continental_history (club_id, season, points)
    SELECT cl.id, ?, 0 FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE co.code IN (${CODES_SQL})`).run(season);
  const up = db.prepare('UPDATE continental_history SET points = ? WHERE club_id = ?');
  for (const r of db.prepare(`SELECT h.club_id, cl.reputation FROM continental_history h JOIN clubs cl ON cl.id = h.club_id WHERE h.points = 0 AND h.season = ?`).all(season)) up.run(historyPoints(N(r.reputation)), S(r.club_id));
}

export interface RankingRow { id: string; points: number; reputation: number; country: string }

/** Ranking de Clubes CONMEBOL ao fim da temporada `asOf` (derivado: `continental_results`, títulos nacionais e o ano histórico). */
export function conmebolRanking(db: SqlDb, asOf: number): RankingRow[] {
  const clubs = db.prepare(`SELECT cl.id, cl.reputation, co.code FROM clubs cl JOIN countries co ON co.id = cl.country_id WHERE co.code IN (${CODES_SQL})`).all();
  const rows = new Map<string, EditionRow[]>();
  for (const r of db.prepare('SELECT season, club_id, comp, stage, prelim, groups, wins, draws FROM continental_results WHERE season <= ?').all(asOf)) {
    const l = rows.get(S(r.club_id)) ?? [];
    l.push({ season: N(r.season), comp: S(r.comp) as 'lib' | 'sud', stage: S(r.stage) as ReachStage, prelim: N(r.prelim) === 1, groups: N(r.groups) === 1, wins: N(r.wins), draws: N(r.draws) });
    rows.set(S(r.club_id), l);
  }
  const titles = new Map<string, number[]>();
  for (const r of db.prepare(`SELECT t.club_id, t.season FROM trophies t JOIN competitions c ON c.id = t.competition_id JOIN leagues l ON l.id = c.league_id
      JOIN countries co ON co.id = c.country_id WHERE c.kind = 'league' AND l.tier = 1 AND co.code IN (${CODES_SQL})`).all()) {
    titles.set(S(r.club_id), [...(titles.get(S(r.club_id)) ?? []), N(r.season)]);
  }
  const hist = new Map(db.prepare('SELECT club_id, season, points FROM continental_history').all().map((r) => [S(r.club_id), { season: N(r.season), points: N(r.points) }]));
  const out = clubs.map((c) => ({ id: S(c.id), reputation: N(c.reputation), country: S(c.code),
    points: rankingPoints(rows.get(S(c.id)) ?? [], titles.get(S(c.id)) ?? [], hist.get(S(c.id)) ?? null, asOf) }));
  const order = new Map(rankOrder(out).map((id, i) => [id, i]));
  return out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** Ranking vigente para a tela: o da temporada atual da CONMEBOL (ao fim da anterior), top 50 e a posição do clube do usuário. */
export function getConmebolRanking(db: SqlDb): ConmebolRankingDto {
  const season = conmebolSeason(db) ?? N(db.prepare(`SELECT MAX(cs.season) AS s FROM country_seasons cs JOIN countries co ON co.id = cs.country_id WHERE co.code IN (${CODES_SQL})`).get()?.s ?? 0);
  const all = conmebolRanking(db, season - 1);
  const user = userClubOf(db);
  const names = new Map(db.prepare(`SELECT code, name FROM countries WHERE code IN (${CODES_SQL})`).all().map((r) => [S(r.code), S(r.name)]));
  const row = (r: RankingRow, i: number) => ({ position: i + 1, clubId: r.id, clubName: nameOf(db, r.id), countryCode: r.country, country: names.get(r.country) ?? r.country, points: r.points, isUserClub: r.id === user });
  const ui = all.findIndex((r) => r.id === user);
  return { asOf: season - 1, season, total: all.length, rows: all.slice(0, 50).map(row), user: ui < 0 ? null : { position: ui + 1, points: all[ui]!.points } };
}

// ---------------------------------------------------------------- vagas e criação

/**
 * Ordem de cada país da CONMEBOL para a temporada `season` (ADAPT): classificação final da 1ª divisão na temporada anterior (sem ela, a
 * 1ª divisão atual pela reputação), com o campeão da copa nacional depois do G4; depois os demais clubes do país (divisão, reputação).
 */
export function conmebolOrders(db: SqlDb, season: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const co of db.prepare(`SELECT id, code FROM countries WHERE code IN (${CODES_SQL})`).all()) {
    const countryId = S(co.id);
    const prev = db.prepare(`SELECT c.id FROM competitions c JOIN leagues l ON l.id = c.league_id WHERE c.kind = 'league' AND c.country_id = ? AND c.season = ? AND l.tier = 1 LIMIT 1`).get(countryId, season - 1);
    let league = prev ? db.prepare('SELECT club_id FROM season_results WHERE competition_id = ? ORDER BY position').all(S(prev.id)).map((r) => S(r.club_id)) : [];
    if (!league.length) league = db.prepare(`SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.country_id = ? AND l.active = 1 AND l.tier = 1 ORDER BY c.reputation DESC, c.id`).all(countryId).map((r) => S(r.id));
    const cup = ['BRA', 'ARG'].includes(S(co.code)) ? previousChampions(db, countryId, season).cupWinner : null;
    const rest = db.prepare(`SELECT c.id FROM clubs c JOIN leagues l ON l.id = c.league_id WHERE c.country_id = ? AND l.active = 1 ORDER BY l.tier, c.reputation DESC, c.id`).all(countryId).map((r) => S(r.id));
    out[S(co.code)] = countryOrder(league, cup, rest);
  }
  return out;
}

/** Temporada atual comum aos países da CONMEBOL (null se faltar algum país, algum estiver na transição ou estiverem em temporadas diferentes). */
export function conmebolSeason(db: SqlDb): number | null {
  const rows = db.prepare(`SELECT cs.season, cs.transition FROM country_seasons cs JOIN countries co ON co.id = cs.country_id WHERE co.code IN (${CODES_SQL})`).all();
  if (rows.length !== CONMEBOL_COUNTRY_CODES.length || rows.some((r) => N(r.transition) === 1)) return null;
  const seasons = new Set(rows.map((r) => N(r.season)));
  return seasons.size === 1 ? [...seasons][0]! : null;
}

/**
 * Cria a Libertadores, a Sul-Americana e (com campeões do ano anterior) a Recopa da temporada da CONMEBOL, se ainda não existem e se ainda
 * há tempo antes da 1ª data (fase 1 da Libertadores). Chamado antes das copas nacionais na criação da temporada e ao abrir saves antigos.
 * Devolve se criou. Idempotente.
 */
export function ensureContinentals(db: SqlDb): boolean {
  const season = conmebolSeason(db);
  if (season === null) return false;
  const libId = continentalCompId(LIB_ID, season);
  if (db.prepare('SELECT 1 AS x FROM competitions WHERE id = ?').get(libId)) return false;
  const first = conmebolFirstDate(season);
  if (gameDateOf(db, season) >= addDays(first, -1)) return false; // tarde demais: fica para a temporada seguinte (saves antigos)
  // save anterior aos continentais: as copas nacionais da temporada já foram sorteadas sem evitar as semanas da CONMEBOL — os continentais
  // ficam para a temporada seguinte, com o calendário nacional montado em volta deles (as copas novas nunca caem nessas semanas)
  const weeks = new Set(conmebolWeeks(season));
  for (const r of db.prepare(`SELECT c.format_json FROM competitions c JOIN countries co ON co.id = c.country_id WHERE c.kind = 'cup' AND c.season = ? AND co.code IN (${CODES_SQL})`).all(season)) {
    const dates = (JSON.parse(S(r.format_json)) as { dates?: string[][] }).dates ?? [];
    if (dates.flat().some((d) => weeks.has(d))) return false;
  }
  ensureContinentalHistory(db, season - 1);
  const champ = (formatId: string) => { const o = formatOutcomesOf(db, continentalCompId(formatId, season - 1)); return o?.complete ? o.champion : null; };
  const champions = { lib: champ(LIB_ID), sud: champ(SUD_ID) };
  let q: ReturnType<typeof distributeQualifiers>;
  try { q = distributeQualifiers(conmebolOrders(db, season), champions); } catch { return false; } // universo sem clubes suficientes (pacote)
  const libSeeds = [...q.lib.f1, ...q.lib.f2, ...q.lib.groups], sudSeeds = [...q.sud.p1.flat(), ...q.sud.groups];
  const ranking = conmebolRanking(db, season - 1);
  const pos = new Map(ranking.map((r, i) => [r.id, i + 1]));
  const rank = Object.fromEntries([...libSeeds, ...sudSeeds].map((id) => [id, pos.get(id) ?? 9999]));
  const base = { leagueId: null, countryId: null, kind: 'continental' as const, confederation: CONFEDERATION, season, weekday: 3, intervalDays: 7 };
  // data mínima = terça da semana (os jogos vão de terça a quinta)
  createFormatCompetition(db, { ...base, compId: libId, name: `CONMEBOL Libertadores ${season}`, def: libertadores(), seeds: libSeeds, start: addDays(first, -1),
    extra: { rank, libChampion: champions.lib, sudChampion: champions.sud } });
  createFormatCompetition(db, { ...base, compId: continentalCompId(SUD_ID, season), name: `CONMEBOL Sudamericana ${season}`, def: sulAmericana(), seeds: sudSeeds,
    start: addDays(conmebolStageDates(SUD_ID, 'p1', season)![0]!, -1), extra: { rank, libComp: libId } });
  if (champions.lib && champions.sud && champions.lib !== champions.sud) {
    createFormatCompetition(db, { ...base, compId: continentalCompId(RECOPA_ID, season), name: `CONMEBOL Recopa ${season}`, def: recopa(), seeds: [champions.lib, champions.sud],
      start: addDays(conmebolStageDates(RECOPA_ID, 'f', season)![0]!, -1), extra: { rank } });
  }
  // notícia para o clube do usuário classificado
  const user = userClubOf(db);
  if (user) {
    const date = gameDateOf(db, season);
    const phase = q.lib.f1.includes(user) ? 'a fase 1' : q.lib.f2.includes(user) ? 'a fase 2' : q.lib.groups.includes(user) ? 'a fase de grupos' : null;
    const sphase = q.sud.p1.flat().includes(user) ? 'a primeira fase' : q.sud.groups.includes(user) ? 'a fase de grupos' : null;
    if (phase) addNews(db, date, 'season', `${nameOf(db, user)} na CONMEBOL Libertadores ${season}`, `O clube disputa a CONMEBOL Libertadores ${season} a partir d${phase}.${user === champions.lib ? ' Como atual campeão, é o cabeça de chave do grupo A.' : ''}\n\nAs datas já estão no calendário. A premiação da CONMEBOL é paga em dólares, convertida para euros no extrato.`);
    else if (sphase) addNews(db, date, 'season', `${nameOf(db, user)} na CONMEBOL Sudamericana ${season}`, `O clube disputa a CONMEBOL Sudamericana ${season} a partir d${sphase}.\n\nAs datas já estão no calendário.`);
  }
  return true;
}

/** Contexto dos sorteios de uma competição continental (país, ranking e campeões gravados na criação). */
export function presetContext(db: SqlDb, meta: FormatMeta, entrants: readonly string[]): PresetContext {
  return { country: conmebolCountryOf(db, entrants), rank: meta.rank ?? {}, libChampion: meta.libChampion ?? null, sudChampion: meta.sudChampion ?? null };
}

/** Listas que a Sul-Americana recebe da Libertadores (só as já completas). */
export function externalLists(db: SqlDb, libComp: string): Record<string, string[]> {
  const lib = formatStateOf(db, libComp);
  if (!lib) return {};
  const out: Record<string, string[]> = {};
  for (const [k, refs] of Object.entries(LIB_TO_SUD)) {
    const list = refs.map((r) => resolveRef(lib.def, lib.state, r));
    if (list.every((c): c is string => !!c)) out[k] = list as string[];
  }
  return out;
}

// ---------------------------------------------------------------- datas e remarcação

/**
 * Datas dos jogos de uma fase continental: semana do anexo para cada rodada da fase, e dentro dela o dia (terça a quinta) com mais descanso
 * para os dois clubes; a final é o sábado da sede. Se a fase ficou pronta depois da semana prevista (atrasos), as semanas andam juntas.
 */
export function continentalFixtureDates(db: SqlDb, formatId: string, stageId: string, season: number, notBefore: string, fixtures: readonly Fixture[]): string[] | null {
  let weeks = conmebolStageDates(formatId, stageId, season);
  if (!weeks) return null;
  const rounds = Math.max(...fixtures.map((f) => f.round));
  if (weeks.length < rounds) return null;
  const single = stageId === 'final';
  const firstDay = (d: string) => (single ? d : addDays(d, -1));
  while (firstDay(weeks[0]!) < notBefore) weeks = weeks.map((d) => addDays(d, 7));
  const busyQ = db.prepare(`SELECT match_date FROM fixtures WHERE (home_club_id IN (?, ?) OR away_club_id IN (?, ?)) AND match_date BETWEEN ? AND ?`);
  return fixtures.map((f) => {
    const wed = weeks![f.round - 1]!;
    if (single) return wed;
    const busy = busyQ.all(f.home, f.away, f.home, f.away, addDays(wed, -8), addDays(wed, 8)).map((r) => S(r.match_date));
    return pickMatchDay(wed, busy);
  });
}

/**
 * Remarcação (ADAPT — como as federações fazem): jogo de liga ou estadual de um clube a 1 dia ou menos de um jogo continental dele vai para a
 * próxima terça a quinta em que os dois clubes estão livres (nenhum outro jogo a menos de 3 dias), antes da última data da competição; sem
 * data livre, procura para trás (a partir de amanhã). Devolve quantos jogos mudaram.
 */
export function clearClashes(db: SqlDb, fixtureIds: readonly string[]): number {
  const today = S(db.prepare('SELECT game_date FROM career WHERE id = 1').get()?.game_date ?? '0000-01-01');
  const user = userClubOf(db);
  const getF = db.prepare('SELECT id, match_date, home_club_id, away_club_id FROM fixtures WHERE id = ?');
  const clashes = db.prepare(`SELECT f.id, f.match_date, f.home_club_id, f.away_club_id, f.competition_id, c.name, c.country_id, c.season FROM fixtures f JOIN competitions c ON c.id = f.competition_id
    WHERE f.status = 'scheduled' AND c.kind IN ('league', 'state') AND (f.home_club_id = ? OR f.away_club_id = ?) AND f.match_date BETWEEN ? AND ?`);
  const near = db.prepare(`SELECT COUNT(*) AS n FROM fixtures WHERE id <> ? AND (home_club_id IN (?, ?) OR away_club_id IN (?, ?)) AND match_date BETWEEN ? AND ?`);
  const lastOf = db.prepare('SELECT MAX(match_date) AS d FROM fixtures WHERE competition_id = ?');
  const move = db.prepare('UPDATE fixtures SET match_date = ? WHERE id = ?');
  // datas planejadas das copas nacionais do país (fases ainda não sorteadas não têm jogos no banco)
  const cupCache = new Map<string, Set<string>>();
  const cupDays = (countryId: string, season: number): Set<string> => {
    const k = `${countryId}|${season}`;
    let set = cupCache.get(k);
    if (!set) {
      set = new Set<string>();
      for (const r of db.prepare("SELECT format_json FROM competitions WHERE kind = 'cup' AND country_id = ? AND season = ?").all(countryId, season)) {
        for (const d of ((JSON.parse(S(r.format_json)) as { dates?: string[][] }).dates ?? []).flat()) set.add(d);
      }
      cupCache.set(k, set);
    }
    return set;
  };
  let moved = 0;
  for (const id of fixtureIds) {
    const f = getF.get(id);
    if (!f) continue;
    const d = S(f.match_date);
    for (const club of [S(f.home_club_id), S(f.away_club_id)]) {
      for (const x of clashes.all(club, club, addDays(d, -1), addDays(d, 1))) {
        const h = S(x.home_club_id), a = S(x.away_club_id);
        // livre: terça a quinta, sem outro jogo de nenhum dos dois clubes a menos de 3 dias (o intervalo mínimo do calendário nacional)
        const cup = cupDays(S(x.country_id), N(x.season));
        const free = (day: string) => [2, 3, 4].includes(weekday(day)) && ![-2, -1, 0, 1, 2].some((k) => cup.has(addDays(day, k)))
          && N(near.get(S(x.id), h, a, h, a, addDays(day, -2), addDays(day, 2))!.n) === 0;
        const last = S(lastOf.get(S(x.competition_id))!.d);
        let target: string | null = null;
        for (let day = addDays(d, 2); day <= last && !target; day = addDays(day, 1)) if (free(day)) target = day;
        for (let day = addDays(d, -2); !target && day > today && daysBetween(day, d) <= 60; day = addDays(day, -1)) if (free(day)) target = day;
        // fim de temporada apertado (ex.: final continental num sábado de rodada): qualquer dia com 2 dias de folga para os dois clubes;
        // sem isso, o jogo vai para logo depois da última rodada (jogo adiado)
        const loose = (day: string) => N(near.get(S(x.id), h, a, h, a, addDays(day, -1), addDays(day, 1))!.n) === 0;
        for (let day = addDays(d, 2); day <= last && !target; day = addDays(day, 1)) if (loose(day)) target = day;
        for (let day = addDays(d, -2); !target && day > today && daysBetween(day, d) <= 30; day = addDays(day, -1)) if (loose(day)) target = day;
        for (let day = addDays(last, 1); !target && daysBetween(last, day) <= 14; day = addDays(day, 1)) if (loose(day)) target = day;
        if (!target) continue;
        move.run(target, S(x.id));
        moved++;
        if (user && (h === user || a === user)) {
          addNews(db, today, 'season', `Jogo remarcado: ${nameOf(db, h)} × ${nameOf(db, a)}`,
            `O jogo de ${S(x.name)} entre ${nameOf(db, h)} e ${nameOf(db, a)}, marcado para ${S(x.match_date).split('-').reverse().join('/')}, foi remarcado para ${target.split('-').reverse().join('/')} por causa do jogo continental de ${d.split('-').reverse().join('/')}.`);
        }
      }
    }
  }
  return moved;
}

/** Remarca os jogos nacionais a 1 dia ou menos de qualquer jogo continental ainda por jogar (depois de criar as ligas da temporada). */
export function sweepContinentalClashes(db: SqlDb): number {
  const ids = db.prepare("SELECT f.id FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.kind = 'continental' AND f.status = 'scheduled'").all().map((r) => S(r.id));
  return ids.length ? clearClashes(db, ids) : 0;
}

/**
 * Fase nacional montada depois dos continentais (estaduais, regionais, Séries C/D): jogo novo a 1 dia ou menos de um jogo continental de um
 * dos clubes é remarcado pela mesma regra de `clearClashes`.
 */
export function clearClashesOfNational(db: SqlDb, fixtureIds: readonly string[]): number {
  if (!fixtureIds.length) return 0;
  // jogos continentais por jogar, por clube (poucas centenas): comparados em memória — a junção por clube varria `fixtures` a cada jogo novo
  const byClub = new Map<string, Array<{ id: string; date: string }>>();
  for (const r of db.prepare("SELECT f.id, f.match_date, f.home_club_id, f.away_club_id FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.kind = 'continental' AND f.status = 'scheduled'").all()) {
    for (const club of [S(r.home_club_id), S(r.away_club_id)]) { const l = byClub.get(club) ?? []; l.push({ id: S(r.id), date: S(r.match_date) }); byClub.set(club, l); }
  }
  if (!byClub.size) return 0;
  const get = db.prepare('SELECT match_date, home_club_id, away_club_id FROM fixtures WHERE id = ?');
  const cont = new Set<string>();
  for (const id of fixtureIds) {
    const f = get.get(id);
    if (!f) continue;
    for (const club of [S(f.home_club_id), S(f.away_club_id)]) for (const c of byClub.get(club) ?? []) if (Math.abs(daysBetween(c.date, S(f.match_date))) <= 1) cont.add(c.id);
  }
  return cont.size ? clearClashes(db, [...cont]) : 0;
}

/** Clubes de um país nas competições da CONMEBOL da temporada (sementes da Libertadores e da Sul-Americana); null se ainda não existem. */
export function conmebolParticipants(db: SqlDb, countryId: string, season: number): Set<string> | null {
  const seeds: string[] = [];
  for (const f of [LIB_ID, SUD_ID]) {
    const r = db.prepare('SELECT format_json FROM competitions WHERE id = ?').get(continentalCompId(f, season));
    if (r) seeds.push(...(JSON.parse(S(r.format_json)) as FormatMeta).seeds);
  }
  if (!seeds.length) return null;
  const mine = new Set(db.prepare('SELECT id FROM clubs WHERE country_id = ?').all(countryId).map((r) => S(r.id)));
  return new Set(seeds.filter((c) => mine.has(c)));
}

// ---------------------------------------------------------------- fases, prêmios e encerramento

/**
 * Fase continental montada: prêmio de participação (regra 1), primeira fase da Sul-Americana (mandante e visitante), acúmulo de amarelos
 * zerado nas semifinais (as suspensões continuam), notícia do sorteio para o clube do usuário e remarcação dos jogos nacionais.
 */
export function continentalStageBuilt(db: SqlDb, compId: string, def: FormatDef, stageId: string, built: { groups?: string[][]; ties?: Array<{ a: string; b: string; host: string }> },
  fixtureIds: readonly string[], date: string): void {
  const user = userClubOf(db);
  const post = makePoster(db, user);
  const comp = S(db.prepare('SELECT name FROM competitions WHERE id = ?').get(compId)!.name);
  const stage = stageOf(def, stageId);
  const entrants = built.groups ? built.groups.flat() : (built.ties ?? []).flatMap((t) => [t.a, t.b]);
  const prize = stageEntryPrize(def.id, stageId);
  if (prize > 0) for (const c of entrants) post(c, date, 'prize', prize, `Premiação: ${stage.name} — ${comp}`);
  if (def.id === SUD_ID && stageId === 'p1') {
    for (const t of built.ties ?? []) {
      const away = t.host === t.a ? t.b : t.a;
      post(t.host, date, 'prize', usdToEur(PRIZES_USD[SUD_ID].p1Home), `Premiação: ${stage.name} (mandante) — ${comp}`);
      post(away, date, 'prize', usdToEur(PRIZES_USD[SUD_ID].p1Away), `Premiação: ${stage.name} (visitante) — ${comp}`);
    }
  }
  if (stageId === 'sf') db.prepare('UPDATE cup_discipline SET yellow_cards = 0 WHERE competition_id = ?').run(compId);
  clearClashes(db, fixtureIds);
  if (!user || !entrants.includes(user)) return;
  if (built.groups) {
    const gi = built.groups.findIndex((g) => g.includes(user));
    const rivals = built.groups[gi]!.filter((c) => c !== user).map((c) => nameOf(db, c));
    addNews(db, date, 'season', `${comp}: sorteio dos grupos`, `O ${nameOf(db, user)} caiu no grupo ${String.fromCharCode(65 + gi)}, com ${rivals.slice(0, -1).join(', ')} e ${rivals[rivals.length - 1]}.\n\nOs dois primeiros vão às oitavas${def.id === LIB_ID ? '; o terceiro vai ao play-off da Sul-Americana' : def.id === SUD_ID ? '; o segundo vai ao play-off das oitavas' : ''}. As datas estão no calendário.`);
  } else {
    const t = (built.ties ?? []).find((x) => x.a === user || x.b === user);
    if (t) {
      const opp = t.a === user ? t.b : t.a;
      const legs = stage.kind === 'knockout' ? stage.legs : 1;
      addNews(db, date, 'season', `${comp}: ${stage.name} contra o ${nameOf(db, opp)}`, `${stage.name} da ${comp}: ${nameOf(db, user)} × ${nameOf(db, opp)}${legs === 2 ? `, em ida e volta; ${t.host === user ? 'o clube decide em casa' : 'o adversário decide em casa'}` : stageId === 'final' ? ', jogo único em sede neutra' : ', jogo único'}.\n\nAs datas estão no calendário.`);
    }
  }
}

/** Prêmios da fase de grupos pelos jogos do dia: mandante e vitória (regra 1). */
export function payContinentalMatchday(db: SqlDb, date: string): void {
  const games = db.prepare(`SELECT f.home_club_id, f.away_club_id, f.home_goals, f.away_goals, c.name, json_extract(c.format_json, '$.formatId') AS fmt
    FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.kind = 'continental' AND f.status = 'played' AND f.match_date = ? AND f.stage = 'g'`).all(date);
  if (!games.length) return;
  const post = makePoster(db, userClubOf(db));
  for (const g of games) {
    const p = groupMatchPrize(S(g.fmt));
    if (!p) continue;
    post(S(g.home_club_id), date, 'prize', p.home, `Premiação: jogo em casa na fase de grupos — ${S(g.name)}`);
    const hg = N(g.home_goals), ag = N(g.away_goals);
    if (hg !== ag) post(hg > ag ? S(g.home_club_id) : S(g.away_club_id), date, 'prize', p.win, `Premiação: vitória na fase de grupos — ${S(g.name)}`);
  }
}

/** Até onde cada clube chegou numa edição (Libertadores ou Sul-Americana), com vitórias e empates da fase de grupos em diante. */
export function reachOf(def: FormatDef, state: FormatState): Map<string, Omit<EditionRow, 'season' | 'comp'>> {
  const out = new Map<string, Omit<EditionRow, 'season' | 'comp'>>();
  const prelimStages = def.id === LIB_ID ? ['f1', 'f2', 'f3'] : ['p1'];
  const order: Array<[string, ReachStage]> = [['g', 'groups'], ['po', 'po'], ['r16', 'r16'], ['qf', 'qf'], ['sf', 'sf'], ['final', 'runnerUp']];
  const clubsOf = (id: string) => { const st = state.stages[id]; return st?.groups?.flat() ?? st?.ties?.flatMap((t) => [t.a, t.b]) ?? []; };
  const touch = (c: string) => { let r = out.get(c); if (!r) { r = { stage: 'prelimOut', prelim: false, groups: false, wins: 0, draws: 0 }; out.set(c, r); } return r; };
  for (const id of prelimStages) for (const c of clubsOf(id)) touch(c).prelim = true;
  for (const [id, reach] of order) for (const c of clubsOf(id)) { const r = touch(c); r.stage = reach; if (id === 'g') r.groups = true; }
  const champ = outcomes(def, state).champion;
  if (champ) touch(champ).stage = 'champion';
  for (const [id] of order) {
    for (const g of state.stages[id]?.results ?? []) {
      const h = touch(g.home), a = touch(g.away);
      if (g.homeGoals === g.awayGoals) { h.draws++; a.draws++; } else if (g.homeGoals > g.awayGoals) h.wins++; else a.wins++;
    }
  }
  return out;
}

/**
 * Campanha continental do clube na temporada `season` (objetivo da diretoria, perfil do clube): a Libertadores se a disputa (mesmo que
 * tenha caído para a Sul-Americana), senão a Sul-Americana. `pot` = pote estimado na criação, pelo ranking entre os que entram direto nos
 * grupos (0 = fases preliminares). `reach` = índice em REACH_ORDER (null = ainda não estreou), `eliminated` = já caiu.
 */
export function continentalCampaign(db: SqlDb, clubId: string, season: number): { compId: string; name: string; comp: 'lib' | 'sud'; pot: number; reach: number | null; eliminated: boolean; champion: boolean; stage: string } | null {
  for (const formatId of [LIB_ID, SUD_ID]) {
    const compId = continentalCompId(formatId, season);
    const fs = formatStateOf(db, compId);
    if (!fs || !fs.state.seeds.includes(clubId)) continue; // quem cai da Libertadores para a Sul-Americana: a campanha é a da Libertadores
    const name = S(db.prepare('SELECT name FROM competitions WHERE id = ?').get(compId)?.name ?? '').replace(/\s\d{4}$/, '');
    const lib = formatId === LIB_ID;
    const direct = (lib ? fs.state.seeds.slice(LIB_SEEDS.groups[0], LIB_SEEDS.groups[1]) : fs.state.seeds.slice(SUD_SEEDS.groups[0], SUD_SEEDS.groups[1]));
    const ranked = [...direct].sort((a, b) => (fs.state.rank?.[a] ?? 9999) - (fs.state.rank?.[b] ?? 9999) || a.localeCompare(b));
    const idx = ranked.indexOf(clubId);
    const meta = JSON.parse(S(db.prepare('SELECT format_json FROM competitions WHERE id = ?').get(compId)!.format_json)) as FormatMeta;
    const pot = idx < 0 ? 0 : lib && meta.libChampion === clubId ? 1 : lib ? 1 + Math.floor(idx / 8) : idx < 8 ? 1 : 2;
    const { last, eliminated, champion } = clubStageIn(fs.def, fs.state, clubId);
    const reachMap = reachOf(fs.def, fs.state).get(clubId);
    // nas preliminares ainda vivo: 'prelimOut' (índice 0) só marca que já estreou
    const reach = last && reachMap ? REACH_ORDER.indexOf(reachMap.stage) : null;
    return { compId, name, comp: lib ? 'lib' : 'sud', pot, reach, eliminated, champion, stage: last ? stageOf(fs.def, last.id).name : '' };
  }
  return null;
}

/**
 * Fase mais avançada do clube numa competição continental (na ordem do formato), se já caiu nela (perdeu o confronto, ou terminou o grupo
 * abaixo do 2º lugar — o 3º da Libertadores segue na Sul-Americana, mas está fora da Libertadores) e se é o campeão.
 */
export function clubStageIn(def: FormatDef, state: FormatState, clubId: string): { last: { id: string; kind: 'league' | 'knockout'; tie: number } | null; eliminated: boolean; champion: boolean } {
  let last: { id: string; kind: 'league' | 'knockout'; tie: number } | null = null;
  for (const st of def.stages) {
    const s = state.stages[st.id];
    if (!s) continue;
    const tie = s.ties?.findIndex((t) => t.a === clubId || t.b === clubId) ?? -1;
    if (tie >= 0 || s.groups?.some((g) => g.includes(clubId))) last = { id: st.id, kind: st.kind, tie };
  }
  const champion = outcomes(def, state).champion === clubId;
  let eliminated = false;
  if (last?.kind === 'knockout') { const o = tieOutcome(def, state, last.id, last.tie); eliminated = !!o && o.winner !== clubId; }
  else if (last && stageComplete(def, state, last.id)) {
    const g = stageTables(def, state, last.id).groups.find((x) => x.some((r) => r.teamId === clubId));
    eliminated = (g?.find((r) => r.teamId === clubId)?.position ?? 0) > 2;
  }
  return { last, eliminated: eliminated && !champion, champion };
}

/** Competição continental encerrada: troféu, `continental_results` (ranking), premiação de campeão e vice, bônus de patrocínio e notícias. */
export function finishContinental(db: SqlDb, compId: string, fs: { def: FormatDef; state: FormatState }, date: string): void {
  const c = db.prepare("SELECT season, name FROM competitions WHERE id = ? AND kind = 'continental'").get(compId);
  if (!c) return;
  const season = N(c.season), name = S(c.name);
  const ranking = finalRanking(fs.def, fs.state);
  const champ = outcomes(fs.def, fs.state).champion;
  if (!champ) return;
  const runnerUp = ranking[1] ?? null;
  const user = userClubOf(db);
  db.prepare('INSERT INTO trophies (season, club_id, competition_id, won_by_user) VALUES (?,?,?,?)').run(season, champ, compId, champ === user ? 1 : 0);
  const post = makePoster(db, user);
  const fp = finalPrizes(fs.def.id);
  post(champ, date, 'prize', fp.champion, `Premiação: campeão — ${name}`);
  if (runnerUp) post(runnerUp, date, 'prize', fp.runnerUp, `Premiação: vice-campeão — ${name}`);
  if (fs.def.id !== RECOPA_ID) {
    const ins = db.prepare('INSERT OR REPLACE INTO continental_results (season, competition_id, club_id, comp, stage, prelim, groups, wins, draws) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const [club, r] of reachOf(fs.def, fs.state)) ins.run(season, compId, club, fs.def.id === LIB_ID ? 'lib' : 'sud', r.stage, r.prelim ? 1 : 0, r.groups ? 1 : 0, r.wins, r.draws);
  }
  if (champ === user && fs.def.id !== RECOPA_ID) paySponsorBonuses(db, post, date, user, { cupTitle: true });
  if (!user) return;
  if (champ === user) addNews(db, date, 'trophy', `CAMPEÃO! ${nameOf(db, user)} conquista a ${name}`, `Parabéns, professor! O ${nameOf(db, user)} é campeão da ${name}.\n\nO troféu já está na Sala de troféus e a premiação foi creditada no caixa.${fs.def.id === LIB_ID ? ' O clube está garantido na próxima Libertadores como cabeça do grupo A.' : fs.def.id === SUD_ID ? ' O título dá vaga na próxima Libertadores.' : ''}`);
  else if (runnerUp === user) addNews(db, date, 'season', `${name}: vice-campeão`, `O ${nameOf(db, user)} perdeu a final da ${name} para o ${nameOf(db, champ)}. A premiação de vice foi creditada no caixa.`);
}
