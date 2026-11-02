export const migration005 = {
  version: 5,
  name: 'finance',
  sql: `
ALTER TABLE countries ADD COLUMN economy REAL NOT NULL DEFAULT 1.0;
UPDATE countries SET economy = CASE code WHEN 'BRA' THEN 0.6 WHEN 'ENG' THEN 1.6 ELSE 1.0 END;

ALTER TABLE matches ADD COLUMN attendance INTEGER;
ALTER TABLE matches ADD COLUMN gate_revenue INTEGER;

CREATE TABLE finance_months (
  club_id TEXT NOT NULL REFERENCES clubs(id),
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  PRIMARY KEY (club_id, month, category)
);

CREATE TABLE finance_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT NOT NULL,
  fixture_id TEXT REFERENCES fixtures(id)
);
CREATE INDEX idx_ledger_club_date ON finance_ledger(club_id, date DESC);

CREATE TABLE sponsor_deals (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  kind TEXT NOT NULL CHECK (kind IN ('shirt', 'kit', 'stadium')),
  sponsor_name TEXT NOT NULL,
  monthly_amount INTEGER NOT NULL CHECK (monthly_amount >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_sponsor_club ON sponsor_deals(club_id, kind, end_date);
`,
};
