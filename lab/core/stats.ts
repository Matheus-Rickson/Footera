/** Contas e formatação usadas pelos cenários (puras). */
import type { MatchOutcome, Mentality, TeamTactics } from '../../src/game/match-engine/types.ts';
import { BALANCED } from './universe.ts';
import { ParamError, type ParamDef, type ParamValue } from './types.ts';

export const mean = (a: readonly number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
export function sd(a: readonly number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
/** erro-padrão da média */
export const se = (a: readonly number[]): number => (a.length ? sd(a) / Math.sqrt(a.length) : 0);
export function quantile(a: readonly number[], q: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

export const f1 = (x: number): string => x.toFixed(1).replace('.', ',');
export const f2 = (x: number): string => x.toFixed(2).replace('.', ',');
export const f3 = (x: number): string => x.toFixed(3).replace('.', ',');
export const pct = (x: number, d = 1): string => `${(100 * x).toFixed(d).replace('.', ',')}%`;
export const pts = (a: number, b: number): number => (a > b ? 3 : a === b ? 1 : 0);

/** acréscimos de cada tempo (minutos), lidos dos rótulos "45+3'" / "90+5'" dos fins de período */
export function addedTime(o: MatchOutcome): { first: number; second: number } {
  const of = (detail: string) => {
    const e = o.events.find((x) => x.type === 'period_end' && x.detail === detail);
    const m = e?.label.match(/\+(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  return { first: of('halftime'), second: of('fulltime') };
}

/** anomalias de uma partida (o que nunca deveria acontecer): notas fora de 3–10, posse ≠ 100%, minutos inválidos, números inválidos */
export function anomalies(o: MatchOutcome): string[] {
  const out: string[] = [];
  const poss = o.stats[0].possession + o.stats[1].possession;
  if (Math.abs(poss - 100) > 0.6) out.push(`posse soma ${poss}`);
  for (const p of o.players) {
    if (p.minutes > 0 && (p.rating < 3 || p.rating > 10)) out.push(`nota ${p.rating} de ${p.name}`);
    if (p.minutes < 0 || p.minutes > o.duration + 1) out.push(`${p.minutes} min de ${p.name}`);
  }
  for (const s of o.stats) for (const [k, v] of Object.entries(s)) if (!Number.isFinite(v) || v < 0) out.push(`${k} = ${v}`);
  if (o.homeGoals < 0 || o.awayGoals < 0) out.push('gols negativos');
  return out;
}

// ---------------------------------------------------------------- parâmetros comuns de partida
export const MENTALITIES: Array<{ value: Mentality; label: string }> = [
  { value: 'balanced', label: 'Equilibrada' }, { value: 'attacking', label: 'Ofensiva' }, { value: 'defensive', label: 'Defensiva' },
];

/** formação + mentalidade + ritmo/pressão/linha de um lado ('home' | 'away') */
export function sideParams(side: 'home' | 'away', label: string): ParamDef[] {
  return [
    { key: `${side}Formation`, label: `Formação (${label})`, kind: 'select', default: 'auto', options: [{ value: 'auto', label: 'Automática (a que melhor encaixa)' }], source: 'formations' },
    { key: `${side}Mentality`, label: `Mentalidade (${label})`, kind: 'select', default: 'balanced', options: MENTALITIES },
    { key: `${side}Pressing`, label: `Pressão 1–5 (${label})`, kind: 'number', default: 3, min: 1, max: 5 },
    { key: `${side}Tempo`, label: `Ritmo 1–5 (${label})`, kind: 'number', default: 3, min: 1, max: 5 },
    { key: `${side}Line`, label: `Linha defensiva 1–5 (${label})`, kind: 'number', default: 3, min: 1, max: 5 },
  ];
}

export function tacticsFrom(p: Record<string, ParamValue>, side: 'home' | 'away'): TeamTactics {
  const m = p[`${side}Mentality`];
  if (m !== 'balanced' && m !== 'attacking' && m !== 'defensive') throw new ParamError(`Mentalidade inválida: ${String(m)}`);
  return { ...BALANCED, mentality: m, pressing: Number(p[`${side}Pressing`]), tempo: Number(p[`${side}Tempo`]), defensiveLine: Number(p[`${side}Line`]) };
}
