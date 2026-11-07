/**
 * Motor de formatos (Fase 9 — estaduais e Séries C/D): competições disputadas em fases, puro e determinístico (sem I/O).
 *
 * Uma competição é uma lista de fases. Fase de liga: grupo único ou grupos, jogando dentro do grupo, contra os outros grupos
 * (Carioca, Mineiro, Goiano) ou dentro do pote + N jogos contra outros potes (Paulistão). Mata-mata: jogo único ou ida e volta,
 * chave fixa, por semente ou sorteio, mando para o primeiro / a melhor campanha / neutro, vantagem do empate, prorrogação e pênaltis.
 * Os entrantes de cada fase são referências (`Ref`) a resultados anteriores: "2º do grupo A", "melhor 2º colocado", "pior lanterna",
 * "vencedor do confronto 3"... Fases laterais (`side`: Taça Rio, Grupo X, quadrangular do rebaixamento) não contam na campanha nem na
 * classificação final. Ver docs/ESTADUAIS.md.
 */
import type { Rng } from '../rng.ts';
import type { LeagueRules } from '../../shared/types.ts';
import { computeStandings, type MatchResult, type StandingRow } from '../competition-engine/standings.ts';
import { generateRounds } from '../competition-engine/roundRobin.ts';

export type Source = 'REG' | 'SEC' | 'ADAPT';
export type Tiebreaker = LeagueRules['tiebreakers'][number];

/** Referência a um clube: semente inicial ou resultado de uma fase. `pos` começa em 1; negativo conta do fim (-1 = último). */
export type Ref =
  | { seed: number }
  | { stage: string; pos: number; group?: number }
  | { stage: string; pos: number; nthBest: number }
  | { stage: string; pos: number; nthWorst: number }
  | { stage: string; winner: number }
  | { stage: string; loser: number };

export interface LeagueStage {
  kind: 'league'; id: string; name: string; entrants: Ref[];
  /** 1 = tabela única */
  groups: number;
  /** order = blocos consecutivos na ordem dos entrantes; snake = serpentina; preset = grupos informados de fora (ex.: geográfico) */
  assign: 'order' | 'snake' | 'preset';
  /** within = só dentro do grupo; cross = só contra os outros grupos; pots = dentro do grupo + `crossGames` contra outros grupos */
  play: 'within' | 'cross' | 'pots';
  crossGames?: number;
  /** cross: cada grupo só enfrenta o seu par (A × B, C × D…), como na Copa do Nordeste */
  crossPairs?: boolean;
  legs: 1 | 2;
  /** pontos de bonificação no início da fase */
  bonus?: Array<{ ref: Ref; points: number }>;
  side?: boolean;
}
export interface KnockoutStage {
  kind: 'knockout'; id: string; name: string;
  /** em pares consecutivos (fixed) ou em ordem de semente (seeded: 1º × último) */
  entrants: Ref[];
  pairing: 'fixed' | 'seeded' | 'draw';
  /** reordena os entrantes pela campanha somada antes de parear; `permute` aplica a ordem da chave sobre essa lista */
  byCampaign?: boolean; permute?: number[];
  legs: 1 | 2;
  /** quem manda o jogo único ou o jogo de VOLTA */
  host: 'first' | 'campaign' | 'neutral' | 'draw';
  /** empate (no jogo ou no agregado) classifica quem tem o mando: sem pênaltis */
  advantage?: boolean;
  extraTime?: boolean;
  side?: boolean;
}
export type Stage = LeagueStage | KnockoutStage;

export interface FormatDef {
  id: string; name: string; regulation: string;
  source: { structure: Source; tiebreak: Source; national: Source };
  /** número de participantes */
  size: number;
  tiebreakers: Tiebreaker[];
  stages: Stage[];
  champion: Ref;
  /** títulos paralelos (Taça Guanabara, Taça Rio) */
  titles?: Array<{ name: string; ref: Ref }>;
  promoted?: Ref[];
  relegated?: Ref[];
}

/** Resultado de um jogo da competição. Mata-mata: confronto, perna e, se empatou no agregado, quem venceu nos pênaltis. */
export interface FxResult extends MatchResult { tie?: number; leg?: 1 | 2; pens?: string }
/** Confronto de mata-mata: `host` manda o jogo único ou a volta. */
export interface Tie { a: string; b: string; host: string; neutral: boolean }
export interface StageState { groups?: string[][]; ties?: Tie[]; results: FxResult[]; expected: number }
export interface FormatState { seeds: string[]; stages: Record<string, StageState> }
export interface Fixture { round: number; home: string; away: string; tie?: number; leg?: 1 | 2; neutral?: boolean }

