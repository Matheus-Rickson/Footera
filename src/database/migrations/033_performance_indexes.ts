/**
 * Índices de desempenho (docs/PERFORMANCE.md). As consultas de classificação, forma e resultados filtram por competição E situação
 * (`status = 'played'`); sem este índice o SQLite escolhia o de situação + data e percorria todas as ~10 mil partidas jogadas do save para
 * pegar as de uma competição (a tela da temporada faz isso para cada liga). Só cria índice (sem mudar dados); desfazer = DROP INDEX.
 */
export const migration033 = {
  version: 33,
  name: 'performance_indexes',
  sql: `
CREATE INDEX IF NOT EXISTS idx_fixtures_comp_status ON fixtures(competition_id, status, match_date);
`,
};
