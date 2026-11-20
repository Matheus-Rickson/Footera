/**
 * Continentais da CONMEBOL (v0.8.13, docs/CONTINENTAIS.md): `competitions.kind` ganha 'continental' (competição de vários países: sem
 * país, com a confederação e o formato em `format_json`). A tabela é reconstruída porque o CHECK muda (mesmo procedimento da 024).
 * `continental_results`: até onde cada clube chegou em cada edição (o ranking CONMEBOL é sempre derivado dela, dos títulos nacionais e
 * de `continental_history`); `continental_history`: o "ano histórico" inicial de cada clube (ADAPT, universo fictício).
 */
export const migration035 = {
  version: 35,
  name: 'continentals',
  rebuildsTables: true,
  sql: `
CREATE TABLE competitions_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'league' CHECK (kind IN ('league', 'cup', 'state', 'continental')),
  league_id TEXT REFERENCES leagues(id),
  country_id TEXT REFERENCES countries(id),
  season INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'finished')),
  format_json TEXT,
  confederation TEXT,
  CHECK ((kind = 'league' AND league_id IS NOT NULL) OR (kind IN ('cup', 'state') AND country_id IS NOT NULL AND format_json IS NOT NULL)
    OR (kind = 'continental' AND country_id IS NULL AND confederation IS NOT NULL AND format_json IS NOT NULL)),
  UNIQUE (league_id, season)
);
INSERT INTO competitions_new (id, kind, league_id, country_id, season, name, status, format_json)
  SELECT id, kind, league_id, country_id, season, name, status, format_json FROM competitions;
DROP TABLE competitions;
ALTER TABLE competitions_new RENAME TO competitions;
CREATE INDEX idx_competitions_state ON competitions(country_id, season) WHERE kind = 'state';
CREATE INDEX idx_competitions_continental ON competitions(confederation, season) WHERE kind = 'continental';

CREATE TABLE continental_results (
  season INTEGER NOT NULL,
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  club_id TEXT NOT NULL REFERENCES clubs(id),
  comp TEXT NOT NULL CHECK (comp IN ('lib', 'sud')),
  stage TEXT NOT NULL CHECK (stage IN ('prelimOut', 'groups', 'po', 'r16', 'qf', 'sf', 'runnerUp', 'champion')),
  prelim INTEGER NOT NULL DEFAULT 0 CHECK (prelim IN (0, 1)),
  groups INTEGER NOT NULL DEFAULT 0 CHECK (groups IN (0, 1)),
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season, competition_id, club_id)
);
CREATE INDEX idx_continental_results_club ON continental_results(club_id);

-- cartões de cada lado no jogo continental (critério de fair play dos grupos; JSON {homeRed, homeYellow, awayRed, awayYellow})
ALTER TABLE fixtures ADD COLUMN cards_json TEXT;

CREATE TABLE continental_history (
  club_id TEXT PRIMARY KEY REFERENCES clubs(id),
  season INTEGER NOT NULL,
  points REAL NOT NULL
);
`,
};
