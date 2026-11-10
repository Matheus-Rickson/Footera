/**
 * Patrocínios negociáveis (v0.8.10, docs/FINANCE.md).
 * - `sponsor_deals` ganha `bonus_json` (bônus por metas do contrato negociado), `negotiated` (1 = fechado pelo usuário) e
 *   `terminated_on` (rescindido pelo clube nesta data: a cota fica vaga até o usuário fechar outro contrato).
 * - `sponsor_offers`: propostas de empresas ao clube do usuário. `standing` = o que a empresa oferece hoje (proposta inicial ou última
 *   contraproposta); `ceiling` = o máximo que ela aceita (escondido); `rounds` = pedidos acima do teto já feitos (até 3);
 *   `for_deal` = contrato que a proposta substitui (janela de renovação) ou NULL (cota vaga).
 */
export const migration029 = {
  version: 29,
  name: 'sponsor_offers',
  sql: `
ALTER TABLE sponsor_deals ADD COLUMN bonus_json TEXT;
ALTER TABLE sponsor_deals ADD COLUMN negotiated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sponsor_deals ADD COLUMN terminated_on TEXT;
CREATE TABLE sponsor_offers (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  kind TEXT NOT NULL CHECK (kind IN ('shirt', 'kit', 'stadium')),
  sponsor_name TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (profile IN ('fixed', 'bonus')),
  monthly INTEGER NOT NULL CHECK (monthly > 0),
  standing INTEGER NOT NULL CHECK (standing > 0),
  ceiling INTEGER NOT NULL CHECK (ceiling > 0),
  years INTEGER NOT NULL CHECK (years BETWEEN 1 AND 4),
  bonus_json TEXT NOT NULL DEFAULT '[]',
  rounds INTEGER NOT NULL DEFAULT 0 CHECK (rounds >= 0),
  for_deal TEXT,
  created TEXT NOT NULL,
  expires TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'expired', 'walkout')),
  locked_until TEXT
);
CREATE INDEX idx_sponsor_offers_club ON sponsor_offers (club_id, kind, status);
`,
};
