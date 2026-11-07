/**
 * Base de dados fixa do FOOTERA: um universo fictício único (16 países), igual para todos os jogadores e todas as carreiras, gravado como
 * pacote de dados em `data/base/` e distribuído com o jogo. Patches da comunidade alteram ESTA base (IDs fixos).
 *
 * Depois de publicada, a base fica CONGELADA: não é regenerada a cada versão (mudanças no gerador não a afetam). Uma base nova só com
 * versão nova (BASE_VERSION) e decisão explícita, porque patches feitos para a anterior podem deixar de funcionar.
 */
export const BASE_ID = 'footera-base';
export const BASE_VERSION = '1.1.0';
/** semente usada UMA vez para gerar a base (`npm run pack -- build-base`); a carreira tem semente própria só para o acaso dos jogos */
export const BASE_SEED = 'footera-base-1';
export const BASE_NAME = 'FOOTERA — base fictícia';
