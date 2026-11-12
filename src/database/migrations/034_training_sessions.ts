/**
 * Treino por sessões, ritmo de jogo e carga aguda (v0.8.12, docs/TRAINING_STAFF.md). Só acrescenta tabelas e colunas; os valores iniciais
 * dos saves antigos: grade "Equilibrada" com ajuste automático, ritmo 85 para quem jogou na temporada (75 para os demais e para carreiras novas), carga 0.
 */
export const migration034 = {
  version: 34,
  name: 'training_sessions',
  sql: `
-- grade semanal do clube do usuário (0 = domingo … 6 = sábado)
CREATE TABLE training_week (
  dow INTEGER PRIMARY KEY CHECK (dow BETWEEN 0 AND 6),
  session TEXT NOT NULL CHECK (session IN ('physical', 'technical', 'tactical', 'prematch', 'recovery', 'rest'))
);
INSERT INTO training_week (dow, session) VALUES (0, 'rest'), (1, 'technical'), (2, 'physical'), (3, 'tactical'), (4, 'technical'), (5, 'tactical'), (6, 'prematch');
ALTER TABLE training_settings ADD COLUMN template TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE training_settings ADD COLUMN auto_adjust INTEGER NOT NULL DEFAULT 1 CHECK (auto_adjust IN (0, 1));

-- sessão de goleiros escolhida pelo técnico para cada goleiro (NULL = a do treinador de goleiros, ou todas as áreas sem ele)
ALTER TABLE player_training ADD COLUMN gk_session TEXT CHECK (gk_session IS NULL OR gk_session IN ('reflexes', 'aerial', 'distribution'));

-- acumulado do mês do clube do usuário: o que a grade efetiva deu × o que a semana Equilibrada daria com os mesmos jogos
CREATE TABLE training_month (
  key TEXT PRIMARY KEY,
  actual REAL NOT NULL DEFAULT 0,
  ref REAL NOT NULL DEFAULT 0
);

-- atributos de goleiro no início do mês (relatório do treinador de goleiros)
CREATE TABLE gk_month_start (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  attrs_json TEXT NOT NULL,
  overall INTEGER NOT NULL
);

ALTER TABLE players ADD COLUMN sharpness REAL NOT NULL DEFAULT 75;
ALTER TABLE players ADD COLUMN acute_load REAL NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN last_played TEXT;
-- datas em que o ritmo e a carga gravados valiam (cálculo preguiçoso: o valor do dia sai da fórmula; NULL = ainda sem data, sem queda)
ALTER TABLE players ADD COLUMN sharp_on TEXT;
ALTER TABLE players ADD COLUMN acute_on TEXT;
UPDATE players SET sharpness = 85 WHERE id IN (SELECT player_id FROM player_season_stats WHERE minutes > 0);
-- saves antigos: o ritmo gravado vale na data atual do jogo (o universo, sem carreira, fica sem data)
UPDATE players SET sharp_on = (SELECT game_date FROM career WHERE id = 1);
-- jogadores ainda sem data (universo, recém-criados): o dia de treino grava a data na primeira vez (índice parcial = checagem barata)
CREATE INDEX idx_players_sharp_on_null ON players(id) WHERE sharp_on IS NULL;
-- quem não está inteiro (recuperação diária dos países simplificados e dos livres sem varrer as linhas largas de players)
CREATE INDEX idx_players_tired ON players(club_id) WHERE condition_pct < 100;
-- dia de treino: todos os jogadores de clubes completos, sem ler as linhas largas (índice de cobertura)
CREATE INDEX idx_players_daily ON players(club_id, id, condition_pct, acute_load, acute_on);
`,
};
