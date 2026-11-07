import type { SqlDb } from '../types.ts';
import { withTransaction } from '../types.ts';
import { createRng } from '../../game/rng.ts';
import { addDays, ageOn } from '../../shared/date.ts';
import { computeStandings, type MatchResult } from '../../game/competition-engine/standings.ts';
import { expectedPosition } from '../../game/board-engine/board.ts';
import { AI_COACH_RETIRE_AGE, aiCoachSeasonDelta, generateAiCoach, pickReplacement } from '../../game/coach-engine/coach.ts';
import { defaultCoaches } from '../../game/coach-engine/worldCoaches.ts';
import { COUNTRY_TEMPLATES } from '../../game/world/names.ts';
import type { CoachAttributes } from '../../shared/coachAttributes.ts';
import type { LeagueRules } from '../../shared/types.ts';
import type { AiCoachDetailDto, AiCoachDto, ClubInfoDto } from '../../shared/api.ts';
import type { Methodology, Position, WorldCoach } from '../../shared/types.ts';
import { UserError } from '../../shared/errors.ts';
import { getCareerState } from './careerRepository.ts';

/**
 * Técnicos da IA (Fase 9). Um por clube (o do usuário é o próprio usuário) e um grupo de desempregados (15% do número de clubes).
 * Demissão tira o técnico do clube; a vaga é preenchida por um desempregado de reputação compatível (ou por alguém novo).
 */
const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);
const seedOf = (db: SqlDb) => S((db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() ?? { value: 'sem-semente' }).value);
const templateOf = (code: string) => COUNTRY_TEMPLATES.find((t) => t.code === code) ?? COUNTRY_TEMPLATES[0]!;

