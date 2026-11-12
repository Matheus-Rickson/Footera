import { clamp } from '../rng.ts';
import { addDays, daysBetween } from '../../shared/date.ts';
import { ACUTE_KEEP, SESSION, type Session } from './sessions.ts';

/**
 * Recuperação de condição, ritmo de jogo e carga aguda (v0.8.12, docs/TRAINING_STAFF.md). A recuperação é não linear: cada dia devolve uma
 * fração do que falta para 100% e a sessão gasta a sua carga. Calibrado para 70% → ~95% em 3 dias com a semana padrão.
 */
export const RECOVERY = { base: 0.45, fitness: 0.08, medical: 0.04, young: 0.04, old: -0.05, veteran: -0.09, natural: 0.1, min: 0.1, max: 0.85 };

export interface RecoveryCtx {
  session: Session;
  /** multiplicador de carga da intensidade (leve 0,6 / normal 1 / forte 1,4) */ loadMul: number;
  /** preparador físico 1..20 (IA: centro de treinamento) */ fitnessQ: number;
  /** departamento médico 1..20 */ medicalLevel: number;
  age: number;
  /** recuperação física (naturalFitness) 1..20 */ naturalFitness: number;
}

export function recoveryRate(c: Omit<RecoveryCtx, 'loadMul'>): number {
  const age = c.age <= 23 ? RECOVERY.young : c.age >= 34 ? RECOVERY.veteran : c.age >= 31 ? RECOVERY.old : 0;
  return clamp(RECOVERY.base + SESSION[c.session].rate + (RECOVERY.fitness * clamp(c.fitnessQ, 0, 20)) / 20 + (RECOVERY.medical * clamp(c.medicalLevel, 0, 20)) / 20
    + age + (clamp(c.naturalFitness, 1, 20) / 20 - 0.5) * RECOVERY.natural, RECOVERY.min, RECOVERY.max);
}
export const sessionLoad = (s: Session, loadMul: number): number => SESSION[s].load * loadMul;

/** Condição no fim do dia: recupera uma fração do que falta e gasta a carga da sessão (30..100, uma casa decimal; 99,5+ vira 100). */
export function recoverDay(condition: number, c: RecoveryCtx): number {
  const next = condition + (100 - condition) * recoveryRate(c) - sessionLoad(c.session, c.loadMul);
  return next >= 99.5 ? 100 : Math.round(clamp(next, 30, 100) * 10) / 10;
}

/** Carga aguda depois do dia (média móvel exponencial de 7 dias). */
export const nextAcuteLoad = (acute: number, todayLoad: number): number => Math.round((acute * ACUTE_KEEP + todayLoad) * 10) / 10;
/**
 * Carga de jogos numa data, a partir do valor gravado no último jogo (`on`): só decai (e^(−1/7) por dia), então não precisa ser regravada
 * todo dia — gravar o estado de ~18 mil jogadores por dia custava ~200 ms (cada linha de `players` é larga).
 */
export const acuteAt = (acute: number, on: string | null, date: string): number =>
  !on || acute <= 0 ? Math.max(0, acute) : Math.round(acute * Math.pow(ACUTE_KEEP, Math.max(0, daysBetween(on, date))) * 10) / 10;

/**
 * Ritmo de jogo: ganho por jogo (proporcional aos minutos) e queda diária depois de alguns dias sem jogar, até o piso de 60 (o treino
 * mantém um ritmo básico — sem o piso, a pré-temporada sem amistosos deixaria o elenco inteiro "sem ritmo"); só a lesão leva abaixo dele.
 */
export const SHARP = { perMatch: 12, idleDays: 4, decay: 1.5, decayBestCoach: 0.8, injured: 3, idleFloor: 60 };
/** Queda por inatividade, sem passar do piso (quem já está abaixo do piso, por lesão, não cai mais por ficar parado). */
const idleDrop = (s: number, drop: number) => (s <= SHARP.idleFloor ? s : Math.max(SHARP.idleFloor, s - drop));
export const sharpnessAfterMatch = (s: number, minutes: number): number => Math.round(clamp(s + (SHARP.perMatch * minutes) / 90, 0, 100) * 10) / 10;
/** Queda diária do ritmo de quem está parado, pelo preparador físico (IA: centro de treinamento): 1,5 → 0,8. */
export const sharpnessDecay = (fitnessQ: number): number => SHARP.decay - ((SHARP.decay - SHARP.decayBestCoach) * clamp(fitnessQ, 0, 20)) / 20;
/**
 * Ritmo numa data a partir do valor gravado em `on` (último jogo ou última atualização), sem escrita diária: cai `rate` por dia depois
 * de `idleDays` dias sem jogar. Equivale a aplicar `nextSharpness` dia a dia sem sessões e sem lesão (há teste). `on` nulo = sem queda.
 */
export function sharpnessAt(s: number, on: string | null, lastPlayed: string | null, date: string, rate: number = SHARP.decay): number {
  if (!on) return s;
  const graceEnd = lastPlayed ? addDays(lastPlayed, SHARP.idleDays) : null;
  const from = graceEnd && graceEnd > on ? graceEnd : on;
  return Math.round(clamp(idleDrop(s, rate * Math.max(0, daysBetween(from, date))), 0, 100) * 10) / 10;
}
/** Ritmo no fim do dia. `idle` = dias desde o último jogo (null = nunca jogou). O preparador físico freia a queda. */
export function nextSharpness(s: number, c: { idle: number | null; injured: boolean; session: Session; fitnessQ: number }): number {
  let next = s;
  if (c.injured) next -= SHARP.injured;
  else {
    if (c.idle === null || c.idle > SHARP.idleDays) next = idleDrop(next, sharpnessDecay(c.fitnessQ));
    next += SESSION[c.session].sharp;
  }
  return Math.round(clamp(next, 0, 100) * 10) / 10;
}
