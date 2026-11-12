import type { SqlDb } from '../types.ts';
import { acuteAt, sharpnessAt, sharpnessDecay } from '../../game/training-engine/condition.ts';
import { staffQuality } from './staffRepository.ts';

/**
 * Ritmo de jogo e carga aguda "preguiçosos" (v0.8.12, docs/TRAINING_STAFF.md): o banco guarda o valor e a data em que valia
 * (`sharpness`/`sharp_on`, `acute_load`/`acute_on`) e o valor do dia sai da fórmula — sem regravar ~18 mil linhas largas de `players` por dia.
 * Só o clube do usuário e os lesionados têm o ritmo gravado dia a dia (sessões e lesão mudam a conta); jogos gravam os dois.
 */
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

/** Queda diária do ritmo no clube (preparador físico; IA: centro de treinamento). Livre = queda cheia. */
export const sharpRateOf = (db: SqlDb, clubId: string | null): number => sharpnessDecay(clubId ? staffQuality(db, clubId, 'fitness') : 0);
/** Ritmo do jogador na data (linha de `players` com sharpness, sharp_on e last_played). */
export const effSharp = (r: Row, date: string, rate: number): number =>
  sharpnessAt(Number(r.sharpness ?? 75), str(r.sharp_on), str(r.last_played), date, rate);
/** Carga de jogos do jogador na data (linha de `players` com acute_load e acute_on). */
export const effAcute = (r: Row, date: string): number => acuteAt(Number(r.acute_load ?? 0), str(r.acute_on), date);
