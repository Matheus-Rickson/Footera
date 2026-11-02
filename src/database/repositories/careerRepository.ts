import type { SqlDb } from '../types.ts';

export interface CareerState { clubId: string; gameDate: string; season: number }

export function getCareerState(db: SqlDb): CareerState {
  const r = db.prepare('SELECT club_id, game_date, season FROM career WHERE id = 1').get();
  if (!r) throw new Error('Registro de carreira ausente.');
  return { clubId: String(r.club_id), gameDate: String(r.game_date), season: Number(r.season) };
}
