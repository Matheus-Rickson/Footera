/**
 * Leitura da análise da partida (`MatchDetail`, motor v2) para as estatísticas pós-jogo. Puro (sem DOM): usado pela tela e pelos testes.
 * Coordenadas devolvidas em metros (campo 105 × 68), no sentido do mandante (x = 0 é o gol do mandante).
 */
import { DEF_KIND, HEAT_H, HEAT_W, PASS_CROSS, PASS_KEY, PASS_LONG, PASS_OK, type DefKind, type PlayerDetail } from '../types.ts';
import { fromBase64, L, W, type P } from './pitch.ts';

export interface PassLine { from: P; to: P; ok: boolean; cross: boolean; key: boolean; long: boolean }
export interface DefAction { kind: DefKind; at: P }

/** mapa de calor do jogador: HEAT_W × HEAT_H valores 0–1 (linha a linha), 1 = a célula onde ele mais ficou */
export function decodeHeat(d: Pick<PlayerDetail, 'heat'>): number[] {
  const b = fromBase64(d.heat);
  return Array.from({ length: HEAT_W * HEAT_H }, (_, i) => (b[i] ?? 0) / 255);
}

export function decodePasses(d: Pick<PlayerDetail, 'passes'>): PassLine[] {
  const b = fromBase64(d.passes), out: PassLine[] = [];
  for (let i = 0; i + 4 < b.length; i += 5) {
    const f = b[i + 4]!;
    out.push({ from: { x: b[i]! / 2, y: b[i + 1]! / 2 }, to: { x: b[i + 2]! / 2, y: b[i + 3]! / 2 }, ok: !!(f & PASS_OK), cross: !!(f & PASS_CROSS), key: !!(f & PASS_KEY), long: !!(f & PASS_LONG) });
  }
  return out;
}

export function decodeDef(d: Pick<PlayerDetail, 'def'>): DefAction[] {
  const b = fromBase64(d.def), out: DefAction[] = [];
  for (let i = 0; i + 2 < b.length; i += 3) out.push({ kind: DEF_KIND[b[i]!] ?? 'tackle', at: { x: b[i + 1]! / 2, y: b[i + 2]! / 2 } });
  return out;
}

/** vira a coordenada para que o time `team` ataque da esquerda para a direita (o visitante joga espelhado no sentido do mandante) */
export const attackRight = (p: P, team: 0 | 1): P => (team === 0 ? p : { x: L - p.x, y: W - p.y });

/** idem para a grade do mapa de calor (o visitante é girado 180°) */
export function heatAttackRight(grid: number[], team: 0 | 1): number[] {
  return team === 0 ? grid : [...grid].reverse();
}

/**
 * Suaviza a grade (núcleo gaussiano 3×3 aplicado `passes` vezes) e reescala para 0–1: o desenho fica contínuo como num mapa de calor
 * de transmissão, sem inventar presença longe de onde o jogador esteve (cada passada espalha no máximo uma célula).
 */
export function smoothHeat(grid: number[], passes = 2): number[] {
  let g = grid;
  const k = [1, 2, 1];
  for (let n = 0; n < passes; n++) {
    const out = new Array<number>(g.length).fill(0);
    for (let y = 0; y < HEAT_H; y++) for (let x = 0; x < HEAT_W; x++) {
      let s = 0, w = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= HEAT_W || yy >= HEAT_H) continue;
        const kw = k[dx + 1]! * k[dy + 1]!;
        s += g[yy * HEAT_W + xx]! * kw; w += kw;
      }
      out[y * HEAT_W + x] = s / w;
    }
    g = out;
  }
  const max = Math.max(0, ...g);
  return max > 0 ? g.map((v) => v / max) : g;
}

/** posição média do jogador (centro de massa do mapa de calor), em metros no sentido do mandante; null sem dados */
export function averagePosition(grid: number[]): P | null {
  let s = 0, sx = 0, sy = 0;
  for (let y = 0; y < HEAT_H; y++) for (let x = 0; x < HEAT_W; x++) {
    const v = grid[y * HEAT_W + x]!;
    s += v; sx += v * (x + 0.5); sy += v * (y + 0.5);
  }
  return s > 0 ? { x: (sx / s) * (L / HEAT_W), y: (sy / s) * (W / HEAT_H) } : null;
}

/**
 * Momentum do jogo, minuto registrado a minuto registrado: pressão do mandante menos a do visitante, suavizada (média com os vizinhos)
 * e normalizada para -1…1 (positivo = mandante por cima).
 */
export function momentumSeries(m: Array<[number, number]>): number[] {
  const raw = m.map(([h, a]) => h - a);
  const sm = raw.map((_, i) => {
    let s = 0, w = 0;
    for (let d = -2; d <= 2; d++) { const v = raw[i + d]; if (v === undefined) continue; const k = 3 - Math.abs(d); s += v * k; w += k; }
    return w ? s / w : 0;
  });
  const max = Math.max(1e-9, ...sm.map(Math.abs));
  return sm.map((v) => v / max);
}