const RULES = (def: FormatDef) => ({ pointsWin: 3, pointsDraw: 1, tiebreakers: def.tiebreakers });

export function stageOf(def: FormatDef, id: string): Stage {
  const s = def.stages.find((x) => x.id === id);
  if (!s) throw new Error(`${def.name}: fase inexistente "${id}".`);
  return s;
}

// ---------------------------------------------------------------- tabelas e confrontos

/** Tabelas de uma fase de liga: por grupo e geral (todos os clubes da fase pelos mesmos critérios). */
export function stageTables(def: FormatDef, state: FormatState, id: string): { groups: StandingRow[][]; overall: StandingRow[] } {
  const stage = stageOf(def, id), st = state.stages[id];
  if (stage.kind !== 'league' || !st?.groups) return { groups: [], overall: [] };
  const bonus = new Map<string, number>();
  for (const b of stage.bonus ?? []) { const c = resolveRef(def, state, b.ref); if (c) bonus.set(c, (bonus.get(c) ?? 0) + b.points); }
  const opts = { countAll: true, bonus };
  return {
    groups: st.groups.map((g) => computeStandings(g, st.results, RULES(def), opts)),
    overall: computeStandings(st.groups.flat(), st.results, RULES(def), opts),
  };
}

/** Desfecho de um confronto (null se ainda não decidido). */
export function tieOutcome(def: FormatDef, state: FormatState, id: string, idx: number): { winner: string; loser: string } | null {
  const stage = stageOf(def, id), st = state.stages[id];
  if (stage.kind !== 'knockout' || !st?.ties) return null;
  const tie = st.ties[idx];
  if (!tie) return null;
  const games = st.results.filter((r) => r.tie === idx);
  if (games.length < stage.legs) return null;
  let ga = 0, gb = 0;
  for (const g of games) { if (g.home === tie.a) { ga += g.homeGoals; gb += g.awayGoals; } else { ga += g.awayGoals; gb += g.homeGoals; } }
  const out = (w: string) => ({ winner: w, loser: w === tie.a ? tie.b : tie.a });
  if (ga !== gb) return out(ga > gb ? tie.a : tie.b);
  if (stage.advantage) return out(tie.host);
  const last = games.find((g) => (g.leg ?? 1) === stage.legs) ?? games[games.length - 1]!;
  return last.pens === tie.a || last.pens === tie.b ? out(last.pens) : null;
}

export function stageBuilt(state: FormatState, id: string): boolean { return !!state.stages[id]; }

/** Fase com todos os jogos disputados (e, no mata-mata, todos os confrontos decididos). */
export function stageComplete(def: FormatDef, state: FormatState, id: string): boolean {
  const st = state.stages[id];
  if (!st || st.results.length < st.expected) return false;
  return !st.ties || st.ties.every((_, i) => tieOutcome(def, state, id, i) !== null);
}

/** Campanha somada nas fases principais (não laterais): pontos, vitórias, saldo, gols pró (jogos de mata-mata contam como jogos). */
export function campaign(def: FormatDef, state: FormatState, club: string): { points: number; wins: number; goalDiff: number; goalsFor: number } {
  const c = { points: 0, wins: 0, goalDiff: 0, goalsFor: 0 };
  for (const stage of def.stages) {
    if (stage.side) continue;
    for (const r of state.stages[stage.id]?.results ?? []) {
      const side = r.home === club ? [r.homeGoals, r.awayGoals] : r.away === club ? [r.awayGoals, r.homeGoals] : null;
      if (!side) continue;
      const [gf, ga] = side as [number, number];
      c.goalsFor += gf; c.goalDiff += gf - ga;
      if (gf > ga) { c.wins++; c.points += 3; } else if (gf === ga) c.points += 1;
    }
  }
  return c;
}
const byCampaign = (def: FormatDef, state: FormatState) => (x: string, y: string) => {
  const a = campaign(def, state, x), b = campaign(def, state, y);
  return b.points - a.points || b.wins - a.wins || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || x.localeCompare(y);
};

const at = <T>(xs: readonly T[], pos: number): T | undefined => (pos > 0 ? xs[pos - 1] : xs[xs.length + pos]);
const rowOrder = (a: StandingRow, b: StandingRow) => b.points - a.points || b.won - a.won || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || a.teamId.localeCompare(b.teamId);

