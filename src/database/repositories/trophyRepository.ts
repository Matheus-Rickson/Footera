/**
 * Sala de troféus (v0.8.10): títulos de um clube agrupados por competição — os conquistados no jogo (`trophies`, gravados no fim de cada
 * liga, copa, supercopa, estadual e regional) somados aos títulos históricos do pacote de dados (`clubs.honours_json`, "antes da
 * carreira"). O agrupamento usa uma chave estável entre temporadas: id da liga (bra-1), id da copa do universo (cup-bra, sup-bra) ou o id
 * da competição sem a temporada (est_sp1, reg_ne). Um título histórico com `competitionId` igual a essa chave cai na mesma taça.
 * Também devolve os títulos do treinador (`won_by_user`) em todos os clubes por onde passou e a lista de campeões do universo.
 */
import type { SqlDb } from '../types.ts';
import type { ClubHonour } from '../../shared/types.ts';
import type { TrophyCaseDto, TrophyKindDto, TrophyLogoDto, TrophyRoomDto } from '../../shared/api.ts';
import { cupDefId } from '../../game/cup-engine/catalog.ts';
import { COPA_RUSSIA_ID } from '../../game/format-engine/formats.ts';
import { getCareerState } from './careerRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);

/** Ordem das prateleiras. */
export const TROPHY_KIND_ORDER: TrophyKindDto[] = ['league', 'cup', 'supercup', 'state', 'regional', 'other'];

const LABEL_RE = /\s+(\d{4}(?:\/\d{2,4})?)\s*$/;
/** Rótulo da temporada tirado do nome da competição ("Premier League 2026/27" → "2026/27"; ano civil → "2026"). */
export function seasonLabelOf(compName: string, season: number): string {
  return compName.match(LABEL_RE)?.[1] ?? String(season);
}
const stripLabel = (name: string) => name.replace(LABEL_RE, '').trim();

interface CompRow { id: string; kind: string; league_id: unknown; country_id: unknown; name: string; season: number; format_json: unknown; league_name: unknown; tier: unknown }
interface Classified { key: string; name: string; kind: TrophyKindDto; tier: number | null; logo: TrophyLogoDto | null; label: string }

/** Classifica uma competição do jogo: chave da taça, nome sem temporada, tipo e logo. */
export function classifyCompetition(c: CompRow): Classified {
  const label = seasonLabelOf(S(c.name), N(c.season));
  const base = stripLabel(S(c.name));
  if (c.kind === 'league' && c.league_id != null) {
    return { key: S(c.league_id), name: c.league_name != null ? S(c.league_name) : base, kind: 'league', tier: c.tier == null ? null : N(c.tier), logo: { kind: 'leagues', id: S(c.league_id) }, label };
  }
  const fmt = c.format_json == null ? null : (JSON.parse(S(c.format_json)) as { format?: { id?: string; kind?: string; name?: string }; formatId?: string });
  if (c.kind === 'cup') {
    const fid = fmt?.format?.id;
    const key = fid ?? S(c.id).replace(/_\d{4}$/, '');
    return { key, name: fmt?.format?.name ?? base, kind: fmt?.format?.kind === 'supercup' ? 'supercup' : 'cup', tier: null, logo: fid ? { kind: 'cups', id: fid } : null, label };
  }
  // competições do motor de formatos sem liga: estaduais (est_), copas estaduais (cest_), regionais (reg_) e a Copa da Rússia (copa nacional)
  const raw = S(c.id).replace(/_\d{4}$/, '');
  if (fmt?.formatId === COPA_RUSSIA_ID || raw === COPA_RUSSIA_ID) {
    const key = c.country_id != null ? cupDefId(S(c.country_id)) : raw;
    return { key, name: base, kind: 'cup', tier: null, logo: { kind: 'cups', id: key }, label };
  }
  const kind: TrophyKindDto = raw.startsWith('est_') || raw.startsWith('cest_') ? 'state' : 'regional';
  return { key: raw, name: base, kind, tier: null, logo: { kind: 'cups', id: raw }, label };
}

