/**
 * Departamento de scouting e rede de captação (07/11/2026): obras passam a aceitar os tipos 'scouting' e 'recruitment' (a tabela é
 * reconstruída porque o CHECK muda: cria, copia, apaga e renomeia). A Caixa de entrada ganha `players_json`: jogadores citados numa
 * mensagem (resumo semanal das tarefas de busca), mostrados em tabela com as estimativas do dia em que o usuário abre.
 */
export const migration026 = {
  version: 26,
  name: 'scouting_department',
  rebuildsTables: true,
  sql: `
CREATE TABLE construction_projects_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  kind TEXT NOT NULL CHECK (kind IN ('training', 'youth', 'medical', 'stadium', 'scouting', 'recruitment')),
  from_level INTEGER NOT NULL,
  cost INTEGER NOT NULL CHECK (cost >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done'))
);
INSERT INTO construction_projects_new (id, club_id, kind, from_level, cost, start_date, end_date, status)
  SELECT id, club_id, kind, from_level, cost, start_date, end_date, status FROM construction_projects;
DROP TABLE construction_projects;
ALTER TABLE construction_projects_new RENAME TO construction_projects;

ALTER TABLE news ADD COLUMN players_json TEXT;
`,
};
