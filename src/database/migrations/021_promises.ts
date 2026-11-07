/**
 * Conversas e promessas (Visão geral, 06/11/2026).
 * - `conversations`: cada conversa do treinador com um jogador do elenco ou com a diretoria (tema, data, efeito) — controla o intervalo entre conversas.
 * - `promises`: promessas feitas (minutos, renovação, posição na liga, vitórias), com a referência no momento da promessa (`baseline_json`),
 *   o prazo e o desfecho (cumprida, quebrada ou anulada quando o jogador ou o treinador deixa o clube).
 */
export const migration021 = {
  version: 21,
  name: 'promises',
  sql: `
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  target TEXT NOT NULL CHECK (target IN ('player', 'board')),
  player_id TEXT REFERENCES players(id),
  topic TEXT NOT NULL,
  date TEXT NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX idx_conversations_player ON conversations(player_id, date);
CREATE TABLE promises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  target TEXT NOT NULL CHECK (target IN ('player', 'board')),
  player_id TEXT REFERENCES players(id),
  kind TEXT NOT NULL CHECK (kind IN ('minutes', 'renewal', 'position', 'wins')),
  made_on TEXT NOT NULL,
  due TEXT NOT NULL,
  baseline_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept', 'broken', 'void')),
  resolved_on TEXT,
  CHECK ((target = 'player') = (player_id IS NOT NULL))
);
CREATE INDEX idx_promises_status ON promises(status, club_id);
`,
};
