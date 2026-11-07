import type { LeagueRules } from '../../shared/types.ts';

export interface MatchResult { home: string; away: string; homeGoals: number; awayGoals: number }

export interface StandingRow {
  teamId: string; position: number;
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; goalDiff: number; points: number;
}

type Tiebreaker = LeagueRules['tiebreakers'][number];

function emptyRow(teamId: string): StandingRow {
  return { teamId, position: 0, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 };
}

/**
 * Tabela simples (sem ordenar) considerando apenas as partidas informadas entre as equipes dadas. `countAll`: conta também os jogos
 * contra equipes fora do conjunto (grupos que enfrentam os outros grupos, como no Carioca); só a equipe do conjunto pontua.
 */
function tally(teamIds: readonly string[], results: readonly MatchResult[], pointsWin: number, pointsDraw: number, countAll = false): Map<string, StandingRow> {
  const rows = new Map(teamIds.map((id) => [id, emptyRow(id)]));
  const side = (row: StandingRow | undefined, gf: number, ga: number) => {
    if (!row) return;
    row.played++; row.goalsFor += gf; row.goalsAgainst += ga;
    if (gf > ga) { row.won++; row.points += pointsWin; } else if (gf < ga) row.lost++; else { row.drawn++; row.points += pointsDraw; }
  };
  for (const r of results) {
    const h = rows.get(r.home), a = rows.get(r.away);
    if (!countAll && (!h || !a)) continue;
    side(h, r.homeGoals, r.awayGoals);
    side(a, r.awayGoals, r.homeGoals);
  }
  for (const row of rows.values()) row.goalDiff = row.goalsFor - row.goalsAgainst;
  return rows;
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): T[][] {
  const groups: T[][] = [];
  let lastKey: string | null = null;
  for (const it of items) {
    const k = key(it);
    if (k === lastKey) groups[groups.length - 1]!.push(it); else { groups.push([it]); lastKey = k; }
  }
  return groups;
}

/**
 * Classifica as equipes aplicando os critérios de desempate na ordem configurada.
 * O confronto direto (`headToHead`) usa uma mini-tabela só com jogos entre as equipes empatadas
 * (pontos, saldo, gols pró) e é reaplicado ao subgrupo que continuar empatado.
 * Empates absolutos são resolvidos por ID da equipe, para o resultado ser determinístico.
 */
export function computeStandings(teamIds: readonly string[], results: readonly MatchResult[], rules: Pick<LeagueRules, 'pointsWin' | 'pointsDraw'> & { tiebreakers: readonly Tiebreaker[] },
  opts: { /** conta os jogos contra equipes de fora do conjunto */ countAll?: boolean; /** pontos de bonificação (ex.: melhor 5º começa com 1 ponto) */ bonus?: ReadonlyMap<string, number> } = {}): StandingRow[] {
  const table = tally(teamIds, results, rules.pointsWin, rules.pointsDraw, opts.countAll);
  for (const [id, pts] of opts.bonus ?? []) { const row = table.get(id); if (row) row.points += pts; }
  const criteria: Tiebreaker[] = rules.tiebreakers.length ? [...rules.tiebreakers] : ['points', 'goalDiff', 'goalsFor'];

  const value = (row: StandingRow, c: Exclude<Tiebreaker, 'headToHead'>): number =>
    c === 'points' ? row.points : c === 'wins' ? row.won : c === 'goalDiff' ? row.goalDiff : row.goalsFor;

  const rank = (ids: string[], ci: number): string[] => {
    if (ids.length <= 1) return ids;
    if (ci >= criteria.length) return [...ids].sort();
    const c = criteria[ci]!;
    if (c !== 'headToHead') {
      const sorted = [...ids].sort((a, b) => value(table.get(b)!, c) - value(table.get(a)!, c));
      return groupBy(sorted, (id) => String(value(table.get(id)!, c))).flatMap((g) => rank(g, ci + 1));
    }
    const mini = tally(ids, results, rules.pointsWin, rules.pointsDraw);
    const sorted = [...ids].sort((a, b) => {
      const x = mini.get(a)!, y = mini.get(b)!;
      return y.points - x.points || y.goalDiff - x.goalDiff || y.goalsFor - x.goalsFor;
    });
    const groups = groupBy(sorted, (id) => { const r = mini.get(id)!; return `${r.points}|${r.goalDiff}|${r.goalsFor}`; });
    return groups.flatMap((g) => (g.length === ids.length ? rank(g, ci + 1) : rank(g, ci)));
  };

  return rank([...teamIds], 0).map((id, i) => ({ ...table.get(id)!, position: i + 1 }));
}

export interface SeasonOutcome { champion: string | null; promoted: string[]; relegated: string[]; continental: string[] }

/** Zonas finais da tabela segundo as regras da liga. Só faz sentido com a temporada concluída. */
export function seasonOutcome(table: readonly StandingRow[], rules: Pick<LeagueRules, 'promotionSlots' | 'relegationSlots' | 'continentalSlots'>): SeasonOutcome {
  const ids = table.map((r) => r.teamId);
  return {
    champion: ids[0] ?? null,
    promoted: ids.slice(0, rules.promotionSlots),
    relegated: rules.relegationSlots > 0 ? ids.slice(-rules.relegationSlots) : [],
    continental: ids.slice(0, rules.continentalSlots),
  };
}
