export const migration001 = {
  version: 1,
  name: 'init_universe_and_career',
  sql: `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE countries (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE leagues (
  id TEXT PRIMARY KEY,
  country_id TEXT NOT NULL REFERENCES countries(id),
  name TEXT NOT NULL,
  tier INTEGER NOT NULL CHECK (tier >= 1),
  team_count INTEGER NOT NULL CHECK (team_count >= 2),
  rules_json TEXT NOT NULL
);

CREATE TABLE stadiums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0)
);

CREATE TABLE clubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  country_id TEXT NOT NULL REFERENCES countries(id),
  city TEXT NOT NULL,
  league_id TEXT NOT NULL REFERENCES leagues(id),
  stadium_id TEXT NOT NULL REFERENCES stadiums(id),
  reputation INTEGER NOT NULL CHECK (reputation BETWEEN 1 AND 100),
  balance INTEGER NOT NULL,
  fans INTEGER NOT NULL,
  facilities_json TEXT NOT NULL
);
CREATE INDEX idx_clubs_league ON clubs(league_id);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  club_id TEXT REFERENCES clubs(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  nationality TEXT NOT NULL,
  extra_nationalities_json TEXT NOT NULL,
  position TEXT NOT NULL,
  secondary_positions_json TEXT NOT NULL,
  foot TEXT NOT NULL,
  height_cm INTEGER NOT NULL,
  weight_kg INTEGER NOT NULL,
  attributes_json TEXT NOT NULL,
  personality_json TEXT NOT NULL,
  potential_estimated INTEGER NOT NULL,
  potential_hidden INTEGER NOT NULL,
  condition_pct REAL NOT NULL,
  fatigue REAL NOT NULL,
  morale REAL NOT NULL,
  form REAL NOT NULL,
  market_value INTEGER NOT NULL,
  salary INTEGER NOT NULL,
  contract_end TEXT NOT NULL,
  overall INTEGER NOT NULL
);
CREATE INDEX idx_players_club ON players(club_id);

-- Estado da carreira (preenchido apenas em arquivos de save)
CREATE TABLE career (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  coach_json TEXT NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  game_date TEXT NOT NULL,
  season INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  play_seconds INTEGER NOT NULL DEFAULT 0
);
`,
};
