import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../database/connection.ts';
import { migrate } from '../database/migrator.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import {
  advanceTime, countPending, ensureSeason, getCareerState, getClubCalendar, getCompetitionTable, getNextFixture, listCompetitions, listRound,
} from '../database/repositories/competitionRepository.ts';
import { getMatchReport, simulateMatchday } from '../database/repositories/matchRepository.ts';
import { ensureFinance, getFinanceOverview } from '../database/repositories/financeRepository.ts';
import { getTransfersOverview, makeOffer, respondOffer, searchMarket, setListed } from '../database/repositories/transferRepository.ts';
import {
  activateScheme, autoLineup, deleteScheme, duplicateScheme, ensureSchemes, getTacticsOverview, saveScheme,
} from '../database/repositories/tacticsRepository.ts';
import { getContracts, getHistory, getSeasonStatus, getTrophies, renewContract, startNextSeason } from '../database/repositories/seasonRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import { turnoverDate } from '../game/career-engine/contracts.ts';
import type { SqlDb } from '../database/types.ts';
import { createCareer, validateCoach, ValidationError } from './careerService.ts';
import { ID_RE, listProfiles } from './profileService.node.ts';
import { generateWorld } from '../game/world/generator.ts';
import { ImageError, inspectImage } from '../shared/photo.ts';
import { ageOn } from '../shared/date.ts';
import type { Coach, Methodology } from '../shared/types.ts';
import type {
  ContractRowDto, HistoryRowDto, NewSeasonReportDto, NewsDto, RenewInput, RenewResultDto, SeasonStatusDto, TrophyRoomDto,
  AdvanceMode, AdvanceResultDto, CalendarDto, FinanceOverviewDto, FixtureDto, MarketFilter, MarketPlayerDto, OfferInput, OfferResultDto, TransfersOverviewDto, MatchReportDto, SchemeDto, SchemeInput, SimulationSummaryDto, TacticsOverviewDto, CareerListDto, CareerOverviewDto, CareerSummaryDto, CoachInput, CompetitionInfoDto, CompetitionTableDto,
} from '../shared/api.ts';

const careersDir = (base: string, profileId: string) => path.join(base, 'saves', profileId);

function assertId(id: string, label: string): void {
  if (!ID_RE.test(id)) throw new ValidationError(`${label} inválido.`);
}

export interface NewCareerInput { profileId: string; seed: string; clubId: string; coach: CoachInput; photo?: Uint8Array }

