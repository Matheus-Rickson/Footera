export const migration006 = {
  version: 6,
  name: 'transfers',
  sql: `
CREATE TABLE transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  from_club_id TEXT REFERENCES clubs(id),
  to_club_id TEXT NOT NULL REFERENCES clubs(id),
  fee INTEGER NOT NULL CHECK (fee >= 0),
  wage INTEGER NOT NULL CHECK (wage >= 0),
  years INTEGER NOT NULL CHECK (years BETWEEN 1 AND 5),
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'sale', 'ai')),
  CHECK (from_club_id IS NULL OR from_club_id <> to_club_id)
);
CREATE INDEX idx_transfers_date ON transfers(date DESC, id DESC);

CREATE TABLE transfer_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  expires TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  buyer_club_id TEXT NOT NULL REFERENCES clubs(id),
  seller_club_id TEXT NOT NULL REFERENCES clubs(id),
  fee INTEGER NOT NULL CHECK (fee >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  response_date TEXT
);
CREATE INDEX idx_offers_status ON transfer_offers(status, expires);

CREATE TABLE transfer_list (player_id TEXT PRIMARY KEY REFERENCES players(id));
`,
};
