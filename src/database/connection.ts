import type { SqlDb, SqlStatement } from './types.ts';

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
  if (path !== ':memory:') db.exec(FILE_PRAGMAS);
  return withStatementCache(db);
}

/**
 * Configuração dos saves (medida em docs/PERFORMANCE.md):
 * - WAL: leitura (lista de carreiras, só leitura) não bloqueia a escrita do jogo.
 * - synchronous = NORMAL: com WAL o banco nunca corrompe; numa queda de energia pode perder só as últimas transações confirmadas (o último
 *   dia avançado). Antes (FULL) cada COMMIT esperava o disco: ~350 ms em 7 dias avançados.
 * - cache_size = 32 MB por conexão (padrão: 2 MB; o save do usuário tem ~58 MB; no máximo 2 saves abertos = 64 MB).
 * - temp_store = MEMORY: ordenações e agrupamentos temporários sem arquivo.
 * - busy_timeout = 5 s: a leitura do resumo do save (outra conexão) espera em vez de falhar com SQLITE_BUSY.
 * mmap_size não foi ativado: sem ganho medido.
 */
const FILE_PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -32000; PRAGMA temp_store = MEMORY; PRAGMA busy_timeout = 5000;';

/** Máximo de consultas preparadas guardadas por conexão (as SQL com valores embutidos variam; as mais antigas saem primeiro). */
export const STATEMENT_CACHE_MAX = 600;

/**
 * Reaproveita as consultas preparadas pelo texto da SQL (LRU). Antes, cada execução compilava a SQL de novo (ex.: o estado da carreira, 1.061
 * vezes num dia avançado). Seguro porque o código só usa `run`/`get`/`all`, que terminam a execução antes de devolver (sem `iterate`).
 */
export function withStatementCache(db: SqlDb, max = STATEMENT_CACHE_MAX): SqlDb {
  const cache = new Map<string, SqlStatement>();
  return {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      let st = cache.get(sql);
      if (st) { cache.delete(sql); cache.set(sql, st); return st; }
      st = db.prepare(sql);
      cache.set(sql, st);
      if (cache.size > max) cache.delete(cache.keys().next().value!);
      return st;
    },
    close() { cache.clear(); db.close(); },
  };
}
