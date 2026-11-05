import type { Position } from './types.ts';

/** Siglas e nomes das posições em português (o código interno continua GK, CB…; só a exibição muda). */
export const POS_LABEL: Record<Position, string> = { GK: 'GOL', CB: 'ZAG', LB: 'LE', RB: 'LD', LWB: 'AE', RWB: 'AD', DM: 'VOL', CM: 'MC', LM: 'ME', RM: 'MD', AM: 'MEI', LW: 'PE', RW: 'PD', SS: 'SA', CF: 'CA', ST: 'ATA' };
export const POS_NAME: Record<Position, string> = { GK: 'Goleiro', CB: 'Zagueiro', LB: 'Lateral esquerdo', RB: 'Lateral direito', LWB: 'Ala esquerda', RWB: 'Ala direita', DM: 'Volante', CM: 'Meio-campista', LM: 'Meia esquerda', RM: 'Meia direita', AM: 'Meia', LW: 'Ponta esquerda', RW: 'Ponta direita', SS: 'Segundo atacante', CF: 'Centroavante', ST: 'Atacante' };
/** Ordem de exibição (do gol ao ataque, esquerda antes da direita). */
export const POS_ORDER: Position[] = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST'];
export const posLabel = (p: Position): string => POS_LABEL[p] ?? p;
/**
 * Posições secundárias plausíveis para cada posição natural (vizinhas no campo, mesmo lado). Goleiro não tem secundária
 * e ninguém de linha vira goleiro; um atacante não vira zagueiro, um lateral não vira centroavante.
 */
export const SECONDARY_OPTIONS: Record<Position, Position[]> = {
  GK: [],
  CB: ['DM', 'LB', 'RB'],
  LB: ['LWB', 'CB', 'LM'], RB: ['RWB', 'CB', 'RM'],
  LWB: ['LB', 'LM', 'LW'], RWB: ['RB', 'RM', 'RW'],
  DM: ['CB', 'CM'],
  CM: ['DM', 'AM', 'LM', 'RM'],
  LM: ['LW', 'CM', 'LWB', 'RM'], RM: ['RW', 'CM', 'RWB', 'LM'],
  AM: ['CM', 'SS', 'LW', 'RW'],
  LW: ['LM', 'RW', 'SS', 'AM'], RW: ['RM', 'LW', 'SS', 'AM'],
  SS: ['AM', 'CF', 'LW', 'RW'],
  CF: ['SS', 'AM'],
  ST: ['AM', 'LW', 'RW'],
};
export const isPlausibleSecondary = (natural: Position, secondary: Position): boolean => SECONDARY_OPTIONS[natural].includes(secondary);
