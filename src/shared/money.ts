/** Moeda única do jogo: euro. Ex.: € 33.820.000; negativo: −€ 1.200.000. Usada nas telas e nas mensagens geradas pelo jogo. */
export const CURRENCY = '€';
export const fmtMoney = (n: number): string => `${n < 0 ? '−' : ''}${CURRENCY} ${Math.abs(n).toLocaleString('pt-BR')}`;