/** Resolve uma referência (null se a fase de origem ainda não terminou). */
export function resolveRef(def: FormatDef, state: FormatState, ref: Ref): string | null {
  if ('seed' in ref) return state.seeds[ref.seed] ?? null;
  if (!stageComplete(def, state, ref.stage)) return null;
  if ('winner' in ref) return tieOutcome(def, state, ref.stage, ref.winner)?.winner ?? null;
  if ('loser' in ref) return tieOutcome(def, state, ref.stage, ref.loser)?.loser ?? null;
  const t = stageTables(def, state, ref.stage);
  if ('nthBest' in ref || 'nthWorst' in ref) {
    const rows = t.groups.map((g) => at(g, ref.pos)).filter((r): r is StandingRow => !!r).sort(rowOrder);
    const n = 'nthBest' in ref ? ref.nthBest : ref.nthWorst;
    return ('nthBest' in ref ? rows[n - 1] : rows[rows.length - n])?.teamId ?? null;
  }
  const table = ref.group !== undefined ? t.groups[ref.group] : t.overall;
  return table ? at(table, ref.pos)?.teamId ?? null : null;
}

// ---------------------------------------------------------------- montagem das fases

/** Rodadas de jogos únicos a partir de pares (arestas): cada rodada é um emparelhamento perfeito; mando equilibrado. */
function matchingRounds(teams: readonly string[], edges: ReadonlyArray<[string, string]>, roundsWanted: number, rng: Rng, homes: Map<string, number>): Array<Array<[string, string]>> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const left = new Set(edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
    const rounds: Array<Array<[string, string]>> = [];
    let failed = false;
    for (let r = 0; r < roundsWanted && !failed; r++) {
      const order = rng.shuffle(teams);
      const used = new Set<string>();
      const round: Array<[string, string]> = [];
      const solve = (i: number): boolean => {
        while (i < order.length && used.has(order[i]!)) i++;
        if (i >= order.length) return true;
        const a = order[i]!;
        used.add(a);
        for (const b of rng.shuffle(order.filter((x) => !used.has(x) && left.has(a < x ? `${a}|${x}` : `${x}|${a}`)))) {
          used.add(b); round.push([a, b]);
          if (solve(i + 1)) return true;
          used.delete(b); round.pop();
        }
        used.delete(a);
        return false;
      };
      if (!solve(0)) { failed = true; break; }
      for (const [a, b] of round) left.delete(a < b ? `${a}|${b}` : `${b}|${a}`);
      rounds.push(round);
    }
    if (!failed) {
      return rounds.map((round) => round.map(([a, b]) => {
        const ha = homes.get(a) ?? 0, hb = homes.get(b) ?? 0;
        const home = ha < hb ? a : hb < ha ? b : rng.next() < 0.5 ? a : b;
        homes.set(home, (homes.get(home) ?? 0) + 1);
        return home === a ? [a, b] as [string, string] : [b, a] as [string, string];
      }));
    }
  }
  throw new Error('Não foi possível montar as rodadas (emparelhamento).');
}

function assignGroups(stage: LeagueStage, entrants: readonly string[], preset?: readonly string[][]): string[][] {
  if (stage.assign === 'preset') {
    if (!preset || preset.length !== stage.groups) throw new Error(`${stage.name}: grupos não informados.`);
    const all = preset.flat();
    if (all.length !== entrants.length || !entrants.every((e) => all.includes(e))) throw new Error(`${stage.name}: grupos não batem com os entrantes.`);
    return preset.map((g) => [...g]);
  }
  const n = entrants.length, g = stage.groups;
  if (n % g !== 0) throw new Error(`${stage.name}: ${n} clubes não se dividem em ${g} grupos.`);
  if (stage.assign === 'order') return Array.from({ length: g }, (_, i) => entrants.slice((i * n) / g, ((i + 1) * n) / g));
  const out: string[][] = Array.from({ length: g }, () => []);
  entrants.forEach((c, i) => { const lap = Math.floor(i / g), k = i % g; out[lap % 2 === 0 ? k : g - 1 - k]!.push(c); });
  return out;
}

