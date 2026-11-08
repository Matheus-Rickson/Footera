/**
 * Formatos reais (2026) das Séries C e D e dos estaduais, montados com o motor de formatos. Fontes e adaptações em docs/ESTADUAIS.md:
 * `source` diz se cada parte vem do regulamento oficial (REG), de fonte secundária (SEC) ou foi adaptada por falta de fonte (ADAPT).
 */
import type { FormatDef, KnockoutStage, LeagueStage, Ref, Stage, Tiebreaker } from './engine.ts';

const TB: Tiebreaker[] = ['points', 'wins', 'goalDiff', 'goalsFor', 'headToHead'];
const seeds = (n: number): Ref[] => Array.from({ length: n }, (_, i) => ({ seed: i }));
const pos = (stage: string, p: number): Ref => ({ stage, pos: p });
const top = (stage: string, n: number): Ref[] => Array.from({ length: n }, (_, i) => pos(stage, i + 1));
const gp = (stage: string, group: number, p: number): Ref => ({ stage, group, pos: p });
const W = (stage: string, i: number): Ref => ({ stage, winner: i });
const L = (stage: string, i: number): Ref => ({ stage, loser: i });
const Ws = (stage: string, idx: readonly number[]) => idx.map((i) => W(stage, i));
const A = 0, B = 1;

const league = (id: string, name: string, entrants: Ref[], o: Partial<LeagueStage> = {}): LeagueStage =>
  ({ kind: 'league', id, name, entrants, groups: 1, assign: 'order', play: 'within', legs: 1, ...o });
const ko = (id: string, name: string, entrants: Ref[], o: Partial<KnockoutStage> = {}): KnockoutStage =>
  ({ kind: 'knockout', id, name, entrants, pairing: 'fixed', legs: 2, host: 'campaign', ...o });
const final2 = (from: string) => ko('final', 'Final', [W(from, 0), W(from, 1)]);
const SEC = { structure: 'SEC', tiebreak: 'ADAPT', national: 'ADAPT' } as const;
const ADAPT = { structure: 'ADAPT', tiebreak: 'ADAPT', national: 'ADAPT' } as const;

/** Cruzamento das quartas com 2 grupos: 1º de um × 4º do outro, 2º × 3º. */
const crossQF = (s: string): Ref[] => [gp(s, A, 1), gp(s, B, 4), gp(s, A, 2), gp(s, B, 3), gp(s, B, 1), gp(s, A, 4), gp(s, B, 2), gp(s, A, 3)];

/**
 * Formato padrão (ADAPT) dos estaduais sem regulamento encontrado: turno único; 4 primeiros → semifinal (1×4, 2×3) e final em ida e
 * volta, volta na casa da melhor campanha, pênaltis; os `down` últimos caem.
 */
export function standardEstadual(id: string, name: string, size: number, down: number, source: FormatDef['source'] = ADAPT): FormatDef {
  return {
    id, name, regulation: 'Formato padrão adaptado (sem regulamento 2026 encontrado)', source, size, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(size)),
      ko('sf', 'Semifinal', top('f1', 4), { pairing: 'seeded', host: 'first' }),
      final2('sf'),
    ],
    champion: W('final', 0),
    relegated: Array.from({ length: down }, (_, i) => pos('f1', -1 - i)),
  };
}

// ---------------------------------------------------------------- Séries nacionais

/** Série C: 20 clubes em 2026, 24 em 2027, 28 (2 grupos de 14) de 2028 em diante (REC 2026; expansão: fontes secundárias). */
export function serieC(season: number): FormatDef {
  if (season >= 2028) {
    return {
      id: 'bra-serie-c', name: 'Série C', regulation: 'CBF — expansão anunciada (28 clubes em 2 grupos de 14); fases finais adaptadas',
      source: { structure: 'SEC', tiebreak: 'REG', national: 'SEC' }, size: 28, tiebreakers: ['points', 'wins', 'goalDiff', 'goalsFor'],
      stages: [
        league('f1', '1ª fase', seeds(28), { groups: 2, assign: 'snake', legs: 2 }),
        ko('qf', 'Quartas de final', crossQF('f1'), { host: 'first' }),
        ko('sf', 'Semifinal', Ws('qf', [0, 1, 2, 3])),
        final2('sf'),
      ],
      champion: W('final', 0),
      promoted: Ws('qf', [0, 1, 2, 3]),
      relegated: [gp('f1', A, -1), gp('f1', A, -2), gp('f1', A, -3), gp('f1', B, -1), gp('f1', B, -2), gp('f1', B, -3)],
    };
  }
  const n = season >= 2027 ? 24 : 20;
  return {
    id: 'bra-serie-c', name: 'Série C', regulation: n === 20 ? 'CBF — REC Brasileiro Série C 2026' : 'CBF — Série C 2027 (24 clubes; fases como em 2026)',
    source: { structure: n === 20 ? 'REG' : 'SEC', tiebreak: 'REG', national: 'REG' }, size: n, tiebreakers: ['points', 'wins', 'goalDiff', 'goalsFor'],
    stages: [
      league('f1', '1ª fase', seeds(n)),
      // Anexo B: grupo B = 1º, 4º, 5º, 8º; grupo C = 2º, 3º, 6º, 7º; ida e volta
      league('f2', '2ª fase', [1, 4, 5, 8, 2, 3, 6, 7].map((p) => pos('f1', p)), { groups: 2, legs: 2 }),
      ko('final', 'Final', [gp('f2', A, 1), gp('f2', B, 1)]),
    ],
    champion: W('final', 0),
    promoted: [gp('f2', A, 1), gp('f2', A, 2), gp('f2', B, 1), gp('f2', B, 2)],
    relegated: [pos('f1', -1), pos('f1', -2)],
  };
}

