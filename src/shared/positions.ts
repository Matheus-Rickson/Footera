import type { Position } from './types.ts';

/** Siglas e nomes das posições em português (o código interno continua GK, CB…; só a exibição muda). */
export const POS_LABEL: Record<Position, string> = { GK: 'GOL', CB: 'ZAG', LB: 'LE', RB: 'LD', DM: 'VOL', CM: 'MC', AM: 'MEI', LW: 'PE', RW: 'PD', ST: 'ATA' };
export const POS_NAME: Record<Position, string> = { GK: 'Goleiro', CB: 'Zagueiro', LB: 'Lateral esquerdo', RB: 'Lateral direito', DM: 'Volante', CM: 'Meio-campista', AM: 'Meia', LW: 'Ponta esquerda', RW: 'Ponta direita', ST: 'Atacante' };
export const posLabel = (p: Position): string => POS_LABEL[p] ?? p;
