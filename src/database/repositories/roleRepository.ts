import type { SqlDb } from '../types.ts';
import type { Player } from '../../shared/types.ts';
import { defaultFamiliarity, familiarity, roleById, type RolePlayer } from '../../game/match-engine/playerRoles.ts';

const S = (v: unknown) => String(v);
const N = (v: unknown) => Number(v);

/** Domínio ganho a cada 90 minutos jogados numa função. */
export const ROLE_MATCH_GAIN = 1.5;
/** Domínio ganho por mês treinando a função (multiplicado pela qualidade do auxiliar técnico e do centro de treinamento). */
export const ROLE_TRAIN_GAIN = 10;

/** Domínio aprendido (id da função → 0–100) dos jogadores informados. Quem não tem histórico não aparece. */
export function familiarityOf(db: SqlDb, playerIds: readonly string[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (!playerIds.length) return out;
  for (const r of db.prepare('SELECT player_id, role_id, familiarity FROM player_roles WHERE player_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(playerIds))) {
    const id = S(r.player_id);
    (out.get(id) ?? out.set(id, {}).get(id)!)[S(r.role_id)] = N(r.familiarity);
  }
  return out;
}

/** Anexa o domínio aprendido aos jogadores (in place) e devolve a mesma lista. */
export function withFamiliarity<T extends Player>(db: SqlDb, players: T[]): T[] {
  const fam = familiarityOf(db, players.map((p) => p.id));
  for (const p of players) { const f = fam.get(p.id); if (f) p.roleFamiliarity = f; }
  return players;
}

/** Soma domínio numa função (parte do domínio inicial pelo perfil, se não houver histórico), limitado a 100. NÃO abre transação. */
export function addFamiliarity(db: SqlDb, p: RolePlayer & { id: string }, roleId: string, gain: number): number {
  const role = roleById(roleId);
  if (!role) return 0;
  if (gain <= 0) return familiarity(p, role);
  // valor bruto (sem o arredondamento de `familiarity`), para não acumular erro jogo a jogo
  const next = Math.min(100, Math.round(((p.roleFamiliarity?.[roleId] ?? defaultFamiliarity(p, role)) + gain) * 10) / 10);
  db.prepare('INSERT INTO player_roles (player_id, role_id, familiarity) VALUES (?,?,?) ON CONFLICT(player_id, role_id) DO UPDATE SET familiarity = excluded.familiarity')
    .run(p.id, roleId, next);
  (p.roleFamiliarity ??= {})[roleId] = next;
  return next;
}

/** Função que cada jogador do usuário treina (id do jogador → id da função). */
export function roleFocusMap(db: SqlDb): Map<string, string> {
  return new Map(db.prepare('SELECT player_id, role_focus FROM player_training WHERE role_focus IS NOT NULL').all().map((r) => [S(r.player_id), S(r.role_focus)]));
}