/** Pares de confrontos em blocos de 8 (Anexo B da Série D: 01×06, 02×05, 03×08, 04×07 em cada bloco). */
function blocks(stage: string, ties: number): Ref[] {
  const out: Ref[] = [];
  for (let b = 0; b < ties; b += 8) for (const [x, y] of [[0, 5], [1, 4], [2, 7], [3, 6]] as const) out.push(W(stage, b + x), W(stage, b + y));
  return out;
}

/** Série D 2026 (REC): 96 clubes em 16 grupos (montados de fora: geográfico, até 3 do mesmo estado), mata-mata e playoffs; 6 acessos. */
export function serieD(): FormatDef {
  const f2: Ref[] = [];
  for (let k = 0; k < 8; k++) {
    const g = 2 * k, h = 2 * k + 1;
    f2.push(gp('f1', g, 1), gp('f1', h, 4), gp('f1', h, 2), gp('f1', g, 3), gp('f1', h, 1), gp('f1', g, 4), gp('f1', g, 2), gp('f1', h, 3));
  }
  return {
    id: 'bra-serie-d', name: 'Série D', regulation: 'CBF — REC Brasileiro Série D 2026', source: { structure: 'REG', tiebreak: 'REG', national: 'REG' },
    size: 96, tiebreakers: ['points', 'wins', 'goalDiff', 'goalsFor', 'headToHead'],
    stages: [
      league('f1', '1ª fase', seeds(96), { groups: 16, assign: 'preset', legs: 2 }),
      ko('f2', '2ª fase', f2, { host: 'first' }),
      ko('f3', '3ª fase', blocks('f2', 32)),
      ko('f4', 'Oitavas de final', blocks('f3', 16)),
      ko('f5', 'Quartas de final', Ws('f4', [0, 1, 2, 3, 4, 5, 6, 7]), { byCampaign: true, permute: [0, 7, 3, 4, 1, 6, 2, 5] }),
      ko('sf', 'Semifinal', Ws('f5', [0, 1, 2, 3])),
      ko('po', 'Playoffs de acesso', [L('f5', 0), L('f5', 1), L('f5', 2), L('f5', 3)], { byCampaign: true, permute: [0, 3, 1, 2], side: true }),
      final2('sf'),
    ],
    champion: W('final', 0),
    promoted: [...Ws('f5', [0, 1, 2, 3]), W('po', 0), W('po', 1)],
  };
}

/** Vagas de cada estado na Série D pelo estadual (REC Série D 2026, Anexo A / critério 2). */
export const SERIE_D_SPOTS: Readonly<Record<string, number>> = {
  SP: 4, BA: 3, CE: 3, GO: 3, MG: 3, PR: 3, RJ: 3, RS: 3, SC: 3,
  AC: 2, AL: 2, AM: 2, AP: 2, DF: 2, ES: 2, MA: 2, MS: 2, MT: 2, PA: 2, PB: 2, PE: 2, PI: 2, RN: 2, RO: 2, RR: 2, SE: 2, TO: 2,
};

// ---------------------------------------------------------------- Estaduais

