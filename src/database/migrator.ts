import type { SqlDb } from './types.ts';
import { withTransaction } from './types.ts';
import { migration001 } from './migrations/001_init.ts';
import { migration002 } from './migrations/002_competitions.ts';
import { migration003 } from './migrations/003_matches.ts';
import { migration004 } from './migrations/004_tactics.ts';
import { migration005 } from './migrations/005_finance.ts';
import { migration006 } from './migrations/006_transfers.ts';
import { migration007 } from './migrations/007_career_cycle.ts';
import { migration008 } from './migrations/008_scouting_youth.ts';
import { migration009 } from './migrations/009_training_staff_infra.ts';

export interface Migration { version: number; name: string; sql: string }

export const MIGRATIONS: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009];

export function currentVersion(db: SqlDb): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return Number(row?.v ?? 0);
}

/** Aplica migrações pendentes, cada uma em transação. Recusa bancos de versão futura. */
export function migrate(db: SqlDb, migrations: Migration[] = MIGRATIONS): number[] {
  const latest = Math.max(0, ...migrations.map((m) => m.version));
  const current = currentVersion(db);
  if (current > latest) {
    throw new Error(`Este arquivo foi criado por uma versão mais nova do jogo (schema ${current} > ${latest}).`);
  }
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.version === sorted[i - 1]!.version) throw new Error(`Migração duplicada: ${sorted[i]!.version}`);
  }
  const applied: number[] = [];
  for (const m of sorted) {
    if (m.version <= current) continue;
    withTransaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
    });
    applied.push(m.version);
  }
  return applied;
}
