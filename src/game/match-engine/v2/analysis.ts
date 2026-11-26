/**
 * Coleta da análise da partida (motor v2) para as estatísticas pós-jogo: mapa de calor, passes, ações defensivas, duelos, momentum e
 * território. Só observa: nada aqui consome o sorteio nem muda o jogo. Ligada por `MatchOptions.detail`.
 * Coordenadas recebidas em metros, no sentido do mandante; gravadas em meio metro (ver `MatchDetail` em types.ts).
 */
import { DEF_KIND, HEAT_H, HEAT_W, PASS_KEY, type DefKind, type MatchDetail, type PlayerDetail } from '../types.ts';
import { depthOf, L, toBase64, W, type P, type Side } from './pitch.ts';

interface Acc {
  heat: Float64Array; passes: number[]; def: number[];
  touches: number; dribbles: number; dribblesWon: number; duelsWon: number; duelsLost: number; aerialWon: number; aerialLost: number;
  lost: number; recoveries: number; seconds: number;
  /** início do último passe completado no vetor `passes` (para marcar o passe decisivo) */ lastPass: number;
}

const hx = (v: number) => Math.max(0, Math.min(210, Math.round(v * 2)));
const hy = (v: number) => Math.max(0, Math.min(136, Math.round(v * 2)));

export interface Analysis {
  /** amostra de `dt` segundos: onde cada jogador está, quem tem a bola e onde ela está */
  sample(dt: number, tick: number, players: Array<{ id: string; pos: P }>, poss: Side | null, ball: P): void;
  touch(id: string): void;
  /** passe de `id`; `to` = destino (certo) ou onde a bola parou (errado) */
  pass(id: string, from: P, to: P, flags: number): void;
  /** o último passe completado de `id` gerou finalização */
  keyPass(id: string): void;
  dribble(id: string, won: boolean): void;
  duel(winner: string, loser: string, aerial?: boolean): void;
  lost(id: string): void;
  def(id: string, kind: DefKind, at: P): void;
  /** bola recuperada (conta também como ação defensiva no mapa) */
  recovery(id: string, at: P): void;
  /** finalização: soma o xG à pressão do minuto */
  shot(side: Side, tick: number, xg: number): void;
  build(): MatchDetail;
}

/** pressão por segundo com a bola: no terço final vale 1, no campo de ataque antes dele 0,3 */
const pressureOf = (depth: number) => (depth >= 70 ? 1 : depth >= L / 2 ? 0.3 : 0);
/** um chute de 0,3 de xG pesa como ~18 s de pressão */
const XG_WEIGHT = 60;

export function createAnalysis(): Analysis {
  const acc = new Map<string, Acc>();
  const A = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { heat: new Float64Array(HEAT_W * HEAT_H), passes: [], def: [], touches: 0, dribbles: 0, dribblesWon: 0, duelsWon: 0, duelsLost: 0, aerialWon: 0, aerialLost: 0, lost: 0, recoveries: 0, seconds: 0, lastPass: -1 };
      acc.set(id, a);
    }
    return a;
  };
  const momentum: Array<[number, number]> = [];
  const territory: [[number, number, number], [number, number, number]] = [[0, 0, 0], [0, 0, 0]];
  const ballHeat = [new Float64Array(HEAT_W * HEAT_H), new Float64Array(HEAT_W * HEAT_H)] as const;
  const cell = (p: P) => Math.max(0, Math.min(HEAT_H - 1, Math.floor((p.y / W) * HEAT_H))) * HEAT_W + Math.max(0, Math.min(HEAT_W - 1, Math.floor((p.x / L) * HEAT_W)));
  const mom = (tick: number): [number, number] => { while (momentum.length <= tick) momentum.push([0, 0]); return momentum[tick]!; };

  return {
    sample(dt, tick, players, poss, ball) {
      if (!(dt > 0)) return;
      for (const p of players) {
        const a = A(p.id);
        a.heat[cell(p.pos)]! += dt;
        a.seconds += dt;
      }
      const m = mom(tick);
      if (poss !== null) {
        const d = depthOf(poss, ball.x);
        m[poss] += dt * pressureOf(d);
        territory[poss][d < L / 3 ? 0 : d < (2 * L) / 3 ? 1 : 2] += dt;
        ballHeat[poss][cell(ball)]! += dt;
      }
    },
    touch(id) { A(id).touches++; },
    pass(id, from, to, flags) {
      const a = A(id);
      if (flags & 1) a.lastPass = a.passes.length;
      a.passes.push(hx(from.x), hy(from.y), hx(to.x), hy(to.y), flags);
    },
    keyPass(id) {
      const a = acc.get(id);
      if (a && a.lastPass >= 0) a.passes[a.lastPass + 4]! |= PASS_KEY;
    },
    dribble(id, won) { const a = A(id); a.dribbles++; if (won) a.dribblesWon++; },
    duel(winner, loser, aerial = false) {
      const w = A(winner), l = A(loser);
      w.duelsWon++; l.duelsLost++;
      if (aerial) { w.aerialWon++; l.aerialLost++; }
    },
    lost(id) { A(id).lost++; },
    def(id, kind, at) { A(id).def.push(DEF_KIND.indexOf(kind), hx(at.x), hy(at.y)); },
    recovery(id, at) { const a = A(id); a.recoveries++; a.def.push(DEF_KIND.indexOf('recovery'), hx(at.x), hy(at.y)); },
    shot(side, tick, xg) { mom(tick)[side] += xg * XG_WEIGHT; },
    build() {
      const players: Record<string, PlayerDetail> = {};
      for (const [id, a] of acc) {
        let max = 0;
        for (const v of a.heat) if (v > max) max = v;
        const heat = new Uint8Array(HEAT_W * HEAT_H);
        if (max > 0) for (let i = 0; i < heat.length; i++) heat[i] = Math.round((a.heat[i]! / max) * 255);
        players[id] = {
          heat: toBase64(heat), passes: toBase64(a.passes), def: toBase64(a.def),
          touches: a.touches, dribbles: a.dribbles, dribblesWon: a.dribblesWon, duelsWon: a.duelsWon, duelsLost: a.duelsLost,
          aerialWon: a.aerialWon, aerialLost: a.aerialLost, lost: a.lost, recoveries: a.recoveries, seconds: Math.round(a.seconds),
        };
      }
      const r1 = (v: number) => Math.round(v * 10) / 10;
      let bmax = 0;
      for (const g of ballHeat) for (const v of g) if (v > bmax) bmax = v;
      const enc = (g: Float64Array) => { const b = new Uint8Array(g.length); if (bmax > 0) for (let i = 0; i < g.length; i++) b[i] = Math.round((g[i]! / bmax) * 255); return toBase64(b); };
      return {
        v: 1, players,
        momentum: momentum.map(([h, a]) => [r1(h), r1(a)]),
        territory: territory.map((t) => t.map((v) => Math.round(v))) as MatchDetail['territory'],
        ball: [enc(ballHeat[0]), enc(ballHeat[1])],
      };
    },
  };
}
