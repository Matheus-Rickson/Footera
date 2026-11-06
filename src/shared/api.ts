/** Contrato da API exposta pelo preload ao renderer. */
import type { AttrSummary } from './attributeSummary.ts';
import type { CoachAttributes, CoachAttrKey } from './coachAttributes.ts';
import type { Methodology, Position } from './types.ts';
import type { CommentaryLine } from '../game/match-engine/commentary.ts';
import type { MatchConditions, MatchTick, PlayerReport, TeamStats, TeamTactics } from '../game/match-engine/types.ts';
import type { TalkTone } from '../game/match-engine/teamTalk.ts';

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AppInfo { dataDir: string; version: string }
export interface ProfileDto { id: string; name: string; createdAt: string }

export interface ClubOption {
  id: string; countryId: string; leagueId: string; name: string; league: string; leagueTier: number; country: string;
  reputation: number; avgOverall: number; stadium: string; stadiumId: string; capacity: number;
  city: string; fans: number; balance: number; facilities: { training: number; youth: number; medical: number; stadium: number };
  /** objetivo que a diretoria vai cobrar (mesma regra da Diretoria) e posição esperada na liga */
  objective: string; expectedPosition: number; teamCount: number;
  squadSize: number; avgAge: number;
  /** 3 jogadores mais fortes (força 0–100; a tela mostra 1–20) */
  stars: Array<{ name: string; position: Position; overall: number }>;
  /** pacote de dados que criou o clube (null = base do jogo) e os que o alteraram */
  origin: { created: string | null; edited: string[] };
  /** história resumida de EXEMPLO (gerada; provisória até a base ter histórias próprias) */
  story: { founded: number; nickname: string; colors: string; text: string[] };
  /** técnico no início do universo (o mesmo do jogo; se o usuário escolher o clube, ele o substitui) */
  coach: { id: string; name: string; nationality: string; age: number; reputation: number } | null;
}
/** Base de dados fixa, para a tela de nova carreira: países (com divisões e clubes) e clubes escolhíveis. */
export interface ClubList {
  startDate: string;
  countries: Array<{ id: string; code: string; name: string; divisions: number; clubs: number; leagues: Array<{ id: string; name: string; tier: number; clubs: number }> }>;
  clubs: ClubOption[];
}

/** Pacote de dados do usuário (pasta em <dados>/packs). `issues` = erros de estrutura (impedem ativar). */
export interface PackInfoDto {
  id: string; folder: string; name: string; version: string; author: string | null; description: string | null;
  enabled: boolean; order: number | null; requires: string[]; fullBase: boolean;
  counts: { countries: number; leagues: number; stadiums: number; clubs: number; players: number; coaches: number } | null;
  issues: string[];
}
/** Tela de pacotes: base fixa, pacotes encontrados e o universo resultante da ordem de carga atual. */
export interface PacksOverviewDto {
  base: { name: string; version: string }; packs: PackInfoDto[]; folder: string;
  universe: { ok: boolean; errors: string[]; warnings: string[]; countries: number; leagues: number; clubs: number; players: number };
}
// ---------------------------------------------------------------- editor de dados (pacote do usuário em cima da base)
export type EditorKind = 'countries' | 'leagues' | 'clubs' | 'players' | 'coaches';
/** Resultado da importação de CSV no editor (tudo ou nada: com erros, nada foi gravado). */
export interface CsvImportReportDto { created: number; updated: number; /** linhas iguais ao que já existe (nada gravado) */ unchanged: number; errors: string[]; warnings: string[] }
/** base = como na base; edited = alterado por este pacote; created = criado por ele; removed = excluído por ele */
export type EditorStatus = 'base' | 'edited' | 'created' | 'removed';
export interface EditorListQuery {
  kind: EditorKind; search?: string; countryId?: string; leagueId?: string; clubId?: string; position?: Position;
  /** só o que este pacote mudou */ onlyChanged?: boolean; offset?: number; limit?: number;
}
export interface EditorListDto { total: number; rows: Array<{ id: string; title: string; subtitle: string; status: EditorStatus; extra: string | null }> }
export interface EditorOptionsDto {
  countries: Array<{ id: string; name: string; code: string }>;
  leagues: Array<{ id: string; name: string; countryId: string; tier: number }>;
  clubs: Array<{ id: string; name: string; leagueId: string; countryId: string }>;
}
/** Registro no formato do pacote (atributos, força e potencial de 1 a 20). Clubes trazem o estádio junto. */
export interface EditorEntityDto {
  kind: EditorKind; id: string; status: EditorStatus; inBase: boolean;
  record: Record<string, unknown>; stadium: Record<string, unknown> | null;
  derived: { overall?: number | null; marketValue?: number; age?: number; squad?: number };
}
export interface EditorSummaryDto {
  pack: { id: string; name: string; version: string; author: string | null; description: string | null };
  changes: Record<EditorKind, { created: number; edited: number; removed: number }>;
  /** pacote ativo na ordem de carga (vale nas próximas carreiras) */ enabled: boolean;
}
export type PackImportDto = { status: 'imported' | 'exists' | 'cancelled'; id?: string; name?: string };

