/**
 * Tempo de jogo e renegociação de contratos (v0.8.9).
 * - `squad_roles`: status de tempo de jogo combinado com cada jogador do clube do usuário (Jogador-chave, Titular, Rotação, Reserva,
 *   Promessa) e a base da avaliação mensal: minutos do jogador e jogos do clube (todas as competições, acumulados) na última avaliação,
 *   a data dela e o último veredito. Só jogadores do clube do usuário têm linha (clubes da IA não usam).
 * - `contract_talks`: conversa de renegociação em andamento: ofertas insuficientes já feitas (até 3), último pedido do jogador e os
 *   termos dele (status e temporadas), e até quando ele se recusa a conversar depois de encerrar.
 */
export const migration028 = {
  version: 28,
  name: 'squad_roles_talks',
  sql: `
CREATE TABLE squad_roles (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  status TEXT NOT NULL CHECK (status IN ('key', 'starter', 'rotation', 'backup', 'prospect')),
  since TEXT NOT NULL,
  base_minutes INTEGER NOT NULL DEFAULT 0,
  base_matches INTEGER NOT NULL DEFAULT 0,
  base_date TEXT NOT NULL,
  verdict TEXT CHECK (verdict IN ('happy', 'ok', 'unhappy'))
);
CREATE TABLE contract_talks (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  rounds INTEGER NOT NULL DEFAULT 0 CHECK (rounds >= 0),
  last_counter INTEGER,
  terms TEXT,
  locked_until TEXT
);
`,
};
