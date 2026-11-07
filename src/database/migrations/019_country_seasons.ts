/**
 * Temporada por país (Fase 9).
 * - `countries.season_start`: '07-01' (jul–jun) ou '01-01' (ano civil). Saves antigos ficam todos em julho (como foram criados).
 * - `country_seasons`: a temporada corrente de cada país (número, início, data da virada; `transition` = torneio de transição jul–dez/2026).
 * - `career.season_country`: país cuja temporada é a do treinador (o do clube; desempregado: o do último clube).
 * - `cup_formats`: formatos das copas e supercopas do universo (base + pacotes), gravados no save — o editor de dados pode mudá-los.
 * - copa e supercopa do mesmo país na mesma temporada: o índice único por país/temporada sai.
 */
export const migration019 = {
  version: 19,
  name: 'country_seasons',
  sql: `
ALTER TABLE countries ADD COLUMN season_start TEXT NOT NULL DEFAULT '07-01' CHECK (season_start IN ('07-01', '01-01'));
CREATE TABLE country_seasons (
  country_id TEXT PRIMARY KEY REFERENCES countries(id),
  season INTEGER NOT NULL,
  starts TEXT NOT NULL,
  turnover TEXT NOT NULL,
  transition INTEGER NOT NULL DEFAULT 0 CHECK (transition IN (0, 1)),
  CHECK (turnover > starts)
);
ALTER TABLE career ADD COLUMN season_country TEXT REFERENCES countries(id);
CREATE TABLE cup_formats (
  id TEXT PRIMARY KEY,
  country_id TEXT NOT NULL REFERENCES countries(id),
  kind TEXT NOT NULL CHECK (kind IN ('cup', 'supercup')),
  format_json TEXT NOT NULL
);
DROP INDEX IF EXISTS idx_competitions_cup;
`,
};
