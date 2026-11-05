export const migration014 = {
  version: 14,
  name: 'league_sim_levels',
  sql: `
-- O nível de simulação passa a ser por DIVISÃO (liga): o usuário marca o país (todas as divisões completas) e pode deixar só algumas
-- divisões completas. O clube segue o nível da divisão em que está a cada temporada (acesso/rebaixamento); o clube do usuário é sempre
-- completo. countries.sim_level (migração 013) fica sem uso; o nível atual de cada país passa para as divisões dele.
ALTER TABLE leagues ADD COLUMN sim_level TEXT NOT NULL DEFAULT 'full' CHECK (sim_level IN ('full', 'light'));
UPDATE leagues SET sim_level = COALESCE((SELECT co.sim_level FROM countries co WHERE co.id = leagues.country_id), 'full');
`,
};
