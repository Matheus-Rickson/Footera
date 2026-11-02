/** Contrato da API exposta pelo preload ao renderer. */
import type { Methodology, Position } from './types.ts';
import type { CommentaryLine } from '../game/match-engine/commentary.ts';
import type { MatchConditions, PlayerReport, TeamStats, TeamTactics } from '../game/match-engine/types.ts';

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AppInfo { dataDir: string; version: string }
export interface ProfileDto { id: string; name: string; createdAt: string }

export interface ClubOption {
  id: string; name: string; league: string; leagueTier: number; country: string;
  reputation: number; avgOverall: number; stadium: string; capacity: number;
}
export interface ClubList {
  seed: string; startDate: string;
  countries: Array<{ code: string; name: string }>;
  clubs: ClubOption[];
}

export interface PhotoPick { token: string; dataUrl: string; width: number; height: number; format: 'png' | 'jpeg'; bytes: number; fileName: string }

export interface CoachInput {
  firstName: string; lastName: string; birthDate: string; nationality: string; methodology: Methodology;
}
export interface CreateCareerInput {
  profileId: string; seed: string; clubId: string; coach: CoachInput; photoToken: string | null;
}

export interface CareerSummaryDto {
  id: string; profileId: string; coachName: string; clubId: string; clubName: string;
  gameDate: string; season: number; createdAt: string; updatedAt: string; playSeconds: number; worldSeed: string;
}
export interface CareerListDto {
  careers: CareerSummaryDto[];
  unreadable: Array<{ id: string; reason: string }>;
}

export interface FixtureDto {
  id: string; competitionId: string; competitionName: string; round: number; date: string;
  homeId: string; homeName: string; awayId: string; awayName: string;
  status: 'scheduled' | 'played'; homeGoals: number | null; awayGoals: number | null;
}
export interface CompetitionInfoDto { id: string; name: string; country: string; tier: number; teamCount: number }
export type TableZone = 'promotion' | 'continental' | 'relegation' | null;
export interface StandingRowDto {
  position: number; clubId: string; clubName: string; played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; goalDiff: number; points: number; zone: TableZone; isUserClub: boolean;
}
export interface CompetitionTableDto {
  competition: CompetitionInfoDto; rows: StandingRowDto[]; roundsPlayed: number; totalRounds: number;
  tiebreakers: string[];
}
export interface CalendarDto { season: number; gameDate: string; clubId: string; fixtures: FixtureDto[] }
export type AdvanceMode = 'day' | 'nextMatchday';
export interface AdvanceResultDto {
  advanced: boolean; fromDate: string; toDate: string; daysAdvanced: number;
  reason: 'ok' | 'pending_matches' | 'season_complete'; pendingMatches: number; message: string;
}

export interface FinanceOverviewDto {
  balance: number; lastSettledMonth: string | null;
  /** `items`: lançamentos do mês por categoria (positivo = receita, negativo = despesa). `settled`: false = mês sem a cobrança mensal (save anterior às finanças). */
  last12: Array<{ month: string; income: number; expense: number; net: number; settled: boolean; items: Array<{ category: string; amount: number }> }>;
  lastMonth: Array<{ category: 'gate' | 'tv' | 'sponsorship' | 'merchandising' | 'wages' | 'staff' | 'maintenance' | 'operations' | 'transfer_in' | 'transfer_out'; amount: number }>;
  projection: { income: number; expense: number; net: number; wageBill: number; gate: number; gateEstimated: boolean };
  runwayMonths: number | null;
  sponsors: Array<{ id: string; kind: 'shirt' | 'kit' | 'stadium'; sponsor: string; monthly: number; start: string; end: string }>;
  gates: Array<{ fixtureId: string; date: string; opponent: string; attendance: number; capacity: number; revenue: number }>;
  ledger: Array<{ date: string; category: string; amount: number; description: string }>;
}
export interface Range { low: number; high: number }
export interface MarketFilter { position?: 'GK' | 'DEF' | 'MID' | 'ATT' | Position; minAge?: number; maxAge?: number; maxValue?: number; name?: string }
export interface MarketPlayerDto {
  id: string; name: string; age: number; nationality: string; position: Position; secondaryPositions: Position[]; foot: string;
  clubId: string; clubName: string; marketValue: number; salary: number; contractEnd: string;
  /** Estimativas com margem de erro (os atributos reais só aparecem depois de contratado). */
  estOverall: Range; estPotential: Range;
}
export interface OfferInput { playerId: string; fee: number; wage: number; years: number }
export interface OfferResultDto {
  outcome: 'completed' | 'club_counter' | 'club_rejected' | 'player_counter' | 'player_rejected';
  message: string; counterFee?: number; counterWage?: number;
}
export interface IncomingOfferDto { id: number; date: string; expires: string; playerId: string; playerName: string; position: Position; age: number; marketValue: number; buyerClubName: string; fee: number }
export interface TransferLogDto { id: number; date: string; playerName: string; fromClub: string | null; toClub: string; fee: number; kind: 'purchase' | 'sale' | 'ai' }
export interface MyPlayerDto { id: string; name: string; position: Position; age: number; marketValue: number; salary: number; contractEnd: string; listed: boolean }
export interface TransfersOverviewDto {
  window: { open: boolean; opensOn: string | null; closesOn: string | null }; balance: number; squadSize: number; squadMin: number; squadMax: number;
  incoming: IncomingOfferDto[]; mine: MyPlayerDto[]; recent: TransferLogDto[];
}