function insertWorldCoach(db: SqlDb, k: WorldCoach, clubId: string | null, date: string): void {
  insertCoach(db, k.id, k.nationality, k, clubId, date);
}
function insertCoach(db: SqlDb, id: string, nationality: string, d: Omit<ReturnType<typeof generateAiCoach>, never>, clubId: string | null, date: string): void {
  db.prepare('INSERT INTO ai_coaches (id, first_name, last_name, nationality, birth_date, reputation, attributes_json, methodology, club_id, since) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, d.firstName, d.lastName, nationality, d.birthDate, d.reputation, JSON.stringify(d.attributes), d.methodology, clubId, clubId ? date : null);
  if (clubId) db.prepare('INSERT INTO ai_coach_spells (coach_id, club_id, start_date) VALUES (?,?,?)').run(id, clubId, date);
}

/**
 * Cria os técnicos (carreira nova ou save anterior à migração 17). Idempotente. Abre transação.
 * `coaches`: os técnicos do universo montado (base + pacotes, os mesmos que a tela de nova carreira mostra); sem eles (mundo antigo
 * ou save anterior), os técnicos padrão dos clubes do save. O do clube escolhido pelo usuário é substituído por ele e começa sem clube.
 */
export function ensureAiCoaches(db: SqlDb, coaches?: readonly WorldCoach[]): void {
  if (db.prepare('SELECT 1 AS x FROM ai_coaches LIMIT 1').get()) return;
  const st = getCareerState(db);
  const start = S((db.prepare("SELECT value FROM meta WHERE key = 'world_start_date'").get() ?? { value: st.gameDate }).value);
  const list = coaches ?? defaultCoaches(db.prepare('SELECT c.id, c.reputation, co.code FROM clubs c JOIN countries co ON co.id = c.country_id ORDER BY c.rowid').all()
    .map((c) => ({ id: S(c.id), reputation: N(c.reputation), countryCode: S(c.code) })), start);
  withTransaction(db, () => { for (const k of list) insertWorldCoach(db, k, k.clubId === st.clubId ? null : k.clubId, start); });
}

export function aiCoachAttributes(db: SqlDb): Map<string, CoachAttributes> {
  return new Map(db.prepare('SELECT club_id, attributes_json FROM ai_coaches WHERE club_id IS NOT NULL').all().map((r) => [S(r.club_id), JSON.parse(S(r.attributes_json)) as CoachAttributes]));
}
export function aiCoachOf(db: SqlDb, clubId: string): { id: string; name: string; reputation: number } | null {
  const r = db.prepare('SELECT id, first_name, last_name, reputation FROM ai_coaches WHERE club_id = ?').get(clubId);
  return r ? { id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, reputation: N(r.reputation) } : null;
}

/** O técnico da IA deixa o clube (demitido, ou substituído pela chegada do usuário). NÃO abre transação. */
export function dismissAiCoach(db: SqlDb, clubId: string, date: string, reason: 'sacked' | 'replaced'): void {
  const c = aiCoachOf(db, clubId);
  if (!c) return;
  db.prepare('UPDATE ai_coaches SET club_id = NULL, since = NULL, reputation = MAX(1, reputation - ?) WHERE id = ?').run(reason === 'sacked' ? 4 : 0, c.id);
  db.prepare('UPDATE ai_coach_spells SET end_date = ?, end_reason = ? WHERE coach_id = ? AND end_date IS NULL').run(date, reason, c.id);
}

/** Preenche a vaga do clube: um desempregado compatível, ou um técnico novo (promovido pelo clube). NÃO abre transação. */
export function hireAiCoach(db: SqlDb, clubId: string, date: string): string {
  if (aiCoachOf(db, clubId)) return aiCoachOf(db, clubId)!.id;
  const club = db.prepare('SELECT c.reputation, co.code FROM clubs c JOIN countries co ON co.id = c.country_id WHERE c.id = ?').get(clubId)!;
  const rng = createRng(`ai-hire:${seedOf(db)}:${date}:${clubId}`);
  // quem deixou este clube nos últimos 2 anos não volta (o clube não recontrata quem acabou de sair)
  const pool = db.prepare(`SELECT id, reputation FROM ai_coaches WHERE club_id IS NULL AND retired = 0
    AND id NOT IN (SELECT coach_id FROM ai_coach_spells WHERE club_id = ? AND end_date >= ?) ORDER BY id`).all(clubId, addDays(date, -730)).map((r) => ({ id: S(r.id), reputation: N(r.reputation) }));
  const pick = pickReplacement(rng, N(club.reputation), pool);
  let id: string;
  if (pick) id = pick.id;
  else {
    let n = N(db.prepare('SELECT COUNT(*) AS n FROM ai_coaches').get()!.n) + 1;
    while (db.prepare('SELECT 1 AS x FROM ai_coaches WHERE id = ?').get(`tec-novo-${n}`)) n++;
    id = `tec-novo-${n}`;
    insertCoach(db, id, S(club.code), generateAiCoach(rng, templateOf(S(club.code)), N(club.reputation) - 10, date), null, date);
  }
  db.prepare('UPDATE ai_coaches SET club_id = ?, since = ? WHERE id = ?').run(clubId, date, id);
  db.prepare('INSERT INTO ai_coach_spells (coach_id, club_id, start_date) VALUES (?,?,?)').run(id, clubId, date);
  return id;
}

/**
 * Virada (antes de o calendário novo existir): reputação dos técnicos empregados pela campanha (posição × esperada pela reputação
 * do clube, título, rebaixamento); desempregados perdem 1 ponto; aos 70 anos se aposentam (o clube contrata outro). NÃO abre transação.
 */
export function reviewAiCoaches(db: SqlDb, competitionIds: readonly string[], date: string, relegated: ReadonlySet<string>, decayUnemployed = true): void {
  const ph = competitionIds.map(() => '?').join(',') || "''";
  for (const c of db.prepare(`SELECT c.id, l.rules_json FROM competitions c JOIN leagues l ON l.id = c.league_id WHERE c.id IN (${ph})`).all(...competitionIds)) {
    const teams = db.prepare('SELECT id, reputation FROM clubs WHERE id IN (SELECT home_club_id FROM fixtures WHERE competition_id = ? UNION SELECT away_club_id FROM fixtures WHERE competition_id = ?)').all(S(c.id), S(c.id));
    const results: MatchResult[] = db.prepare("SELECT home_club_id, away_club_id, home_goals, away_goals FROM fixtures WHERE competition_id = ? AND status = 'played'").all(S(c.id))
      .map((r) => ({ home: S(r.home_club_id), away: S(r.away_club_id), homeGoals: N(r.home_goals), awayGoals: N(r.away_goals) }));
    if (!results.length) continue;
    const reps = teams.map((t) => N(t.reputation));
    for (const row of computeStandings(teams.map((t) => S(t.id)), results, JSON.parse(S(c.rules_json)) as LeagueRules)) {
      const delta = aiCoachSeasonDelta({ expected: expectedPosition(N(teams.find((t) => S(t.id) === row.teamId)!.reputation), reps), position: row.position, champion: row.position === 1, relegated: relegated.has(row.teamId) });
      db.prepare('UPDATE ai_coaches SET reputation = MAX(1, MIN(100, reputation + ?)) WHERE club_id = ?').run(delta, row.teamId);
    }
  }
  if (decayUnemployed) db.prepare('UPDATE ai_coaches SET reputation = MAX(1, reputation - 1) WHERE club_id IS NULL AND retired = 0').run(); // uma vez por ano (virada de julho)
  for (const r of db.prepare('SELECT id, club_id, birth_date FROM ai_coaches WHERE retired = 0 ORDER BY id').all()) {
    if (ageOn(S(r.birth_date), date) < AI_COACH_RETIRE_AGE) continue;
    const club = r.club_id == null ? null : S(r.club_id);
    db.prepare('UPDATE ai_coaches SET retired = 1, club_id = NULL, since = NULL WHERE id = ?').run(S(r.id));
    if (club) {
      db.prepare("UPDATE ai_coach_spells SET end_date = ?, end_reason = 'retired' WHERE coach_id = ? AND end_date IS NULL").run(date, S(r.id));
      hireAiCoach(db, club, date);
    }
  }
}

const dto = (r: Record<string, unknown>, date: string): AiCoachDto => ({
  id: S(r.id), name: `${S(r.first_name)} ${S(r.last_name)}`, nationality: S(r.nationality), age: ageOn(S(r.birth_date), date), reputation: N(r.reputation),
  clubId: r.club_id == null ? null : S(r.club_id), clubName: r.club_name == null ? null : S(r.club_name), since: r.since == null ? null : S(r.since),
});
/** Técnicos sem clube (não aposentados), por reputação. */
export function listUnemployedCoaches(db: SqlDb): AiCoachDto[] {
  const date = getCareerState(db).gameDate;
  return db.prepare('SELECT * FROM ai_coaches WHERE club_id IS NULL AND retired = 0 ORDER BY reputation DESC, id').all().map((r) => dto(r, date));
}

/** Ficha do técnico: dados, atributos (1–20), metodologia e passagens por clubes. */
export function getAiCoachDetail(db: SqlDb, coachId: string): AiCoachDetailDto {
  const r = db.prepare('SELECT a.*, c.name AS club_name FROM ai_coaches a LEFT JOIN clubs c ON c.id = a.club_id WHERE a.id = ?').get(coachId);
  if (!r) throw new UserError('Técnico não encontrado.');
  const spells = db.prepare('SELECT s.club_id, c.name, s.start_date, s.end_date, s.end_reason FROM ai_coach_spells s JOIN clubs c ON c.id = s.club_id WHERE s.coach_id = ? ORDER BY s.start_date DESC, s.id DESC').all(coachId)
    .map((x) => ({ clubId: S(x.club_id), clubName: S(x.name), start: S(x.start_date), end: x.end_date == null ? null : S(x.end_date), reason: x.end_reason == null ? null : S(x.end_reason) as 'sacked' | 'replaced' | 'retired' }));
  return { ...dto(r, getCareerState(db).gameDate), retired: N(r.retired) === 1, methodology: S(r.methodology) as Methodology, attributes: JSON.parse(S(r.attributes_json)) as CoachAttributes, spells };
}

/** Ficha de um clube (aberta pela tabela de Competições): dados, técnico e elenco (sem força: de outros clubes o usuário só vê estimativas no perfil). */
export function getClubInfo(db: SqlDb, clubId: string): ClubInfoDto {
  const st = getCareerState(db);
  const c = db.prepare(`SELECT c.id, c.name, c.city, c.reputation, c.fans, co.name AS country, co.code, l.id AS league_id, l.name AS league, s.name AS stadium, s.capacity
    FROM clubs c JOIN countries co ON co.id = c.country_id JOIN leagues l ON l.id = c.league_id JOIN stadiums s ON s.id = c.stadium_id WHERE c.id = ?`).get(clubId);
  if (!c) throw new UserError('Clube não encontrado.');
  const isUser = clubId === st.clubId;
  const coachRow = db.prepare('SELECT a.*, NULL AS club_name FROM ai_coaches a WHERE a.club_id = ?').get(clubId);
  const userCoach = isUser ? (() => { const j = JSON.parse(S(db.prepare('SELECT coach_json FROM career WHERE id = 1').get()!.coach_json)) as { firstName: string; lastName: string }; return `${j.firstName} ${j.lastName}`; })() : null;
  const squad = db.prepare('SELECT id, first_name, last_name, position, birth_date, nationality FROM players WHERE club_id = ? ORDER BY last_name, first_name').all(clubId)
    .map((p) => ({ id: S(p.id), name: `${S(p.first_name)} ${S(p.last_name)}`, position: S(p.position) as Position, age: ageOn(S(p.birth_date), st.gameDate), nationality: S(p.nationality) }));
  return {
    id: S(c.id), name: S(c.name), city: S(c.city), country: S(c.country), countryCode: S(c.code), leagueId: S(c.league_id), league: S(c.league),
    reputation: N(c.reputation), fans: N(c.fans), stadium: S(c.stadium), capacity: N(c.capacity), isUserClub: isUser,
    coach: coachRow ? dto({ ...coachRow, club_id: clubId, club_name: S(c.name) }, st.gameDate) : null, userCoach,
    squad, avgAge: squad.length ? Math.round((squad.reduce((s, p) => s + p.age, 0) / squad.length) * 10) / 10 : 0,
  };
}
