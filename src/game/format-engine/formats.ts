/**
 * Formatos reais (2026) das Séries C e D e dos estaduais, montados com o motor de formatos. Fontes e adaptações em docs/ESTADUAIS.md:
 * `source` diz se cada parte vem do regulamento oficial (REG), de fonte secundária (SEC) ou foi adaptada por falta de fonte (ADAPT).
 */
import type { FormatDef, KnockoutStage, LeagueStage, Ref, Tiebreaker } from './engine.ts';

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
export function formatById(id: string, clubs: number): FormatDef | null {
  if (id === 'bra-serie-c') return leagueFormat('bra-3', clubs);
  if (id === 'bra-serie-d') return leagueFormat('bra-4', clubs);
  return ESTADUAIS.find((e) => e.id === id)?.format(2026) ?? null;
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
