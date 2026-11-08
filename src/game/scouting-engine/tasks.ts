/**
 * Tarefas de busca dos olheiros (docs/SCOUTING_YOUTH.md, "Tarefas de busca"). Lógica pura: critérios, nome automático, faixa de
 * compatíveis e ritmo do relatório. Decisões do usuário (07/11/2026): os critérios são checados nos valores REAIS (o olheiro encontra quem
 * de fato atende; o usuário continua vendo só faixas — regra 7), escopos país / liga / mundo, olheiros contratados (cada tarefa ativa ocupa
 * um olheiro; as demais esperam na fila).
 */
import type { Attributes, Position } from '../../shared/types.ts';
import { POS_LABEL } from '../../shared/positions.ts';
import { ATTR_GROUP } from '../../shared/attributeLabels.ts';
import { to20, toStars } from '../../shared/scale.ts';
import { dailyGain } from './scouting.ts';

export type ScoutScope = 'country' | 'league' | 'world';
export interface NumRange { min?: number; max?: number }
export type ScoutStatKey = 'appearances' | 'minutes' | 'goals' | 'assists' | 'avgRating';
export type ScoutStatus = 'free' | 'expiring' | 'contracted';

/**
 * Critérios de uma tarefa (todos opcionais; o jogador precisa atender a TODOS). Escalas: força e potencial 1–20 (como nas telas),
 * reputação em estrelas 0–5, condição e moral 0–100, atributos 1–20 (mínimo), estatísticas = mínimos na temporada atual do país.
 */
export interface ScoutCriteria {
  positions?: Position[];
  /** joga também em alguma destas (posição principal ou secundária) */
  secondary?: Position[];
  overall?: NumRange; potential?: NumRange; age?: NumRange;
  value?: NumRange; salary?: NumRange; reputation?: NumRange; condition?: NumRange; morale?: NumRange;
  foot?: 'left' | 'right' | 'both';
  /** free = sem clube; expiring = contrato termina em até 6 meses; contracted = com contrato */
  status?: ScoutStatus;
  attributes?: Partial<Record<string, number>>;
  stats?: Partial<Record<ScoutStatKey, number>>;
}

/** O que o olheiro sabe de verdade sobre o jogador (valores reais; nunca vai para a tela). */
export interface ScoutSubject {
  position: Position; secondary: Position[]; overall: number; potential: number; age: number; value: number; salary: number;
  /** reputação 0–100 (playerReputation) */ reputation: number;
  foot: string; clubId: string | null; contractEnd: string; condition: number; morale: number;
  attributes: Attributes | null;
  stats: { appearances: number; minutes: number; goals: number; assists: number; avgRating: number | null } | null;
}

/** Jogadores acompanhados ao mesmo tempo por tarefa no nível padrão do departamento (o real vem de `trackedFor`). */
export const TASK_TRACKED = 5;
/** Tarefas abertas (ativas + fila) ao mesmo tempo. */
export const MAX_OPEN_TASKS = 12;
/** Jogadores listados por tarefa (os mais recentes ficam de fora quando passa disso). */
export const MAX_FOUND = 300;
/** Durações oferecidas (meses); null = contínua. */
export const TASK_MONTHS = [1, 2, 3, 6, 9, 12] as const;
/** Busca no mundo todo: o olheiro viaja mais e observa mais devagar. */
export const WORLD_FACTOR = 0.75;

export const STAT_LABEL: Record<ScoutStatKey, string> = { appearances: 'Jogos', minutes: 'Minutos', goals: 'Gols', assists: 'Assistências', avgRating: 'Nota média' };
export const STATUS_LABEL: Record<ScoutStatus, string> = { free: 'Sem clube', expiring: 'Contrato terminando (≤ 6 meses)', contracted: 'Com contrato' };
export const SCOPE_LABEL: Record<ScoutScope, string> = { country: 'País', league: 'Liga', world: 'Mundo' };

/** Ganho diário de conhecimento por jogador acompanhado numa tarefa. */
export const taskGain = (ability: number, scope: ScoutScope): number => dailyGain(ability) * (scope === 'world' ? WORLD_FACTOR : 1);
/** Dias para um relatório completo (0 → 100%). */
export const reportDays = (ability: number, scope: ScoutScope): number => Math.ceil(100 / taskGain(ability, scope));

const inRange = (v: number, r: NumRange | undefined) => !r || ((r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max));
const flatAttrs = (a: Attributes): Record<string, number> => ({ ...a.technical, ...a.mental, ...a.physical, ...(a.goalkeeper ?? {}) });

/** O jogador atende a todos os critérios? `date` = hoje (contrato terminando). */
export function matchesCriteria(s: ScoutSubject, c: ScoutCriteria, date: string): boolean {
  if (c.positions?.length && !c.positions.includes(s.position)) return false;
  if (c.secondary?.length && !c.secondary.some((p) => p === s.position || s.secondary.includes(p))) return false;
  if (!inRange(to20(s.overall), c.overall) || !inRange(to20(s.potential), c.potential) || !inRange(s.age, c.age)) return false;
  if (!inRange(s.value, c.value) || !inRange(s.salary, c.salary) || !inRange(toStars(s.reputation), c.reputation)) return false;
  if (!inRange(s.condition, c.condition) || !inRange(s.morale, c.morale)) return false;
  if (c.foot && s.foot !== c.foot) return false;
  if (c.status === 'free' && s.clubId !== null) return false;
  if (c.status === 'contracted' && s.clubId === null) return false;
  if (c.status === 'expiring' && (s.clubId === null || s.contractEnd > addMonths(date, 6))) return false;
  const attrs = Object.entries(c.attributes ?? {}).filter(([, v]) => v !== undefined);
  if (attrs.length) {
    if (!s.attributes) return false;
    const flat = flatAttrs(s.attributes);
    if (attrs.some(([k, v]) => (flat[k] ?? 0) < v!)) return false;
  }
  const stats = Object.entries(c.stats ?? {}).filter(([, v]) => v !== undefined) as Array<[ScoutStatKey, number]>;
  if (stats.length) {
    if (!s.stats) return stats.every(([, v]) => v <= 0);
    for (const [k, v] of stats) if ((s.stats[k] ?? 0) < v) return false;
  }
  return true;
}

