import type { Methodology, Player, Position } from '../../shared/types.ts';
import { FORMATIONS, getFormation, type Formation } from './formations.ts';
import { effective, readiness } from './roles.ts';
import { overallFor } from '../world/overall.ts';
import type { LineupSlot, MatchPlayer, TeamSheet, TeamTactics } from './types.ts';

export function toMatchPlayer(p: Player): MatchPlayer {
  return {
    id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, secondaryPositions: p.secondaryPositions,
    attributes: p.attributes, condition: p.condition, morale: p.morale, form: p.form,
    ...(p.roleFamiliarity ? { roleFamiliarity: p.roleFamiliarity } : {}),
  };
}

const SLOT_ORDER: Position[] = ['GK', 'CF', 'ST', 'SS', 'CB', 'LW', 'RW', 'AM', 'DM', 'CM', 'LM', 'RM', 'LB', 'RB', 'LWB', 'RWB'];

/** Atribui o melhor jogador disponível a cada função (gulosa por escassez), preferindo especialistas naturais. */
export function assignLineup(players: readonly MatchPlayer[], formation: Formation): { lineup: LineupSlot[]; score: number } {
  const free = new Set(players.map((p) => p.id));
  const byId = new Map(players.map((p) => [p.id, p]));
  const slots = formation.slots.map((s, i) => ({ s, i })).sort((a, b) => SLOT_ORDER.indexOf(a.s.pos) - SLOT_ORDER.indexOf(b.s.pos));
  const chosen = new Map<number, MatchPlayer>();
  let score = 0;
  for (const { s, i } of slots) {
    let best: MatchPlayer | null = null, bestV = -1;
    for (const id of free) {
      const p = byId.get(id)!;
      const v = effective(p, s.pos) + (p.position === s.pos ? 3 : 0);
      if (v > bestV) { bestV = v; best = p; }
    }
    if (!best) throw new Error('Jogadores insuficientes para a formação.');
    free.delete(best.id); chosen.set(i, best); score += effective(best, s.pos);
  }
  return { lineup: formation.slots.map((s, i) => ({ slot: s.pos, x: s.x, y: s.y, player: chosen.get(i)! })), score };
}

export interface ReplacedSlot { slotIndex: number; wantedId: string; chosen: MatchPlayer }

/**
 * Escalação pedida pelo usuário (um jogador por posição da formação). Quem estiver indisponível — ou repetido — é
 * substituído pelo melhor jogador livre para aquela função; as substituições são devolvidas para avisar o usuário.
 */
export function assignLineupPreferred(players: readonly MatchPlayer[], formation: Formation, preferred: readonly string[]): { lineup: LineupSlot[]; score: number; replaced: ReplacedSlot[] } {
  const byId = new Map(players.map((p) => [p.id, p]));
  const used = new Set<string>();
  const chosen = new Map<number, MatchPlayer>();
  const holes: number[] = [];
  formation.slots.forEach((_, i) => {
    const p = byId.get(preferred[i] ?? '');
    if (p && !used.has(p.id)) { chosen.set(i, p); used.add(p.id); } else holes.push(i);
  });
  holes.sort((a, b) => SLOT_ORDER.indexOf(formation.slots[a]!.pos) - SLOT_ORDER.indexOf(formation.slots[b]!.pos));
  const replaced: ReplacedSlot[] = [];
  for (const i of holes) {
    const pos = formation.slots[i]!.pos;
    let best: MatchPlayer | null = null, bestV = -1;
    for (const p of players) {
      if (used.has(p.id)) continue;
      const v = effective(p, pos) + (p.position === pos ? 3 : 0);
      if (v > bestV) { bestV = v; best = p; }
    }
    if (!best) throw new Error('Jogadores insuficientes para a formação.');
    used.add(best.id); chosen.set(i, best);
    replaced.push({ slotIndex: i, wantedId: preferred[i] ?? '', chosen: best });
  }
  const lineup = formation.slots.map((s, i) => ({ slot: s.pos, x: s.x, y: s.y, player: chosen.get(i)! }));
  return { lineup, score: lineup.reduce((a, l) => a + effective(l.player, l.slot), 0), replaced };
}

export function chooseFormation(players: readonly MatchPlayer[], previousId?: string | null): { formation: Formation; lineup: LineupSlot[]; score: number } {
  const options = FORMATIONS.map((f) => ({ formation: f, ...assignLineup(players, f) }));
  const best = options.reduce((a, b) => (b.score > a.score ? b : a));
  const prev = previousId ? options.find((o) => o.formation.id === previousId) : undefined;
  return prev && prev.score >= best.score * 0.99 ? prev : best;
}

const group = (pos: Position): 'GK' | 'DEF' | 'MID' | 'ATT' =>
  pos === 'GK' ? 'GK' : pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB' ? 'DEF' : pos === 'DM' || pos === 'CM' || pos === 'AM' || pos === 'LM' || pos === 'RM' ? 'MID' : 'ATT';