export interface PhotoPick { token: string; dataUrl: string; width: number; height: number; format: 'png' | 'jpeg'; bytes: number; fileName: string }

export interface CoachInput {
  firstName: string; lastName: string; birthDate: string; nationality: string; methodology: Methodology;
  /** distribuição inicial dos atributos (base + 12 pontos); obrigatória pela tela (validada no IPC) */ attributes?: CoachAttributes;
}
export interface CreateCareerInput {
  profileId: string; clubId: string; coach: CoachInput; photoToken: string | null;
  /** divisões com simulação completa (ids de liga); as demais ficam simplificadas. A do clube entra sempre. */
  fullLeagues: string[];
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
  /** há relatório lance a lance (não há em países com simulação simplificada) */ hasReport: boolean;
  /** partida de copa: nome da copa (sem a temporada), fase, jogo de ida/volta (null = jogo único) e campo neutro; null = liga */
  cup: { name: string; stage: string; leg: 1 | 2 | null; neutral: boolean } | null;
}
export interface CompetitionInfoDto { id: string; leagueId: string; name: string; country: string; tier: number; teamCount: number; /** copa: leagueId = '' e tier = 0 */ kind: 'league' | 'cup' }
/** Chave de uma copa: fases com os confrontos, a regra de cada fase e de onde veio cada regra. */
export interface CupBracketDto {
  id: string; name: string; country: string; countryCode: string; status: 'scheduled' | 'in_progress' | 'finished'; champion: { id: string; name: string } | null;
  regulation: string; reward: string;
  source: { structure: string; tiebreak: string; host: string; discipline: string; prizes: string };
  discipline: { yellowLimit: number; resetAfter: string | null };
  stages: Array<{
    name: string; legs: 1 | 2; dates: string[]; rule: string; drawn: boolean;
    ties: Array<{
      id: string; a: { id: string; name: string }; b: { id: string; name: string } | null;
      games: Array<{ fixtureId: string; date: string; homeId: string; homeGoals: number | null; awayGoals: number | null; neutral: boolean; hasReport: boolean }>;
      winnerId: string | null; decidedIn: 'regular' | 'extra_time' | 'penalties' | 'bye' | null; shootout: [number, number] | null; aggregate: [number, number] | null; mine: boolean;
    }>;
  }>;
}
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
  lastMonth: Array<{ category: 'gate' | 'tv' | 'sponsorship' | 'merchandising' | 'wages' | 'staff' | 'maintenance' | 'operations' | 'transfer_in' | 'transfer_out' | 'prize' | 'youth' | 'scouting' | 'coaching' | 'infrastructure'; amount: number }>;
  projection: { income: number; expense: number; net: number; wageBill: number; youthBill: number; scoutBill: number; coachingBill: number; staffFixed: number; gate: number; gateEstimated: boolean };
  runwayMonths: number | null;
  sponsors: Array<{ id: string; kind: 'shirt' | 'kit' | 'stadium'; sponsor: string; monthly: number; start: string; end: string }>;
  gates: Array<{ fixtureId: string; date: string; opponent: string; attendance: number; capacity: number; revenue: number }>;
  ledger: Array<{ date: string; category: string; amount: number; description: string }>;
}
export interface Range { low: number; high: number }
export interface MarketFilter {
  position?: 'GK' | 'DEF' | 'MID' | 'ATT' | Position; minAge?: number; maxAge?: number; maxValue?: number; name?: string; /** só jogadores sem clube */ freeOnly?: boolean;
  /** várias posições: entra quem joga em QUALQUER uma delas (natural ou, se `naturalOnly` não estiver ligado, secundária) */
  positions?: Position[]; naturalOnly?: boolean;
  /** códigos de país (nacionalidade principal) */ nationalities?: string[];
  foot?: 'right' | 'left' | 'both'; maxWage?: number;
  /** contrato termina no fim desta temporada (30/jun) ou até o fim da próxima; livres entram */ contractEndsBy?: 'season' | 'next';
  /** só com clube (o oposto de `freeOnly`) */ clubOnly?: boolean;
  shortlistedOnly?: boolean; /** só jogadores bem observados (50%+ de conhecimento: faixas estreitas) */ knownOnly?: boolean;
  /** paginação (padrão: 0 e 100) */ offset?: number; limit?: number;
}
/** Página do mercado: `total` = quantos passam nos filtros; `nationalities` = países presentes no mercado (para o filtro), com contagem. */
export interface MarketPageDto { total: number; offset: number; players: MarketPlayerDto[]; nationalities: Array<{ code: string; name: string; count: number }> }
export interface MarketPlayerDto {
  id: string; name: string; age: number; nationality: string; position: Position; secondaryPositions: Position[]; foot: string;
  /** null = jogador livre (sem clube): contratação sem taxa, fora das janelas inclusive. */
  clubId: string | null; clubName: string | null; marketValue: number; salary: number; contractEnd: string;
  /** reputação (0–100, exibida em estrelas): derivada do valor de mercado e da reputação do clube — dados públicos */ reputation: number;
  /** Estimativas com margem de erro (os atributos reais só aparecem depois de contratado). */
  estOverall: Range; estPotential: Range;
  /** Conhecimento da rede de olheiros (0..100): quanto maior, mais estreitas as faixas. */
  knowledge: number; shortlisted: boolean;
  nationalityName: string; heightCm: number; weightKg: number;
  /** situação pública: lesão, suspensão e cartões nas competições da temporada atual */
  status: { injuredUntil: string | null; suspension: number; yellows: number; reds: number };
  /** atributos resumidos (0–100 no motor; a tela mostra 1–20) estimados pelos olheiros; faixas largas sem conhecimento, exatos com 100% */
  estSummary: AttrSummary;
}
export interface OfferInput { playerId: string; fee: number; wage: number; years: number }
export interface OfferResultDto {
  outcome: 'completed' | 'club_counter' | 'club_rejected' | 'player_counter' | 'player_rejected' | 'board_rejected';
  message: string; counterFee?: number; counterWage?: number;
}
/** Etapa 1 da negociação: só a taxa ao clube vendedor (nada é gravado). */
export interface FeeResultDto { outcome: 'accepted' | 'club_counter' | 'club_rejected'; message: string; counterFee?: number }
/** Dados para a janela de negociação. Disposição e interesse vêm só de dados públicos (contrato, caixa, prestígio dos clubes). */
export interface NegotiationDto {
  player: MarketPlayerDto; buyerName: string; sellerName: string | null; windowOpen: boolean; opensOn: string | null;
  balance: number; payroll: number; wageCeiling: number | null; transferBudgetRemaining: number | null;
  /** 0..100; null = jogador livre (não há clube vendedor) */ clubWillingness: number | null;
  /** 0..100 */ playerInterest: number;
}
export interface IncomingOfferDto { id: number; date: string; expires: string; playerId: string; playerName: string; position: Position; age: number; marketValue: number; buyerClubName: string; fee: number }
export interface TransferLogDto { id: number; date: string; playerName: string; fromClub: string | null; toClub: string; fee: number; kind: 'purchase' | 'sale' | 'ai' }
export interface MyPlayerDto { id: string; name: string; position: Position; age: number; marketValue: number; salary: number; contractEnd: string; listed: boolean }
export interface TransfersOverviewDto {
  window: { open: boolean; opensOn: string | null; closesOn: string | null }; balance: number; squadSize: number; squadMin: number; squadMax: number;
  incoming: IncomingOfferDto[]; mine: MyPlayerDto[]; recent: TransferLogDto[];
}

