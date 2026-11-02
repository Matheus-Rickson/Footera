export const migration007 = {
  version: 7,
  name: 'career_cycle',
  sql: `
ALTER TABLE players ADD COLUMN retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1));
CREATE INDEX idx_players_free ON players(club_id, retired);

-- Evolução anual (snapshot feito na virada de temporada, depois do desenvolvimento).
CREATE TABLE player_development (
  player_id TEXT NOT NULL REFERENCES players(id),
  season INTEGER NOT NULL,
  club_id TEXT REFERENCES clubs(id),
  age INTEGER NOT NULL,
  overall_before INTEGER NOT NULL,
  overall_after INTEGER NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, season)
);

-- Registro oficial do que foi aplicado na virada (a tabela em si continua derivada das partidas).
CREATE TABLE season_results (
  season INTEGER NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  position INTEGER NOT NULL CHECK (position >= 1),
  outcome TEXT CHECK (outcome IN ('champion', 'promoted', 'relegated')),
  prize INTEGER NOT NULL DEFAULT 0 CHECK (prize >= 0),
  PRIMARY KEY (season, club_id)
);

CREATE TABLE trophies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  won_by_user INTEGER NOT NULL DEFAULT 0 CHECK (won_by_user IN (0, 1)),
  UNIQUE (season, competition_id)
);

CREATE TABLE news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('season', 'trophy', 'transfer', 'contract', 'youth', 'retirement', 'offer')),
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX idx_news_date ON news(date DESC, id DESC);
`,
};