export async function createCareerSave(base: string, input: NewCareerInput): Promise<CareerSummaryDto> {
  assertId(input.profileId, 'Perfil');
  if (!listProfiles(base).some((p) => p.id === input.profileId)) throw new ValidationError('Perfil inexistente.');
  const seed = input.seed.trim();
  if (!seed || seed.length > 64) throw new ValidationError('A semente deve ter de 1 a 64 caracteres.');
  if (!/^[A-Z]{3}$/.test(input.coach.nationality)) throw new ValidationError('Nacionalidade inválida.');

  let ext: 'png' | 'jpg' | null = null;
  if (input.photo) {
    try { ext = inspectImage(input.photo).format === 'png' ? 'png' : 'jpg'; }
    catch (e) { if (e instanceof ImageError) throw new ValidationError(e.message); throw e; }
  }

  const world = generateWorld({ seed });
  const coach: Coach = {
    firstName: input.coach.firstName.trim(), lastName: input.coach.lastName.trim(),
    birthDate: input.coach.birthDate, nationality: input.coach.nationality,
    methodology: input.coach.methodology, reputation: 20, photoPath: ext ? `coach.${ext}` : null,
  };
  validateCoach(coach, world.startDate);
  if (!world.clubs.some((c) => c.id === input.clubId)) throw new ValidationError('Clube inexistente no universo.');

  const careerId = randomUUID();
  const dir = careersDir(base, input.profileId);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${careerId}`);
  const final = path.join(dir, careerId);
  fs.mkdirSync(tmp);
  let db: SqlDb | null = null;
  try {
    db = await openDatabase(path.join(tmp, 'career.db'));
    createCareer(db, world, coach, input.clubId);
    db.close(); db = null;
    if (ext && input.photo) fs.writeFileSync(path.join(tmp, `coach.${ext}`), input.photo);
    fs.renameSync(tmp, final);
  } catch (e) {
    try { db?.close(); } catch { /* já fechado */ }
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return readSummary(base, input.profileId, careerId);
}

async function withCareerDb<T>(file: string, fn: (db: SqlDb) => T): Promise<T> {
  const db = await openDatabase(file);
  try { return fn(db); } finally { db.close(); }
}

function summaryFromDb(db: SqlDb, profileId: string, careerId: string): CareerSummaryDto {
  const row = db.prepare(
    `SELECT c.coach_json, c.club_id, c.game_date, c.season, c.created_at, c.updated_at, c.play_seconds, cl.name AS club_name,
            (SELECT value FROM meta WHERE key = 'world_seed') AS world_seed
       FROM career c JOIN clubs cl ON cl.id = c.club_id WHERE c.id = 1`).get();
  if (!row) throw new Error('Registro de carreira ausente.');
  const coach = JSON.parse(String(row.coach_json)) as Coach;
  return {
    id: careerId, profileId, coachName: `${coach.firstName} ${coach.lastName}`, clubId: String(row.club_id),
    clubName: String(row.club_name), gameDate: String(row.game_date), season: Number(row.season),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), playSeconds: Number(row.play_seconds),
    worldSeed: String(row.world_seed),
  };
}

export async function readSummary(base: string, profileId: string, careerId: string): Promise<CareerSummaryDto> {
  assertId(profileId, 'Perfil'); assertId(careerId, 'Carreira');
  return withCareerDb(path.join(careersDir(base, profileId), careerId, 'career.db'), (db) => summaryFromDb(db, profileId, careerId));
}

export async function listCareerSaves(base: string, profileId: string): Promise<CareerListDto> {
  assertId(profileId, 'Perfil');
  const dir = careersDir(base, profileId);
  const out: CareerListDto = { careers: [], unreadable: [] };
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
    try { out.careers.push(await readSummary(base, profileId, entry.name)); }
    catch (e) { out.unreadable.push({ id: entry.name, reason: e instanceof Error ? e.message : 'Erro desconhecido.' }); }
  }
  out.careers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

const POS_ORDER = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

export async function openCareer(base: string, profileId: string, careerId: string): Promise<CareerOverviewDto> {
  assertId(profileId, 'Perfil'); assertId(careerId, 'Carreira');
  const dir = path.join(careersDir(base, profileId), careerId);
  const file = path.join(dir, 'career.db');
  if (!fs.existsSync(file)) throw new ValidationError('Save não encontrado.');
  return withCareerDb(file, (db) => {
    migrate(db);
    ensureSeason(db, getCareerState(db).season); // cria o calendário em saves anteriores à Fase 3
    ensureSchemes(db); // cria os esquemas táticos em saves anteriores à Fase 5
    ensureFinance(db); // patrocínios e ponto de partida financeiro em saves anteriores à Fase 6
    const summary = summaryFromDb(db, profileId, careerId);
    const coach = JSON.parse(String((db.prepare('SELECT coach_json FROM career WHERE id = 1').get() as { coach_json: string }).coach_json)) as Coach;
    const c = db.prepare(
      `SELECT cl.*, l.name AS league_name, co.name AS country_name, st.name AS stadium_name, st.capacity
         FROM clubs cl JOIN leagues l ON l.id = cl.league_id JOIN countries co ON co.id = cl.country_id
         JOIN stadiums st ON st.id = cl.stadium_id WHERE cl.id = ?`).get(summary.clubId);
    if (!c) throw new Error('Clube da carreira não encontrado no save.');
    const squad = db.prepare('SELECT * FROM players WHERE club_id = ?').all(summary.clubId).map(rowToPlayer)
      .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || b.overall - a.overall)
      .map((p) => ({
        id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, age: ageOn(p.birthDate, summary.gameDate),
        overall: p.overall, potentialEstimated: Math.max(p.overall, p.potentialEstimated), condition: p.condition, morale: p.morale,
        salary: p.salary, contractEnd: p.contractEnd,
      }));

    const natRow = db.prepare('SELECT name FROM countries WHERE code = ?').get(coach.nationality);
    const comps = listCompetitions(db);
    const mine = comps.userCompetitionId ? getCompetitionTable(db, comps.userCompetitionId).rows.find((r) => r.isUserClub) : undefined;
    const leaguePosition = comps.userCompetitionId && mine
      ? { competitionId: comps.userCompetitionId, position: mine.position, total: comps.competitions.find((x) => x.id === comps.userCompetitionId)?.teamCount ?? 0, points: mine.points, played: mine.played }
      : null;

    const warnings: string[] = [];
    let photoDataUrl: string | null = null;
    if (coach.photoPath) {
      if (/^coach\.(png|jpg)$/.test(coach.photoPath) && fs.existsSync(path.join(dir, coach.photoPath))) {
        const mime = coach.photoPath.endsWith('png') ? 'image/png' : 'image/jpeg';
        photoDataUrl = `data:${mime};base64,${fs.readFileSync(path.join(dir, coach.photoPath)).toString('base64')}`;
      } else warnings.push('A foto do treinador não foi encontrada no save.');
    }
    return {
      summary,
      coach: {
        firstName: coach.firstName, lastName: coach.lastName, birthDate: coach.birthDate,
        age: ageOn(coach.birthDate, summary.gameDate), nationality: coach.nationality,
        methodology: coach.methodology as Methodology, reputation: coach.reputation,
      },
      photoDataUrl, warnings, nationalityName: natRow ? String(natRow.name) : coach.nationality,
      nextFixture: getNextFixture(db), pendingMatches: countPending(db), leaguePosition,
      seasonStatus: (() => {
        const complete = Number(db.prepare("SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.season = ? AND f.status = 'scheduled'").get(summary.season)!.n) === 0;
        const turnover = turnoverDate(summary.season);
        return { complete, turnoverDate: turnover, canStart: complete && summary.gameDate >= turnover };
      })(),
      club: {
        id: String(c.id), name: String(c.name), city: String(c.city), league: String(c.league_name),
        country: String(c.country_name), reputation: Number(c.reputation), balance: Number(c.balance),
        fans: Number(c.fans), stadium: String(c.stadium_name), capacity: Number(c.capacity),
      },
      squad,
    };
  });
}

/** Abre o save, garante migrações e calendário, executa `fn` e fecha. */
async function withPreparedCareer<T>(base: string, profileId: string, careerId: string, fn: (db: SqlDb) => T): Promise<T> {
  assertId(profileId, 'Perfil'); assertId(careerId, 'Carreira');
  const file = path.join(careersDir(base, profileId), careerId, 'career.db');
  if (!fs.existsSync(file)) throw new ValidationError('Save não encontrado.');
  return withCareerDb(file, (db) => {
    migrate(db);
    ensureSeason(db, getCareerState(db).season);
    ensureSchemes(db);
    ensureFinance(db);
    return fn(db);
  });
}

export const getCalendar = (base: string, profileId: string, careerId: string): Promise<CalendarDto> =>
  withPreparedCareer(base, profileId, careerId, (db) => getClubCalendar(db));

export const listCompetitionsFor = (base: string, profileId: string, careerId: string): Promise<{ userCompetitionId: string | null; competitions: CompetitionInfoDto[] }> =>
  withPreparedCareer(base, profileId, careerId, (db) => listCompetitions(db));

export const getTable = (base: string, profileId: string, careerId: string, competitionId: string): Promise<CompetitionTableDto> =>
  withPreparedCareer(base, profileId, careerId, (db) => getCompetitionTable(db, competitionId));

export const advanceCareer = (base: string, profileId: string, careerId: string, mode: AdvanceMode): Promise<AdvanceResultDto> =>
  withPreparedCareer(base, profileId, careerId, (db) => advanceTime(db, mode));

export const simulateCareerMatchday = (base: string, profileId: string, careerId: string): Promise<SimulationSummaryDto> =>
  withPreparedCareer(base, profileId, careerId, (db) => simulateMatchday(db));

export const getReport = (base: string, profileId: string, careerId: string, fixtureId: string): Promise<MatchReportDto> =>
  withPreparedCareer(base, profileId, careerId, (db) => getMatchReport(db, fixtureId));

export const getRound = (base: string, profileId: string, careerId: string, competitionId: string, round: number): Promise<FixtureDto[]> =>
  withPreparedCareer(base, profileId, careerId, (db) => listRound(db, competitionId, round));

type Ref = [string, string, string];
export const getTactics = (b: string, p: string, c: string): Promise<TacticsOverviewDto> => withPreparedCareer(b, p, c, (db) => getTacticsOverview(db));
export const saveTacticScheme = (b: string, p: string, c: string, scheme: SchemeInput): Promise<SchemeDto> => withPreparedCareer(b, p, c, (db) => saveScheme(db, scheme));
export const duplicateTacticScheme = (b: string, p: string, c: string, id: string): Promise<SchemeDto> => withPreparedCareer(b, p, c, (db) => duplicateScheme(db, id));
export const deleteTacticScheme = (b: string, p: string, c: string, id: string): Promise<true> => withPreparedCareer(b, p, c, (db) => { deleteScheme(db, id); return true as const; });
export const activateTacticScheme = (b: string, p: string, c: string, id: string): Promise<true> => withPreparedCareer(b, p, c, (db) => { activateScheme(db, id); return true as const; });
export const getAutoLineup = (b: string, p: string, c: string, formation: string): Promise<string[]> => withPreparedCareer(b, p, c, (db) => autoLineup(db, formation));
export type { Ref };

export const getFinance = (b: string, p: string, c: string): Promise<FinanceOverviewDto> => withPreparedCareer(b, p, c, (db) => getFinanceOverview(db));

export const getTransfers = (b: string, p: string, c: string): Promise<TransfersOverviewDto> => withPreparedCareer(b, p, c, (db) => getTransfersOverview(db));
export const searchTransferMarket = (b: string, p: string, c: string, f: MarketFilter): Promise<MarketPlayerDto[]> => withPreparedCareer(b, p, c, (db) => searchMarket(db, f));
export const sendTransferOffer = (b: string, p: string, c: string, o: OfferInput): Promise<OfferResultDto> => withPreparedCareer(b, p, c, (db) => makeOffer(db, o));
export const answerTransferOffer = (b: string, p: string, c: string, id: number, accept: boolean): Promise<true> => withPreparedCareer(b, p, c, (db) => { respondOffer(db, id, accept); return true as const; });
export const listPlayerForSale = (b: string, p: string, c: string, playerId: string, listed: boolean): Promise<true> => withPreparedCareer(b, p, c, (db) => { setListed(db, playerId, listed); return true as const; });

export const getSeason = (b: string, p: string, c: string): Promise<SeasonStatusDto> => withPreparedCareer(b, p, c, (db) => getSeasonStatus(db));
export const beginNextSeason = (b: string, p: string, c: string): Promise<NewSeasonReportDto> => withPreparedCareer(b, p, c, (db) => startNextSeason(db));
export const listContracts = (b: string, p: string, c: string): Promise<ContractRowDto[]> => withPreparedCareer(b, p, c, (db) => getContracts(db));
export const offerRenewal = (b: string, p: string, c: string, input: RenewInput): Promise<RenewResultDto> => withPreparedCareer(b, p, c, (db) => renewContract(db, input));
export const listNews = (b: string, p: string, c: string): Promise<NewsDto[]> => withPreparedCareer(b, p, c, (db) => getNews(db));
export const careerHistory = (b: string, p: string, c: string): Promise<HistoryRowDto[]> => withPreparedCareer(b, p, c, (db) => getHistory(db));
export const trophyRoom = (b: string, p: string, c: string): Promise<TrophyRoomDto> => withPreparedCareer(b, p, c, (db) => getTrophies(db));
