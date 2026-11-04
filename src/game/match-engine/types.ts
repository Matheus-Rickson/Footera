import type { Attributes, Position } from '../../shared/types.ts';
import type { TalkTone } from './teamTalk.ts';

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
  /** registra a linha do tempo minuto a minuto (só observa: não muda nenhum sorteio nem o resultado) */ timeline?: boolean;
  /**
   * Partida acompanhada pelo técnico: até o minuto registrado `until` (índice da linha do tempo, exclusivo) o time `team`
   * não faz substituições automáticas (nem por lesão) — quem decide é o técnico, pelas intervenções. Depois, o auxiliar assume.
   */
  control?: { team: 0 | 1; until: number };
  /** decisões do técnico, aplicadas no início do minuto registrado `tick` (o que veio antes não muda) */
  interventions?: Intervention[];
}

export type Intervention =
  | { tick: number; kind: 'sub'; team: 0 | 1; out: string; in: string; /** posição de quem entra (padrão: a de quem sai) */ slot?: Position;
      /** reorganiza o time na formação que melhor encaixa quem entra (sugestão do auxiliar) */ reshape?: boolean }
  | { tick: number; kind: 'talk'; team: 0 | 1; tone: TalkTone };

/** Ordem dos números em `MatchTick.s` (estatísticas acumuladas da equipe; xg em centésimos). */
export const TICK_STATS = ['shots', 'shotsOnTarget', 'xg', 'corners', 'fouls', 'yellowCards', 'redCards', 'offsides', 'passes', 'passesCompleted', 'tackles', 'interceptions', 'saves'] as const;
/**
 * Foto do fim de um minuto de jogo. `ev` = quantos eventos já tinham acontecido; `held` = fases de posse acumuladas;
 * `p[time]` = [nota×10, condição×10] de cada jogador, na ordem de entrada em campo da equipe (a mesma ordem de `players`).
 */
export interface MatchTick { minute: number; label: string; ev: number; held: [number, number]; s: [number[], number[]]; p: [number[], number[]] }

export type EventType =
  | 'goal' | 'shot' | 'corner' | 'foul' | 'yellow_card' | 'red_card' | 'offside' | 'penalty_awarded'
  | 'substitution' | 'injury' | 'period_end' | 'shootout_kick' | 'team_talk' | 'formation_change';
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
  /** mudança de formação: nova função e lugar de cada jogador em campo (só exibição do lugar; a função muda o jogo) */
  moves?: Array<{ id: string; slot: Position; x: number; y: number }>;
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
  timeline: MatchTick[] | null;
  /** variação de moral causada pela conversa no vestiário (só durante esta partida; jogadores relacionados: em campo e no banco) */
  moraleDelta: Record<string, number>;
  /** trocas que o auxiliar sugere ao técnico (só para o time sob controle): no minuto registrado `tick`, com o motivo */
  suggestions: SubSuggestion[];
}

export interface SubSuggestion {
  tick: number; team: 0 | 1; out: string; in: string; slot: Position;
  kind: 'injury' | 'chase' | 'protect' | 'fresh'; reason: string;
  /** quando quem entra é de outra posição: a formação que o auxiliar propõe e quem muda de função */
  reshape: { from: string; to: string; changes: Array<{ id: string; from: Position; to: Position }> } | null;
}