function paulista(): FormatDef {
  return {
    id: 'sp-a1', name: 'Campeonato Paulista', regulation: 'FPF — Paulistão 2026 (Wikipédia pt)', source: SEC, size: 16, tiebreakers: TB,
    stages: [
      // 4 potes de 4 (pela ordem de força): 3 jogos no pote + 5 contra outros potes, tabela única
      league('f1', 'Primeira fase', seeds(16), { groups: 4, play: 'pots', crossGames: 5 }),
      ko('qf', 'Quartas de final', top('f1', 8), { pairing: 'seeded', legs: 1, host: 'first' }),
      ko('sf', 'Semifinal', Ws('qf', [0, 3, 1, 2]), { legs: 1 }),
      final2('sf'),
    ],
    champion: W('final', 0),
    relegated: [pos('f1', -1), pos('f1', -2)],
  };
}
function paulistaA2(): FormatDef {
  return {
    id: 'sp-a2', name: 'Paulista Série A2', regulation: 'FPF — Série A2 2026 (Wikipédia pt; mata-mata adaptado)', source: SEC, size: 16, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(16)),
      ko('qf', 'Quartas de final', top('f1', 8), { pairing: 'seeded', host: 'first' }),
      ko('sf', 'Semifinal', Ws('qf', [0, 3, 1, 2])),
      final2('sf'),
    ],
    champion: W('final', 0),
    promoted: [W('sf', 0), W('sf', 1)],
    relegated: [pos('f1', -1), pos('f1', -2)],
  };
}
function carioca(): FormatDef {
  const g = (grp: number, p: number) => gp('f1', grp, p);
  return {
    id: 'rj-a1', name: 'Campeonato Carioca', regulation: 'FERJ — Cariocão 2026 (Wikipédia pt)', source: SEC, size: 12, tiebreakers: TB,
    stages: [
      // Taça Guanabara: 2 grupos de 6; cada clube enfrenta os 6 do outro grupo
      league('f1', 'Taça Guanabara', seeds(12), { groups: 2, assign: 'snake', play: 'cross' }),
      ko('qf', 'Quartas de final', [g(A, 1), g(A, 4), g(A, 2), g(A, 3), g(B, 1), g(B, 4), g(B, 2), g(B, 3)], { legs: 1, host: 'first' }),
      ko('sf', 'Semifinal', Ws('qf', [0, 1, 2, 3]), { pairing: 'draw' }),
      ko('final', 'Final', [W('sf', 0), W('sf', 1)], { legs: 1, host: 'neutral' }),
      ko('tr', 'Taça Rio — semifinal', [L('qf', 0), L('qf', 1), L('qf', 2), L('qf', 3)], { pairing: 'draw', side: true }),
      ko('trf', 'Taça Rio — final', [W('tr', 0), W('tr', 1)], { legs: 1, host: 'neutral', side: true }),
      league('x', 'Grupo X', [g(A, 5), g(A, 6), g(B, 5), g(B, 6)], { legs: 2, side: true }),
    ],
    champion: W('final', 0),
    titles: [{ name: 'Taça Guanabara', ref: pos('f1', 1) }, { name: 'Taça Rio', ref: W('trf', 0) }],
    relegated: [pos('x', -1)],
  };
}
function mineiro(): FormatDef {
  return {
    id: 'mg', name: 'Campeonato Mineiro', regulation: 'FMF — Mineiro 2026 (Goal, Itatiaia)', source: SEC, size: 12, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(12), { groups: 3, assign: 'snake', play: 'cross' }),
      ko('sf', 'Semifinal', [gp('f1', 0, 1), gp('f1', 1, 1), gp('f1', 2, 1), { stage: 'f1', pos: 2, nthBest: 1 }], { byCampaign: true, pairing: 'seeded' }),
      ko('final', 'Final', [W('sf', 0), W('sf', 1)], { legs: 1 }),
    ],
    champion: W('final', 0),
    relegated: [{ stage: 'f1', pos: -1, nthWorst: 1 }, { stage: 'f1', pos: -1, nthWorst: 2 }],
  };
}
function crossGroups(id: string, name: string, regulation: string, source: FormatDef['source'], qfLegs: 1 | 2, extra: Pick<FormatDef, 'relegated'> & { side?: FormatDef['stages'] }): FormatDef {
  return {
    id, name, regulation, source, size: 12, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(12), { groups: 2, assign: 'snake', play: 'cross' }),
      ko('qf', 'Quartas de final', crossQF('f1'), { legs: qfLegs, host: 'first' }),
      ko('sf', 'Semifinal', Ws('qf', [0, 1, 2, 3])),
      final2('sf'),
      ...(extra.side ?? []),
    ],
    champion: W('final', 0),
    relegated: extra.relegated,
  };
}
const bottomQuad = (legs: 1 | 2 = 2, bonus?: LeagueStage['bonus']) => league('rb', 'Quadrangular do rebaixamento', [gp('f1', A, 5), gp('f1', B, 5), gp('f1', A, 6), gp('f1', B, 6)], { legs, side: true, ...(bonus ? { bonus } : {}) });
function paranaense(): FormatDef {
  const g = (grp: number, p: number) => gp('f1', grp, p);
  return {
    id: 'pr', name: 'Campeonato Paranaense', regulation: 'FPF-PR — Paranaense 2026 (Wikipédia pt)', source: SEC, size: 12, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(12), { groups: 2, assign: 'snake', play: 'cross' }),
      // quartas e semis dentro do próprio grupo
      ko('qf', 'Quartas de final', [g(A, 1), g(A, 4), g(A, 2), g(A, 3), g(B, 1), g(B, 4), g(B, 2), g(B, 3)], { host: 'first' }),
      ko('sf', 'Semifinal', Ws('qf', [0, 1, 2, 3])),
      final2('sf'),
      ko('rel', 'Playoff do rebaixamento', [g(A, 5), g(B, 6), g(B, 5), g(A, 6)], { host: 'first', side: true }),
    ],
    champion: W('final', 0),
    relegated: [L('rel', 0), L('rel', 1)],
  };
}
function goiano(): FormatDef {
  return {
    id: 'go', name: 'Campeonato Goiano', regulation: 'FGF-GO — Goianão 2026 (Wikipédia pt; sem o playoff opcional de permanência)', source: SEC, size: 12, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(12), { groups: 3, assign: 'snake', play: 'cross' }),
      ko('qf', 'Quartas de final', top('f1', 8), { pairing: 'seeded', host: 'first' }),
      ko('sf', 'Semifinal', Ws('qf', [0, 3, 1, 2])),
      final2('sf'),
    ],
    champion: W('final', 0),
    relegated: [pos('f1', -1), pos('f1', -2)],
  };
}
function capixaba(): FormatDef {
  return {
    id: 'es', name: 'Campeonato Capixaba', regulation: 'FES — Capixabão 2026 (Agência Brasil, Serra Notícias)', source: SEC, size: 10, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(10)),
      ko('qf', 'Quartas de final', top('f1', 8), { pairing: 'seeded', host: 'first' }),
      ko('sf', 'Semifinal', Ws('qf', [0, 3, 1, 2])),
      final2('sf'),
    ],
    champion: W('final', 0),
    relegated: [pos('f1', -1), pos('f1', -2)],
  };
}
function baiano(): FormatDef {
  return {
    id: 'ba', name: 'Campeonato Baiano', regulation: 'FBF — Baianão 2026 (Wikipédia pt)', source: SEC, size: 10, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(10)),
      ko('sf', 'Semifinal', top('f1', 4), { pairing: 'seeded', legs: 1, host: 'first' }),
      ko('final', 'Final', [W('sf', 0), W('sf', 1)], { legs: 1 }),
    ],
    champion: W('final', 0),
    relegated: [pos('f1', -1), pos('f1', -2)],
  };
}
function pernambucano(): FormatDef {
  return {
    id: 'pe', name: 'Campeonato Pernambucano', regulation: 'FPF-PE — Pernambucano 2026 (Wikipédia pt; rebaixamento adaptado)', source: SEC, size: 8, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(8)),
      ko('p2', 'Segunda fase', [pos('f1', 3), pos('f1', 6), pos('f1', 4), pos('f1', 5)], { host: 'first' }),
      ko('sf', 'Semifinal', [pos('f1', 1), W('p2', 1), pos('f1', 2), W('p2', 0)], { host: 'first' }),
      final2('sf'),
    ],
    champion: W('final', 0),
    relegated: [pos('f1', -1)],
  };
}
function cearense(): FormatDef {
  const g = (grp: number, p: number) => gp('f1', grp, p);
  return {
    id: 'ce', name: 'Campeonato Cearense', regulation: 'FCF — Cearense 2026 (Wikipédia pt; triangulares e permanência adaptados)', source: SEC, size: 10, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(10), { groups: 2, assign: 'snake' }),
      league('f2', 'Segunda fase', [g(A, 1), g(B, 2), g(A, 3), g(B, 1), g(A, 2), g(B, 3)], { groups: 2 }),
      ko('sf', 'Semifinal', [gp('f2', A, 1), gp('f2', B, 2), gp('f2', B, 1), gp('f2', A, 2)], { host: 'first' }),
      final2('sf'),
      league('perm', 'Quadrangular da permanência', [g(A, 4), g(B, 4), g(A, 5), g(B, 5)], { legs: 2, side: true }),
    ],
    champion: W('final', 0),
    relegated: [pos('perm', -1), pos('perm', -2)],
  };
}
function sergipano(): FormatDef {
  return {
    id: 'se', name: 'Campeonato Sergipano', regulation: 'FSF — Sergipano 2026 (Wikipédia pt)', source: SEC, size: 10, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(10)),
      ko('p2', 'Segunda fase', [pos('f1', 2), pos('f1', 7), pos('f1', 3), pos('f1', 6), pos('f1', 4), pos('f1', 5)], { legs: 1, host: 'first' }),
      ko('sf', 'Semifinal', [pos('f1', 1), W('p2', 0), W('p2', 1), W('p2', 2)], { byCampaign: true, pairing: 'seeded', host: 'first' }),
      final2('sf'),
    ],
    champion: W('final', 0),
    relegated: [pos('f1', -1), pos('f1', -2)],
  };
}
function maranhense(): FormatDef {
  return {
    id: 'ma', name: 'Campeonato Maranhense', regulation: 'FMF-MA — Maranhense 2026 (O Imparcial)', source: SEC, size: 8, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(8)),
      ko('sf', 'Semifinal', top('f1', 4), { pairing: 'seeded', host: 'first' }),
      final2('sf'),
      ko('rel', 'Playoff do rebaixamento', [pos('f1', 6), pos('f1', 7)], { host: 'first', side: true }),
    ],
    champion: W('final', 0),
    relegated: [pos('f1', -1), L('rel', 0)],
  };
}
function roraimense(): FormatDef {
  return {
    id: 'rr', name: 'Campeonato Roraimense', regulation: 'FRF — Roraimense 2026 (Wikipédia pt)', source: SEC, size: 9, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(9)),
      ko('sf', 'Semifinal', top('f1', 4), { pairing: 'seeded', legs: 1, host: 'first' }),
      ko('final', 'Final', [W('sf', 0), W('sf', 1)], { legs: 1 }),
    ],
    champion: W('final', 0),
    relegated: [pos('f1', -1)],
  };
}

