import type { SqlDb } from '../types.ts';
import type { Player } from '../../shared/types.ts';
import { rowToPlayer } from './worldRepository.ts';
import { withFamiliarity } from './roleRepository.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);

export interface Status { injuryUntil: string | null; suspension: number; yellows: number }
export interface Squad { players: Player[]; status: Map<string, Status>; available: Player[]; suspendedOut: string[] }

/** `cupSuspensions`: numa partida de copa, as suspensões que valem são as da copa (as da liga não contam nela, e vice-versa). */
export function loadSquad(db: SqlDb, clubId: string, date: string, cupSuspensions?: ReadonlyMap<string, number>): Squad {
  const players = withFamiliarity(db, db.prepare('SELECT * FROM players WHERE club_id = ?').all(clubId).map(rowToPlayer));
  const status = new Map<string, Status>();
  for (const r of db.prepare('SELECT ps.* FROM player_status ps JOIN players p ON p.id = ps.player_id WHERE p.club_id = ?').all(clubId)) {
    status.set(S(r.player_id), { injuryUntil: r.injury_until == null ? null : S(r.injury_until), suspension: N(r.suspension_matches), yellows: N(r.yellow_cards) });
  }
  if (cupSuspensions) for (const p of players) { const s = status.get(p.id) ?? { injuryUntil: null, suspension: 0, yellows: 0 }; status.set(p.id, { ...s, suspension: cupSuspensions.get(p.id) ?? 0 }); }
  const injured = (p: Player) => { const s = status.get(p.id); return !!s?.injuryUntil && s.injuryUntil > date; };
  const suspended = (p: Player) => (status.get(p.id)?.suspension ?? 0) > 0;
  let available = players.filter((p) => !injured(p) && !suspended(p));
  // Emergência: elenco desfalcado demais -> escala lesionados (menos graves primeiro) e, por último, suspensos.
  if (available.length < 14 || !available.some((p) => p.position === 'GK')) {
    const extra = players.filter((p) => !available.includes(p) && !suspended(p))
      .sort((a, b) => (status.get(a.id)?.injuryUntil ?? '').localeCompare(status.get(b.id)?.injuryUntil ?? ''));
    for (const p of extra) { if (available.length >= 14 && available.some((x) => x.position === 'GK')) break; available.push(p); }
    for (const p of players.filter((q) => suspended(q) && !available.includes(q))) { if (available.length >= 14 && available.some((x) => x.position === 'GK')) break; available.push(p); }
  }
  const suspendedOut = players.filter((p) => suspended(p) && !available.includes(p)).map((p) => p.id);
  return { players, status, available, suspendedOut };
}

