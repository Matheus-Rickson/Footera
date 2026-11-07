/**
 * Estado da partida num instante do acompanhamento ao vivo, derivado só do relatório gravado (sem React, testável).
 * Com linha do tempo (partidas do usuário a partir da lapidação): notas, condição e estatísticas minuto a minuto.
 * Sem ela (saves antigos, jogos de outros clubes): um passo por minuto, só com o que os eventos contam.
 */
import type { MatchReportDto } from '../shared/api.ts';
import type { CommentaryLine } from '../game/match-engine/commentary.ts';
import type { PlayerReport, TeamStats } from '../game/match-engine/types.ts';
import { TICK_STATS } from '../game/match-engine/types.ts';
import type { Position } from '../shared/types.ts';

export type Side = 0 | 1;
export interface LiveTick { minute: number; label: string; ev: number; held: [number, number] | null; s: [number[], number[]] | null; p: [number[], number[]] | null }

export function ticksOf(r: Pick<MatchReportDto, 'timeline' | 'commentary' | 'decidedIn' | 'extraTime'>): LiveTick[] {
  if (r.timeline?.length) return r.timeline;
  const end = r.extraTime ? 120 : 90; // pênaltis direto (copas) terminam aos 90
  const lines = r.commentary.filter((l) => l.kind !== 'shootout');
  const out: LiveTick[] = [];
  let k = 0, ev = 0;
  for (let m = 1; m <= end; m++) {
    while (k < lines.length && lines[k]!.minute <= m) { ev = lines[k]!.i + 1; k++; }
    out.push({ minute: m, label: `${m}'`, ev, held: null, s: null, p: null });
  }
  return out;
}

export interface LivePlayer {
  id: string; name: string; team: Side; slot: Position; x: number; y: number;
  rating: number | null; condition: number | null; minutes: number;
  goals: number; assists: number; yellow: number; red: boolean; injured: boolean; subIn: boolean; subOut: boolean; onPitch: boolean;
}
export interface LiveState {
  step: number; finished: boolean; started: boolean; minuteLabel: string; minute: number;
  score: [number, number]; shootout: [number, number] | null;
  /** cobranças da disputa de pênaltis, na ordem (time e se converteu) */ kicks: Array<{ team: Side; scored: boolean }>;
  lines: CommentaryLine[]; tickLines: CommentaryLine[];
  /** em campo (na ordem da escalação) e os que já saíram (substituídos, expulsos, lesionados) */
  teams: [{ onPitch: LivePlayer[]; gone: LivePlayer[]; formation: string }, { onPitch: LivePlayer[]; gone: LivePlayer[]; formation: string }];
  stats: [TeamStats, TeamStats] | null;
}

const statsFrom = (s: number[], held: number, total: number): TeamStats => {
  const o = Object.fromEntries(TICK_STATS.map((k, j) => [k, k === 'xg' ? s[j]! / 100 : s[j]!])) as Record<(typeof TICK_STATS)[number], number>;
  return { ...o, possession: total ? Math.round((held / total) * 1000) / 10 : 50, shotsBlocked: 0, chancesCreated: 0 } as TeamStats;
};

