/**
 * Nível de simulação por divisão (migração 014). Clubes de divisões simplificadas existem por inteiro (elenco, tabela, mercado para os
 * clubes completos), mas não rodam as rotinas detalhadas: elas filtram por `FULL_CLUBS` / `FULL_PLAYERS`. O clube segue o nível da
 * divisão em que está (acesso e rebaixamento mudam isso na virada); o clube do usuário é SEMPRE completo.
 */
import type { SqlDb } from '../types.ts';

export type SimLevel = 'full' | 'light';
/** subconsulta: ids dos clubes com simulação completa (divisão completa ou o clube do usuário) */
export const FULL_CLUBS = `(SELECT cl.id FROM clubs cl JOIN leagues lg ON lg.id = cl.league_id WHERE lg.sim_level = 'full'
  UNION SELECT club_id FROM career WHERE id = 1 AND club_id IS NOT NULL AND club_id <> '')`;
/** condição sobre a tabela players: jogadores de clubes completos, das bases deles, ou livres */
export const FULL_PLAYERS = `((club_id IS NULL AND youth_club_id IS NULL) OR club_id IN ${FULL_CLUBS} OR youth_club_id IN ${FULL_CLUBS})`;

export function lightClubIds(db: SqlDb): Set<string> {
  return new Set(db.prepare(`SELECT id FROM clubs WHERE id NOT IN ${FULL_CLUBS}`).all().map((r) => String(r.id)));
}
/** Define as divisões completas (ids de liga); as demais ficam simplificadas. Usado só na criação da carreira. */
export function setFullLeagues(db: SqlDb, fullLeagueIds: readonly string[]): void {
  const full = new Set(fullLeagueIds);
  const up = db.prepare('UPDATE leagues SET sim_level = ? WHERE id = ?');
  for (const r of db.prepare('SELECT id FROM leagues').all()) up.run(full.has(String(r.id)) ? 'full' : 'light', String(r.id));
}
