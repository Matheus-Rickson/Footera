/**
 * Análise das partidas do clube do usuário (v0.11.0, docs/MATCH_STATS.md): mapa de calor, passes, ações defensivas, duelos, momentum
 * e território, gravados pelo motor v2 (`MatchOutcome.detail`). Tabela à parte para o relatório (`matches.report_json`) continuar leve.
 * Saves antigos: as partidas já jogadas ficam sem análise (a tela avisa).
 */
export const migration036 = {
  version: 36,
  name: 'match_detail',
  sql: `
CREATE TABLE match_detail (
  fixture_id TEXT PRIMARY KEY REFERENCES matches(fixture_id),
  engine TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
`,
};
