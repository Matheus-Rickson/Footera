/**
 * Copas nacionais (Fase 9). `competitions` passa a ter tipo (liga ou copa), país e o formato da copa (snapshot da regra usada, para o
 * histórico registrar a versão do regulamento). A tabela é reconstruída porque `league_id` deixa de ser obrigatório (copa não tem liga);
 * procedimento oficial do SQLite (chaves estrangeiras desligadas pelo migrador, `rebuildsTables`): cria a nova, copia, apaga a antiga e
 * renomeia; `fixtures` e `player_season_stats` continuam apontando para "competitions" (a nova, com os mesmos ids), conferido no commit.
 *
 * - `fixtures`: confronto (`tie_id`), jogo de ida/volta (`leg`) e campo neutro (`neutral`).
 * - `cup_ties`: um confronto de copa (fase, dois clubes, vencedor, como se decidiu).
 * - `cup_discipline`: cartões e suspensões que valem só dentro de cada copa (cada regulamento tem o seu limite).
 */
export const migration018 = {
  version: 18,
  name: 'cups',
  rebuildsTables: true,
  sql: `
CREATE TABLE competitions_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'league' CHECK (kind IN ('league', 'cup')),
  league_id TEXT REFERENCES leagues(id),
  country_id TEXT REFERENCES countries(id),
  season INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'finished')),
  format_json TEXT,
  CHECK ((kind = 'league' AND league_id IS NOT NULL) OR (kind = 'cup' AND country_id IS NOT NULL AND format_json IS NOT NULL)),
  UNIQUE (league_id, season)
);
INSERT INTO competitions_new (id, kind, league_id, country_id, season, name, status)
  SELECT c.id, 'league', c.league_id, l.country_id, c.season, c.name, c.status FROM competitions c JOIN leagues l ON l.id = c.league_id;
DROP TABLE competitions;
ALTER TABLE competitions_new RENAME TO competitions;
CREATE UNIQUE INDEX idx_competitions_cup ON competitions(country_id, season) WHERE kind = 'cup';

ALTER TABLE fixtures ADD COLUMN tie_id TEXT;
ALTER TABLE fixtures ADD COLUMN leg INTEGER;
ALTER TABLE fixtures ADD COLUMN neutral INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_fixtures_tie ON fixtures(tie_id);

CREATE TABLE cup_ties (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  stage INTEGER NOT NULL CHECK (stage >= 0),
  slot INTEGER NOT NULL,
  club_a TEXT NOT NULL REFERENCES clubs(id),
  club_b TEXT REFERENCES clubs(id),
  winner TEXT REFERENCES clubs(id),
  decided_in TEXT CHECK (decided_in IN ('regular', 'extra_time', 'penalties', 'bye')),
  shootout_a INTEGER,
  shootout_b INTEGER,
  UNIQUE (competition_id, stage, slot)
);
CREATE INDEX idx_cup_ties_comp ON cup_ties(competition_id, stage);

CREATE TABLE cup_discipline (
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  yellow_cards INTEGER NOT NULL DEFAULT 0 CHECK (yellow_cards >= 0),
  suspension_matches INTEGER NOT NULL DEFAULT 0 CHECK (suspension_matches >= 0),
  PRIMARY KEY (competition_id, player_id)
);
`,
};
