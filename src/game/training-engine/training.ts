import { clamp, createRng } from '../rng.ts';
import { positionWeights, flattenAttributes } from '../world/overall.ts';
import type { CountryTemplate } from '../world/names.ts';
import type { Attributes, Position } from '../../shared/types.ts';
import { groupOf } from '../transfer-engine/transfer.ts';

// ---------------------------------------------------------------- treino
export type Intensity = 'light' | 'normal' | 'hard';
export type Focus = 'balanced' | 'finishing' | 'creation' | 'defense' | 'physical' | 'technical' | 'goalkeeping';
export const FOCUSES: Focus[] = ['balanced', 'finishing', 'creation', 'defense', 'physical', 'technical', 'goalkeeping'];

/** Atributos priorizados por foco (vazio = equilibrado). */
export const FOCUS_KEYS: Record<Focus, readonly string[]> = {
  balanced: [],
  finishing: ['finishing', 'composure', 'firstTouch', 'heading', 'longShots'],
  creation: ['passing', 'vision', 'crossing', 'decisions', 'dribbling'],
  defense: ['tackling', 'marking', 'positioning', 'heading', 'workRate'],
  physical: ['pace', 'stamina', 'strength', 'agility', 'jumping', 'naturalFitness'],
  technical: ['firstTouch', 'dribbling', 'passing', 'finishing', 'crossing'],
  goalkeeping: ['reflexes', 'oneOnOne', 'handling', 'aerial', 'rushingOut', 'kicking', 'positioning', 'agility'],
};

/**
 * Efeitos da intensidade sobre as sessões da semana (v0.8.12): crescimento, carga (custo de condição de cada sessão) e risco de lesão no
 * treino. Antes da v0.8.12 a intensidade dava uma recuperação fixa por dia (7,5 / 6 / 4 pontos).
 */
export const INTENSITY: Record<Intensity, { growth: number; load: number; injury: number }> = {
  light: { growth: 0.88, load: 0.6, injury: 0.6 },
  normal: { growth: 1, load: 1, injury: 1 },
  hard: { growth: 1.14, load: 1.4, injury: 1.7 },
};

/** Profissional (1..20) ou instalação (1..20) → multiplicador de crescimento: 0,90 a 1,10. */
export const qualityFactor = (q: number): number => 0.9 + (0.2 * clamp(q, 0, 20)) / 20;
/** Sem o profissional contratado, a função rende como alguém de qualidade 5. */
export const UNSTAFFED_QUALITY = 5;

/**
 * Melhor foco para o jogador (o que o preparador físico escolhe quando o treino é delegado): goleiro treina goleiro; veterano (31+) treina o físico
 * para frear o declínio; os demais treinam o grupo de atributos relevantes para a posição em que estão mais fracos.
 */
export function bestFocus(position: Position, attributes: Attributes, age: number): Focus {
  if (position === 'GK') return 'goalkeeping';
  if (age >= 31) return 'physical';
  const flat = flattenAttributes(attributes), w = positionWeights(position);
  // focos que fazem sentido para o setor (um zagueiro não treina "finalização", mesmo que cabeceio e compostura contem para ele)
  const allowed: Record<string, Focus[]> = { DEF: ['defense', 'physical', 'creation'], MID: ['creation', 'defense', 'technical', 'physical'], ATT: ['finishing', 'technical', 'physical', 'creation'] };
  let best: Focus = 'balanced', worst = Infinity;
  for (const f of allowed[groupOf(position)] ?? []) {
    const keys = FOCUS_KEYS[f].filter((k) => (w[k] ?? 0) > 0);
    if (keys.length < 2) continue; // foco irrelevante para a posição
    const avg = keys.reduce((s, k) => s + (flat[k] ?? 0), 0) / keys.length;
    if (avg < worst) { worst = avg; best = f; }
  }
  return best;
}

/** Intensidade da semana escolhida pelo preparador: alivia com o elenco cansado ou semana cheia; puxa quando não há jogos e todos estão inteiros. */
export function chooseIntensity(avgCondition: number, matchesNext7Days: number, avgAcuteLoad = 0): Intensity {
  if (avgCondition < 82 || matchesNext7Days >= 2 || avgAcuteLoad > ACUTE_SAFE + 5) return 'light';
  if (matchesNext7Days === 0 && avgCondition >= 92) return 'hard';
  return 'normal';
}
/** Modelo de semana escolhido pelo preparador físico (delegado): pré-temporada sem jogos, recuperação com elenco cansado, 2 jogos, ou equilibrada. */
export function chooseTemplate(avgCondition: number, matchesNext7Days: number, avgAcuteLoad: number): 'balanced' | 'preseason' | 'double' | 'recovery' {
  if (matchesNext7Days >= 2) return 'double';
  if (avgCondition < 82 || avgAcuteLoad > ACUTE_SAFE + 5) return 'recovery';
  if (matchesNext7Days === 0) return 'preseason';
  return 'balanced';
}

