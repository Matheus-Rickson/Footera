/**
 * Tarefas de busca dos olheiros (reformulação do scouting, 07/11/2026): cada tarefa tem escopo (país, liga ou mundo), critérios e duração
 * (meses ou contínua). Uma tarefa ativa ocupa um olheiro (`scout_id`); as demais esperam na fila (`seq`). `scout_task_players` guarda os
 * jogadores que a tarefa encontrou. Olheiros que estavam designados a um país viram uma tarefa contínua, ativa, sem critérios, no mesmo
 * país; a coluna `scouts.assignment` deixa de ser usada (fica 'shortlist').
 */
export const migration025 = {
  version: 25,
  name: 'scout_tasks',
  sql: `
CREATE TABLE scout_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('country', 'league', 'world')),
  area TEXT NOT NULL DEFAULT '',
  criteria_json TEXT NOT NULL DEFAULT '{}',
  months INTEGER CHECK (months IS NULL OR months BETWEEN 1 AND 24),
  status TEXT NOT NULL CHECK (status IN ('queued', 'active', 'done', 'cancelled')),
  scout_id TEXT,
  seq INTEGER NOT NULL,
  created_on TEXT NOT NULL,
  started_on TEXT,
  ends_on TEXT,
  finished_on TEXT,
  -- última busca sem ninguém a acompanhar (tarefa contínua esgotada procura de novo só depois de 7 dias)
  searched_on TEXT,
  -- último resumo semanal enviado à Caixa de entrada
  digest_on TEXT
);
CREATE INDEX idx_scout_tasks_status ON scout_tasks(status, seq);

CREATE TABLE scout_task_players (
  task_id TEXT NOT NULL REFERENCES scout_tasks(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  found_on TEXT NOT NULL,
  PRIMARY KEY (task_id, player_id)
);

INSERT INTO scout_tasks (id, name, scope, area, months, status, scout_id, seq, created_on, started_on)
  SELECT 'tsk_' || s.id, 'Todas as posições · ' || COALESCE(co.name, substr(s.assignment, 9)), 'country', substr(s.assignment, 9), NULL, 'active', s.id,
    s.rowid, s.hired_on, s.hired_on
  FROM scouts s LEFT JOIN countries co ON co.code = substr(s.assignment, 9) WHERE s.assignment LIKE 'country:%';
UPDATE scouts SET assignment = 'shortlist';
`,
};
