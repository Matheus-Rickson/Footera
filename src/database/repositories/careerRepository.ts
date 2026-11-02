import type { SqlDb } from '../types.ts';

/** `clubId` é '' quando o treinador está sem clube (demitido): nenhum clube é "do usuário" e todas as rotinas tratam todos como IA. */
export interface CareerState { clubId: string; gameDate: string; season: number }

export function getCareerState(db: SqlDb): CareerState {
  const r = db.prepare('SELECT club_id, game_date, season FROM career WHERE id = 1').get();
  if (!r) throw new Error('Registro de carreira ausente.');
  return { clubId: r.club_id == null ? '' : String(r.club_id), gameDate: String(r.game_date), season: Number(r.season) };
}

export const isEmployed = (db: SqlDb): boolean => getCareerState(db).clubId !== '';
