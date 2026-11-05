export const migration015 = {
  version: 15,
  name: 'social',
  sql: `
-- Rede social do futebol (aba Notícias): perfis (veículos e jornalistas fictícios, perfis oficiais de ligas e clubes, torcedores),
-- posts gerados a partir do que acontece no jogo (dia a dia e rodada a rodada) e comentários de torcedores. Tudo determinístico pela semente.
CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('outlet', 'journalist', 'league', 'club', 'fan')),
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  club_id TEXT REFERENCES clubs(id),
  league_id TEXT REFERENCES leagues(id),
  bio TEXT NOT NULL DEFAULT '',
  hue INTEGER NOT NULL DEFAULT 200
);
CREATE INDEX idx_social_accounts_club ON social_accounts(kind, club_id);
CREATE TABLE social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES social_accounts(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  card_json TEXT,
  clubs TEXT NOT NULL DEFAULT '',
  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_social_posts_date ON social_posts(date DESC, id DESC);
CREATE TABLE social_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES social_accounts(id),
  text TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_social_comments_post ON social_comments(post_id);
`,
};