/** Banco de 7: 1 goleiro, 2 defensores, 2 meias, 2 atacantes (completando com os melhores restantes). */
export function pickBench(players: readonly MatchPlayer[], lineup: readonly LineupSlot[]): MatchPlayer[] {
  const used = new Set(lineup.map((l) => l.player.id));
  const rest = players.filter((p) => !used.has(p.id)).sort((a, b) => effective(b, b.position) - effective(a, a.position));
  const want: Array<['GK' | 'DEF' | 'MID' | 'ATT', number]> = [['GK', 1], ['DEF', 2], ['MID', 2], ['ATT', 2]];
  const bench: MatchPlayer[] = [];
  for (const [g, n] of want) bench.push(...rest.filter((p) => group(p.position) === g && !bench.includes(p)).slice(0, n));
  for (const p of rest) { if (bench.length >= 7) break; if (!bench.includes(p) && p.position !== 'GK') bench.push(p); }
  return bench.slice(0, 7);
}

export function cohesionFrom(previous: readonly string[] | null, current: readonly string[]): number {
  if (!previous || previous.length === 0) return 0.98;
  const prev = new Set(previous);
  const overlap = current.filter((id) => prev.has(id)).length;
  return Math.round((0.95 + 0.08 * (overlap / 11)) * 1000) / 1000;
}

export function tacticsForMethodology(m: Methodology): TeamTactics {
  switch (m) {
    case 'defensive': return { mentality: 'defensive', tempo: 2, width: 3, defensiveLine: 2, pressing: 2, buildUp: 'mixed' };
    case 'possession': return { mentality: 'balanced', tempo: 3, width: 3, defensiveLine: 3, pressing: 3, buildUp: 'short' };
    case 'aggressive': return { mentality: 'attacking', tempo: 4, width: 3, defensiveLine: 4, pressing: 5, buildUp: 'mixed' };
  }
}

export const lineupStrength = (lineup: readonly LineupSlot[]): number =>
  lineup.reduce((s, l) => s + effective(l.player, l.slot), 0) / Math.max(lineup.length, 1);

/** Táticas da IA: dependem da força relativa, do mando, da reputação e do perfil técnico do elenco. */
export function aiTactics(self: readonly LineupSlot[], opponent: readonly LineupSlot[], reputation: number, isHome: boolean): TeamTactics {
  const diff = lineupStrength(self) - lineupStrength(opponent) + (isHome ? 1.5 : -1.5);
  const mentality: TeamTactics['mentality'] = diff > 4 ? 'attacking' : diff < -5 ? 'defensive' : 'balanced';
  const passAvg = self.reduce((s, l) => s + l.player.attributes.technical.passing, 0) / Math.max(self.length, 1);
  const clampT = (v: number) => Math.min(5, Math.max(1, v));
  return {
    mentality,
    tempo: clampT(3 + (reputation >= 70 ? 1 : 0) - (mentality === 'defensive' ? 1 : 0)),
    width: 3,
    defensiveLine: clampT(3 + (mentality === 'attacking' ? 1 : 0) - (mentality === 'defensive' ? 1 : 0)),
    pressing: clampT(3 + (reputation >= 65 ? 1 : 0) - (mentality === 'defensive' ? 1 : 0)),
    buildUp: passAvg >= 11.5 ? 'short' : passAvg <= 8.5 ? 'long' : 'mixed',
  };
}

/** Monta a súmula completa de uma equipe a partir do elenco disponível. */
export function buildSheetDetailed(args: {
  clubId: string; name: string; squad: readonly MatchPlayer[]; previousFormation?: string | null; previousLineup?: readonly string[] | null;
  tactics: TeamTactics; formationId?: string; preferredLineup?: readonly string[] | null;
  /** função de cada vaga (alinhada às vagas da formação); ausente/nula = a melhor para o jogador */ preferredRoles?: ReadonlyArray<string | null> | null;
}): { sheet: TeamSheet; replaced: ReplacedSlot[] } {
  let picked: { formation: Formation; lineup: LineupSlot[]; score: number };
  let replaced: ReplacedSlot[] = [];
  if (args.formationId && args.preferredLineup && args.preferredLineup.length === 11) {
    const f = getFormation(args.formationId);
    const r = assignLineupPreferred(args.squad, f, args.preferredLineup);
    picked = { formation: f, lineup: r.lineup, score: r.score }; replaced = r.replaced;
  } else if (args.formationId) {
    picked = { formation: getFormation(args.formationId), ...assignLineup(args.squad, getFormation(args.formationId)) };
  } else picked = chooseFormation(args.squad, args.previousFormation);
  return {
    sheet: {
      clubId: args.clubId, name: args.name, formation: picked.formation.id,
      lineup: args.preferredRoles ? picked.lineup.map((l, i) => (args.preferredRoles![i] ? { ...l, role: args.preferredRoles![i]! } : l)) : picked.lineup,
      bench: pickBench(args.squad, picked.lineup), tactics: args.tactics,
      cohesion: cohesionFrom(args.previousLineup ?? null, picked.lineup.map((l) => l.player.id)),
    },
    replaced,
  };
}

export const buildSheet = (args: Parameters<typeof buildSheetDetailed>[0]): TeamSheet => buildSheetDetailed(args).sheet;

export { overallFor, readiness };