/**
 * Carga de jogos a partir da qual o risco de lesão cresce: um jogo por semana fica entre ~6 e ~16; dois jogos por semana chegam a ~25.
 * (A carga conta os jogos — 90 minutos = 10 —, não as sessões: as sessões pesam pelo próprio risco e pela intensidade.)
 */
export const ACUTE_SAFE = 20;
/**
 * Chance diária de lesão no treino. `sessionInjury` = risco da sessão do dia × intensidade (0 em folga, recuperação e dia de jogo).
 * Cansaço dobra o risco; carga aguda acima de `ACUTE_SAFE` aumenta; o preparador físico reduz (prevenção). A base subiu de 0,04% para
 * 0,055% na v0.8.12 porque folgas, recuperações e dias de jogo deixaram de ter risco (a semana padrão rende o mesmo total de antes).
 */
export function trainingInjuryChance(condition: number, sessionInjury: number, fitnessQuality: number, acuteLoad = 0): number {
  return 0.00055 * sessionInjury * (condition < 70 ? 2 : 1) * (1 + Math.max(0, acuteLoad - ACUTE_SAFE) / 15) * (1.15 - (0.3 * clamp(fitnessQuality, 0, 20)) / 20);
}

/** Multiplicador do tempo de lesão: médico e departamento médico encurtam (0,85 a 1,15). */
export const recoveryFactor = (doctorQuality: number, medicalLevel: number): number =>
  1.15 - (0.15 * clamp(doctorQuality, 0, 20)) / 20 - (0.15 * clamp(medicalLevel, 0, 20)) / 20;

/** Condição máxima de quem está lesionado: volta ao elenco ainda sem ritmo e recupera aos poucos. */
export const INJURED_CONDITION_CAP = 60;

// ---------------------------------------------------------------- comissão técnica
export type StaffRole = 'assistant' | 'fitness' | 'goalkeeping' | 'doctor';
export const STAFF_ROLES: StaffRole[] = ['assistant', 'fitness', 'goalkeeping', 'doctor'];
export const STAFF_CONTRACT_YEARS = 2;
export const STAFF_SEVERANCE_MONTHS = 3;

export interface StaffCandidate { id: string; role: StaffRole; firstName: string; lastName: string; nationality: string; ability: number; salary: number }

export const staffSalary = (ability: number, economy: number): number => Math.round((economy * (3500 + ability * ability * 170)) / 100) * 100;

/** 3 candidatos por função no mês (determinísticos; IDs estáveis para contratar). */
export function staffCandidates(seed: string, month: string, templates: readonly CountryTemplate[], economy: number): StaffCandidate[] {
  return STAFF_ROLES.flatMap((role) => {
    const rng = createRng(`staff:${seed}:${month}:${role}`);
    return Array.from({ length: 3 }, (_, i) => {
      const tpl = rng.pick(templates);
      const ability = clamp(Math.round(rng.normal(10, 3.5)), 3, 19);
      return { id: `stf_${role}_${month}_${i}`, role, firstName: rng.pick(tpl.firstNames), lastName: rng.pick(tpl.lastNames), nationality: tpl.code, ability, salary: staffSalary(ability, economy) };
    });
  });
}

// ---------------------------------------------------------------- infraestrutura
export type FacilityKind = 'training' | 'youth' | 'medical' | 'stadium' | 'scouting' | 'recruitment';
export const FACILITY_KINDS: FacilityKind[] = ['stadium', 'training', 'youth', 'recruitment', 'scouting', 'medical'];
/**
 * Departamento de scouting e rede de captação (reformulação de 07/11/2026): só o clube do usuário usa; saves e carreiras sem o nível gravado
 * começam no 10, que reproduz o jogo de antes (4 olheiros, 5 jogadores por tarefa, +1 jovem na peneira).
 */
export const DEFAULT_DEPT_LEVEL = 10;
export const MAX_FACILITY_LEVEL = 20;

/** Custo de subir um nível (cresce exponencialmente com o nível atual; estádio é mais caro). */
export function upgradeCost(kind: FacilityKind, level: number, economy: number): number {
  const base = kind === 'stadium' ? 1_600_000 : kind === 'training' ? 1_100_000 : kind === 'scouting' || kind === 'recruitment' ? 600_000 : 900_000;
  return Math.round((economy * base * Math.pow(1.12, level)) / 1000) * 1000;
}
/** Duração da obra em dias (níveis altos levam mais tempo). */
export const upgradeDays = (kind: FacilityKind, level: number): number => (kind === 'stadium' ? 150 : 90) + 8 * level;
/** Lugares acrescentados por uma ampliação de estádio (5%, arredondado a centenas). */
export const stadiumExpansion = (capacity: number): number => Math.max(500, Math.round((capacity * 0.05) / 100) * 100);
