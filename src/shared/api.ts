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
  lastMonth: Array<{ category: 'gate' | 'tv' | 'sponsorship' | 'merchandising' | 'wages' | 'staff' | 'maintenance' | 'operations' | 'transfer_in' | 'transfer_out' | 'prize' | 'youth' | 'scouting'; amount: number }>;
  projection: { income: number; expense: number; net: number; wageBill: number; youthBill: number; scoutBill: number; gate: number; gateEstimated: boolean };
  runwayMonths: number | null;
  sponsors: Array<{ id: string; kind: 'shirt' | 'kit' | 'stadium'; sponsor: string; monthly: number; start: string; end: string }>;
  gates: Array<{ fixtureId: string; date: string; opponent: string; attendance: number; capacity: number; revenue: number }>;
  ledger: Array<{ date: string; category: string; amount: number; description: string }>;
}
export interface Range { low: number; high: number }
export interface MarketFilter { position?: 'GK' | 'DEF' | 'MID' | 'ATT' | Position; minAge?: number; maxAge?: number; maxValue?: number; name?: string; /** só jogadores sem clube */ freeOnly?: boolean }
export interface MarketPlayerDto {
  id: string; name: string; age: number; nationality: string; position: Position; secondaryPositions: Position[]; foot: string;
  /** null = jogador livre (sem clube): contratação sem taxa, fora das janelas inclusive. */
  clubId: string | null; clubName: string | null; marketValue: number; salary: number; contractEnd: string;
  /** Estimativas com margem de erro (os atributos reais só aparecem depois de contratado). */
  estOverall: Range; estPotential: Range;
  /** Conhecimento da rede de olheiros (0..100): quanto maior, mais estreitas as faixas. */
  knowledge: number; shortlisted: boolean;
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
  /** Virada de temporada: `canStart` = todas as partidas disputadas e a data chegou a 1º/jul. */
  seasonStatus: { complete: boolean; turnoverDate: string; canStart: boolean };
  club: {
    id: string; name: string; city: string; league: string; country: string;
    reputation: number; balance: number; fans: number; stadium: string; capacity: number;
  };
  squad: SquadRow[];
}

// ---------------------------------------------------------------- ciclo de carreira (Fase 8A)
export interface NewsDto { id: number; date: string; kind: 'season' | 'trophy' | 'transfer' | 'contract' | 'youth' | 'retirement' | 'offer' | 'staff'; title: string; body: string }
export interface ContractRowDto {
  id: string; name: string; position: Position; age: number; overall: number; salary: number; contractEnd: string;
  monthsLeft: number; /** vence na próxima virada (1º/jul) */ expiresThisSeason: boolean; canRenew: boolean; maxYears: number;
  /** renovar por N temporadas = contrato até 30/06 de (renewBaseYear + N) */ renewBaseYear: number;
}
export interface RenewInput { playerId: string; wage: number; years: number }
export interface RenewResultDto { outcome: 'accepted' | 'counter' | 'rejected'; message: string; counterWage?: number; contractEnd?: string }
export interface SeasonStatusDto {
  season: number; label: string; gameDate: string; turnoverDate: string; matchesLeft: number; complete: boolean; canStart: boolean;
  user: { competitionId: string; competitionName: string; position: number; teamCount: number; points: number; played: number; zone: TableZone; prizeIfEndedNow: number } | null;
  leagues: Array<{ competitionId: string; name: string; country: string; tier: number; leader: string | null; roundsPlayed: number; totalRounds: number }>;
  expiring: ContractRowDto[];
}
export interface NewSeasonReportDto {
  season: number; label: string;
  previous: { season: number; competitionName: string; position: number; teamCount: number; outcome: 'champion' | 'promoted' | 'relegated' | null; prize: number } | null;
  newLeague: string;
  champions: Array<{ competitionName: string; country: string; clubName: string }>;
  movements: Array<{ country: string; promoted: string[]; relegated: string[] }>;
  retiredUser: string[]; retiredTotal: number; releasedUser: string[];
  /** jovens de 19 anos que deixaram a sua base sem ser promovidos */ youthReleased: string[];
  autoPromoted: string[]; aiRenewed: number; aiReleased: number;
}
export interface HistoryRowDto {
  season: number; current: boolean; competitionName: string; tier: number; position: number; teamCount: number;
  played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number;
  outcome: 'champion' | 'promoted' | 'relegated' | null; prize: number;
}
export interface TrophyDto { season: number; competitionName: string; country: string; clubName: string; wonByUser: boolean }
export interface TrophyRoomDto { mine: TrophyDto[]; champions: TrophyDto[] }