/** `roles`: função de cada vaga, alinhada às vagas da formação (null = o motor escolhe a que mais combina com o jogador). */
export interface SchemeDto { id: string; name: string; formation: string; settings: TeamTactics; lineup: string[] | null; roles: Array<string | null> | null; builtin: boolean; active: boolean; /** nome exibido da formação */ formationLabel?: string }
export interface SchemeInput { id?: string | null; name: string; formation: string; settings: TeamTactics; lineup: string[] | null; roles?: Array<string | null> | null }
/** Função tática no catálogo (para a tela de Táticas e a ficha). */
export interface RoleInfoDto { id: string; label: string; positions: Position[]; description: string }
/** Função de um jogador do elenco: compatibilidade dos atributos (0–100) e domínio (0–100). */
export interface PlayerRoleFitDto { id: string; suitability: number; familiarity: number }
export interface TacticsSquadPlayer {
  id: string; name: string; position: Position; secondaryPositions: Position[]; overall: number; condition: number;
  unavailable: { kind: 'injured'; until: string } | { kind: 'suspended'; matches: number } | null;
  slotScores: Record<Position, number>;
  /** compatibilidade e domínio em cada função de cada posição */ roles: PlayerRoleFitDto[];
  /** função que treina no mês (null = nenhuma) */ roleFocus: string | null;
}
export interface TacticsOverviewDto {
  schemes: SchemeDto[]; squad: TacticsSquadPlayer[];
  /** pré-definições: vagas na ordem da escalação, cada uma numa âncora do campo */
  formations: Array<{ id: string; slots: Array<{ pos: Position; x: number; y: number; anchor: string }> }>;
  /** as 24 posições do campo onde o técnico pode colocar jogadores */
  anchors: Array<{ id: string; pos: Position; x: number; y: number; label?: string }>;
  /** funções de cada posição */ roleCatalog: RoleInfoDto[];
}