/** Critério de atributo de goleiro? (para separar os grupos na tela). */
export const isGoalkeeperAttr = (k: string) => ATTR_GROUP[k] === 'goalkeeper';
export const needsAttributes = (c: ScoutCriteria) => Object.values(c.attributes ?? {}).some((v) => v !== undefined);
export const needsStats = (c: ScoutCriteria) => Object.values(c.stats ?? {}).some((v) => v !== undefined);

/** Quantos critérios estão preenchidos (o contador da tela). */
export function criteriaCount(c: ScoutCriteria): number {
  const ranges = [c.overall, c.potential, c.age, c.value, c.salary, c.reputation, c.condition, c.morale].filter((r) => r && (r.min !== undefined || r.max !== undefined)).length;
  return ranges + (c.positions?.length ? 1 : 0) + (c.secondary?.length ? 1 : 0) + (c.foot ? 1 : 0) + (c.status ? 1 : 0)
    + Object.values(c.attributes ?? {}).filter((v) => v !== undefined).length + Object.values(c.stats ?? {}).filter((v) => v !== undefined).length;
}

const rangeText = (label: string, r: NumRange | undefined): string | null => {
  if (!r || (r.min === undefined && r.max === undefined)) return null;
  if (r.min !== undefined && r.max !== undefined) return r.min === r.max ? `${label} ${r.min}` : `${label} ${r.min}–${r.max}`;
  return r.min !== undefined ? `${label} ${r.min}+` : `${label} ≤${r.max}`;
};

/** Nome automático: "ATA · Brasil · Força 13+ · Idade ≤27 · +2 filtros". */
export function taskName(areaName: string, c: ScoutCriteria): string {
  const parts = [c.positions?.length ? c.positions.map((p) => POS_LABEL[p]).join('/') : 'Todas as posições', areaName];
  const shown = [rangeText('Força', c.overall), rangeText('Potencial', c.potential), rangeText('Idade', c.age)].filter((x): x is string => !!x);
  parts.push(...shown);
  const rest = criteriaCount(c) - shown.length - (c.positions?.length ? 1 : 0);
  if (rest > 0) parts.push(`+${rest} ${rest === 1 ? 'filtro' : 'filtros'}`);
  return parts.join(' · ');
}

const BUCKETS: Array<[number, number]> = [[1, 5], [6, 10], [11, 20], [21, 35], [36, 50], [51, 100], [101, 200], [201, 500], [501, 1000], [1001, 2000]];
/**
 * Faixa aproximada de jogadores compatíveis (a tela não mostra o número exato: ele viria dos valores reais). 0 = nenhum; acima de 2.000,
 * `high` = null ("mais de 2.000").
 */
export function compatibleBucket(n: number): { low: number; high: number | null } {
  if (n <= 0) return { low: 0, high: 0 };
  const b = BUCKETS.find(([, hi]) => n <= hi);
  return b ? { low: b[0], high: b[1] } : { low: 2001, high: null };
}

/** Soma meses a uma data ISO (dia limitado ao fim do mês). */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + months, d = Number(iso.slice(8, 10));
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Erros de critérios (mensagens para o usuário); vazio = válido. */
export function criteriaProblems(c: ScoutCriteria): string[] {
  const out: string[] = [];
  const check = (label: string, r: NumRange | undefined, lo: number, hi: number) => {
    if (!r) return;
    for (const v of [r.min, r.max]) if (v !== undefined && (!Number.isFinite(v) || v < lo || v > hi)) out.push(`${label}: use valores de ${lo} a ${hi}.`);
    if (r.min !== undefined && r.max !== undefined && r.min > r.max) out.push(`${label}: o mínimo passa do máximo.`);
  };
  check('Força', c.overall, 1, 20); check('Potencial', c.potential, 1, 20); check('Idade', c.age, 14, 45);
  check('Valor de mercado', c.value, 0, 1e10); check('Salário', c.salary, 0, 1e9); check('Reputação', c.reputation, 0, 5);
  check('Condição', c.condition, 0, 100); check('Moral', c.morale, 0, 100);
  for (const [k, v] of Object.entries(c.attributes ?? {})) {
    if (!(k in ATTR_GROUP)) out.push(`Atributo desconhecido: ${k}.`);
    else if (v !== undefined && (!Number.isFinite(v) || v < 1 || v > 20)) out.push('Atributos: use valores de 1 a 20.');
  }
  for (const [k, v] of Object.entries(c.stats ?? {})) {
    if (!(k in STAT_LABEL)) out.push(`Estatística desconhecida: ${k}.`);
    else if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > (k === 'avgRating' ? 10 : 10_000))) out.push(`${STAT_LABEL[k as ScoutStatKey]}: valor fora do intervalo.`);
  }
  return out;
}
