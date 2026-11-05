export const migration017 = {
  version: 17,
  name: 'ai_coaches',
  sql: `
-- Técnicos da IA como pessoas: um por clube (o do usuário é o próprio usuário) e um grupo de desempregados. A demissão da IA tira o
-- técnico do clube (vaga aberta); a vaga é preenchida por um desempregado de reputação compatível. Reputação evolui na virada.
CREATE TABLE ai_coaches (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  nationality TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  reputation INTEGER NOT NULL CHECK (reputation BETWEEN 1 AND 100),
  attributes_json TEXT NOT NULL,
  methodology TEXT NOT NULL,
  club_id TEXT REFERENCES clubs(id),
  since TEXT,
  retired INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_ai_coaches_club ON ai_coaches(club_id) WHERE club_id IS NOT NULL;
CREATE TABLE ai_coach_spells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id TEXT NOT NULL REFERENCES ai_coaches(id),
  club_id TEXT NOT NULL REFERENCES clubs(id),
  start_date TEXT NOT NULL,
  end_date TEXT,
  end_reason TEXT CHECK (end_reason IN ('sacked', 'replaced', 'retired'))
);
CREATE INDEX idx_ai_coach_spells_club ON ai_coach_spells(club_id, start_date);
`,
};
