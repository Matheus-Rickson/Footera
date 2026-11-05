export const migration016 = {
  version: 16,
  name: 'inbox',
  sql: `
-- Comunicados do clube viram a Caixa de entrada (estilo e-mail): remetente, ação sugerida (tela do jogo para resolver), lida/não lida
-- e novos tipos (médico, mercado, diretoria, elenco). SQLite não altera CHECK: a tabela é recriada preservando os dados (as antigas
-- entram como lidas).
CREATE TABLE news_v16 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('season', 'trophy', 'transfer', 'contract', 'youth', 'retirement', 'offer', 'staff', 'medical', 'market', 'board', 'squad')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sender TEXT,
  action TEXT,
  action_label TEXT,
  read INTEGER NOT NULL DEFAULT 0
);
INSERT INTO news_v16 (id, date, kind, title, body, read) SELECT id, date, kind, title, body, 1 FROM news;
DROP TABLE news;
ALTER TABLE news_v16 RENAME TO news;
CREATE INDEX idx_news_date ON news(date DESC, id DESC);
`,
};