export interface MatchSummaryDto {
  fixtureId: string; competitionName: string; date: string; round: number;
  homeName: string; awayName: string; homeGoals: number; awayGoals: number; involvesUser: boolean;
  /** false = país com simulação simplificada (só o placar) */ hasReport: boolean;
}
export interface SimulationSummaryDto {
  date: string; simulated: number; userMatch: MatchSummaryDto | null; results: MatchSummaryDto[]; notes: string[];
}
export interface MatchReportDto {
  fixtureId: string; competitionName: string; date: string; round: number; detail: 'full' | 'compact';
  home: { clubId: string; name: string; formation: string }; away: { clubId: string; name: string; formation: string };
  homeGoals: number; awayGoals: number; decidedIn: 'regular' | 'extra_time' | 'penalties';
  shootout: { home: number; away: number } | null;
  /** houve prorrogação (pênaltis direto não têm) */ extraTime: boolean;
  /** partida de copa: fase, jogo de ida/volta (null = jogo único), agregado (na volta) e campo neutro */
  cup: { stage: string; leg: 1 | 2 | null; aggregate: [number, number] | null; neutral: boolean } | null;
  conditions: MatchConditions; duration: number;
  stats: [TeamStats, TeamStats]; players: PlayerReport[];
  lineups: Array<{ clubId: string; name: string; formation: string; slots: Array<{ slot: Position; x: number; y: number; playerId: string }> }>;
  commentary: CommentaryLine[];
  manOfTheMatch: { id: string; name: string } | null;
  attendance: { attendance: number; capacity: number; revenue: number } | null;
  tactics: [TeamTactics, TeamTactics] | null;
  /** minuto a minuto (só partidas do usuário jogadas a partir da lapidação); null = acompanhamento só pelos eventos */
  timeline: MatchTick[] | null;
  /** força atual dos jogadores do clube do usuário que aparecem na partida */ levels: Record<string, number>;
  userClubId: string;
}

/** Decisão do técnico na partida ao vivo, aplicada no início do minuto registrado `tick` (índice da linha do tempo). */
export type LiveInterventionInput =
  | { tick: number; kind: 'sub'; out: string; in: string; slot?: Position; reshape?: boolean }
  | { tick: number; kind: 'talk'; tone: TalkTone };
export interface LiveOptionsInput { interventions: LiveInterventionInput[]; /** null = o técnico decide até o fim; número = o auxiliar assume a partir desse minuto registrado */ controlUntil: number | null }
/** Prévia (não gravada) da partida do usuário com as decisões até agora. */
export interface LiveMatchDto {
  report: MatchReportDto; side: 0 | 1; subsMax: number; notes: string[];
  /** banco do seu time no início da partida (jogadores do seu clube: força real) */
  bench: Array<{ id: string; name: string; position: Position; overall: number; condition: number }>;
  /** moral de cada relacionado do seu time antes do jogo e a variação causada pela conversa no vestiário (só nesta partida) */
  morale: Record<string, { before: number; delta: number }>;
  /** trocas sugeridas pelo auxiliar, com o motivo (o técnico decide) */
  suggestions: Array<{ tick: number; out: string; in: string; slot: Position; kind: 'injury' | 'goalkeeper' | 'chase' | 'protect' | 'fresh'; reason: string;
    /** formação proposta quando quem entra é de outra posição */ reshape: { from: string; to: string; changes: Array<{ id: string; from: Position; to: Position }> } | null }>;
}

export interface SquadRow {
  id: string; name: string; position: Position; age: number; overall: number;
  potentialEstimated: number; condition: number; morale: number; salary: number; contractEnd: string;
  secondaryPositions: Position[]; nationality: string; nationalityName: string; heightCm: number;
  /** situação: lesão em curso, suspensão e cartões da temporada */
  status: { injuredUntil: string | null; suspension: number };
  /** estatísticas da temporada atual (todas as competições pelo clube) */
  stats: { appearances: number; minutes: number; goals: number; assists: number; avgRating: number | null; yellows: number; reds: number };
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
  /** mensagens não lidas na caixa de entrada */ unreadInbox: number;
  /** false = treinador sem clube (demitido): `club` é null e o elenco vem vazio. */
  employed: boolean;
  /** Virada de temporada: `canStart` = todas as partidas disputadas e a data chegou a 1º/jul. */
  seasonStatus: { complete: boolean; turnoverDate: string; canStart: boolean };
  club: {
    id: string; name: string; city: string; league: string; country: string;
    reputation: number; balance: number; fans: number; stadium: string; capacity: number;
  } | null;
  squad: SquadRow[];
}

