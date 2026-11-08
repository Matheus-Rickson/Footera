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
import { migration010 } from './migrations/010_board_jobs.ts';
import { migration011 } from './migrations/011_player_roles.ts';
import { migration012 } from './migrations/012_plausible_secondary.ts';
import { migration013 } from './migrations/013_sim_levels.ts';
import { migration014 } from './migrations/014_league_sim_levels.ts';
import { migration015 } from './migrations/015_social.ts';
import { migration016 } from './migrations/016_inbox.ts';
import { migration017 } from './migrations/017_ai_coaches.ts';
import { migration018 } from './migrations/018_cups.ts';
import { migration019 } from './migrations/019_country_seasons.ts';
import { migration020 } from './migrations/020_clean_sheets.ts';
import { migration021 } from './migrations/021_promises.ts';
import { migration022 } from './migrations/022_states.ts';
import { migration023 } from './migrations/023_formats.ts';
import { migration024 } from './migrations/024_state_competitions.ts';
import { migration025 } from './migrations/025_scout_tasks.ts';
import { migration026 } from './migrations/026_scouting_department.ts';

export interface Migration {
  version: number; name: string; sql: string;
  /**
   * Reconstrução de tabela referenciada por chaves estrangeiras (procedimento oficial do SQLite): desliga as chaves antes da transação
   * (não dá para desligar dentro dela), confere `foreign_key_check` antes do commit e religa no fim.
   */
  rebuildsTables?: boolean;
}

export const MIGRATIONS: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011, migration012, migration013, migration014, migration015, migration016, migration017, migration018, migration019, migration020, migration021, migration022, migration023, migration024, migration025, migration026];

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
    if (m.rebuildsTables) db.exec('PRAGMA foreign_keys = OFF;');
    try {
      withTransaction(db, () => {
        db.exec(m.sql);
        if (m.rebuildsTables) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`Migração ${m.version}: ${broken.length} referência(s) quebrada(s) (ex.: tabela ${String(broken[0]!.table)}).`);
        }
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(m.version, m.name, new Date().toISOString());
      });
    } finally {
      if (m.rebuildsTables) db.exec('PRAGMA foreign_keys = ON;');
    }
    applied.push(m.version);
  }
  return applied;
}
