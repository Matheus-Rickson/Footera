import type { SqlDb } from './types.ts';

/**
 * Cache de leitura que vale até a próxima escrita no save (docs/PERFORMANCE.md). A versão é `total_changes()` da conexão: soma toda linha
 * inserida, alterada ou apagada por ela, inclusive em transações desfeitas (aí só invalida a mais). Cada save tem uma única conexão de escrita
 * (a do jogo), então qualquer mudança de partida, transferência, observação ou data invalida tudo; a leitura de resumos é só leitura.
 * Poucas entradas por conexão (LRU), sem prazo: o dado nunca fica velho, porque não há escrita sem mudar a versão.
 */
const MAX_ENTRIES = 8;
const memos = new WeakMap<SqlDb, Map<string, { version: number; value: unknown }>>();

export function writeVersion(db: SqlDb): number {
  return Number(db.prepare('SELECT total_changes() AS n').get()!.n);
}

export function memoUntilWrite<T>(db: SqlDb, key: string, compute: () => T): T {
  let m = memos.get(db);
  if (!m) { m = new Map(); memos.set(db, m); }
  const version = writeVersion(db);
  const hit = m.get(key);
  if (hit && hit.version === version) { m.delete(key); m.set(key, hit); return hit.value as T; }
  const value = compute();
  m.set(key, { version, value });
  if (m.size > MAX_ENTRIES) m.delete(m.keys().next().value!);
  return value;
}