const COMP_SQL = `SELECT c.id, c.kind, c.league_id, c.country_id, c.name, c.season, c.format_json, l.name AS league_name, l.tier
  FROM competitions c LEFT JOIN leagues l ON l.id = c.league_id`;

function readHonours(db: SqlDb, clubId: string): ClubHonour[] {
  const has = db.prepare("SELECT 1 AS x FROM pragma_table_info('clubs') WHERE name = 'honours_json'").get() !== undefined;
  if (!has) return [];
  const r = db.prepare('SELECT honours_json FROM clubs WHERE id = ?').get(clubId);
  if (!r || r.honours_json == null) return [];
  try { const v = JSON.parse(S(r.honours_json)); return Array.isArray(v) ? (v as ClubHonour[]) : []; } catch { return []; }
}

/** Tipo de um título histórico sem taça no jogo: pelo id (liga do universo, cup-/sup-) ou "outro". */
function honourKind(db: SqlDb, competitionId: string | undefined): { kind: TrophyKindDto; tier: number | null; name: string | null; logo: TrophyLogoDto | null } {
  if (!competitionId) return { kind: 'other', tier: null, name: null, logo: null };
  const lg = db.prepare('SELECT name, tier FROM leagues WHERE id = ?').get(competitionId);
  if (lg) return { kind: 'league', tier: N(lg.tier), name: S(lg.name), logo: { kind: 'leagues', id: competitionId } };
  if (competitionId.startsWith('cup-')) return { kind: 'cup', tier: null, name: null, logo: { kind: 'cups', id: competitionId } };
  if (competitionId.startsWith('sup-')) return { kind: 'supercup', tier: null, name: null, logo: { kind: 'cups', id: competitionId } };
  if (competitionId.startsWith('est_') || competitionId.startsWith('cest_')) return { kind: 'state', tier: null, name: null, logo: { kind: 'cups', id: competitionId } };
  if (competitionId.startsWith('reg_')) return { kind: 'regional', tier: null, name: null, logo: { kind: 'cups', id: competitionId } };
  return { kind: 'other', tier: null, name: null, logo: null };
}

