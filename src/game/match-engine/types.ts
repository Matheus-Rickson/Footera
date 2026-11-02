import type { Attributes, Position } from '../../shared/types.ts';

export interface MatchPlayer {
  id: string; name: string; position: Position; secondaryPositions: Position[];
  attributes: Attributes;
  /** 0..100 (prontidão física no início da partida) */
  condition: number; morale: number; form: number;
}

export type Mentality = 'defensive' | 'balanced' | 'attacking';
export type BuildUp = 'short' | 'mixed' | 'long';
export interface TeamTactics {
  mentality: Mentality;
  tempo: number; width: number; defensiveLine: number; pressing: number; // 1..5
  buildUp: BuildUp;
}

export interface LineupSlot { slot: Position; x: number; y: number; player: MatchPlayer }

export interface TeamSheet {
  clubId: string; name: string; formation: string;
  lineup: LineupSlot[]; bench: MatchPlayer[];
  tactics: TeamTactics;
  /** 0.95..1.03 — entrosamento (estabilidade da escalação). */
  cohesion: number;
}

export interface MatchConditions { weather: 'clear' | 'rain' | 'heat' | 'cold'; pitch: 'good' | 'poor' }
export interface MatchOptions {
  seed: string; knockout?: boolean; neutral?: boolean; conditions?: MatchConditions;
}

export type EventType =
  | 'goal' | 'shot' | 'corner' | 'foul' | 'yellow_card' | 'red_card' | 'offside' | 'penalty_awarded'
  | 'substitution' | 'injury' | 'period_end' | 'shootout_kick';
export type ChanceType = 'buildup' | 'cross' | 'long' | 'counter' | 'corner' | 'freekick' | 'penalty';
export type ShotOutcome = 'goal' | 'saved' | 'off_target' | 'blocked' | 'post';

export interface MatchEvent {
  i: number;
  /** minuto absoluto (1..90, 91..120 na prorrogação). */
  minute: number;
  /** rótulo exibido, ex.: "45+2'" */
  label: string;
  type: EventType;
  /** 0 = mandante, 1 = visitante */
  team: 0 | 1;
  player?: string;
  player2?: string; // assistente / quem sai / vítima da falta / goleiro
  chance?: ChanceType;
  outcome?: ShotOutcome;
  xg?: number;
  detail?: string; // 'halftime' | 'fulltime' | 'extra1' | 'extra2' | 'second_yellow' | lesão: dias etc.
  days?: number;
  scored?: boolean; // shootout
}

export interface TeamStats {
  possession: number; shots: number; shotsOnTarget: number; shotsBlocked: number; chancesCreated: number; xg: number;
  corners: number; fouls: number; yellowCards: number; redCards: number; offsides: number;
  passes: number; passesCompleted: number; tackles: number; interceptions: number; saves: number;
}

export interface PlayerReport {
  id: string; name: string; team: 0 | 1; slot: Position; position: Position;
  starter: boolean; minutes: number; subbedInAt: number | null; subbedOutAt: number | null;
  rating: number;
  goals: number; assists: number; shots: number; shotsOnTarget: number; passes: number; passesCompleted: number;
  keyPasses: number; tackles: number; interceptions: number; fouls: number; yellow: number; red: number;
  saves: number; goalsConceded: number; xg: number; injuredDays: number;
}

export interface MatchOutcome {
  seed: string;
  homeGoals: number; awayGoals: number;
  decidedIn: 'regular' | 'extra_time' | 'penalties';
  shootout: { home: number; away: number } | null;
  winner: 0 | 1 | null;
  events: MatchEvent[];
  stats: [TeamStats, TeamStats];
  players: PlayerReport[];
  lineups: Array<{ clubId: string; name: string; formation: string; slots: Array<{ slot: Position; x: number; y: number; playerId: string }> }>;
  conditions: MatchConditions;
  duration: number;
  manOfTheMatch: string | null;
}