// ---------------------------------------------------------------- ciclo de carreira (Fase 8A)
/** Tela do jogo para onde uma mensagem da caixa de entrada leva (ação sugerida). */
export type InboxAction = 'overview' | 'squad' | 'tactics' | 'contracts' | 'season' | 'transfers' | 'scouting' | 'youth' | 'training' | 'staff' | 'medical' | 'infrastructure' | 'board' | 'finance' | 'trophies';
/** Mensagem da caixa de entrada do treinador. */
export interface NewsDto {
  id: number; date: string; kind: 'season' | 'trophy' | 'transfer' | 'contract' | 'youth' | 'retirement' | 'offer' | 'staff' | 'medical' | 'market' | 'board' | 'squad';
  title: string; body: string; sender: string; action: InboxAction | null; actionLabel: string | null; read: boolean;
}
/** Rede social do futebol (aba Notícias). */
export interface SocialAccountDto { id: string; kind: 'outlet' | 'journalist' | 'league' | 'club' | 'fan'; name: string; handle: string; verified: boolean; clubId: string | null; leagueId: string | null; bio: string; hue: number }
export type SocialCard =
  | { type: 'match'; homeId: string; homeName: string; awayId: string; awayName: string; hg: number; ag: number; competition: string }
  | { type: 'fixture'; homeId: string; homeName: string; awayId: string; awayName: string; competition: string }
  | { type: 'transfer'; player: string; fromId: string | null; fromName: string | null; toId: string; toName: string; fee: number }
  | { type: 'injury'; player: string; clubId: string; clubName: string; days: number }
  | { type: 'table'; title: string; rows: Array<{ clubId: string; name: string; points: number; played: number; rank: number }> };
export interface SocialPostDto {
  id: number; date: string; kind: 'match' | 'preview' | 'transfer' | 'injury' | 'sacking' | 'title' | 'round' | 'coach' | 'hattrick' | 'upset';
  author: SocialAccountDto; text: string; card: SocialCard | null; likes: number; reposts: number;
  /** cita o clube do usuário */ mine: boolean;
  comments: Array<{ id: number; author: SocialAccountDto; text: string; likes: number }>;
}
export type SocialFilter = 'all' | 'mine' | 'match' | 'transfer' | 'injury' | 'coach' | 'league';
export interface SocialFeedDto { posts: SocialPostDto[]; trending: Array<{ clubId: string; name: string; posts: number }>; profiles: SocialAccountDto[]; total: number }
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
  /** avaliação da diretoria (null se o treinador estava sem clube) */ board: { met: boolean; lines: string[]; sacked: boolean } | null;
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
  /** reputação (0–100, exibida em estrelas) */ reputation: number;
  knowledge: number; estOverall: Range; estPotential: Range;
  /** faixas (exatas no próprio clube ou com 100% de conhecimento) */
  attributes: { technical: Record<string, Range>; mental: Record<string, Range>; physical: Record<string, Range>; goalkeeper?: Record<string, Range> };
  stats: { appearances: number; goals: number; assists: number; avgRating: number | null };
  verdict: { level: 'starter' | 'rotation' | 'depth' | 'no'; text: string } | null;
  /** Para negociar a partir da ficha (null para jogadores do próprio clube). */
  market: MarketPlayerDto | null;
  /** pode receber proposta agora (janela aberta, ou jogador livre) */ negotiable: boolean;
  birthDate: string; nationalityName: string; condition: number;
  /** moral e personalidade: do próprio clube ou com 50%+ de conhecimento dos olheiros; senão null */
  morale: number | null; personality: { professionalism: number; ambition: number; loyalty: number } | null;
  /** força ao fim de cada temporada (só do próprio clube; de outros clubes revelaria o valor real) */ history: Array<{ season: number; overall: number }> | null;
  lastMatches: Array<{ fixtureId: string; date: string; opponent: string; home: boolean; score: string; minutes: number; rating: number; goals: number; assists: number }>;
  transfers: Array<{ date: string; from: string | null; to: string; fee: number }>;
  /**
   * Funções táticas (só do próprio clube: de outros clubes revelaria atributos reais): as das posições natural e secundárias e as que ele já
   * aprendeu em campo ou no treino; `focus` = função treinada no mês.
   */
  roles: { list: Array<RoleInfoDto & PlayerRoleFitDto>; focus: string | null } | null;
}
export interface YouthPlayerDto { id: string; name: string; position: Position; age: number; overall: number; potentialEstimated: number; salary: number; /** completa 19 anos até a virada: sai se não for promovido */ leavesAtTurnover: boolean }
export interface YouthOverviewDto {
  players: YouthPlayerDto[]; academyLevel: number; nextIntake: string; lastIntake: { date: string; names: string[] } | null; cap: number; seniorSize: number; seniorMax: number;
}

