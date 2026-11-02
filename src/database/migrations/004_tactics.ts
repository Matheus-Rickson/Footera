export const migration004 = {
  version: 4,
  name: 'tactic_schemes',
  sql: `
CREATE TABLE tactic_schemes (
  id TEXT PRIMARY KEY,
  name TEXT COLLATE NOCASE NOT NULL UNIQUE,
  formation TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  lineup_json TEXT,
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE career ADD COLUMN active_scheme_id TEXT REFERENCES tactic_schemes(id);
`,
};
