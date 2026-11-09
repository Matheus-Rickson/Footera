/**
 * Aposentadoria anunciada e contrapropostas (09/11/2026).
 * - `players.retire_planned`: o jogador anunciou, no início da temporada, que encerra a carreira ao FIM dela (sorteio na virada anterior,
 *   ou na criação da carreira). Antes, a aposentadoria era sorteada e aplicada na própria virada, e o treinador perdia jogadores no
 *   primeiro dia da temporada sem aviso.
 * - `transfer_offers.counter_rounds`: quantas contrapropostas o usuário já fez nessa proposta recebida (o comprador aceita, cobre com um
 *   valor intermediário ou desiste; depois de 2 rodadas, só aceita ou desiste).
 */
export const migration027 = {
  version: 27,
  name: 'retirement_counteroffers',
  sql: `
ALTER TABLE players ADD COLUMN retire_planned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transfer_offers ADD COLUMN counter_rounds INTEGER NOT NULL DEFAULT 0;
`,
};
