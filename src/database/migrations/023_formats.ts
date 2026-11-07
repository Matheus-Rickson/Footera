/**
 * Campeonatos em fases (Fase 9, etapa 3 dos estaduais — Séries C e D reais; depois os estaduais). Ver game/format-engine.
 * - `competitions.format_json` (já existia, usado pelas copas) passa a valer também para ligas com formato: id do formato, participantes
 *   iniciais (ordem de semente) e a data de início.
 * - `competition_stages`: grupos ou confrontos de cada fase montada (as fases seguintes são montadas quando os participantes ficam definidos).
 * - `fixtures.stage` / `fixtures.stage_tie`: fase e confronto do jogo (o jogo de ida/volta já está em `fixtures.leg`);
 *   `fixtures.pens_winner`: quem venceu nos pênaltis o jogo que decidiu o confronto empatado.
 */
export const migration023 = {
  version: 23,
  name: 'formats',
  sql: `
CREATE TABLE competition_stages (
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  stage_id TEXT NOT NULL,
  groups_json TEXT,
  ties_json TEXT,
  expected INTEGER NOT NULL CHECK (expected >= 0),
  PRIMARY KEY (competition_id, stage_id)
);
ALTER TABLE fixtures ADD COLUMN stage TEXT;
ALTER TABLE fixtures ADD COLUMN stage_tie INTEGER;
ALTER TABLE fixtures ADD COLUMN pens_winner TEXT REFERENCES clubs(id);
CREATE INDEX idx_fixtures_stage ON fixtures(competition_id, stage);
`,
};
