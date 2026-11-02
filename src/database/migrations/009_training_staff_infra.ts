export const migration009 = {
  version: 9,
  name: 'training_staff_infrastructure',
  sql: `
-- Força no início da temporada (o desenvolvimento passou a ser mensal; a virada só registra o saldo da temporada).
ALTER TABLE players ADD COLUMN season_start_overall INTEGER;
UPDATE players SET season_start_overall = overall;

-- Comissão técnica do clube do usuário: um profissional por função.
CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL UNIQUE CHECK (role IN ('assistant', 'fitness', 'goalkeeping', 'doctor')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  nationality TEXT NOT NULL,
  ability INTEGER NOT NULL CHECK (ability BETWEEN 1 AND 20),
  salary INTEGER NOT NULL CHECK (salary >= 0),
  hired_on TEXT NOT NULL,
  contract_end TEXT NOT NULL
);

-- Rotina de treino do clube do usuário (linha única). delegated = o preparador físico decide intensidade e focos.
CREATE TABLE training_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  intensity TEXT NOT NULL DEFAULT 'normal' CHECK (intensity IN ('light', 'normal', 'hard')),
  delegated INTEGER NOT NULL DEFAULT 0 CHECK (delegated IN (0, 1))
);
INSERT INTO training_settings (id) VALUES (1);

CREATE TABLE player_training (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  focus TEXT NOT NULL CHECK (focus IN ('balanced', 'finishing', 'creation', 'defense', 'physical', 'technical', 'goalkeeping'))
);

-- Obras de infraestrutura (uma por vez no clube do usuário).
CREATE TABLE construction_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  kind TEXT NOT NULL CHECK (kind IN ('training', 'youth', 'medical', 'stadium')),
  from_level INTEGER NOT NULL,
  cost INTEGER NOT NULL CHECK (cost >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done'))
);
`,
};