export interface EstadualDef {
  /** id da competição (estável) */ id: string;
  /** sigla do estado */ uf: string;
  /** 1 = primeira divisão; 2 = segunda (SP e RJ) */ division: 1 | 2;
  name: string;
  /** formato da temporada (alguns estaduais mudam de tamanho de um ano para o outro) */
  format: (season: number) => FormatDef;
}

const fixed = (f: FormatDef) => () => f;
const std = (id: string, uf: string, name: string, size: number, down: number, source?: FormatDef['source']): EstadualDef =>
  ({ id, uf, division: 1, name, format: fixed(standardEstadual(id, name, size, down, source)) });

/** Os 27 estaduais (primeira divisão) e as segundas divisões de SP e RJ. */
export const ESTADUAIS: readonly EstadualDef[] = [
  { id: 'sp-a1', uf: 'SP', division: 1, name: 'Campeonato Paulista', format: fixed(paulista()) },
  { id: 'sp-a2', uf: 'SP', division: 2, name: 'Paulista Série A2', format: fixed(paulistaA2()) },
  { id: 'rj-a1', uf: 'RJ', division: 1, name: 'Campeonato Carioca', format: fixed(carioca()) },
  { id: 'rj-a2', uf: 'RJ', division: 2, name: 'Carioca Série A2', format: fixed({ ...standardEstadual('rj-a2', 'Carioca Série A2', 12, 2, SEC), regulation: 'FERJ — Série A2 2026 (Wikipédia pt; mata-mata adaptado)', promoted: [W('final', 0)] }) },
  { id: 'mg', uf: 'MG', division: 1, name: 'Campeonato Mineiro', format: fixed(mineiro()) },
  { id: 'rs', uf: 'RS', division: 1, name: 'Campeonato Gaúcho', format: fixed(crossGroups('rs', 'Campeonato Gaúcho', 'FGF — Gauchão 2026 (Goal, Lance; mata-mata adaptado)', SEC, 1, { relegated: [pos('rb', -1), pos('rb', -2)], side: [bottomQuad()] })) },
  { id: 'pr', uf: 'PR', division: 1, name: 'Campeonato Paranaense', format: fixed(paranaense()) },
  {
    id: 'sc', uf: 'SC', division: 1, name: 'Campeonato Catarinense',
    // 2026: 12 clubes, 3 rebaixados (10 em 2027); de 2027 em diante, formato adaptado com 10 clubes
    format: (season) => (season <= 2026
      ? crossGroups('sc', 'Campeonato Catarinense', 'FCF — Catarinense 2026 (NSC Total, Wikipédia)', SEC, 2,
        { relegated: [pos('rb', -1), pos('rb', -2), pos('rb', -3)], side: [bottomQuad(2, [{ ref: { stage: 'f1', pos: 5, nthBest: 1 }, points: 1 }])] })
      : standardEstadual('sc', 'Campeonato Catarinense', 10, 1)),
  },
  { id: 'go', uf: 'GO', division: 1, name: 'Campeonato Goiano', format: fixed(goiano()) },
  std('df', 'DF', 'Campeonato Brasiliense', 10, 2),
  { id: 'es', uf: 'ES', division: 1, name: 'Campeonato Capixaba', format: fixed(capixaba()) },
  std('mt', 'MT', 'Campeonato Mato-Grossense', 10, 2),
  std('ms', 'MS', 'Campeonato Sul-Mato-Grossense', 10, 2),
  { id: 'ba', uf: 'BA', division: 1, name: 'Campeonato Baiano', format: fixed(baiano()) },
  { id: 'pe', uf: 'PE', division: 1, name: 'Campeonato Pernambucano', format: fixed(pernambucano()) },
  { id: 'ce', uf: 'CE', division: 1, name: 'Campeonato Cearense', format: fixed(cearense()) },
  std('pb', 'PB', 'Campeonato Paraibano', 10, 2, SEC),
  std('rn', 'RN', 'Campeonato Potiguar', 8, 2),
  std('al', 'AL', 'Campeonato Alagoano', 8, 1, { structure: 'REG', tiebreak: 'ADAPT', national: 'ADAPT' }),
  { id: 'se', uf: 'SE', division: 1, name: 'Campeonato Sergipano', format: fixed(sergipano()) },
  { id: 'ma', uf: 'MA', division: 1, name: 'Campeonato Maranhense', format: fixed(maranhense()) },
  std('pi', 'PI', 'Campeonato Piauiense', 8, 1),
  { id: 'pa', uf: 'PA', division: 1, name: 'Campeonato Paraense', format: fixed(crossGroups('pa', 'Campeonato Paraense', 'FPF-PA — Parazão 2026 (O Liberal; mata-mata adaptado)', SEC, 2, { relegated: [pos('f1', -1), pos('f1', -2)] })) },
  std('am', 'AM', 'Campeonato Amazonense', 8, 1, SEC),
  { id: 'rr', uf: 'RR', division: 1, name: 'Campeonato Roraimense', format: fixed(roraimense()) },
  std('ap', 'AP', 'Campeonato Amapaense', 8, 1),
  std('ac', 'AC', 'Campeonato Acreano', 8, 2),
  std('ro', 'RO', 'Campeonato Rondoniense', 7, 1),
  std('to', 'TO', 'Campeonato Tocantinense', 8, 1),
];

