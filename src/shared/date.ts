import type { IsoDate } from './types.ts';

export function parseIso(d: IsoDate): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Data inválida: ${d}`);
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) {
    throw new Error(`Data inexistente: ${d}`);
  }
  return { y, m: mo, d: da };
}

export function isValidIso(d: string): boolean {
  try { parseIso(d); return true; } catch { return false; }
}

export function ageOn(birth: IsoDate, on: IsoDate): number {
  const b = parseIso(birth), o = parseIso(on);
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age--;
  return age;
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const { y, m, d: da } = parseIso(d);
  return new Date(Date.UTC(y, m - 1, da + days)).toISOString().slice(0, 10);
}

export function addYears(d: IsoDate, years: number): IsoDate {
  const { y, m, d: da } = parseIso(d);
  const dt = new Date(Date.UTC(y + years, m - 1, da));
  // 29/02 em ano não bissexto: normaliza para 28/02.
  if (dt.getUTCMonth() !== m - 1) return new Date(Date.UTC(y + years, m - 1, 28)).toISOString().slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(d: IsoDate): number {
  const { y, m, d: da } = parseIso(d);
  return new Date(Date.UTC(y, m - 1, da)).getUTCDay();
}

export function nextWeekdayOnOrAfter(d: IsoDate, wd: number): IsoDate {
  return addDays(d, (wd - weekday(d) + 7) % 7);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  const pa = parseIso(a), pb = parseIso(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/**
 * Grade de um mês para o calendário: semanas completas de domingo a sábado (5 ou 6), incluindo os dias do mês anterior e do
 * seguinte que completam a primeira e a última semana.
 */
export function monthGrid(year: number, month: number): IsoDate[] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const start = addDays(first, -weekday(first));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const days = Math.ceil((daysBetween(start, last) + 1) / 7) * 7;
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}
