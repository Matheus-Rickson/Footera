export const migration013 = {
  version: 13,
  name: 'sim_levels',
  sql: `
-- Nível de simulação por país, escolhido ao criar a carreira: 'full' = tudo (partidas lance a lance, finanças, mercado, base, treino,
-- diretoria e técnicos); 'light' = simplificado (resultado pela força, sem finanças nem base; evolução e reposição uma vez por ano).
-- Saves anteriores: todos os países completos (como antes).
ALTER TABLE countries ADD COLUMN sim_level TEXT NOT NULL DEFAULT 'full' CHECK (sim_level IN ('full', 'light'));
`,
};