export interface SchemeDto { id: string; name: string; formation: string; settings: TeamTactics; lineup: string[] | null; builtin: boolean; active: boolean }
export interface SchemeInput { id?: string | null; name: string; formation: string; settings: TeamTactics; lineup: string[] | null }
export interface TacticsSquadPlayer {
  id: string; name: string; position: Position; secondaryPositions: Position[]; overall: number; condition: number;
  unavailable: { kind: 'injured'; until: string } | { kind: 'suspended'; matches: number } | null;
  slotScores: Record<Position, number>;
}
export interface TacticsOverviewDto {
  schemes: SchemeDto[]; squad: TacticsSquadPlayer[]; formations: Array<{ id: string; slots: Array<{ pos: Position; x: number; y: number }> }>;
}

export interface MatchSummaryDto {
  fixtureId: string; competitionName: string; date: string; round: number;
  homeName: string; awayName: string; homeGoals: number; awayGoals: number; involvesUser: boolean;
}
export interface SimulationSummaryDto {
  date: string; simulated: number; userMatch: MatchSummaryDto | null; results: MatchSummaryDto[]; notes: string[];
}
export interface MatchReportDto {
  fixtureId: string; competitionName: string; date: string; round: number; detail: 'full' | 'compact';
  home: { clubId: string; name: string; formation: string }; away: { clubId: string; name: string; formation: string };
  homeGoals: number; awayGoals: number; decidedIn: 'regular' | 'extra_time' | 'penalties';
  shootout: { home: number; away: number } | null;
  conditions: MatchConditions; duration: number;
  stats: [TeamStats, TeamStats]; players: PlayerReport[];
  lineups: Array<{ clubId: string; name: string; formation: string; slots: Array<{ slot: Position; x: number; y: number; playerId: string }> }>;
  commentary: CommentaryLine[];
  manOfTheMatch: { id: string; name: string } | null;
  attendance: { attendance: number; capacity: number; revenue: number } | null;
  tactics: [TeamTactics, TeamTactics] | null;
}

export interface SquadRow {
  id: string; name: string; position: Position; age: number; overall: number;
  potentialEstimated: number; condition: number; morale: number; salary: number; contractEnd: string;
}
export interface CareerOverviewDto {
  summary: CareerSummaryDto;
  coach: {
    firstName: string; lastName: string; birthDate: string; age: number; nationality: string;
    methodology: Methodology; reputation: number;
  };
  photoDataUrl: string | null;
  nationalityName: string;
  nextFixture: FixtureDto | null;
  pendingMatches: number;
  leaguePosition: { competitionId: string; position: number; total: number; points: number; played: number } | null;
  warnings: string[];
  club: {
    id: string; name: string; city: string; league: string; country: string;
    reputation: number; balance: number; fans: number; stadium: string; capacity: number;
  };
  squad: SquadRow[];
}

export interface GameApi {
  appInfo(): Promise<IpcResult<AppInfo>>;
  listProfiles(): Promise<IpcResult<ProfileDto[]>>;
  createProfile(name: string): Promise<IpcResult<ProfileDto>>;
  listClubs(seed: string): Promise<IpcResult<ClubList>>;
  pickPhoto(): Promise<IpcResult<PhotoPick | null>>;
  discardPhoto(token: string): Promise<IpcResult<true>>;
  createCareer(input: CreateCareerInput): Promise<IpcResult<CareerSummaryDto>>;
  listCareers(profileId: string): Promise<IpcResult<CareerListDto>>;
  openCareer(profileId: string, careerId: string): Promise<IpcResult<CareerOverviewDto>>;
  getCalendar(profileId: string, careerId: string): Promise<IpcResult<CalendarDto>>;
  listCompetitions(profileId: string, careerId: string): Promise<IpcResult<{ userCompetitionId: string | null; competitions: CompetitionInfoDto[] }>>;
  getCompetitionTable(profileId: string, careerId: string, competitionId: string): Promise<IpcResult<CompetitionTableDto>>;
  advance(profileId: string, careerId: string, mode: AdvanceMode): Promise<IpcResult<AdvanceResultDto>>;
  getTransfers(profileId: string, careerId: string): Promise<IpcResult<TransfersOverviewDto>>;
  searchMarket(profileId: string, careerId: string, filter: MarketFilter): Promise<IpcResult<MarketPlayerDto[]>>;
  makeOffer(profileId: string, careerId: string, offer: OfferInput): Promise<IpcResult<OfferResultDto>>;
  respondOffer(profileId: string, careerId: string, offerId: number, accept: boolean): Promise<IpcResult<true>>;
  setListed(profileId: string, careerId: string, playerId: string, listed: boolean): Promise<IpcResult<true>>;
  getFinance(profileId: string, careerId: string): Promise<IpcResult<FinanceOverviewDto>>;
  getTactics(profileId: string, careerId: string): Promise<IpcResult<TacticsOverviewDto>>;
  saveScheme(profileId: string, careerId: string, scheme: SchemeInput): Promise<IpcResult<SchemeDto>>;
  duplicateScheme(profileId: string, careerId: string, schemeId: string): Promise<IpcResult<SchemeDto>>;
  deleteScheme(profileId: string, careerId: string, schemeId: string): Promise<IpcResult<true>>;
  activateScheme(profileId: string, careerId: string, schemeId: string): Promise<IpcResult<true>>;
  autoLineup(profileId: string, careerId: string, formation: string): Promise<IpcResult<string[]>>;
  simulateMatchday(profileId: string, careerId: string): Promise<IpcResult<SimulationSummaryDto>>;
  getMatchReport(profileId: string, careerId: string, fixtureId: string): Promise<IpcResult<MatchReportDto>>;
  listRound(profileId: string, careerId: string, competitionId: string, round: number): Promise<IpcResult<FixtureDto[]>>;
  quit(): Promise<IpcResult<true>>;
}
declare global { interface Window { api: GameApi } }