/** Taças de um clube: jogo + histórico, agrupadas e ordenadas (prateleira, divisão, mais títulos). */
export function clubTrophyCases(db: SqlDb, clubId: string): TrophyCaseDto[] {
  const cases = new Map<string, TrophyCaseDto>();
  const rows = db.prepare(`SELECT t.season AS t_season, t.won_by_user, x.* FROM trophies t JOIN (${COMP_SQL}) x ON x.id = t.competition_id
    WHERE t.club_id = ? ORDER BY t.season DESC, x.id`).all(clubId);
  for (const r of rows) {
    const c = classifyCompetition(r as unknown as CompRow);
    let tc = cases.get(c.key);
    if (!tc) { tc = { key: c.key, name: c.name, kind: c.kind, tier: c.tier, logo: c.logo, total: 0, historical: 0, historicalYears: null, wins: [] }; cases.set(c.key, tc); }
    tc.wins.push({ season: N(r.t_season), label: c.label, byUser: N(r.won_by_user) === 1 });
    tc.total++;
  }
  for (const h of readHonours(db, clubId)) {
    const count = Math.max(0, Math.floor(N(h.count)));
    if (count === 0) continue;
    const key = h.competitionId ?? `h:${h.name.trim().toLowerCase()}`;
    let tc = cases.get(key);
    if (!tc) {
      const k = honourKind(db, h.competitionId);
      tc = { key, name: k.name ?? h.name, kind: k.kind, tier: k.tier, logo: k.logo, total: 0, historical: 0, historicalYears: null, wins: [] };
      cases.set(key, tc);
    }
    tc.historical += count;
    tc.total += count;
    if (h.years?.trim()) tc.historicalYears = tc.historicalYears ? `${tc.historicalYears}, ${h.years.trim()}` : h.years.trim();
  }
  const order = (k: TrophyKindDto) => TROPHY_KIND_ORDER.indexOf(k);
  return [...cases.values()].sort((a, b) => order(a.kind) - order(b.kind) || (a.tier ?? 99) - (b.tier ?? 99) || b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Sala de troféus. `clubId` escolhe o clube exibido (qualquer clube existente); sem ele, o clube atual do treinador ou, desempregado,
 * o último clube por onde passou. `clubs` = clubes do treinador (atual primeiro, depois as passagens mais recentes).
 */
export function getTrophyRoom(db: SqlDb, clubId?: string): TrophyRoomDto {
  const st = getCareerState(db);
  const spells = db.prepare(`SELECT s.club_id, c.name, MAX(s.start_date) AS last FROM coach_spells s JOIN clubs c ON c.id = s.club_id
    GROUP BY s.club_id ORDER BY last DESC, s.club_id`).all().map((r) => ({ id: S(r.club_id), name: S(r.name) }));
  const clubs: TrophyRoomDto['clubs'] = [];
  if (st.clubId) {
    const cur = db.prepare('SELECT name FROM clubs WHERE id = ?').get(st.clubId);
    if (cur) clubs.push({ id: st.clubId, name: S(cur.name), current: true });
  }
  for (const s of spells) if (!clubs.some((c) => c.id === s.id)) clubs.push({ ...s, current: false });

  const wanted = clubId && db.prepare('SELECT 1 AS x FROM clubs WHERE id = ?').get(clubId) ? clubId : clubs[0]?.id ?? null;
  const clubRow = wanted ? db.prepare('SELECT id, name FROM clubs WHERE id = ?').get(wanted) : undefined;
  const cases = clubRow ? clubTrophyCases(db, S(clubRow.id)) : [];

  // títulos do treinador, em qualquer clube
  const coach = db.prepare(`SELECT t.season AS t_season, t.club_id AS t_club, cl.name AS club_name, x.* FROM trophies t JOIN (${COMP_SQL}) x ON x.id = t.competition_id
    JOIN clubs cl ON cl.id = t.club_id WHERE t.won_by_user = 1 ORDER BY t.season DESC, x.id`).all().map((r) => {
    const c = classifyCompetition(r as unknown as CompRow);
    return { season: N(r.t_season), label: c.label, competition: c.name, key: c.key, kind: c.kind, logo: c.logo, clubId: S(r.t_club), clubName: S(r.club_name) };
  });

  const champions = db.prepare(`SELECT t.season AS t_season, t.won_by_user, cl.name AS club_name, co.name AS country, x.* FROM trophies t JOIN (${COMP_SQL}) x ON x.id = t.competition_id
    JOIN clubs cl ON cl.id = t.club_id JOIN countries co ON co.id = COALESCE(x.country_id, (SELECT country_id FROM leagues WHERE id = x.league_id))
    ORDER BY t.season DESC, co.rowid, COALESCE(x.tier, 99), x.id`).all().map((r) => {
    const c = classifyCompetition(r as unknown as CompRow);
    return { season: N(r.t_season), label: c.label, competition: c.name, kind: c.kind, country: S(r.country), clubName: S(r.club_name), wonByUser: N(r.won_by_user) === 1 };
  });

  const inGame = cases.reduce((s, c) => s + c.wins.length, 0);
  const historical = cases.reduce((s, c) => s + c.historical, 0);
  return {
    club: clubRow ? { id: S(clubRow.id), name: S(clubRow.name) } : null,
    clubs, cases,
    totals: { all: inGame + historical, inGame, historical, byUser: cases.reduce((s, c) => s + c.wins.filter((w) => w.byUser).length, 0) },
    coachTitles: coach, champions,
  };
}
