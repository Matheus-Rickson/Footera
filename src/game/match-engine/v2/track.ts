/**
 * Leitura do trajeto (`MatchTrack`) gravado pelo motor v2. Puro (sem DOM): usado pelo mapa ao vivo e pelos testes.
 * Coordenadas devolvidas em metros (campo 105 × 68), no sentido do mandante (x = 0 é o gol do mandante).
 */
import { TRACK_HEAD, TRACK_KIND, TRACK_SLOTS, type MatchTrack, type TrackKind } from '../types.ts';
import { fromBase64, type P } from './pitch.ts';

export interface TrackFrame {
  /** minuto registrado (o mesmo índice da linha do tempo: o quadro pertence a `timeline[tick]`) */ tick: number;
  /** segundo dentro do minuto (0–63,75) */ sec: number;
  kind: TrackKind;
  /** time com a bola (null = bola sem dono) e o índice dele em `ids[time]` */ poss: 0 | 1 | null; holder: number | null;
  ball: P;
  /** posição de cada jogador, pelo índice em `ids[time]` (null = fora de campo) */ pos: [Array<P | null>, Array<P | null>];
}

export const FRAME_SIZE = TRACK_HEAD + 4 * TRACK_SLOTS;

export function decodeTrack(track: MatchTrack): TrackFrame[] {
  const b = fromBase64(track.data);
  const n = Math.min(track.frames, Math.floor(b.length / FRAME_SIZE));
  const out: TrackFrame[] = [];
  for (let f = 0; f < n; f++) {
    const o = f * FRAME_SIZE;
    const poss = b[o + 4]!;
    const pos: [Array<P | null>, Array<P | null>] = [[], []];
    for (const t of [0, 1] as const) {
      for (let s = 0; s < TRACK_SLOTS; s++) {
        const k = o + TRACK_HEAD + (t * TRACK_SLOTS + s) * 2;
        pos[t].push(b[k] === 255 ? null : { x: b[k]! / 2, y: b[k + 1]! / 2 });
      }
    }
    out.push({
      tick: (b[o]! << 8) | b[o + 1]!, sec: b[o + 2]! / 4, kind: TRACK_KIND[b[o + 3]!] ?? 'move',
      poss: poss === 2 ? null : (poss as 0 | 1), holder: b[o + 5] === 255 ? null : b[o + 5]!,
      ball: { x: b[o + 6]! / 2, y: b[o + 7]! / 2 }, pos,
    });
  }
  return out;
}

/** quadros agrupados pelo minuto registrado */
export function framesByTick(frames: TrackFrame[]): Map<number, TrackFrame[]> {
  const m = new Map<number, TrackFrame[]>();
  for (const f of frames) { const a = m.get(f.tick); if (a) a.push(f); else m.set(f.tick, [f]); }
  return m;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpP = (a: P | null, b: P | null, k: number): P | null => (a && b ? { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) } : b);

/**
 * Situação em `sec` segundos dentro do minuto: interpola entre o quadro anterior e o seguinte. `prev` é o último quadro do minuto
 * anterior (de onde a cena parte). Devolve o quadro "atual" (o último já alcançado) para o rótulo do lance.
 */
export function sceneAt(frames: TrackFrame[], prev: TrackFrame | null, sec: number): { ball: P; pos: [Array<P | null>, Array<P | null>]; current: TrackFrame | null; index: number } | null {
  if (!frames.length) return prev ? { ball: prev.ball, pos: prev.pos, current: prev, index: -1 } : null;
  let i = -1;
  while (i + 1 < frames.length && frames[i + 1]!.sec <= sec) i++;
  const a = i >= 0 ? frames[i]! : prev, b = frames[i + 1] ?? null;
  if (!a) return { ball: frames[0]!.ball, pos: frames[0]!.pos, current: null, index: -1 };
  if (!b) return { ball: a.ball, pos: a.pos, current: i >= 0 ? a : prev, index: i };
  const t0 = i >= 0 ? a.sec : 0, span = b.sec - t0;
  const k = span > 0 ? Math.max(0, Math.min(1, (sec - t0) / span)) : 1;
  const pos: [Array<P | null>, Array<P | null>] = [
    b.pos[0].map((p, s) => lerpP(a.pos[0][s] ?? null, p, k)),
    b.pos[1].map((p, s) => lerpP(a.pos[1][s] ?? null, p, k)),
  ];
  return { ball: lerpP(a.ball, b.ball, k)!, pos, current: i >= 0 ? a : prev, index: i };
}
