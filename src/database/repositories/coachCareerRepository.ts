/**
 * Histórico da carreira do treinador (v0.8.10): temporadas no comando de cada clube (`coach_seasons`), números derivados das partidas
 * dentro de cada período (todas as competições; nada de classificação armazenada), títulos, reputação e licenças.
 */
import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { ageOn } from '../../shared/date.ts';
import { baseCoachAttributes } from '../../shared/coachAttributes.ts';
import { nationName } from '../../shared/nations.ts';
import type { CoachCareerDto, CoachLicenseDto, CoachSeasonDto } from '../../shared/api.ts';
import { enrollError, hasLicense, LICENSES, licenseName, licenseRank, reputationCap } from '../../game/coach-engine/licenses.ts';
import { getCareerState } from './careerRepository.ts';
import { countrySeason } from './countrySeasonRepository.ts';
import { activeCourse, careerDays, clubRequiredLicense, employedSeasons, heldLicense, readCoach } from './coachLicenseRepository.ts';
import { seasonLabelOf } from './trophyRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const n0 = (v: unknown) => (v == null ? null : N(v));

/**
 * Grava (ou completa) a linha da temporada do treinador no clube atual: na avaliação da virada (`season`) ou na saída do clube
 * (`sacked`/`left`, temporada parcial). Uma linha por clube e temporada; a saída logo depois da avaliação só troca o motivo.
 * Precisa do `board_state` da temporada. NÃO abre transação.
 */
export function recordCoachSeason(db: SqlDb, a: { date: string; reason: 'season' | 'sacked' | 'left'; position: number | null; competitionId: string | null; objectiveLabel: string | null; met: boolean | null; confidence: number | null }): void {
  const st = getCareerState(db);
  const b = db.prepare('SELECT * FROM board_state WHERE id = 1').get();
  if (!st.clubId || !b) return;
  const country = S(db.prepare('SELECT country_id FROM clubs WHERE id = ?').get(st.clubId)!.country_id);
  const label = countrySeason(db, country).label;
  const spellStart = S(db.prepare('SELECT start_date FROM coach_spells WHERE end_date IS NULL ORDER BY id DESC LIMIT 1').get()?.start_date ?? st.gameDate);
  const start = b.season_start != null ? S(b.season_start) : spellStart;
  const rep = readCoach(db).reputation;
  db.prepare(`INSERT INTO coach_seasons (season, label, club_id, competition_id, start_date, end_date, position, objective_label, objective_met, reputation_start, reputation_end, license, confidence_end, end_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (club_id, season) DO UPDATE SET end_date = excluded.end_date, position = COALESCE(excluded.position, coach_seasons.position),
      objective_met = COALESCE(coach_seasons.objective_met, excluded.objective_met), reputation_end = excluded.reputation_end, license = excluded.license,
      confidence_end = COALESCE(excluded.confidence_end, coach_seasons.confidence_end),
      end_reason = CASE WHEN excluded.end_reason = 'season' THEN coach_seasons.end_reason ELSE excluded.end_reason END`)
    .run(N(b.season), label, st.clubId, a.competitionId, start > a.date ? a.date : start, a.date, a.position, a.objectiveLabel, a.met == null ? null : a.met ? 1 : 0,
      b.coach_rep_start == null ? null : N(b.coach_rep_start), rep, heldLicense(db), a.confidence, a.reason);
}

/**
 * Saves anteriores à v0.8.10: recupera as temporadas já encerradas a partir das passagens (`coach_spells`) e dos resultados de liga
 * (`season_results`), com a reputação desconhecida. Roda uma vez por save. Idempotente.
 */
