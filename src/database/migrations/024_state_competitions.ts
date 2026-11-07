/**
 * Estaduais (Fase 9, etapa 5): `competitions.kind` ganha 'state' (campeonato estadual: país + formato em `format_json`, sem liga).
 * A tabela é reconstruída porque o CHECK do tipo muda (procedimento oficial do SQLite, chaves estrangeiras desligadas pelo migrador:
 * cria a nova, copia, apaga a antiga e renomeia; `fixtures`, `competition_stages` e `player_season_stats` continuam apontando para os
 * mesmos ids). O índice antigo das copas não volta (a migração 19 o removeu: copa e supercopa no mesmo país e temporada).
 */
export const migration024 = {
  version: 24,
  name: 'state_competitions',
  rebuildsTables: true,
  sql: `
CREATE TABLE competitions_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'league' CHECK (kind IN ('league', 'cup', 'state')),
  league_id TEXT REFERENCES leagues(id),
  country_id TEXT REFERENCES countries(id),
  season INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'finished')),
  format_json TEXT,
  CHECK ((kind = 'league' AND league_id IS NOT NULL) OR (kind IN ('cup', 'state') AND country_id IS NOT NULL AND format_json IS NOT NULL)),
  UNIQUE (league_id, season)
);
INSERT INTO competitions_new (id, kind, league_id, country_id, season, name, status, format_json)
  SELECT id, kind, league_id, country_id, season, name, status, format_json FROM competitions;
DROP TABLE competitions;
ALTER TABLE competitions_new RENAME TO competitions;
CREATE INDEX idx_competitions_state ON competitions(country_id, season) WHERE kind = 'state';
`,
};