// ---------------------------------------------------------------- olheiros e categorias de base (Fase 8B)
export type ScoutAssignment = { kind: 'shortlist' } | { kind: 'country'; countryCode: string };
export interface ScoutDto { id: string; name: string; nationality: string; ability: number; salary: number; contractEnd: string; assignment: ScoutAssignment }
export interface ScoutCandidateDto { id: string; name: string; nationality: string; ability: number; salary: number }
export interface ScoutingOverviewDto {
  scouts: ScoutDto[]; candidates: ScoutCandidateDto[]; maxScouts: number; monthlyCost: number; countries: Array<{ code: string; name: string }>;
  shortlist: MarketPlayerDto[]; reports: MarketPlayerDto[];
}
/** Ficha de um jogador. De outros clubes: só estimativas (faixas); do próprio clube: valores reais (faixas com low = high). */
export interface PlayerProfileDto {
  id: string; name: string; age: number; nationality: string; position: Position; secondaryPositions: Position[]; foot: string; heightCm: number; weightKg: number;
  clubId: string | null; clubName: string | null; own: boolean; youth: boolean; marketValue: number; salary: number; contractEnd: string;
  knowledge: number; estOverall: Range; estPotential: Range;
  /** null = conhecimento insuficiente para relatar atributos */
  attributes: { technical: Record<string, Range>; mental: Record<string, Range>; physical: Record<string, Range> } | null;
  stats: { appearances: number; goals: number; assists: number; avgRating: number | null };
  verdict: { level: 'starter' | 'rotation' | 'depth' | 'no'; text: string } | null;
  /** Para negociar a partir da ficha (null para jogadores do próprio clube). */
  market: MarketPlayerDto | null;
  /** pode receber proposta agora (janela aberta, ou jogador livre) */ negotiable: boolean;
}
export interface YouthPlayerDto { id: string; name: string; position: Position; age: number; overall: number; potentialEstimated: number; salary: number; /** completa 19 anos até a virada: sai se não for promovido */ leavesAtTurnover: boolean }
export interface YouthOverviewDto {
  players: YouthPlayerDto[]; academyLevel: number; nextIntake: string; lastIntake: { date: string; names: string[] } | null; cap: number; seniorSize: number; seniorMax: number;
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
  getSeasonStatus(profileId: string, careerId: string): Promise<IpcResult<SeasonStatusDto>>;
  startNextSeason(profileId: string, careerId: string): Promise<IpcResult<NewSeasonReportDto>>;
  getContracts(profileId: string, careerId: string): Promise<IpcResult<ContractRowDto[]>>;
  renewContract(profileId: string, careerId: string, input: RenewInput): Promise<IpcResult<RenewResultDto>>;
  getNews(profileId: string, careerId: string): Promise<IpcResult<NewsDto[]>>;
  getHistory(profileId: string, careerId: string): Promise<IpcResult<HistoryRowDto[]>>;
  getTrophies(profileId: string, careerId: string): Promise<IpcResult<TrophyRoomDto>>;
  getScouting(profileId: string, careerId: string): Promise<IpcResult<ScoutingOverviewDto>>;
  hireScout(profileId: string, careerId: string, candidateId: string): Promise<IpcResult<true>>;
  fireScout(profileId: string, careerId: string, scoutId: string): Promise<IpcResult<number>>;
  assignScout(profileId: string, careerId: string, scoutId: string, assignment: ScoutAssignment): Promise<IpcResult<true>>;
  setShortlisted(profileId: string, careerId: string, playerId: string, on: boolean): Promise<IpcResult<true>>;
  getYouth(profileId: string, careerId: string): Promise<IpcResult<YouthOverviewDto>>;
  promoteYouth(profileId: string, careerId: string, playerId: string): Promise<IpcResult<true>>;
  releaseYouth(profileId: string, careerId: string, playerId: string): Promise<IpcResult<true>>;
  getPlayerProfile(profileId: string, careerId: string, playerId: string): Promise<IpcResult<PlayerProfileDto>>;
  quit(): Promise<IpcResult<true>>;
}
declare global { interface Window { api: GameApi } }