export function backfillCoachSeasons(db: SqlDb): void {
  if (db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'coach_seasons'").get() === undefined) return;
  if (db.prepare("SELECT 1 AS x FROM meta WHERE key = 'coach_seasons_backfill'").get()) return;
  const today = getCareerState(db).gameDate;
  withTransaction(db, () => {
    if (!db.prepare('SELECT 1 AS x FROM coach_seasons LIMIT 1').get()) {
      for (const sp of db.prepare('SELECT club_id, start_date, end_date FROM coach_spells ORDER BY start_date, id').all()) {
        const spEnd = sp.end_date == null ? today : S(sp.end_date);
        const rows = db.prepare(`SELECT sr.season, sr.competition_id, sr.position, c.name, MIN(f.match_date) AS first, MAX(f.match_date) AS last FROM season_results sr
          JOIN competitions c ON c.id = sr.competition_id JOIN fixtures f ON f.competition_id = sr.competition_id AND (f.home_club_id = sr.club_id OR f.away_club_id = sr.club_id)
          WHERE sr.club_id = ? GROUP BY sr.season, sr.competition_id ORDER BY sr.season`).all(S(sp.club_id));
        for (const r of rows) {
          const start = S(r.first) > S(sp.start_date) ? S(r.first) : S(sp.start_date);
          const end = S(r.last) < spEnd ? S(r.last) : spEnd;
          if (start > end) continue;
          db.prepare(`INSERT OR IGNORE INTO coach_seasons (season, label, club_id, competition_id, start_date, end_date, position, end_reason) VALUES (?,?,?,?,?,?,?, 'season')`)
            .run(N(r.season), seasonLabelOf(S(r.name), N(r.season)), S(sp.club_id), S(r.competition_id), start, end, N(r.position));
        }
      }
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('coach_seasons_backfill', '1')").run();
  });
}

/** Números do clube nas partidas disputadas entre duas datas (todas as competições). */
function recordBetween(db: SqlDb, clubId: string, start: string, end: string) {
  const out = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const f of db.prepare(`SELECT home_club_id, home_goals, away_goals FROM fixtures WHERE status = 'played' AND (home_club_id = ? OR away_club_id = ?)
    AND match_date >= ? AND match_date <= ?`).all(clubId, clubId, start, end)) {
    const home = S(f.home_club_id) === clubId;
    const gf = N(home ? f.home_goals : f.away_goals), ga = N(home ? f.away_goals : f.home_goals);
    out.played++; out.goalsFor += gf; out.goalsAgainst += ga;
    if (gf > ga) out.won++; else if (gf < ga) out.lost++; else out.drawn++;
  }
  return out;
}

export function getCoachCareer(db: SqlDb): CoachCareerDto {
  const st = getCareerState(db);
  const coach = readCoach(db);
  const held = heldLicense(db);
  const course = activeCourse(db);
  const clubName = (id: string) => S(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)?.name ?? '?');
  const compName = (id: unknown) => (id == null ? null : (() => { const r = db.prepare('SELECT c.name, l.name AS league FROM competitions c LEFT JOIN leagues l ON l.id = c.league_id WHERE c.id = ?').get(S(id)); return r ? S(r.league ?? r.name) : null; })());
  const titlesOf = (clubId: string, season: number) => N(db.prepare('SELECT COUNT(*) AS n FROM trophies WHERE club_id = ? AND season = ? AND won_by_user = 1').get(clubId, season)!.n);

  const seasons: CoachSeasonDto[] = db.prepare('SELECT * FROM coach_seasons ORDER BY end_date DESC, id DESC').all().map((r) => ({
    season: N(r.season), label: S(r.label), clubId: S(r.club_id), clubName: clubName(S(r.club_id)), competition: compName(r.competition_id),
    position: n0(r.position), objective: r.objective_label == null ? null : S(r.objective_label), met: r.objective_met == null ? null : N(r.objective_met) === 1,
    ...recordBetween(db, S(r.club_id), S(r.start_date), S(r.end_date)), titles: titlesOf(S(r.club_id), N(r.season)),
    reputationStart: n0(r.reputation_start), reputationEnd: n0(r.reputation_end), endReason: S(r.end_reason) as CoachSeasonDto['endReason'],
    start: S(r.start_date), end: S(r.end_date),
  }));
  // temporada em andamento no clube atual
  const b = st.clubId ? db.prepare('SELECT * FROM board_state WHERE id = 1').get() : undefined;
  if (st.clubId && b && !seasons.some((s) => s.clubId === st.clubId && s.season === N(b.season))) {
    const country = S(db.prepare('SELECT country_id FROM clubs WHERE id = ?').get(st.clubId)!.country_id);
    const spellStart = S(db.prepare('SELECT start_date FROM coach_spells WHERE end_date IS NULL ORDER BY id DESC LIMIT 1').get()?.start_date ?? st.gameDate);
    const start = b.season_start != null ? S(b.season_start) : spellStart;
    const lg = db.prepare(`SELECT c.id FROM competitions c WHERE c.kind = 'league' AND c.season = ? AND c.id IN (SELECT competition_id FROM fixtures WHERE home_club_id = ? OR away_club_id = ?) LIMIT 1`).get(countrySeason(db, country).season, st.clubId, st.clubId);
    seasons.unshift({
      season: N(b.season), label: countrySeason(db, country).label, clubId: st.clubId, clubName: clubName(st.clubId), competition: compName(lg?.id),
      position: null, objective: null, met: null, ...recordBetween(db, st.clubId, start, st.gameDate), titles: titlesOf(st.clubId, N(b.season)),
      reputationStart: n0(b.coach_rep_start), reputationEnd: coach.reputation, endReason: 'current', start, end: st.gameDate,
    });
  }

  const totals = seasons.reduce((t, s) => ({ played: t.played + s.played, won: t.won + s.won, drawn: t.drawn + s.drawn, lost: t.lost + s.lost, goalsFor: t.goalsFor + s.goalsFor, goalsAgainst: t.goalsAgainst + s.goalsAgainst }),
    { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
  const titles = N(db.prepare('SELECT COUNT(*) AS n FROM trophies WHERE won_by_user = 1').get()!.n);
  const clubs = N(db.prepare('SELECT COUNT(DISTINCT club_id) AS n FROM coach_spells').get()!.n);

  const days = careerDays(db, st.gameDate), done = employedSeasons(db);
  const obtained = new Map(db.prepare('SELECT license, obtained, initial FROM coach_licenses').all().map((r) => [S(r.license), { date: S(r.obtained), initial: N(r.initial) === 1 }]));
  const licenses: CoachLicenseDto[] = LICENSES.map((l) => {
    const got = obtained.get(l.id);
    const inCourse = course?.license === l.id;
    const blocked = got || inCourse ? null : enrollError({ held, course: course?.license ?? null, target: l.id, careerDays: days, employedSeasons: done });
    const req = [l.requires.license === 'none' ? null : licenseName(l.requires.license), l.requires.careerDays ? `${l.requires.careerDays} dias de carreira` : null,
      l.requires.employedSeasons ? `${l.requires.employedSeasons} temporada(s) completa(s) no comando de um clube` : null].filter(Boolean).join(' + ') || 'Nenhum';
    const total = course ? Math.max(1, (Date.parse(course.end) - Date.parse(course.start)) / 86400000) : 1;
    return {
      id: l.id, name: l.name, status: got || hasLicense(held, l.id) ? 'held' : inCourse ? 'course' : blocked ? 'locked' : 'available',
      obtained: got?.date ?? null, initial: got?.initial ?? false, courseDays: l.courseDays, reputationBonus: l.reputationBonus, reputationCap: l.reputationCap,
      requirement: req, blocked,
      course: inCourse && course ? { start: course.start, end: course.end, progress: Math.max(0, Math.min(1, (Date.parse(st.gameDate) - Date.parse(course.start)) / 86400000 / total)), waived: course.waived } : null,
      requiredBy: l.id === 'PRO' ? '1ª divisão' : l.id === 'A' ? '2ª divisão' : l.id === 'B' ? '3ª divisão e abaixo' : 'clubes só de estadual',
    };
  });
  const requiredHere = st.clubId ? clubRequiredLicense(db, st.clubId) : null;
  return {
    coach: {
      name: `${coach.firstName} ${coach.lastName}`, nationality: nationName(coach.nationality), age: ageOn(coach.birthDate, st.gameDate), reputation: coach.reputation,
      reputationCap: Math.max(reputationCap(held), coach.reputation), license: held, licenseName: licenseName(held),
      clubId: st.clubId || null, clubName: st.clubId ? clubName(st.clubId) : null, requiredHere,
      compliant: requiredHere == null || hasLicense(held, requiredHere) || (course != null && licenseRank(course.license) >= licenseRank(requiredHere)),
    },
    totals: { ...totals, pointsPct: totals.played ? Math.round(((totals.won * 3 + totals.drawn) / (totals.played * 3)) * 1000) / 10 : 0, titles, clubs, seasons: seasons.length },
    seasons, licenses, careerDays: days, employedSeasons: done,
    attributes: coach.attributes ?? baseCoachAttributes(), points: coach.attributePoints ?? 0,
  };
}
