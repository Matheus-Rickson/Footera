/**
 * Formatos das competições da CONMEBOL (docs/CONTINENTAIS.md; manuais de clubes 2026). Puro: só declara as fases para o motor de formatos.
 *
 * Libertadores (47 sementes, nesta ordem): [0..5] fase 1, [6..18] diretos na fase 2, [19..46] diretos nos grupos (o campeão da
 * Libertadores anterior, se houver, é o [19]). Sul-Americana (44 sementes): [0..31] primeira fase (4 por país, agrupados por país),
 * [32..43] diretos nos grupos (Argentina 6, Brasil 6); mais 12 de fora: os 4 perdedores da fase 3 da Libertadores (`lib-f3`) e os 8
 * terceiros dos grupos da Libertadores na ordem de desempenho (`lib-g3`, numerados 17–24).
 */
import type { FormatDef, KnockoutStage, Ref } from '../format-engine/engine.ts';

export const LIB_ID = 'conmebol-lib';
export const SUD_ID = 'conmebol-sud';
export const RECOPA_ID = 'conmebol-rec';
export const CONMEBOL_FORMAT_IDS: readonly string[] = [LIB_ID, SUD_ID, RECOPA_ID];

export const LIB_SIZE = 47;
export const SUD_SIZE = 44;
/** Limites das sementes da Libertadores e da Sul-Americana (ver o cabeçalho). */
export const LIB_SEEDS = { f1: [0, 6], f2: [6, 19], groups: [19, 47] } as const;
export const SUD_SEEDS = { p1: [0, 32], groups: [32, 44] } as const;

/** Desempate dos grupos (LIB p. 53–54; SUD p. 47–48): pontos; confronto direto; saldo; gols pró; menos vermelhos e amarelos; sorteio. */
const TB: FormatDef['tiebreakers'] = ['points', 'headToHead', 'goalDiff', 'goalsFor', 'fairPlay'];
const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);
const W = (stage: string, i: number): Ref => ({ stage, winner: i });
const seeds = (a: number, b: number): Ref[] => range(a, b).map((seed) => ({ seed }));
const nth = (stage: string, pos: number): Ref[] => range(1, 9).map((nthBest) => ({ stage, pos, nthBest }));
const ext = (external: string, idx: number[]): Ref[] => idx.map((i) => ({ external, idx: i }));
/** mata-mata de ida e volta sem prorrogação: saldo no agregado e pênaltis direto (LIB p. 54; SUD p. 48) */
const ko2 = (id: string, name: string, entrants: Ref[], o: Partial<KnockoutStage> = {}): KnockoutStage =>
  ({ kind: 'knockout', id, name, entrants, pairing: 'fixed', legs: 2, host: 'first', ...o });
/** quartas (A×H, B×G, C×F, D×E), semis (S1×S4, S2×S3) e final única em sede neutra, com prorrogação e pênaltis (LIB p. 49–50) */
const finalPhase = (): KnockoutStage[] => [
  ko2('qf', 'Quartas de final', [0, 7, 1, 6, 2, 5, 3, 4].map((i) => W('r16', i)), { host: 'numbered' }),
  ko2('sf', 'Semifinais', [0, 3, 1, 2].map((i) => W('qf', i)), { host: 'numbered' }),
  { kind: 'knockout', id: 'final', name: 'Final', entrants: [W('sf', 0), W('sf', 1)], pairing: 'fixed', legs: 1, host: 'neutral', extraTime: true },
];