// ---------------------------------------------------------------- formatos das divisões nacionais

/** Formato de uma divisão nacional pelo id da liga e o número de clubes (null = pontos corridos, como as demais). */
export function leagueFormat(leagueId: string, clubs: number): FormatDef | null {
  if (leagueId === 'bra-3') return clubs === 20 ? serieC(2026) : clubs === 24 ? serieC(2027) : clubs === 28 ? serieC(2028) : null;
  if (leagueId === 'bra-4') return clubs === 96 ? serieD() : null;
  return null;
}
/** Formato pelo id gravado na competição (o tamanho escolhe a versão da Série C). */
export function formatById(id: string, clubs: number, season = 2026): FormatDef | null {
  if (id === 'bra-serie-c') return leagueFormat('bra-3', clubs);
  if (id === 'bra-serie-d') return leagueFormat('bra-4', clubs);
  if (id === COPA_RUSSIA_ID) return copaDaRussia(clubs);
  const reg = REGIONAIS.find((r) => r.id === id);
  if (id.startsWith('cest_')) return clubs >= COPA_ESTADUAL_SIZE.min && clubs <= COPA_ESTADUAL_SIZE.max && clubs % 2 === 0 ? copaEstadual(id.slice(5).toUpperCase(), clubs) : clubs >= COPA_ESTADUAL_SIZE.min && clubs <= 8 ? copaEstadual(id.slice(5).toUpperCase(), clubs) : null;
  const f = reg ? reg.format() : ESTADUAIS.find((e) => e.id === id)?.format(season) ?? null;
  return f && f.size === clubs ? f : null;
}

/** Ordem geográfica dos estados (norte → sul), para formar grupos regionais. */
export const UF_GEO_ORDER = ['AC', 'RO', 'AM', 'RR', 'AP', 'PA', 'TO', 'MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL', 'SE', 'BA', 'DF', 'GO', 'MT', 'MS', 'MG', 'ES', 'RJ', 'SP', 'PR', 'SC', 'RS'];

/**
 * Grupos regionais (Série D: 16 grupos de 6, no máximo 3 clubes do mesmo estado — REC art. 14): os clubes em ordem geográfica formam
 * blocos consecutivos; quando um grupo passa do limite de um estado, um desses clubes troca de lugar com um clube de outro estado do
 * grupo mais próximo em que a troca respeita o limite dos dois lados.
 */