// ---------------------------------------------------------------- treino, comissão técnica, médico e infraestrutura (Fase 8C)
export type Intensity = 'light' | 'normal' | 'hard';
export type TrainingFocus = 'balanced' | 'finishing' | 'creation' | 'defense' | 'physical' | 'technical' | 'goalkeeping';
export type StaffRole = 'assistant' | 'fitness' | 'goalkeeping' | 'doctor';
export interface TrainingOverviewDto {
  intensity: Intensity; delegated: boolean; hasFitnessCoach: boolean; focuses: TrainingFocus[];
  intensityEffects: Record<Intensity, { growth: number; recovery: number; injury: number }>;
  players: Array<{ id: string; name: string; position: Position; age: number; overall: number; potentialEstimated: number; condition: number; focus: TrainingFocus; suggestedFocus: TrainingFocus; seasonChange: number; injuredUntil: string | null }>;
}
export interface StaffMemberDto { id: string; name: string; nationality: string; ability: number; salary: number; contractEnd: string }
export interface StaffOverviewDto {
  monthlyCost: number; unstaffedQuality: number;
  roles: Array<{ role: StaffRole; label: string; effect: string; member: StaffMemberDto | null; candidates: Array<{ id: string; name: string; nationality: string; ability: number; salary: number }> }>;
}
export interface MedicalOverviewDto {
  doctor: { name: string; ability: number } | null; medicalLevel: number; recoveryFactor: number; intensity: Intensity;
  injured: Array<{ id: string; name: string; position: Position; until: string; daysLeft: number; note: string }>;
  atRisk: Array<{ id: string; name: string; position: Position; condition: number; dailyRisk: number }>;
}
export type FacilityKind = 'training' | 'youth' | 'medical' | 'stadium';
export interface InfrastructureOverviewDto {
  balance: number; capacity: number;
  project: { kind: FacilityKind; label: string; toLevel: number; cost: number; start: string; end: string; progress: number } | null;
  facilities: Array<{ kind: FacilityKind; label: string; level: number; maxed: boolean; effect: string; nextEffect: string | null; cost: number | null; days: number | null; extraMonthly: number | null; extraSeats: number | null }>;
}

// ---------------------------------------------------------------- diretoria e empregos (Fase 8D)
export type BoardStatus = 'pending' | 'on_track' | 'close' | 'off_track';
/** Técnico da IA (Fase 9). */
export interface AiCoachDto { id: string; name: string; nationality: string; age: number; reputation: number; clubId: string | null; clubName: string | null; since: string | null }
/** Ficha de um técnico da IA: atributos 1–20, metodologia e passagens (fim: demitido, substituído ou aposentado). */
export interface AiCoachDetailDto extends AiCoachDto {
  retired: boolean; methodology: Methodology; attributes: CoachAttributes;
  spells: Array<{ clubId: string; clubName: string; start: string; end: string | null; reason: 'sacked' | 'replaced' | 'retired' | null }>;
}
/** Ficha de um clube no jogo: técnico (null = vaga aberta; `userCoach` = nome do usuário, no clube dele) e elenco sem força. */
export interface ClubInfoDto {
  id: string; name: string; city: string; country: string; countryCode: string; leagueId: string; league: string;
  reputation: number; fans: number; stadium: string; capacity: number; isUserClub: boolean;
  coach: AiCoachDto | null; userCoach: string | null;
  squad: Array<{ id: string; name: string; position: Position; age: number; nationality: string }>; avgAge: number;
}
export interface BoardOverviewDto {
  employed: boolean; coachReputation: number;
  /** atributos do treinador (1–20) e pontos ainda não distribuídos */ coachAttributes: CoachAttributes; coachPoints: number;
  spells: Array<{ clubName: string; start: string; end: string | null; reason: 'sacked' | 'left' | null }>;
  offers: Array<{ id: number; clubName: string; league: string; reputation: number; date: string; expires: string }>;
  club: {
    name: string; confidence: number; warning: boolean;
    objective: { label: string; target: number; expected: number; position: number | null; played: number; status: BoardStatus };
    secondary: Array<{ label: string; status: BoardStatus; detail: string }>;
    budgets: { transfer: number; spent: number; remaining: number; wageCeiling: number; payroll: number };
    requests: { transfer: boolean; wage: boolean };
  } | null;
}