/** CONMEBOL Libertadores (LIB p. 38–50). */
export function libertadores(): FormatDef {
  return {
    id: LIB_ID, name: 'CONMEBOL Libertadores', regulation: 'Manual de Clubes CONMEBOL Libertadores 2026, cap. 2',
    source: { structure: 'REG', tiebreak: 'REG', national: 'ADAPT' }, size: LIB_SIZE, tiebreakers: TB, conmebolTables: true,
    stages: [
      ko2('f1', 'Fase 1', seeds(...LIB_SEEDS.f1), { pairing: 'preset' }),
      ko2('f2', 'Fase 2', [...seeds(...LIB_SEEDS.f2), W('f1', 0), W('f1', 1), W('f1', 2)], { pairing: 'preset' }),
      // C1×C8, C2×C7, C3×C6, C4×C5; o de pior ranking manda a ida
      ko2('f3', 'Fase 3', [0, 7, 1, 6, 2, 5, 3, 4].map((i) => W('f2', i)), { host: 'favorite' }),
      { kind: 'league', id: 'g', name: 'Fase de grupos', entrants: [...seeds(...LIB_SEEDS.groups), W('f3', 0), W('f3', 1), W('f3', 2), W('f3', 3)],
        groups: 8, assign: 'preset', play: 'within', legs: 2, schedule: 'conmebol' },
      // sorteio: cada 2º (pote 2, manda a ida) recebe um 1º; o par vem como [1º, 2º]
      ko2('r16', 'Oitavas de final', [...nth('g', 1), ...nth('g', 2)], { pairing: 'preset' }),
      ...finalPhase(),
    ],
    champion: W('final', 0),
    numbering: [...nth('g', 1), ...nth('g', 2)],
  };
}

/** Os 4 perdedores da fase 3 e os 8 terceiros dos grupos da Libertadores, que vão para a Sul-Americana (referências no formato da Libertadores). */
export const LIB_TO_SUD: Record<'lib-f3' | 'lib-g3', Ref[]> = {
  'lib-f3': range(0, 4).map((loser) => ({ stage: 'f3', loser })),
  'lib-g3': nth('g', 3),
};

/** CONMEBOL Sul-Americana (SUD p. 38–48). */
export function sulAmericana(): FormatDef {
  return {
    id: SUD_ID, name: 'CONMEBOL Sudamericana', regulation: 'Manual de Clubes CONMEBOL Sudamericana 2026, cap. 2',
    source: { structure: 'REG', tiebreak: 'REG', national: 'ADAPT' }, size: SUD_SIZE, tiebreakers: TB, conmebolTables: true,
    stages: [
      // jogo único entre clubes do mesmo país; empate → pênaltis (SUD p. 47)
      { kind: 'knockout', id: 'p1', name: 'Primeira fase', entrants: seeds(...SUD_SEEDS.p1), pairing: 'preset', legs: 1, host: 'first' },
      { kind: 'league', id: 'g', name: 'Fase de grupos', entrants: [...seeds(...SUD_SEEDS.groups), ...ext('lib-f3', [0, 1, 2, 3]), ...range(0, 16).map((i) => W('p1', i))],
        groups: 8, assign: 'preset', play: 'within', legs: 2, schedule: 'conmebol' },
      // 9×24, 10×23 … 16×17: o 2º da Sul-Americana decide em casa, o 3º da Libertadores manda a ida
      ko2('po', 'Playoffs de oitavas', range(0, 8).flatMap((i) => [{ stage: 'g', pos: 2, nthBest: i + 1 } as Ref, { external: 'lib-g3', idx: 7 - i }])),
      ko2('r16', 'Oitavas de final', [...nth('g', 1), ...range(0, 8).map((i) => W('po', i))], { pairing: 'preset' }),
      ...finalPhase(),
    ],
    champion: W('final', 0),
    numbering: [...nth('g', 1), ...nth('g', 2), ...ext('lib-g3', range(0, 8))],
  };
}

/**
 * CONMEBOL Recopa (LIB p. 48; SUD p. 46): campeão da Libertadores × campeão da Sul-Americana, ida e volta, o da Libertadores manda a volta.
 * Desempate: o manual não traz; na Recopa 2026 (Lanús × Flamengo) o agregado empatado foi à prorrogação — [SEC]: agregado, prorrogação e pênaltis.
 */
export function recopa(): FormatDef {
  return {
    id: RECOPA_ID, name: 'CONMEBOL Recopa', regulation: 'Manuais de Clubes CONMEBOL 2026, item 2.3',
    source: { structure: 'REG', tiebreak: 'SEC', national: 'REG' }, size: 2, tiebreakers: ['points', 'goalDiff', 'goalsFor'],
    stages: [ko2('f', 'Final', [{ seed: 0 }, { seed: 1 }], { extraTime: true })],
    champion: W('f', 0),
  };
}

export function conmebolFormat(id: string, size: number): FormatDef | null {
  const f = id === LIB_ID ? libertadores() : id === SUD_ID ? sulAmericana() : id === RECOPA_ID ? recopa() : null;
  return f && f.size === size ? f : null;
}
