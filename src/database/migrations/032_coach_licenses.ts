/**
 * Licenças e histórico do treinador (v0.8.10, docs/BOARD_JOBS.md).
 * - `coach_licenses`: licenças obtidas (C, B, A, PRO), com a data; `initial` = recebida no início da carreira.
 * - `coach_course`: curso em andamento (um por vez).
 * - `coach_seasons`: uma linha por temporada (ou parte dela) no comando de um clube, gravada na avaliação da virada e na saída do clube.
 *   Jogos, vitórias e gols NÃO ficam aqui: são derivados das partidas entre `start_date` e `end_date` (regra 4).
 * - `board_state` ganha a reputação e a data do início da temporada no clube (para a linha de `coach_seasons`).
 */
export const migration032 = {
  version: 32,
  name: 'coach_licenses',
  sql: `
CREATE TABLE coach_licenses (
  license TEXT PRIMARY KEY CHECK (license IN ('C', 'B', 'A', 'PRO')),
  obtained TEXT NOT NULL,
  initial INTEGER NOT NULL DEFAULT 0 CHECK (initial IN (0, 1))
);
CREATE TABLE coach_course (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  license TEXT NOT NULL CHECK (license IN ('C', 'B', 'A', 'PRO')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  waived INTEGER NOT NULL DEFAULT 0 CHECK (waived IN (0, 1))
);
CREATE TABLE coach_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  label TEXT NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  competition_id TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  position INTEGER,
  objective_label TEXT,
  objective_met INTEGER CHECK (objective_met IN (0, 1)),
  reputation_start INTEGER,
  reputation_end INTEGER,
  license TEXT,
  confidence_end REAL,
  end_reason TEXT NOT NULL CHECK (end_reason IN ('season', 'sacked', 'left')),
  UNIQUE (club_id, season)
);
ALTER TABLE board_state ADD COLUMN coach_rep_start INTEGER;
ALTER TABLE board_state ADD COLUMN season_start TEXT;
`,
};