/** `step` 0 = antes do apito inicial; k = depois do k-ésimo minuto registrado; >= ticks.length = encerrado (inclui pênaltis). */
export function liveAt(r: MatchReportDto, ticks: LiveTick[], step: number): LiveState {
  const finished = step >= ticks.length;
  const tick = step > 0 ? ticks[Math.min(step, ticks.length) - 1]! : null;
  const prevEv = step > 1 ? ticks[Math.min(step, ticks.length) - 2]!.ev : 0;
  const lines = finished ? r.commentary : tick ? r.commentary.filter((l) => l.i < tick.ev) : [];
  const tickLines = finished || !tick ? [] : lines.filter((l) => l.i >= prevEv);
  const minute = finished ? r.duration : tick?.minute ?? 0;

  const score: [number, number] = [0, 0];
  let shoot: [number, number] | null = null;
  const kicks: Array<{ team: Side; scored: boolean }> = [];
  for (const l of lines) {
    if (l.kind === 'goal' && l.team !== null) score[l.team]++;
    if (l.kind === 'shootout' && l.team !== null) { shoot ??= [0, 0]; if (l.scored) shoot[l.team]++; kicks.push({ team: l.team as Side, scored: !!l.scored }); }
  }

  const teams = ([0, 1] as const).map((t) => {
    const reports = r.players.filter((p) => p.team === t);
    const index = new Map(reports.map((p, j) => [p.id, j]));
    const byId = new Map<string, PlayerReport>(reports.map((p) => [p.id, p]));
    const lineup = r.lineups[t]!;
    const pitch = lineup.slots.map((s) => ({ id: s.playerId, slot: s.slot, x: s.x, y: s.y }));
    const gone: string[] = [];
    let formation = lineup.formation;
    const flags = new Map<string, { goals: number; assists: number; yellow: number; red: boolean; injured: boolean; subIn: boolean; subOut: boolean }>();
    const f = (id: string) => flags.get(id) ?? (flags.set(id, { goals: 0, assists: 0, yellow: 0, red: false, injured: false, subIn: false, subOut: false }), flags.get(id)!);
    const leave = (id: string) => { const k = pitch.findIndex((p) => p.id === id); if (k >= 0) pitch.splice(k, 1); if (!gone.includes(id)) gone.push(id); };
    for (const l of lines) {
      if (l.team !== t) continue;
      if (l.type === 'goal' && l.player) { f(l.player).goals++; if (l.player2) f(l.player2).assists++; }
      if (l.type === 'yellow_card' && l.player) f(l.player).yellow++;
      if (l.type === 'red_card' && l.player) { f(l.player).red = true; leave(l.player); }
      if (l.type === 'injury' && l.player) {
        f(l.player).injured = true;
        const replaced = r.commentary.some((x) => x.type === 'substitution' && x.player2 === l.player && x.i === l.i + 1);
        if (!replaced) leave(l.player);
      }
      if (l.type === 'formation_change' && l.moves) {
        formation = (l.detail ?? '').split('>')[1] ?? formation;
        for (const m of l.moves) { const k = pitch.findIndex((p) => p.id === m.id); if (k >= 0) pitch[k] = { ...pitch[k]!, slot: m.slot, x: m.x, y: m.y }; }
      }
      if (l.type === 'substitution' && l.player && l.player2) {
        const k = pitch.findIndex((p) => p.id === l.player2);
        const inRep = byId.get(l.player);
        if (k >= 0) pitch[k] = { ...pitch[k]!, id: l.player, slot: inRep?.slot ?? pitch[k]!.slot };
        f(l.player).subIn = true; f(l.player2).subOut = true;
        if (!gone.includes(l.player2)) gone.push(l.player2);
      }
    }
    const live = (id: string, x: number, y: number, slot: Position, onPitch: boolean): LivePlayer | null => {
      const rep = byId.get(id);
      if (!rep) return null;
      const j = index.get(id)!;
      const fl = f(id);
      const from = rep.subbedInAt ?? 0;
      const minutes = finished ? rep.minutes : Math.max(0, Math.min(rep.subbedOutAt ?? minute, minute) - from);
      const rating = finished ? rep.rating : tick?.p ? tick.p[t][2 * j]! / 10 : null;
      const snap = finished ? ticks.at(-1)?.p ?? null : tick?.p ?? null;
      const condition = snap ? snap[t][2 * j + 1]! / 10 : null;
      return { id, name: rep.name, team: t, slot, x, y, rating: step === 0 ? null : rating, condition: step === 0 ? null : condition, minutes, ...fl, onPitch };
    };
    return {
      formation,
      onPitch: pitch.map((p) => live(p.id, p.x, p.y, p.slot, true)).filter((p): p is LivePlayer => !!p),
      gone: gone.map((id) => { const rep = byId.get(id); return rep ? live(id, 0, 0, rep.slot, false) : null; }).filter((p): p is LivePlayer => !!p),
    };
  }) as LiveState['teams'];

  let stats: LiveState['stats'] = null;
  if (finished) stats = r.stats;
  else if (tick?.s && tick.held) { const tot = tick.held[0] + tick.held[1]; stats = [statsFrom(tick.s[0], tick.held[0], tot), statsFrom(tick.s[1], tick.held[1], tot)]; }

  return {
    step, finished, started: step > 0, minute, minuteLabel: finished ? 'Fim' : tick?.label ?? "0'",
    score: finished ? [r.homeGoals, r.awayGoals] : score, shootout: finished && r.shootout ? [r.shootout.home, r.shootout.away] : shoot, kicks,
    lines, tickLines, teams, stats,
  };
}
