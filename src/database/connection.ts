import type { SqlDb } from './types.ts';

/**
 * Abre um banco SQLite. Usa node:sqlite (Node >= 22.5 / Electron recente).
 * Fallback para better-sqlite3 caso node:sqlite não exista no runtime.
 * `readOnly`: só leitura, sem PRAGMAs (resumos da lista de carreiras: não disputa o arquivo nem grava nada).
 */
export async function openDatabase(path: string, opts: { readOnly?: boolean } = {}): Promise<SqlDb> {
  const readOnly = !!opts.readOnly && path !== ':memory:';
  let db: SqlDb;
  try {
    const mod = (await import('node:sqlite')) as unknown as { DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => SqlDb };
    db = readOnly ? new mod.DatabaseSync(path, { readOnly: true }) : new mod.DatabaseSync(path);
  } catch (primary) {
    try {
      const optionalModule = 'better-sqlite3'; // não é dependência; só tentado se node:sqlite faltar
      const mod = (await import(optionalModule)) as unknown as { default: new (p: string, o?: { readonly?: boolean }) => SqlDb };
      db = readOnly ? new mod.default(path, { readonly: true }) : new mod.default(path);
    } catch {
      throw new Error(`SQLite indisponível neste runtime (node:sqlite falhou: ${primary instanceof Error ? primary.message : String(primary)}).`);
    }
  }
  if (readOnly) return db;
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}