export function regionalGroups(clubs: ReadonlyArray<{ id: string; state: string | null }>, groups: number, maxSameState = 3): string[][] {
  const size = clubs.length / groups;
  if (!Number.isInteger(size)) throw new Error(`${clubs.length} clubes não se dividem em ${groups} grupos.`);
  const geo = (uf: string | null) => (uf ? UF_GEO_ORDER.indexOf(uf) : 99);
  const order = [...clubs].sort((a, b) => geo(a.state) - geo(b.state) || a.id.localeCompare(b.id));
  const out = Array.from({ length: groups }, (_, g) => order.slice(g * size, (g + 1) * size));
  const count = (g: number, uf: string | null) => (uf ? out[g]!.filter((c) => c.state === uf).length : 0);
  for (let guard = 0; guard < 10_000; guard++) {
    const gi = out.findIndex((_, g) => out[g]!.some((c) => count(g, c.state) > maxSameState));
    if (gi < 0) break;
    const x = out[gi]!.find((c) => count(gi, c.state) > maxSameState)!;
    let swapped = false;
    for (let d = 1; d < groups && !swapped; d++) {
      for (const gj of [gi + d, gi - d]) {
        if (gj < 0 || gj >= groups) continue;
        const y = out[gj]!.find((c) => c.state !== x.state && count(gj, x.state) < maxSameState && count(gi, c.state) < maxSameState);
        if (!y) continue;
        out[gi]![out[gi]!.indexOf(x)] = y; out[gj]![out[gj]!.indexOf(y)] = x;
        swapped = true; break;
      }
    }
    if (!swapped) break; // impossível respeitar o limite (estado com clubes demais): fica como está
  }
  return out.map((x) => x.map((c) => c.id));
}

/** Vagas de cada federação na Copa do Brasil pelos estaduais (102; RNF 2026, Lance 22/12/2025). */
export const COPA_DO_BRASIL_SPOTS: Readonly<Record<string, number>> = {
  SP: 6, RJ: 6, MG: 5, RS: 5, PR: 5, SC: 4, BA: 4, PA: 4, CE: 4, PE: 4, AL: 4, MT: 4, AM: 4, GO: 4,
  SE: 3, RN: 3, MA: 3, PB: 3, DF: 3, PI: 3, ES: 3, AC: 3, MS: 3, RR: 3, RO: 3, AP: 3, TO: 3,
};

// ---------------------------------------------------------------- copas regionais (docs/COPAS_REGIONAIS.md)

/** Copa do Nordeste 2026 (SEC): 4 grupos de 5, A × B e C × D em turno único; quartas em jogo único; semifinais e final em ida e volta. */
export function copaNordeste(): FormatDef {
  return {
    id: 'reg_ne', name: 'Copa do Nordeste', regulation: 'CBF — Copa do Nordeste 2026 (TNH1, Band)', source: { structure: 'SEC', tiebreak: 'ADAPT', national: 'SEC' }, size: 20, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(20), { groups: 4, assign: 'snake', play: 'cross', crossPairs: true }),
      ko('qf', 'Quartas de final', [gp('f1', 0, 1), gp('f1', 2, 2), gp('f1', 1, 1), gp('f1', 3, 2), gp('f1', 2, 1), gp('f1', 0, 2), gp('f1', 3, 1), gp('f1', 1, 2)], { legs: 1, host: 'first' }),
      ko('sf', 'Semifinal', Ws('qf', [0, 1, 2, 3])),
      final2('sf'),
    ],
    champion: W('final', 0),
  };
}
/**
 * Copa Verde 2026 (REC): os 12 primeiros participantes são da Copa Norte (grupos A e B), os 12 seguintes da Copa Centro-Oeste (C e D);
 * turno único dentro do grupo; quartas em jogo único (mando do 1º); final de cada bloco em ida e volta; final da Copa Verde entre os
 * campeões dos blocos, em ida e volta.
 */
export function copaVerde(): FormatDef {
  return {
    id: 'reg_cv', name: 'Copa Verde', regulation: 'CBF — REC Copa Verde 2026 (Copa Norte e Copa Centro-Oeste)', source: { structure: 'REG', tiebreak: 'ADAPT', national: 'REG' }, size: 24, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(24), { groups: 4 }),
      ko('qf', 'Quartas de final', [gp('f1', 0, 1), gp('f1', 1, 2), gp('f1', 1, 1), gp('f1', 0, 2), gp('f1', 2, 1), gp('f1', 3, 2), gp('f1', 3, 1), gp('f1', 2, 2)], { legs: 1, host: 'first' }),
      ko('fn', 'Final da Copa Norte', [W('qf', 0), W('qf', 1)]),
      ko('fco', 'Final da Copa Centro-Oeste', [W('qf', 2), W('qf', 3)]),
      ko('final', 'Final da Copa Verde', [W('fn', 0), W('fco', 0)]),
    ],
    champion: W('final', 0),
    titles: [{ name: 'Copa Norte', ref: W('fn', 0) }, { name: 'Copa Centro-Oeste', ref: W('fco', 0) }],
  };
}
/** Copa Sul-Sudeste 2026 (REC): 2 grupos de 6 que se enfrentam em turno único; semifinal dentro do grupo (1º × 2º) e final em ida e volta. */
export function copaSulSudeste(): FormatDef {
  return {
    id: 'reg_ss', name: 'Copa Sul-Sudeste', regulation: 'CBF — REC Copa Sul-Sudeste 2026', source: { structure: 'REG', tiebreak: 'ADAPT', national: 'REG' }, size: 12, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(12), { groups: 2, assign: 'snake', play: 'cross' }),
      ko('sf', 'Semifinal', [gp('f1', A, 1), gp('f1', A, 2), gp('f1', B, 1), gp('f1', B, 2)], { host: 'first' }),
      final2('sf'),
    ],
    champion: W('final', 0),
  };
}