export interface GameApi {
  appInfo(): Promise<IpcResult<AppInfo>>;
  listProfiles(): Promise<IpcResult<ProfileDto[]>>;
  createProfile(name: string): Promise<IpcResult<ProfileDto>>;
  listClubs(): Promise<IpcResult<ClubList>>;
  pickPhoto(): Promise<IpcResult<PhotoPick | null>>;
  discardPhoto(token: string): Promise<IpcResult<true>>;
  listPacks(): Promise<IpcResult<PacksOverviewDto>>;
  setPackOrder(enabled: string[]): Promise<IpcResult<PacksOverviewDto>>;
  /** escolhe um .zip (diálogo); com `overwrite`, reimporta o último escolhido substituindo o pacote de mesmo id */
  importPack(overwrite: boolean): Promise<IpcResult<PackImportDto>>;
  removePack(id: string): Promise<IpcResult<PacksOverviewDto>>;
  openPacksFolder(): Promise<IpcResult<true>>;
  /** imagens disponíveis nos pacotes ativos ("players/<id>", "clubs/<id>", "stadiums/<id>", "leagues/<id>") e a versão do índice */
  imageKeys(): Promise<IpcResult<{ version: number; keys: string[] }>>;
  /** escolhe uma imagem (diálogo) e grava no pacote para a entidade; devolve as chaves atualizadas (ou null se cancelou) */
  /** importa jogadores/clubes de uma planilha CSV escolhida pelo usuário (null = cancelou) */
  editorImportCsv(packId: string, kind: 'players' | 'clubs'): Promise<IpcResult<CsvImportReportDto | null>>;
  /** salva o modelo (só cabeçalho) ou a exportação completa em CSV (null = cancelou; senão o caminho) */
  editorExportCsv(packId: string, kind: 'players' | 'clubs', template: boolean): Promise<IpcResult<string | null>>;
  editorSetImage(packId: string, kind: 'players' | 'clubs' | 'stadiums' | 'leagues' | 'coaches', id: string): Promise<IpcResult<{ version: number; keys: string[] } | null>>;
  editorRemoveImage(packId: string, kind: 'players' | 'clubs' | 'stadiums' | 'leagues' | 'coaches', id: string): Promise<IpcResult<{ version: number; keys: string[] }>>;
  /** imagens deste pacote (mesmo inativo), para o editor */
  editorImageKeys(packId: string): Promise<IpcResult<{ version: number; keys: string[] }>>;
  editorCreatePack(input: { name: string; author?: string; description?: string }): Promise<IpcResult<EditorSummaryDto>>;
  editorSummary(packId: string): Promise<IpcResult<EditorSummaryDto>>;
  editorUpdateManifest(packId: string, m: { name: string; version: string; author?: string; description?: string }): Promise<IpcResult<EditorSummaryDto>>;
  editorOptions(packId: string): Promise<IpcResult<EditorOptionsDto>>;
  editorList(packId: string, query: EditorListQuery): Promise<IpcResult<EditorListDto>>;
  editorGet(packId: string, kind: EditorKind, id: string): Promise<IpcResult<EditorEntityDto>>;
  editorSave(packId: string, kind: EditorKind, record: Record<string, unknown>, stadium?: Record<string, unknown> | null): Promise<IpcResult<EditorEntityDto>>;
  editorRemove(packId: string, kind: EditorKind, id: string): Promise<IpcResult<EditorSummaryDto>>;
  editorRevert(packId: string, kind: EditorKind, id: string): Promise<IpcResult<EditorEntityDto>>;
  /** grava o pacote em .zip (diálogo "salvar como") */
  editorExport(packId: string): Promise<IpcResult<{ saved: boolean; path?: string }>>;
  createCareer(input: CreateCareerInput): Promise<IpcResult<CareerSummaryDto>>;
  listCareers(profileId: string): Promise<IpcResult<CareerListDto>>;
  openCareer(profileId: string, careerId: string): Promise<IpcResult<CareerOverviewDto>>;
  getCalendar(profileId: string, careerId: string): Promise<IpcResult<CalendarDto>>;
  listCompetitions(profileId: string, careerId: string): Promise<IpcResult<{ userCompetitionId: string | null; competitions: CompetitionInfoDto[] }>>;
  getCompetitionTable(profileId: string, careerId: string, competitionId: string): Promise<IpcResult<CompetitionTableDto>>;
  getCupBracket(profileId: string, careerId: string, competitionId: string): Promise<IpcResult<CupBracketDto>>;
  advance(profileId: string, careerId: string, mode: AdvanceMode): Promise<IpcResult<AdvanceResultDto>>;
  getTransfers(profileId: string, careerId: string): Promise<IpcResult<TransfersOverviewDto>>;
  searchMarket(profileId: string, careerId: string, filter: MarketFilter): Promise<IpcResult<MarketPageDto>>;
  makeOffer(profileId: string, careerId: string, offer: OfferInput): Promise<IpcResult<OfferResultDto>>;
  getNegotiation(profileId: string, careerId: string, playerId: string): Promise<IpcResult<NegotiationDto>>;
  proposeFee(profileId: string, careerId: string, playerId: string, fee: number): Promise<IpcResult<FeeResultDto>>;
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
  previewLiveMatch(profileId: string, careerId: string, live: LiveOptionsInput): Promise<IpcResult<LiveMatchDto>>;
  finishLiveMatch(profileId: string, careerId: string, live: LiveOptionsInput): Promise<IpcResult<SimulationSummaryDto>>;
  getMatchReport(profileId: string, careerId: string, fixtureId: string): Promise<IpcResult<MatchReportDto>>;
  listRound(profileId: string, careerId: string, competitionId: string, round: number): Promise<IpcResult<FixtureDto[]>>;
  getSeasonStatus(profileId: string, careerId: string): Promise<IpcResult<SeasonStatusDto>>;
  startNextSeason(profileId: string, careerId: string): Promise<IpcResult<NewSeasonReportDto>>;
  getContracts(profileId: string, careerId: string): Promise<IpcResult<ContractRowDto[]>>;
  renewContract(profileId: string, careerId: string, input: RenewInput): Promise<IpcResult<RenewResultDto>>;
  getNews(profileId: string, careerId: string): Promise<IpcResult<NewsDto[]>>;
  /** marca uma mensagem da caixa de entrada como lida (null = todas) */
  markInboxRead(profileId: string, careerId: string, id: number | null): Promise<IpcResult<true>>;
  /** rede social do futebol (aba Notícias) */
  getSocialFeed(profileId: string, careerId: string, filter: SocialFilter): Promise<IpcResult<SocialFeedDto>>;
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
  getTraining(profileId: string, careerId: string): Promise<IpcResult<TrainingOverviewDto>>;
  setIntensity(profileId: string, careerId: string, intensity: Intensity): Promise<IpcResult<true>>;
  setDelegated(profileId: string, careerId: string, on: boolean): Promise<IpcResult<true>>;
  setFocus(profileId: string, careerId: string, playerId: string, focus: TrainingFocus): Promise<IpcResult<true>>;
  /** função tática treinada no mês (null = nenhuma) */ setRoleFocus(profileId: string, careerId: string, playerId: string, roleId: string | null): Promise<IpcResult<true>>;
  getStaff(profileId: string, careerId: string): Promise<IpcResult<StaffOverviewDto>>;
  hireStaff(profileId: string, careerId: string, candidateId: string): Promise<IpcResult<true>>;
  fireStaff(profileId: string, careerId: string, staffId: string): Promise<IpcResult<number>>;
  getMedical(profileId: string, careerId: string): Promise<IpcResult<MedicalOverviewDto>>;
  getInfrastructure(profileId: string, careerId: string): Promise<IpcResult<InfrastructureOverviewDto>>;
  startUpgrade(profileId: string, careerId: string, kind: FacilityKind): Promise<IpcResult<true>>;
  getBoard(profileId: string, careerId: string): Promise<IpcResult<BoardOverviewDto>>;
  getClubInfo(profileId: string, careerId: string, clubId: string): Promise<IpcResult<ClubInfoDto>>;
  getAiCoach(profileId: string, careerId: string, coachId: string): Promise<IpcResult<AiCoachDetailDto>>;
  listUnemployedCoaches(profileId: string, careerId: string): Promise<IpcResult<AiCoachDto[]>>;
  respondJobOffer(profileId: string, careerId: string, offerId: number, accept: boolean): Promise<IpcResult<true>>;
  /** distribui um ponto de atributo do treinador */
  spendCoachPoint(profileId: string, careerId: string, key: CoachAttrKey): Promise<IpcResult<BoardOverviewDto>>;
  requestBudget(profileId: string, careerId: string, kind: 'transfer' | 'wage'): Promise<IpcResult<{ approved: boolean; message: string }>>;
  quit(): Promise<IpcResult<true>>;
}
declare global { interface Window { api: GameApi } }
