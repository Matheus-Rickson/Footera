/**
 * Estados e estaduais (Fase 9, etapa 2 dos estaduais — docs/ESTADUAIS.md).
 * - `countries.states_json`: estados do país (sigla e nome) com estadual.
 * - `clubs.state`: sigla do estado do clube; `clubs.state_division`: 1 = elite do estadual, 2 = segunda divisão, NULL = fora do estadual.
 * - `leagues.active`: 0 = divisão sem jogos próprios ("Sem divisão": clubes fora das séries nacionais, que disputam só o estadual).
 */
export const migration022 = {
  version: 22,
  name: 'states',
  sql: `
ALTER TABLE countries ADD COLUMN states_json TEXT;
ALTER TABLE clubs ADD COLUMN state TEXT;
ALTER TABLE clubs ADD COLUMN state_division INTEGER;
ALTER TABLE leagues ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_clubs_state ON clubs(state, state_division);
`,
};
