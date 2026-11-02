import { createRng, clamp } from '../rng.ts';
import type { CountryTemplate } from '../world/names.ts';

export const MAX_SCOUTS = 4;
export const SCOUT_CONTRACT_YEARS = 2;
/** Meses de salário pagos ao demitir um olheiro (limitados ao que resta do contrato). */
export const SCOUT_SEVERANCE_MONTHS = 3;
/** Jogadores acompanhados ao mesmo tempo por um olheiro designado a um país (cada um recebe o ganho diário cheio até 100%). */
export const COUNTRY_PLAYERS_PER_DAY = 5;

export interface ScoutCandidate { id: string; firstName: string; lastName: string; nationality: string; ability: number; salary: number }

/** Salário mensal de um olheiro: cresce com o quadrado da qualidade, escalado pela economia do país do clube. */
export const scoutSalary = (ability: number, economy: number): number => Math.round((economy * (3000 + ability * ability * 150)) / 100) * 100;

/** Conhecimento (pontos de 0..100) que um olheiro acrescenta por dia a cada jogador que observa. */
export const dailyGain = (ability: number): number => 3 + clamp(ability, 1, 20) * 0.35;

/** Candidatos disponíveis no mês (determinísticos por semente e mês; IDs estáveis para a contratação). */
export function scoutCandidates(seed: string, month: string, templates: readonly CountryTemplate[], economy: number): ScoutCandidate[] {
  const rng = createRng(`scouts:${seed}:${month}`);
  return Array.from({ length: 5 }, (_, i) => {
    const tpl = rng.pick(templates);
    const ability = clamp(Math.round(rng.normal(10, 3.5)), 3, 19);
    return { id: `sct_${month}_${i}`, firstName: rng.pick(tpl.firstNames), lastName: rng.pick(tpl.lastNames), nationality: tpl.code, ability, salary: scoutSalary(ability, economy) };
  });
}

// ---------------------------------------------------------------- categorias de base
/** Dia da peneira (MM-DD), no meio da temporada. */
export const INTAKE_DAY = '03-15';
/** Jovens com esta idade na virada deixam a base (promovidos ou dispensados). */
export const YOUTH_MAX_AGE = 19;
export const YOUTH_CAP = { user: 20, ai: 12 } as const;

/** Salário mensal de um jogador da base (pago como despesa de categorias de base). */
export const youthSalary = (overall: number, economy: number): number => Math.round((economy * (500 + 20 * overall)) / 100) * 100;

/** Tamanho da safra: base melhor revela mais jogadores; o usuário recebe um pouco mais (é a sua academia que ele administra). */
export const intakeSize = (youthLevel: number, user: boolean, roll: number): number =>
  clamp(Math.round(2 + youthLevel / 7 + roll * 2) + (user ? 1 : 0), 2, 7);