function leagueFixtures(stage: LeagueStage, groups: string[][], rng: Rng): Fixture[] {
  const teams = groups.flat(), groupOf = new Map(groups.flatMap((g, i) => g.map((c) => [c, i] as const)));
  let single: Array<Array<[string, string]>> = [];
  const homes = new Map<string, number>();
  if (stage.play === 'within' || stage.play === 'pots') {
    const per = groups.map((g, i) => generateRounds(g, 1, rng.fork(`g${i}`)));
    const n = Math.max(...per.map((p) => p.length));
    for (let r = 0; r < n; r++) single.push(per.flatMap((p) => (p[r]?.matches ?? []).map((m) => [m.home, m.away] as [string, string])));
    for (const round of single) for (const [h] of round) homes.set(h, (homes.get(h) ?? 0) + 1);
  }
  if (stage.play === 'cross' || stage.play === 'pots') {
    const cross: Array<[string, string]> = [];
    const facing = (a: number, b: number) => a !== b && (!stage.crossPairs || Math.floor(a / 2) === Math.floor(b / 2));
    for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) if (facing(groupOf.get(teams[i]!)!, groupOf.get(teams[j]!)!)) cross.push([teams[i]!, teams[j]!]);
    const want = stage.play === 'pots' ? stage.crossGames ?? 0 : stage.crossPairs ? Math.max(...groups.map((g) => g.length)) : teams.length - Math.max(...groups.map((g) => g.length));
    if (want > 0) single = single.concat(matchingRounds(teams, cross, want, rng.fork('cross'), homes));
  }
  const rounds = stage.legs === 2 ? single.concat(single.map((r) => r.map(([h, a]) => [a, h] as [string, string]))) : single;
  return rounds.flatMap((r, i) => r.map(([home, away]) => ({ round: i + 1, home, away })));
}

/** Entrantes de uma fase (null se alguma referência ainda não pode ser resolvida). */
export function stageEntrants(def: FormatDef, state: FormatState, id: string): string[] | null {
  const out: string[] = [];
  for (const ref of stageOf(def, id).entrants) { const c = resolveRef(def, state, ref); if (!c) return null; out.push(c); }
  if (new Set(out).size !== out.length) throw new Error(`${def.name}: clube repetido nos entrantes de "${id}".`);
  return out;
}

/** Fases ainda não montadas cujos entrantes já estão definidos. */
export function buildableStages(def: FormatDef, state: FormatState): string[] {
  return def.stages.filter((s) => !stageBuilt(state, s.id) && stageEntrants(def, state, s.id) !== null).map((s) => s.id);
}

/** Monta uma fase: grupos ou confrontos e a lista de jogos (rodadas relativas, a partir de 1). */
export function buildStage(def: FormatDef, state: FormatState, id: string, rng: Rng, preset?: readonly string[][]): { stage: StageState; fixtures: Fixture[] } {
  const stage = stageOf(def, id);
  const entrants = stageEntrants(def, state, id);
  if (!entrants) throw new Error(`${def.name}: a fase "${stage.name}" ainda não tem todos os participantes.`);
  if (stage.kind === 'league') {
    const groups = assignGroups(stage, entrants, preset);
    const fixtures = leagueFixtures(stage, groups, rng);
    return { stage: { groups, results: [], expected: fixtures.length }, fixtures };
  }
  let list = stage.byCampaign ? [...entrants].sort(byCampaign(def, state)) : entrants;
  if (stage.permute) list = stage.permute.map((i) => list[i]!);
  if (list.length % 2 !== 0) throw new Error(`${stage.name}: número ímpar de clubes.`);
  const pairs: Array<[string, string]> = [];
  if (stage.pairing === 'seeded') for (let i = 0; i < list.length / 2; i++) pairs.push([list[i]!, list[list.length - 1 - i]!]);
  else { const l = stage.pairing === 'draw' ? rng.shuffle(list) : list; for (let i = 0; i < l.length; i += 2) pairs.push([l[i]!, l[i + 1]!]); }
  const cmp = byCampaign(def, state);
  const ties: Tie[] = pairs.map(([a, b]) => {
    const host = stage.host === 'campaign' ? (cmp(a, b) <= 0 ? a : b) : stage.host === 'draw' ? (rng.next() < 0.5 ? a : b) : a;
    return { a, b, host, neutral: stage.host === 'neutral' };
  });
  const fixtures: Fixture[] = [];
  ties.forEach((t, i) => {
    const other = t.host === t.a ? t.b : t.a;
    if (stage.legs === 1) fixtures.push({ round: 1, home: t.host, away: other, tie: i, leg: 1, ...(t.neutral ? { neutral: true } : {}) });
    else { fixtures.push({ round: 1, home: other, away: t.host, tie: i, leg: 1 }); fixtures.push({ round: 2, home: t.host, away: other, tie: i, leg: 2, ...(t.neutral ? { neutral: true } : {}) }); }
  });
  return { stage: { ties, results: [], expected: fixtures.length }, fixtures };
}

