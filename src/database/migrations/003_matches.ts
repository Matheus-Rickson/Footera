export const migration003 = {
  version: 3,
  name: 'matches_status_and_stats',
  sql: `
CREATE TABLE matches (
  fixture_id TEXT PRIMARY KEY REFERENCES fixtures(id),
  seed TEXT NOT NULL,
  played_on TEXT NOT NULL,
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  decided_in TEXT NOT NULL CHECK (decided_in IN ('regular', 'extra_time', 'penalties')),
  detail TEXT NOT NULL CHECK (detail IN ('full', 'compact')),
  report_json TEXT NOT NULL
);

CREATE TABLE player_status (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  injury_until TEXT,
  injury_note TEXT,
  suspension_matches INTEGER NOT NULL DEFAULT 0 CHECK (suspension_matches >= 0),
  yellow_cards INTEGER NOT NULL DEFAULT 0 CHECK (yellow_cards >= 0)
);

CREATE TABLE club_state (
  club_id TEXT PRIMARY KEY REFERENCES clubs(id),
  formation TEXT NOT NULL,
  last_lineup_json TEXT NOT NULL
);

CREATE TABLE player_season_stats (
  player_id TEXT NOT NULL REFERENCES players(id),
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  club_id TEXT NOT NULL REFERENCES clubs(id),
  appearances INTEGER NOT NULL DEFAULT 0,
  minutes INTEGER NOT NULL DEFAULT 0,
  goals INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  yellow_cards INTEGER NOT NULL DEFAULT 0,
  red_cards INTEGER NOT NULL DEFAULT 0,
  rating_sum REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, competition_id)
);
CREATE INDEX idx_pss_competition ON player_season_stats(competition_id, goals DESC);
`,
};
