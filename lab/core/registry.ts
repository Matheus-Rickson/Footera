/** Cenários do Laboratório, validação de parâmetros e execução (comum à janela e ao terminal). */
import { calibration } from './scenarios/calibration.ts';
import { matchBatch } from './scenarios/matchBatch.ts';
import { matchInspect } from './scenarios/matchInspect.ts';
import { saveInspect } from './scenarios/saveInspect.ts';
import { asUniverse, clubOptions, FORMATION_OPTIONS } from './universe.ts';
import { saveOptions } from './saves.ts';
import { ParamError, type OptionSource, type ParamDef, type ParamValue, type Report, type RunContext, type Scenario } from './types.ts';

export const SCENARIOS: Scenario[] = [matchBatch, matchInspect, calibration, saveInspect];

export function scenarioById(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new ParamError(`Cenário desconhecido: ${id}. Disponíveis: ${SCENARIOS.map((x) => x.id).join(', ')}`);
  return s;
}

/** opções dinâmicas de um parâmetro (clubes dependem do universo escolhido) */
export function optionsFor(source: OptionSource, params: Record<string, ParamValue>): Array<{ value: string; label: string }> {
  if (source === 'clubs') return clubOptions(asUniverse(params.universe ?? 'calib'));
  if (source === 'formations') return FORMATION_OPTIONS;
  return saveOptions();
}

/** parâmetros completos e validados: os que faltam ganham o padrão; tipos e limites conferidos */
export function resolveParams(s: Scenario, given: Record<string, unknown>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  const known = new Set(s.params.map((d) => d.key));
  for (const k of Object.keys(given)) if (!known.has(k)) throw new ParamError(`Parâmetro desconhecido em "${s.id}": ${k}. Aceitos: ${[...known].join(', ')}`);
  for (const d of s.params) out[d.key] = coerce(d, given[d.key]);
  return out;
}

function coerce(d: ParamDef, v: unknown): ParamValue {
  if (v === undefined || v === null || v === '') {
    if (d.kind === 'text' || d.kind === 'select') return v === '' ? '' : d.default;
    return d.default;
  }
  if (d.kind === 'number') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n)) throw new ParamError(`${d.label}: "${String(v)}" não é número.`);
    if (n < d.min || n > d.max) throw new ParamError(`${d.label}: ${n} fora do intervalo ${d.min}–${d.max}.`);
    return n;
  }
  if (d.kind === 'boolean') {
    if (typeof v === 'boolean') return v;
    const t = String(v).toLowerCase();
    if (['1', 'true', 'sim', 's', 'yes'].includes(t)) return true;
    if (['0', 'false', 'nao', 'não', 'n', 'no'].includes(t)) return false;
    throw new ParamError(`${d.label}: use sim/não.`);
  }
  if (d.kind === 'select' && d.options && !d.source && !d.options.some((o) => o.value === String(v)))
    throw new ParamError(`${d.label}: "${String(v)}" não é uma opção (${d.options.map((o) => o.value).join(', ')}).`);
  return String(v);
}

export async function runScenario(id: string, given: Record<string, unknown>, ctx: RunContext): Promise<Report> {
  const s = scenarioById(id);
  const params = resolveParams(s, given);
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const r = await s.run(params, ctx);
  return { scenario: s.id, title: s.title, params, startedAt, ms: Math.round(performance.now() - t0), ...r };
}

/** descrição serializável dos cenários (para a janela, que não importa o código do motor) */
export const scenarioCatalog = () => SCENARIOS.map(({ id, title, description, params }) => ({ id, title, description, params }));
