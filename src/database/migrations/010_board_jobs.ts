export const migration010 = {
  version: 10,
  name: 'board_and_jobs',
  sql: `
-- O treinador pode ficar sem clube (demitido): club_id passa a aceitar NULL. SQLite não altera restrições de coluna, então a tabela é recriada.
CREATE TABLE career_v10 (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  coach_json TEXT NOT NULL,
  club_id TEXT REFERENCES clubs(id),
  game_date TEXT NOT NULL,
  season INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  play_seconds INTEGER NOT NULL DEFAULT 0,
  active_scheme_id TEXT REFERENCES tactic_schemes(id)
);
INSERT INTO career_v10 (id, coach_json, club_id, game_date, season, created_at, updated_at, play_seconds, active_scheme_id)
  SELECT id, coach_json, club_id, game_date, season, created_at, updated_at, play_seconds, active_scheme_id FROM career;
DROP TABLE career;
ALTER TABLE career_v10 RENAME TO career;

-- Diretoria do clube atual (linha única): objetivos da temporada, confiança e orçamentos.
CREATE TABLE board_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  club_id TEXT NOT NULL REFERENCES clubs(id),
  season INTEGER NOT NULL,
  objective TEXT NOT NULL,
  target_position INTEGER NOT NULL,
  expected_position INTEGER NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  transfer_budget INTEGER NOT NULL,
  transfer_spent INTEGER NOT NULL DEFAULT 0,
  wage_ceiling INTEGER NOT NULL,
  youth_target INTEGER NOT NULL,
  youth_promoted INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  warned INTEGER NOT NULL DEFAULT 0,
  transfer_request_used INTEGER NOT NULL DEFAULT 0,
  wage_request_used INTEGER NOT NULL DEFAULT 0
);

-- Passagens do treinador pelos clubes.
CREATE TABLE coach_spells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  start_date TEXT NOT NULL,
  end_date TEXT,
  end_reason TEXT CHECK (end_reason IN ('sacked', 'left'))
);

-- Vagas de técnico nos clubes da IA e propostas de emprego ao treinador.
CREATE TABLE job_vacancies (club_id TEXT PRIMARY KEY REFERENCES clubs(id), opened_on TEXT NOT NULL);
CREATE TABLE job_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  date TEXT NOT NULL,
  expires TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired'))
);
`,
};
