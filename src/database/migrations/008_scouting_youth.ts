export const migration008 = {
  version: 8,
  name: 'scouting_and_youth',
  sql: `
-- Jogador das categorias de base: club_id NULL (fora do elenco principal) e youth_club_id = clube dono da base.
ALTER TABLE players ADD COLUMN youth_club_id TEXT REFERENCES clubs(id);
CREATE INDEX idx_players_youth ON players(youth_club_id);

-- Olheiros do clube do usuário. assignment: 'shortlist' (lista de observação) ou 'country:<código>'.
CREATE TABLE scouts (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  nationality TEXT NOT NULL,
  ability INTEGER NOT NULL CHECK (ability BETWEEN 1 AND 20),
  salary INTEGER NOT NULL CHECK (salary >= 0),
  hired_on TEXT NOT NULL,
  contract_end TEXT NOT NULL,
  assignment TEXT NOT NULL DEFAULT 'shortlist'
);

-- Conhecimento acumulado sobre cada jogador observado (0..100): estreita as estimativas.
CREATE TABLE scout_knowledge (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  knowledge REAL NOT NULL CHECK (knowledge BETWEEN 0 AND 100),
  updated_on TEXT NOT NULL
);

CREATE TABLE scout_shortlist (player_id TEXT PRIMARY KEY REFERENCES players(id), added_on TEXT NOT NULL);

-- Notícias ganham o tipo 'staff' (olheiros); SQLite não altera CHECK, então a tabela é recriada preservando os dados.
CREATE TABLE news_v8 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('season', 'trophy', 'transfer', 'contract', 'youth', 'retirement', 'offer', 'staff')),
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
INSERT INTO news_v8 (id, date, kind, title, body) SELECT id, date, kind, title, body FROM news;
DROP TABLE news;
ALTER TABLE news_v8 RENAME TO news;
CREATE INDEX idx_news_date ON news(date DESC, id DESC);
`,
};
