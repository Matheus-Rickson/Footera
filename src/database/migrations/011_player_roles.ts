export const migration011 = {
  version: 11,
  name: 'player_roles',
  sql: `
-- Domínio aprendido de cada função tática (0–100). Sem linha = domínio inicial pelo perfil (posição e atributos), calculado no motor.
CREATE TABLE player_roles (
  player_id TEXT NOT NULL REFERENCES players(id),
  role_id TEXT NOT NULL,
  familiarity REAL NOT NULL CHECK (familiarity BETWEEN 0 AND 100),
  PRIMARY KEY (player_id, role_id)
);
-- Função escolhida para cada vaga do esquema (alinhada às vagas da escalação); NULL = o motor escolhe a mais adequada.
ALTER TABLE tactic_schemes ADD COLUMN roles_json TEXT;
-- Função treinada no mês (só jogadores do usuário); NULL = nenhuma.
ALTER TABLE player_training ADD COLUMN role_focus TEXT;
`,
};