/**
 * Regra de desempate do jogo que decide o confronto (jogo único ou volta), para o motor da partida: com vantagem do empate, nenhuma;
 * senão prorrogação (se houver) e pênaltis, com o placar da ida do ponto de vista do mandante da volta.
 */
export function deciderFor(def: FormatDef, state: FormatState, id: string, tieIdx: number, leg: 1 | 2): { extraTime: boolean; penalties: boolean; firstLeg?: [number, number] } | null {
  const stage = stageOf(def, id), st = state.stages[id];
  if (stage.kind !== 'knockout' || !st?.ties || leg !== stage.legs || stage.advantage) return null;
  const tie = st.ties[tieIdx]!;
  if (stage.legs === 1) return { extraTime: !!stage.extraTime, penalties: true };
  const first = st.results.find((r) => r.tie === tieIdx && r.leg === 1);
  if (!first) return { extraTime: !!stage.extraTime, penalties: true };
  // placar da ida visto pelo mandante da volta (o host): [gols do host, gols do outro]
  const firstLeg: [number, number] = first.home === tie.host ? [first.homeGoals, first.awayGoals] : [first.awayGoals, first.homeGoals];
  return { extraTime: !!stage.extraTime, penalties: true, firstLeg };
}

// ---------------------------------------------------------------- desfecho

export function formatComplete(def: FormatDef, state: FormatState): boolean {
  return def.stages.every((s) => stageComplete(def, state, s.id));
}

/**
 * Classificação final: campeão; vice (se a final for mata-mata); depois quem foi mais longe nas fases principais; na mesma fase,
 * a posição na tabela geral (fase de liga) ou a campanha somada (mata-mata).
 */
export function finalRanking(def: FormatDef, state: FormatState): string[] {
  const main = def.stages.filter((s) => !s.side);
  const depth = new Map<string, number>();
  main.forEach((s, i) => {
    const st = state.stages[s.id];
    for (const c of st?.groups?.flat() ?? st?.ties?.flatMap((t) => [t.a, t.b]) ?? []) depth.set(c, i);
  });
  const tables = new Map(main.filter((s) => s.kind === 'league' && state.stages[s.id]).map((s) => [s.id, new Map(stageTables(def, state, s.id).overall.map((r) => [r.teamId, r.position]))]));
  const cmp = byCampaign(def, state);
  const champion = resolveRef(def, state, def.champion);
  const finalStage = 'stage' in def.champion && 'winner' in def.champion ? def.champion : null;
  const runnerUp = finalStage ? resolveRef(def, state, { stage: finalStage.stage, loser: finalStage.winner }) : null;
  const rest = state.seeds.filter((c) => c !== champion && c !== runnerUp).sort((x, y) => {
    const dx = depth.get(x) ?? -1, dy = depth.get(y) ?? -1;
    if (dx !== dy) return dy - dx;
    const s = main[dx];
    const tbl = s ? tables.get(s.id) : undefined;
    if (tbl && tbl.has(x) && tbl.has(y)) return tbl.get(x)! - tbl.get(y)!;
    return cmp(x, y);
  });
  return [...(champion ? [champion] : []), ...(runnerUp ? [runnerUp] : []), ...rest];
}

export function outcomes(def: FormatDef, state: FormatState): { champion: string | null; titles: Array<{ name: string; club: string | null }>; promoted: string[]; relegated: string[] } {
  const r = (refs: readonly Ref[] = []) => refs.map((x) => resolveRef(def, state, x)).filter((c): c is string => !!c);
  return {
    champion: resolveRef(def, state, def.champion),
    titles: (def.titles ?? []).map((t) => ({ name: t.name, club: resolveRef(def, state, t.ref) })),
    promoted: r(def.promoted),
    relegated: r(def.relegated),
  };
}

/** Número máximo de datas que o formato usa em sequência (fases principais; as laterais jogam em paralelo). */
export function formatRounds(def: FormatDef): number {
  let total = 0;
  for (const s of def.stages) {
    if (s.side) continue;
    if (s.kind === 'knockout') { total += s.legs; continue; }
    const n = s.entrants.length, g = n / s.groups;
    const single = s.play === 'cross' ? (s.crossPairs ? g : n - g) : s.play === 'pots' ? (g % 2 === 0 ? g - 1 : g) + (s.crossGames ?? 0) : g % 2 === 0 ? g - 1 : g;
    total += single * s.legs;
  }
  return total;
}
