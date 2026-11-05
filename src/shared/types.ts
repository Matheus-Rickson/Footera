/** Tipos de domínio compartilhados entre main, renderer e motores. Sem dependências externas. */
import type { CoachAttributes } from './coachAttributes.ts';

export type Id = string;
export type IsoDate = string; // YYYY-MM-DD

/** LM/RM = meia esquerda/direita (meio-campo aberto); LWB/RWB = ala esquerda/direita (corredor inteiro). */
/** SS = segundo atacante; CF = centroavante (ST = atacante genérico dos universos anteriores à v0.8.6). */
export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'LWB' | 'RWB' | 'DM' | 'CM' | 'LM' | 'RM' | 'AM' | 'LW' | 'RW' | 'SS' | 'CF' | 'ST';
export type Foot = 'left' | 'right' | 'both';

export interface TechnicalAttributes {
  finishing: number; passing: number; dribbling: number; tackling: number; marking: number;
  firstTouch: number; crossing: number; heading: number; longShots: number; goalkeeping: number;
}
export interface MentalAttributes {
  vision: number; composure: number; decisions: number; positioning: number;
  workRate: number; leadership: number; aggression: number;
}
export interface PhysicalAttributes {
  pace: number; stamina: number; strength: number; agility: number; jumping: number; naturalFitness: number;
}
/** Atributos específicos de goleiro (o "goalkeeping" técnico é a média ponderada deles; ver game/world/goalkeeper.ts). */
export interface GoalkeeperAttributes {
  reflexes: number; oneOnOne: number; handling: number; aerial: number; rushingOut: number; kicking: number;
}
/** Todos os atributos usam a escala 1..20. */
export interface Attributes {
  technical: TechnicalAttributes;
  mental: MentalAttributes;
  physical: PhysicalAttributes;
  /** ausente só em dados antigos (é derivado ao ler; ver withGoalkeeper) */
  goalkeeper?: GoalkeeperAttributes;
}

export interface Personality {
  professionalism: number; ambition: number; loyalty: number; temperament: number; consistency: number;
}

export interface Player {
  id: Id;
  clubId: Id | null;
  firstName: string;
  lastName: string;
  birthDate: IsoDate;
  nationality: string;
  extraNationalities: string[];
  position: Position;
  secondaryPositions: Position[];
  foot: Foot;
  heightCm: number;
  weightKg: number;
  attributes: Attributes;
  personality: Personality;
  /** Estimativa visível ao usuário (sujeita a erro de olheiro). */
  potentialEstimated: number;
  /** domínio aprendido das funções (id → 0–100), carregado com o elenco; ausente = domínio inicial pelo perfil */
  roleFamiliarity?: Record<string, number>;
  /** Potencial real, interno ao motor; nunca exibido diretamente. */
  potentialHidden: number;
  /** 0..100 */
  condition: number;
  fatigue: number;
  morale: number;
  form: number;
  marketValue: number;
  salary: number;
  contractEnd: IsoDate;
  overall: number;
}

export interface Stadium {
  id: Id; name: string; city: string; capacity: number;
}

export interface Club {
  id: Id;
  name: string;
  shortName: string;
  countryId: Id;
  city: string;
  leagueId: Id;
  stadiumId: Id;
  reputation: number; // 1..100
  balance: number;
  fans: number;
  facilities: { training: number; youth: number; medical: number; stadium: number }; // 1..20
}

/** Calendário de uma liga. Se ausente, usa-se o padrão (início em 1º/ago, sábados, a cada 7 dias). */
export interface LeagueCalendar {
  seasonStart: string; // 'MM-DD'
  matchWeekday: number; // 0 = domingo ... 6 = sábado
  intervalDays: number;
}

export interface LeagueRules {
  calendar?: LeagueCalendar;
  rounds: number; // 2 = turno e returno
  pointsWin: number; pointsDraw: number;
  tiebreakers: Array<'points' | 'wins' | 'goalDiff' | 'goalsFor' | 'headToHead'>;
  promotionSlots: number; relegationSlots: number;
  continentalSlots: number;
  maxForeignPlayers: number | null;
  squadMin: number; squadMax: number;
}

export interface League {
  id: Id;
  countryId: Id;
  name: string;
  tier: number;
  teamCount: number;
  rules: LeagueRules;
}

export interface Country { id: Id; code: string; name: string; /** fator econômico (1 = referência) */ economy: number }

export interface World {
  seed: string;
  startDate: IsoDate;
  countries: Country[];
  leagues: League[];
  stadiums: Stadium[];
  clubs: Club[];
  players: Player[];
  /** técnicos do universo (ausente em mundos antigos: a carreira gera os padrão) */
  coaches?: WorldCoach[];
}

/** Técnico do universo (dos clubes da IA e os sem clube). Atributos 1–20; reputação 1–100. */
export interface WorldCoach {
  id: Id; firstName: string; lastName: string; birthDate: IsoDate; nationality: string;
  /** null = sem clube */
  clubId: Id | null;
  reputation: number; methodology: Methodology; attributes: CoachAttributes;
}

export type Methodology = 'defensive' | 'possession' | 'aggressive';

export interface Coach {
  firstName: string;
  lastName: string;
  birthDate: IsoDate;
  nationality: string;
  methodology: Methodology;
  reputation: number;
  /** Caminho relativo, dentro do save, para a foto copiada. */
  photoPath: string | null;
  /** atributos do treinador (1–20); ausente em carreiras criadas antes da v0.9 */
  attributes?: CoachAttributes;
  /** pontos de atributo ganhos nas avaliações de temporada e ainda não distribuídos (ausente = 0) */
  attributePoints?: number;
}
