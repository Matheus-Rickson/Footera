export const migration002 = {
  version: 2,
  name: 'competitions_and_fixtures',
  sql: `
CREATE TABLE competitions (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id),
  season INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'finished')),
  UNIQUE (league_id, season)
);

CREATE TABLE fixtures (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  round INTEGER NOT NULL CHECK (round >= 1),
  match_date TEXT NOT NULL,
  home_club_id TEXT NOT NULL REFERENCES clubs(id),
  away_club_id TEXT NOT NULL REFERENCES clubs(id),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'played')),
  home_goals INTEGER CHECK (home_goals >= 0),
  away_goals INTEGER CHECK (away_goals >= 0),
  CHECK (home_club_id <> away_club_id),
  CHECK ((status = 'scheduled' AND home_goals IS NULL AND away_goals IS NULL)
      OR (status = 'played' AND home_goals IS NOT NULL AND away_goals IS NOT NULL)),
  UNIQUE (competition_id, round, home_club_id),
  UNIQUE (competition_id, round, away_club_id)
);
CREATE INDEX idx_fixtures_status_date ON fixtures(status, match_date);
CREATE INDEX idx_fixtures_home ON fixtures(home_club_id);
CREATE INDEX idx_fixtures_away ON fixtures(away_club_id);
CREATE INDEX idx_fixtures_competition ON fixtures(competition_id, round);
`,
};