/** Copas regionais do Brasil: estados e vagas por estado (campeão, vice… do estadual do ano anterior). */
export const REGIONAIS: ReadonlyArray<{ id: string; name: string; format: () => FormatDef; spots: Readonly<Record<string, number>>; blocks?: ReadonlyArray<readonly string[]> }> = [
  { id: 'reg_ne', name: 'Copa do Nordeste', format: copaNordeste, spots: { BA: 3, CE: 3, AL: 2, MA: 2, PB: 2, PE: 2, PI: 2, RN: 2, SE: 2 } },
  // Copa Verde: campeão dos 12 estados, vice de 10 (não AP e MS) e mais um da federação mais bem ranqueada de cada bloco (PA e GO)
  { id: 'reg_cv', name: 'Copa Verde', format: copaVerde, spots: { PA: 3, AM: 2, AC: 2, RO: 2, RR: 2, AP: 1, GO: 3, DF: 2, ES: 2, MT: 2, TO: 2, MS: 1 },
    blocks: [['PA', 'AM', 'AC', 'RO', 'RR', 'AP'], ['GO', 'DF', 'ES', 'MT', 'TO', 'MS']] },
  { id: 'reg_ss', name: 'Copa Sul-Sudeste', format: copaSulSudeste, spots: { SP: 2, RJ: 2, MG: 2, RS: 2, PR: 2, SC: 2 } },
];

// ---------------------------------------------------------------- copas estaduais do 2º semestre (torneios seletivos)

/** Nomes reais das copas estaduais conhecidas (docs/COPAS_REGIONAIS.md); nos demais estados, "Copa <estado>". */
export const COPA_ESTADUAL_NOMES: Readonly<Record<string, string>> = {
  SP: 'Copa Paulista', RJ: 'Copa Rio', RS: 'Copa FGF', SC: 'Copa Santa Catarina', BA: 'Copa Governador do Estado da Bahia', AL: 'Copa Alagoas',
  ES: 'Copa Espírito Santo', SE: 'Copa Governo do Estado de Sergipe', MS: 'Copa MS', CE: 'Copa Fares Lopes', PB: 'Copa Paraíba',
};
/** O que o campeão da copa estadual ganha no ano seguinte: uma vaga do estado na Série D (ES, SE) ou a última vaga na Copa do Brasil. */
export const copaEstadualPrize = (uf: string): 'serie-d' | 'copa-do-brasil' => (uf === 'ES' || uf === 'SE' ? 'serie-d' : 'copa-do-brasil');
/** Participantes de uma copa estadual: mínimo e máximo. */
export const COPA_ESTADUAL_SIZE = { min: 4, max: 16 } as const;

/**
 * Copa estadual do 2º semestre (ADAPT — formatos não encontrados): até 8 clubes, turno único e final em ida e volta entre os 2 primeiros;
 * de 9 a 16, 2 grupos (serpentina) em turno único, semifinais cruzadas (1º × 2º do outro grupo) e final em ida e volta.
 */
export function copaEstadual(uf: string, n: number): FormatDef {
  const id = `cest_${uf.toLowerCase()}`, name = COPA_ESTADUAL_NOMES[uf] ?? `Copa ${uf}`;
  const source = { structure: 'ADAPT', tiebreak: 'ADAPT', national: uf === 'BA' || uf === 'AL' || uf === 'ES' || uf === 'SE' || uf === 'MS' ? 'SEC' : 'ADAPT' } as const;
  if (n <= 8) {
    return { id, name, regulation: 'Copa estadual do 2º semestre (formato adaptado)', source, size: n, tiebreakers: TB,
      stages: [league('f1', 'Primeira fase', seeds(n)), ko('final', 'Final', [pos('f1', 1), pos('f1', 2)], { host: 'first' })], champion: W('final', 0) };
  }
  return { id, name, regulation: 'Copa estadual do 2º semestre (formato adaptado)', source, size: n, tiebreakers: TB,
    stages: [
      league('f1', 'Primeira fase', seeds(n), { groups: 2, assign: 'snake' }),
      ko('sf', 'Semifinal', [gp('f1', A, 1), gp('f1', B, 2), gp('f1', B, 1), gp('f1', A, 2)], { host: 'first' }),
      final2('sf'),
    ], champion: W('final', 0) };
}

// ---------------------------------------------------------------- Copa da Rússia (docs/COPA_RUSSIA.md)

/** Id do formato e prefixo da competição da Copa da Rússia. */
export const COPA_RUSSIA_ID = 'rcup';
/** Clubes da Premier Liga no caminho da RPL (4 grupos de 4). */
export const COPA_RUSSIA_RPL = 16;

/**
 * Copa da Rússia 2025/26 (SEC — Wikipédia en/ru e imprensa; regulamento da RFS não obtido): dois caminhos com dupla eliminação.
 * Sementes: os 16 da Premier Liga (do mais forte ao mais fraco) e depois os da 1ª divisão (Pervaya Liga).
 * - Caminho das Regiões, rodadas classificatórias em jogo único, manda o de divisão inferior: a base só tem a Pervaya Liga (o real começa
 *   na 1ª rodada com amadores e a 2ª divisão): uma rodada preliminar entre os de pior semente até sobrar uma potência de 2, depois até 4
 *   (as rodadas levam os números reais, a última é a 6ª — ADAPT).
 * - Caminho da RPL: 4 grupos de 4 (potes pela semente), ida e volta; empate vai aos pênaltis (3/2/1/0); 1º e 2º → quartas da RPL;
 *   3º → quartas das Regiões; 4º eliminado. Quartas, semifinais e final da RPL em ida e volta, pênaltis direto no agregado.
 * - Quartas das Regiões, etapa 1: os 4 classificados das rodadas × os 3º dos grupos, em casa do clube das Regiões (REG do sorteio);
 *   etapa 2: vencedores × perdedores das quartas da RPL. Semifinal das Regiões, etapa 1 entre os 4; etapa 2 × perdedores das semifinais da
 *   RPL. Final das Regiões em jogo único. O perdedor da final da RPL está eliminado (mudança de 2025/26).
 * - Superfinal: campeão do caminho da RPL × campeão do caminho das Regiões, jogo único em campo neutro (ADAPT: Moscou no real).
 * Cruzamento das quartas da RPL (1º × 2º de outro grupo) e mando da volta: ADAPT (no real, a chave inteira é sorteada antes da copa).
 */
