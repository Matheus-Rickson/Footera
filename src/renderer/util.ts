import type { IpcResult } from '../shared/api.ts';
import type { Methodology } from '../shared/types.ts';

export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const fmtDate = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
export const fmtDateTime = (iso: string): string => new Date(iso).toLocaleString('pt-BR');
export const fmtNum = (n: number): string => n.toLocaleString('pt-BR');
export { fmtMoney } from '../shared/money.ts';
export const fmtPlay = (s: number): string => (s < 60 ? 'menos de 1 min' : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`);

export const METHODOLOGY: Record<Methodology, { label: string; description: string }> = {
  defensive: { label: 'Defensivo', description: 'Solidez, linhas compactas e contra-ataques.' },
  possession: { label: 'Posse de bola', description: 'Construção paciente e controle do jogo.' },
  aggressive: { label: 'Agressivo', description: 'Pressão alta e ataque em velocidade.' },
};

export const fmtWeekday = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');

export const TIEBREAKER_LABEL: Record<string, string> = {
  points: 'Pontos', wins: 'Vitórias', goalDiff: 'Saldo de gols', goalsFor: 'Gols pró', headToHead: 'Confronto direto',
};

export const MENTALITY_LABEL: Record<string, string> = { defensive: 'Defensiva', balanced: 'Equilibrada', attacking: 'Ofensiva' };
export const BUILDUP_LABEL: Record<string, string> = { short: 'Curta (posse)', mixed: 'Mista', long: 'Direta (bolas longas)' };

/** "Callum Harris" -> "C. Harris" (evita rótulos iguais no campo quando há sobrenomes repetidos). */
export const shortName = (full: string): string => {
  const parts = full.trim().split(/\s+/);
  return parts.length < 2 ? full : `${parts[0]![0]}. ${parts.slice(1).join(' ')}`;
};
