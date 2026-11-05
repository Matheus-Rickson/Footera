import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../database/connection.ts';
import { migrate } from '../database/migrator.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import {
  advanceTime, countPending, ensureSeason, getCareerState, getClubCalendar, getCompetitionTable, getNextFixture, listCompetitions, listRound,
} from '../database/repositories/competitionRepository.ts';
import { getMatchReport, previewUserMatch, simulateMatchday } from '../database/repositories/matchRepository.ts';
import { ensureFinance, getFinanceOverview } from '../database/repositories/financeRepository.ts';
import { getNegotiation, getTransfersOverview, makeOffer, proposeFee, respondOffer, searchMarketPage, setListed } from '../database/repositories/transferRepository.ts';
import {
  activateScheme, autoLineup, deleteScheme, duplicateScheme, ensureSchemes, getTacticsOverview, saveScheme,
} from '../database/repositories/tacticsRepository.ts';
import { getContracts, getHistory, getSeasonStatus, getTrophies, renewContract, startNextSeason } from '../database/repositories/seasonRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import { turnoverDate } from '../game/career-engine/contracts.ts';
import { assignScout, fireScout, getPlayerProfile, getScoutingOverview, hireScout, setShortlisted } from '../database/repositories/scoutRepository.ts';
import { ensureYouthAcademies, getYouthOverview, promoteYouth, releaseYouth } from '../database/repositories/youthRepository.ts';
import { getMedicalOverview, getTrainingOverview, setDelegated, setFocus, setIntensity, setRoleFocus } from '../database/repositories/trainingRepository.ts';
import { fireStaff, getStaffOverview, hireStaff } from '../database/repositories/staffRepository.ts';
import { getInfrastructureOverview, startUpgrade } from '../database/repositories/infrastructureRepository.ts';
import { ensureBoard, getBoardOverview, requestBudget, respondJobOffer } from '../database/repositories/boardRepository.ts';
import { isEmployed } from '../database/repositories/careerRepository.ts';
import { UserError } from '../shared/errors.ts';
import type { SqlDb } from '../database/types.ts';
import { withTransaction } from '../database/types.ts';
import { createCareer, validateCoach, ValidationError } from './careerService.ts';
import { ID_RE, listProfiles } from './profileService.node.ts';
import { generateWorld } from '../game/world/generator.ts';
import { ImageError, inspectImage } from '../shared/photo.ts';
import { ageOn } from '../shared/date.ts';
import type { Coach, Methodology } from '../shared/types.ts';
import type {
  BoardOverviewDto, FacilityKind, Intensity, InfrastructureOverviewDto, MedicalOverviewDto, StaffOverviewDto, TrainingFocus, TrainingOverviewDto,
  PlayerProfileDto, ScoutAssignment, ScoutingOverviewDto, YouthOverviewDto,
  ContractRowDto, HistoryRowDto, NewSeasonReportDto, NewsDto, RenewInput, RenewResultDto, SeasonStatusDto, TrophyRoomDto,
  AdvanceMode, AdvanceResultDto, CalendarDto, FinanceOverviewDto, FixtureDto, MarketFilter, MarketPageDto, OfferInput, OfferResultDto, NegotiationDto, FeeResultDto, LiveOptionsInput, LiveMatchDto, TransfersOverviewDto, MatchReportDto, SchemeDto, SchemeInput, SimulationSummaryDto, TacticsOverviewDto, CareerListDto, CareerOverviewDto, CareerSummaryDto, CoachInput, CompetitionInfoDto, CompetitionTableDto,
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
       FROM career c LEFT JOIN clubs cl ON cl.id = c.club_id WHERE c.id = 1`).get();
  if (!row) throw new Error('Registro de carreira ausente.');
  const coach = JSON.parse(String(row.coach_json)) as Coach;
  return {
    id: careerId, profileId, coachName: `${coach.firstName} ${coach.lastName}`, clubId: row.club_id == null ? '' : String(row.club_id),
    clubName: row.club_name == null ? 'Sem clube' : String(row.club_name), gameDate: String(row.game_date), season: Number(row.season),
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

import { POS_ORDER } from '../shared/positions.ts';

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
    ensureYouthAcademies(db); // categorias de base em saves anteriores à Fase 8B
    ensureBoard(db); // diretoria em saves anteriores à Fase 8D
    const summary = summaryFromDb(db, profileId, careerId);
    const coach = JSON.parse(String((db.prepare('SELECT coach_json FROM career WHERE id = 1').get() as { coach_json: string }).coach_json)) as Coach;
    const c = db.prepare(
      `SELECT cl.*, l.name AS league_name, co.name AS country_name, st.name AS stadium_name, st.capacity
         FROM clubs cl JOIN leagues l ON l.id = cl.league_id JOIN countries co ON co.id = cl.country_id
         JOIN stadiums st ON st.id = cl.stadium_id WHERE cl.id = ?`).get(summary.clubId);
    if (!c && summary.clubId) throw new Error('Clube da carreira não encontrado no save.');
    const countries = new Map(db.prepare('SELECT code, name FROM countries').all().map((r) => [String(r.code), String(r.name)]));
    const statusOf = new Map(db.prepare('SELECT ps.player_id, ps.injury_until, ps.suspension_matches FROM player_status ps JOIN players p ON p.id = ps.player_id WHERE p.club_id = ?')
      .all(summary.clubId).map((r) => [String(r.player_id), { injuredUntil: r.injury_until != null && String(r.injury_until) > summary.gameDate ? String(r.injury_until) : null, suspension: Number(r.suspension_matches) }]));
    const statsOf = new Map(db.prepare(`SELECT pss.player_id, SUM(pss.appearances) AS apps, SUM(pss.minutes) AS mins, SUM(pss.goals) AS g, SUM(pss.assists) AS a,
        SUM(pss.rating_sum) AS rs, SUM(pss.yellow_cards) AS y, SUM(pss.red_cards) AS r
        FROM player_season_stats pss JOIN competitions c ON c.id = pss.competition_id WHERE pss.club_id = ? AND c.season = ? GROUP BY pss.player_id`)
      .all(summary.clubId, summary.season).map((r) => [String(r.player_id), {
        appearances: Number(r.apps), minutes: Number(r.mins), goals: Number(r.g), assists: Number(r.a),
        avgRating: Number(r.apps) > 0 ? Math.round((Number(r.rs) / Number(r.apps)) * 100) / 100 : null, yellows: Number(r.y), reds: Number(r.r) }]));
    const noStats = { appearances: 0, minutes: 0, goals: 0, assists: 0, avgRating: null, yellows: 0, reds: 0 };
    const squad = db.prepare('SELECT * FROM players WHERE club_id = ?').all(summary.clubId).map(rowToPlayer)
      .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position) || b.overall - a.overall)
      .map((p) => ({
        id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, age: ageOn(p.birthDate, summary.gameDate),
        overall: p.overall, potentialEstimated: Math.max(p.overall, p.potentialEstimated), condition: p.condition, morale: p.morale,
        salary: p.salary, contractEnd: p.contractEnd,
        secondaryPositions: p.secondaryPositions, nationality: p.nationality, nationalityName: countries.get(p.nationality) ?? p.nationality, heightCm: p.heightCm,
        status: statusOf.get(p.id) ?? { injuredUntil: null, suspension: 0 }, stats: statsOf.get(p.id) ?? noStats,
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
      employed: !!c,
      club: c ? {
        id: String(c.id), name: String(c.name), city: String(c.city), league: String(c.league_name),
        country: String(c.country_name), reputation: Number(c.reputation), balance: Number(c.balance),
        fans: Number(c.fans), stadium: String(c.stadium_name), capacity: Number(c.capacity),
      } : null,
      squad,
    };
  });
}

/** Como `withPreparedCareer`, mas só com clube: bloqueado quando o treinador está desempregado. */
function withClubCareer<T>(base: string, profileId: string, careerId: string, fn: (db: SqlDb) => T): Promise<T> {
  return withPreparedCareer(base, profileId, careerId, (db) => {
    if (!isEmployed(db)) throw new UserError('Você está sem clube: aceite uma proposta de emprego na aba Diretoria.');
    return fn(db);
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
    ensureYouthAcademies(db);
    ensureBoard(db);
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
/** Partida ao vivo: prévia sem gravar nada, com as decisões do técnico até agora. */
export const previewCareerLiveMatch = (base: string, profileId: string, careerId: string, live: LiveOptionsInput): Promise<LiveMatchDto> =>
  withClubCareer(base, profileId, careerId, (db) => previewUserMatch(db, live));
/** Partida ao vivo: grava a rodada inteira (atômica) com as decisões do técnico. */
export const finishCareerLiveMatch = (base: string, profileId: string, careerId: string, live: LiveOptionsInput): Promise<SimulationSummaryDto> =>
  withPreparedCareer(base, profileId, careerId, (db) => simulateMatchday(db, live));

export const getReport = (base: string, profileId: string, careerId: string, fixtureId: string): Promise<MatchReportDto> =>
  withPreparedCareer(base, profileId, careerId, (db) => getMatchReport(db, fixtureId));

export const getRound = (base: string, profileId: string, careerId: string, competitionId: string, round: number): Promise<FixtureDto[]> =>
  withPreparedCareer(base, profileId, careerId, (db) => listRound(db, competitionId, round));

type Ref = [string, string, string];
export const getTactics = (b: string, p: string, c: string): Promise<TacticsOverviewDto> => withClubCareer(b, p, c, (db) => getTacticsOverview(db));
export const saveTacticScheme = (b: string, p: string, c: string, scheme: SchemeInput): Promise<SchemeDto> => withClubCareer(b, p, c, (db) => saveScheme(db, scheme));
export const duplicateTacticScheme = (b: string, p: string, c: string, id: string): Promise<SchemeDto> => withClubCareer(b, p, c, (db) => duplicateScheme(db, id));
export const deleteTacticScheme = (b: string, p: string, c: string, id: string): Promise<true> => withClubCareer(b, p, c, (db) => { deleteScheme(db, id); return true as const; });
export const activateTacticScheme = (b: string, p: string, c: string, id: string): Promise<true> => withClubCareer(b, p, c, (db) => { activateScheme(db, id); return true as const; });
export const getAutoLineup = (b: string, p: string, c: string, formation: string): Promise<string[]> => withClubCareer(b, p, c, (db) => autoLineup(db, formation));
export type { Ref };

export const getFinance = (b: string, p: string, c: string): Promise<FinanceOverviewDto> => withClubCareer(b, p, c, (db) => getFinanceOverview(db));

export const getTransfers = (b: string, p: string, c: string): Promise<TransfersOverviewDto> => withClubCareer(b, p, c, (db) => getTransfersOverview(db));
export const searchTransferMarket = (b: string, p: string, c: string, f: MarketFilter): Promise<MarketPageDto> => withClubCareer(b, p, c, (db) => searchMarketPage(db, f));
export const sendTransferOffer = (b: string, p: string, c: string, o: OfferInput): Promise<OfferResultDto> => withClubCareer(b, p, c, (db) => makeOffer(db, o));
export const getTransferNegotiation = (b: string, p: string, c: string, playerId: string): Promise<NegotiationDto> => withClubCareer(b, p, c, (db) => getNegotiation(db, playerId));
export const proposeTransferFee = (b: string, p: string, c: string, playerId: string, fee: number): Promise<FeeResultDto> => withClubCareer(b, p, c, (db) => proposeFee(db, playerId, fee));
export const answerTransferOffer = (b: string, p: string, c: string, id: number, accept: boolean): Promise<true> => withClubCareer(b, p, c, (db) => { respondOffer(db, id, accept); return true as const; });
export const listPlayerForSale = (b: string, p: string, c: string, playerId: string, listed: boolean): Promise<true> => withClubCareer(b, p, c, (db) => { setListed(db, playerId, listed); return true as const; });

export const getSeason = (b: string, p: string, c: string): Promise<SeasonStatusDto> => withPreparedCareer(b, p, c, (db) => getSeasonStatus(db));
export const beginNextSeason = (b: string, p: string, c: string): Promise<NewSeasonReportDto> => withPreparedCareer(b, p, c, (db) => startNextSeason(db));
export const listContracts = (b: string, p: string, c: string): Promise<ContractRowDto[]> => withClubCareer(b, p, c, (db) => getContracts(db));
export const offerRenewal = (b: string, p: string, c: string, input: RenewInput): Promise<RenewResultDto> => withClubCareer(b, p, c, (db) => renewContract(db, input));
export const listNews = (b: string, p: string, c: string): Promise<NewsDto[]> => withPreparedCareer(b, p, c, (db) => getNews(db));
export const careerHistory = (b: string, p: string, c: string): Promise<HistoryRowDto[]> => withPreparedCareer(b, p, c, (db) => getHistory(db));
export const trophyRoom = (b: string, p: string, c: string): Promise<TrophyRoomDto> => withPreparedCareer(b, p, c, (db) => getTrophies(db));

export const getScouting = (b: string, p: string, c: string): Promise<ScoutingOverviewDto> => withClubCareer(b, p, c, (db) => getScoutingOverview(db));
export const hireScoutFor = (b: string, p: string, c: string, id: string): Promise<true> => withClubCareer(b, p, c, (db) => { hireScout(db, id); return true as const; });
export const fireScoutFor = (b: string, p: string, c: string, id: string): Promise<number> => withClubCareer(b, p, c, (db) => fireScout(db, id));
export const assignScoutFor = (b: string, p: string, c: string, id: string, a: ScoutAssignment): Promise<true> => withClubCareer(b, p, c, (db) => { assignScout(db, id, a); return true as const; });
export const shortlistFor = (b: string, p: string, c: string, id: string, on: boolean): Promise<true> => withClubCareer(b, p, c, (db) => { setShortlisted(db, id, on); return true as const; });
export const getYouth = (b: string, p: string, c: string): Promise<YouthOverviewDto> => withClubCareer(b, p, c, (db) => getYouthOverview(db));
export const promoteYouthFor = (b: string, p: string, c: string, id: string): Promise<true> => withClubCareer(b, p, c, (db) => { promoteYouth(db, id); return true as const; });
export const releaseYouthFor = (b: string, p: string, c: string, id: string): Promise<true> => withClubCareer(b, p, c, (db) => { releaseYouth(db, id); return true as const; });
export const playerProfile = (b: string, p: string, c: string, id: string): Promise<PlayerProfileDto> => withClubCareer(b, p, c, (db) => getPlayerProfile(db, id));

export const getTraining = (b: string, p: string, c: string): Promise<TrainingOverviewDto> => withClubCareer(b, p, c, (db) => getTrainingOverview(db));
export const setTrainingIntensity = (b: string, p: string, c: string, v: Intensity): Promise<true> => withClubCareer(b, p, c, (db) => { setIntensity(db, v); return true as const; });
export const setTrainingDelegated = (b: string, p: string, c: string, on: boolean): Promise<true> => withClubCareer(b, p, c, (db) => { setDelegated(db, on); return true as const; });
export const setTrainingFocus = (b: string, p: string, c: string, id: string, f: TrainingFocus): Promise<true> => withClubCareer(b, p, c, (db) => { setFocus(db, id, f); return true as const; });
export const setTrainingRoleFocus = (b: string, p: string, c: string, id: string, role: string | null): Promise<true> => withClubCareer(b, p, c, (db) => { setRoleFocus(db, id, role); return true as const; });
export const getStaff = (b: string, p: string, c: string): Promise<StaffOverviewDto> => withClubCareer(b, p, c, (db) => getStaffOverview(db));
export const hireStaffFor = (b: string, p: string, c: string, id: string): Promise<true> => withClubCareer(b, p, c, (db) => { hireStaff(db, id); return true as const; });
export const fireStaffFor = (b: string, p: string, c: string, id: string): Promise<number> => withClubCareer(b, p, c, (db) => fireStaff(db, id));
export const getMedical = (b: string, p: string, c: string): Promise<MedicalOverviewDto> => withClubCareer(b, p, c, (db) => getMedicalOverview(db));
export const getInfrastructure = (b: string, p: string, c: string): Promise<InfrastructureOverviewDto> => withClubCareer(b, p, c, (db) => getInfrastructureOverview(db));
export const startUpgradeFor = (b: string, p: string, c: string, k: FacilityKind): Promise<true> => withClubCareer(b, p, c, (db) => { startUpgrade(db, k); return true as const; });

export const getBoard = (b: string, p: string, c: string): Promise<BoardOverviewDto> => withPreparedCareer(b, p, c, (db) => getBoardOverview(db));
export const answerJobOffer = (b: string, p: string, c: string, id: number, accept: boolean): Promise<true> => withPreparedCareer(b, p, c, (db) => { respondJobOffer(db, id, accept); return true as const; });
export const askBudget = (b: string, p: string, c: string, kind: 'transfer' | 'wage'): Promise<{ approved: boolean; message: string }> => withClubCareer(b, p, c, (db) => withTransaction(db, () => requestBudget(db, kind)));