export function copaDaRussia(clubs: number): FormatDef | null {
  const m = clubs - COPA_RUSSIA_RPL;
  if (m < 4) return null;
  const S = (i: number): Ref => ({ seed: i });
  const stages: Stage[] = [];
  // caminho das Regiões: rodadas classificatórias até sobrarem 4
  let p = 4; while (p * 2 <= m) p *= 2;
  const total = Math.log2(p / 4) + (m > p ? 1 : 0);
  const num = (k: number) => 6 - total + 1 + k;
  const rid = (k: number) => `r${num(k)}`, rname = (k: number) => `${num(k)}ª rodada (Regiões)`;
  const one = { legs: 1 as const, pairing: 'draw' as const, host: 'underdog' as const };
  let field: Ref[] = Array.from({ length: m }, (_, i) => S(COPA_RUSSIA_RPL + i));
  let k = 0;
  if (m > p) { // preliminar: os 2·(m − p) de pior semente
    const n = 2 * (m - p), id = rid(k);
    stages.push(ko(id, rname(k), field.slice(m - n), one));
    field = [...field.slice(0, m - n), ...Array.from({ length: n / 2 }, (_, i) => W(id, i))];
    k++;
  }
  for (; k < total; k++) {
    const id = rid(k);
    stages.push(ko(id, rname(k), field, one));
    field = Array.from({ length: field.length / 2 }, (_, i) => W(id, i));
  }
  const last = rid(total - 1);
  const C = 2, D = 3;
  stages.push(
    league('g', 'Fase de grupos (RPL)', Array.from({ length: COPA_RUSSIA_RPL }, (_, i) => S(i)), { groups: 4, assign: 'snake', legs: 2, drawPens: true }),
    ko('qf', 'Quartas de final (RPL)', [gp('g', A, 1), gp('g', B, 2), gp('g', B, 1), gp('g', A, 2), gp('g', C, 1), gp('g', D, 2), gp('g', D, 1), gp('g', C, 2)], { host: 'first' }),
    ko('rq1', 'Quartas (Regiões) — etapa 1', [W(last, 0), gp('g', A, 3), W(last, 1), gp('g', B, 3), W(last, 2), gp('g', C, 3), W(last, 3), gp('g', D, 3)], { legs: 1, host: 'first' }),
    ko('rq2', 'Quartas (Regiões) — etapa 2', [0, 1, 2, 3].flatMap((i) => [W('rq1', i), L('qf', i)]), { legs: 1, host: 'underdog' }),
    ko('sf', 'Semifinal (RPL)', Ws('qf', [0, 1, 2, 3]), { host: 'first' }),
    ko('rs1', 'Semifinal (Regiões) — etapa 1', Ws('rq2', [0, 1, 2, 3]), { legs: 1, host: 'underdog' }),
    ko('rs2', 'Semifinal (Regiões) — etapa 2', [W('rs1', 0), L('sf', 0), W('rs1', 1), L('sf', 1)], { legs: 1, host: 'first' }),
    ko('fr', 'Final do caminho da RPL', Ws('sf', [0, 1]), { host: 'first' }),
    ko('freg', 'Final do caminho das Regiões', Ws('rs2', [0, 1]), { legs: 1, host: 'draw' }),
    ko('super', 'Superfinal', [W('fr', 0), W('freg', 0)], { legs: 1, host: 'neutral' }),
  );
  return {
    id: COPA_RUSSIA_ID, name: 'Copa da Rússia', regulation: 'Copa da Rússia 2025/26 (formato pela imprensa e Wikipédia)',
    source: { structure: 'SEC', tiebreak: 'SEC', national: 'ADAPT' }, size: clubs,
    tiebreakers: ['points', 'headToHead', 'wins', 'goalDiff', 'goalsFor'], stages, champion: W('super', 0),
  };
}

/**
 * Datas da Copa da Rússia por fase (as de 2025/26 levadas à quarta-feira mais próxima; superfinal no domingo): os jogos de liga da base
 * são aos sábados, a 3 ou 4 dias. `season` = ano de início da temporada. null = fase sem data fixa.
 */
export function copaDaRussiaDates(season: number, stageId: string): string[] | null {
  const y = season, z = season + 1;
  const T: Record<string, string[]> = {
    g: [`${y}-07-29`, `${y}-08-12`, `${y}-08-26`, `${y}-09-16`, `${y}-09-30`, `${y}-10-21`],
    r1: [`${y}-08-05`], r2: [`${y}-08-19`], r3: [`${y}-09-09`], r4: [`${y}-09-23`], r5: [`${y}-10-14`], r6: [`${y}-10-28`],
    qf: [`${y}-11-04`, `${y}-11-25`], rq1: [`${y}-11-25`], rq2: [`${z}-03-03`], sf: [`${z}-03-03`, `${z}-03-17`], rs1: [`${z}-03-17`],
    rs2: [`${z}-04-07`], fr: [`${z}-04-07`, `${z}-05-05`], freg: [`${z}-05-05`],
  };
  if (stageId === 'super') return [nextOn(`${z}-05-23`, 0)];
  return T[stageId]?.map((d) => nextOn(d, 3)) ?? null;
}
const nextOn = (iso: string, weekday: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
};
