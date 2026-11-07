/**
 * Copas e supercopas do universo (Fase 9), editáveis no editor de dados (`cups.json` dos pacotes). O padrão de cada país vem das regras
 * reais em formats.ts e supercups.ts; o pacote pode mudar nome, ativar/desativar, janela, limite de amarelos, datas, mando, desempate e a
 * regra da dobradinha. As fases da copa vêm de um formato existente (`stagesFrom`: o código do país cujo regulamento é usado), o que
 * permite dar copa a um país novo de pacote com o formato de outro.
 */
import type { Country, WorldCup } from '../../shared/types.ts';
import { CUP_FORMATS, cupFormatFor, type CupFormat } from './formats.ts';
import { SUPERCUP_RULES, supercupRuleFor, type SupercupRule } from './supercups.ts';

export const cupDefId = (countryId: string) => `cup-${countryId}`;
export const supercupDefId = (countryId: string) => `sup-${countryId}`;

/** Copas e supercopas padrão dos países (os que têm regra no jogo). */
export function defaultCups(countries: readonly Country[]): WorldCup[] {
  const out: WorldCup[] = [];
  for (const c of countries) {
    const f = cupFormatFor(c.code);
    if (f) out.push({
      id: cupDefId(c.id), countryId: c.id, kind: 'cup', name: f.name, enabled: true, stagesFrom: c.code,
      window: { ...f.window }, ...(f.windowCalendarYear ? { windowCalendarYear: { ...f.windowCalendarYear } } : {}), yellowLimit: f.discipline.yellowLimit,
    });
    const r = supercupRuleFor(c.code);
    if (r) out.push({
      id: supercupDefId(c.id), countryId: c.id, kind: 'supercup', name: r.name, enabled: true,
      teams: r.teams, double: r.double, host: r.host, extraTime: r.extraTime, dates: [...r.dates], ...(r.datesCalendarYear ? { datesCalendarYear: [...r.datesCalendarYear] } : {}),
    });
  }
  return out;
}

/** Formato completo da copa a partir da definição do universo (null se desativada ou sem formato de fases). */
export function resolveCup(def: WorldCup, countryCode: string): CupFormat | null {
  if (def.kind !== 'cup' || !def.enabled) return null;
  const base = cupFormatFor(def.stagesFrom ?? countryCode);
  if (!base) return null;
  const { windowCalendarYear: _w, ...rest } = base;
  return {
    ...rest, id: def.id, countryCode, name: def.name,
    window: def.window ? { ...def.window } : { ...base.window },
    ...((def.windowCalendarYear ?? base.windowCalendarYear) ? { windowCalendarYear: { ...(def.windowCalendarYear ?? base.windowCalendarYear)! } } : {}),
    discipline: { ...base.discipline, yellowLimit: def.yellowLimit ?? base.discipline.yellowLimit },
  };
}

/** Regra completa da supercopa (null se desativada). Campos ausentes: os da regra real do país, ou os mais comuns. */
export function resolveSupercup(def: WorldCup, countryCode: string): SupercupRule | null {
  if (def.kind !== 'supercup' || !def.enabled) return null;
  const real = supercupRuleFor(countryCode);
  const dates = def.dates ? [...def.dates] : real ? [...real.dates] : ['07-26'];
  // ano civil: as datas próprias, as da regra real, as mesmas da temporada de julho (se informadas) ou o fim de janeiro
  const civil = def.datesCalendarYear ?? real?.datesCalendarYear ?? (def.dates || real ? dates : ['01-24']);
  return {
    id: def.id, countryCode, name: def.name,
    regulation: real?.regulation ?? 'Pacote de dados', source: real?.source ?? { structure: 'ADAPT', tiebreak: 'ADAPT', host: 'ADAPT' },
    teams: def.teams ?? real?.teams ?? 2, double: def.double ?? real?.double ?? 'league2', host: def.host ?? real?.host ?? 'neutral',
    extraTime: def.extraTime ?? real?.extraTime ?? false, dates, datesCalendarYear: [...civil],
    ...(real?.extraSub ? { extraSub: true } : {}),
  };
}

/** Códigos de país com formato de fases de copa (opções do campo "fases de" no editor). */
export const CUP_STAGE_CODES: readonly string[] = CUP_FORMATS.map((f) => f.countryCode);
export const SUPERCUP_CODES: readonly string[] = SUPERCUP_RULES.map((r) => r.countryCode);
