import type { SqlDb } from '../types.ts';
import type { ClubProfileDto } from '../../shared/api.ts';
import type { Position } from '../../shared/types.ts';
import { ageOn } from '../../shared/date.ts';
import { getClubInfo } from './aiCoachRepository.ts';
import { FIXTURE_SELECT, getCareerState, getCompetitionTable, toFixture } from './competitionRepository.ts';
import { CURRENT_COMP } from './countrySeasonRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);

/**
 * Ficha completa de um clube: dados, técnico, campanha na temporada (liga e copas), últimos e próximos jogos, elenco com as estatísticas
 * da temporada (públicas: sem força, que de outros clubes só aparece como estimativa no perfil), histórico de temporadas e títulos.
 */
export function getClubProfile(db: SqlDb, clubId: string): ClubProfileDto {
  const info = getClubInfo(db, clubId);
  const today = getCareerState(db).gameDate;
  // liga da temporada corrente em que o clube joga (participantes saem das partidas)
  const lg = db.prepare(`SELECT c.id FROM competitions c WHERE c.kind = 'league' AND ${CURRENT_COMP}
      AND EXISTS (SELECT 1 FROM fixtures f WHERE f.competition_id = c.id AND (f.home_club_id = ? OR f.away_club_id = ?)) LIMIT 1`).get(clubId, clubId);
  let league: ClubProfileDto['league'] = null;
  if (lg) {
    const t = getCompetitionTable(db, S(lg.id));
    const row = t.rows.find((r) => r.clubId === clubId);
    if (row) league = { competitionId: t.competition.id, name: t.competition.name, total: t.rows.length, row, roundsPlayed: t.roundsPlayed, totalRounds: t.totalRounds, zoneTargets: t.zoneTargets };
  }
  // copas da temporada corrente: fase atual, eliminado ou campeão
  const cups = db.prepare(`SELECT c.id, c.name, c.status, json_extract(c.format_json, '$.format.kind') AS fk FROM competitions c
      WHERE c.kind = 'cup' AND ${CURRENT_COMP} AND EXISTS (SELECT 1 FROM cup_ties t WHERE t.competition_id = c.id AND (t.club_a = ? OR t.club_b = ?)) ORDER BY fk = 'supercup', c.id`).all(clubId, clubId)
    .map((c) => {
      const last = db.prepare(`SELECT t.stage, t.winner, t.club_b, json_extract(cc.format_json, '$.format.stages[' || t.stage || '].name') AS stage_name
          FROM cup_ties t JOIN competitions cc ON cc.id = t.competition_id WHERE t.competition_id = ? AND (t.club_a = ? OR t.club_b = ?) ORDER BY t.stage DESC LIMIT 1`).get(S(c.id), clubId, clubId)!;
      const champion = !!db.prepare('SELECT 1 FROM trophies WHERE competition_id = ? AND club_id = ?').get(S(c.id), clubId);
      const status: ClubProfileDto['cups'][number]['status'] = champion ? 'champion' : last.winner == null ? 'alive' : S(last.winner) === clubId ? 'alive' : 'eliminated';
      return { competitionId: S(c.id), name: S(c.name), stage: last.stage_name == null ? '' : S(last.stage_name), status };
    });
  const fx = (where: string, order: string) => db.prepare(`${FIXTURE_SELECT} WHERE (f.home_club_id = ? OR f.away_club_id = ?) AND ${where} ORDER BY ${order} LIMIT 5`).all(clubId, clubId).map(toFixture);
  const recent = fx("f.status = 'played'", 'f.match_date DESC, f.id DESC').reverse();
  const upcoming = fx("f.status = 'scheduled'", 'f.match_date, f.id');
  // elenco com as estatísticas da temporada corrente (todas as competições, pelo clube)
  const stats = new Map(db.prepare(`SELECT s.player_id, SUM(s.appearances) AS a, SUM(s.minutes) AS m, SUM(s.goals) AS g, SUM(s.assists) AS x, SUM(s.clean_sheets) AS cs, SUM(s.rating_sum) AS rs
      FROM player_season_stats s JOIN competitions c ON c.id = s.competition_id WHERE s.club_id = ? AND ${CURRENT_COMP} GROUP BY s.player_id`).all(clubId).map((r) => [S(r.player_id), r]));
  const injured = new Set(db.prepare('SELECT ps.player_id FROM player_status ps JOIN players p ON p.id = ps.player_id WHERE p.club_id = ? AND ps.injury_until > ?').all(clubId, today).map((r) => S(r.player_id)));
  const squad = db.prepare('SELECT id, first_name, last_name, position, birth_date, nationality, contract_end FROM players WHERE club_id = ?').all(clubId).map((p) => {
    const s = stats.get(S(p.id));
    const apps = s ? N(s.a) : 0;
    return {
      id: S(p.id), name: `${S(p.first_name)} ${S(p.last_name)}`, position: S(p.position) as Position, age: ageOn(S(p.birth_date), today), nationality: S(p.nationality),
      contractEnd: p.contract_end == null ? null : S(p.contract_end),
      appearances: apps, minutes: s ? N(s.m) : 0, goals: s ? N(s.g) : 0, assists: s ? N(s.x) : 0, cleanSheets: s ? N(s.cs) : 0,
      avgRating: apps > 0 ? Math.round((N(s!.rs) / apps) * 100) / 100 : null, injured: injured.has(S(p.id)),
    };
  });
  const history = db.prepare(`SELECT r.season, r.position, r.outcome, c.name FROM season_results r JOIN competitions c ON c.id = r.competition_id WHERE r.club_id = ? ORDER BY r.season DESC`).all(clubId)
    .map((r) => ({ season: N(r.season), competitionName: S(r.name), position: N(r.position), outcome: r.outcome == null ? null : (S(r.outcome) as 'champion' | 'promoted' | 'relegated') }));
  const trophies = db.prepare('SELECT t.season, c.name FROM trophies t JOIN competitions c ON c.id = t.competition_id WHERE t.club_id = ? ORDER BY t.season DESC, t.id DESC').all(clubId)
    .map((r) => ({ season: N(r.season), competitionName: S(r.name) }));
  return { info, league, cups, recent, upcoming, squad, history, trophies };
}
