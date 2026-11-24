/**
 * Geometria do motor v2 (puro, sem sorteio). Campo de 105 × 68 m. Coordenadas absolutas: x ao longo do campo no sentido do mandante
 * (0 = gol do mandante, 105 = gol do visitante), y na largura (0 = esquerda de quem ataca com o mandante). "Profundidade" é a distância
 * do próprio gol no sentido de ataque de cada time (0 = próprio gol, 105 = gol adversário).
 */
export const L = 105;
export const W = 68;
export const MID_Y = W / 2;
/** meia largura do gol (7,32 m) */
export const GOAL_HALF = 3.66;

export interface P { x: number; y: number }
export type Side = 0 | 1;

export const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** (Math.sqrt em vez de Math.hypot: bem mais rápido no V8, e o motor chama isto milhões de vezes) */
export const dist = (a: P, b: P): number => { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); };
/** profundidade (no sentido de ataque do time) de um x absoluto */
export const depthOf = (team: Side, x: number): number => (team === 0 ? x : L - x);
/** x absoluto de uma profundidade do time */
export const xOf = (team: Side, depth: number): number => (team === 0 ? depth : L - depth);
export const oppGoal = (team: Side): P => ({ x: team === 0 ? L : 0, y: MID_Y });
export const ownGoal = (team: Side): P => ({ x: team === 0 ? 0 : L, y: MID_Y });

/** ângulo de abertura do gol adversário visto do ponto (radianos) */
export function goalAngle(team: Side, p: P): number {
  const dx = Math.max(0.3, Math.abs((team === 0 ? L : 0) - p.x));
  return Math.abs(Math.atan2(MID_Y + GOAL_HALF - p.y, dx) - Math.atan2(MID_Y - GOAL_HALF - p.y, dx));
}

/**
 * Gol esperado de uma finalização pela posição (distância e ângulo), antes de pressão e qualidade de quem chuta. Logística com os
 * números de referência de modelos públicos: pênalti em jogada ~0,25; pequena área central ~0,5; 25 m central ~0,05; ângulo fechado ~0,03.
 */
export function xgAt(team: Side, p: P, header: boolean): number {
  const d = dist(p, oppGoal(team));
  const z = -1.05 + 1.45 * goalAngle(team, p) - 0.095 * d;
  const xg = 1 / (1 + Math.exp(-z));
  return clampN(header ? xg * 0.6 : xg, 0.01, 0.8);
}

/**
 * Ameaça de ter a bola no ponto (valor da posição para a escolha das ações): cresce com a profundidade e dispara perto do gol.
 * Perto da área vale metade do xG do lugar: quem recebe ali ainda precisa dominar e finalizar sob pressão.
 */
export function threat(team: Side, p: P): number {
  const d = depthOf(team, p.x);
  const base = 0.006 + 0.03 * Math.pow(d / L, 2);
  return d > 70 ? Math.max(base, xgAt(team, p, false) * 0.5) : base;
}

/** distância do ponto `p` ao segmento a→b e a fração do caminho (0 = em a, 1 = em b) do ponto mais próximo */
export function segDist(p: P, a: P, b: P): { d: number; t: number } {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? clampN(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1) : 0;
  const ex = a.x + vx * t - p.x, ey = a.y + vy * t - p.y;
  return { d: Math.sqrt(ex * ex + ey * ey), t };
}

/** dentro da grande área adversária */
export const inBox = (team: Side, p: P): boolean => depthOf(team, p.x) > L - 16.5 && Math.abs(p.y - MID_Y) < 20.16;
export const onPitch = (p: P): P => ({ x: clampN(p.x, 0.5, L - 0.5), y: clampN(p.y, 0.5, W - 0.5) });

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** base64 de bytes (puro: o motor não usa Buffer) */
export function toBase64(bytes: ArrayLike<number>, n = bytes.length): string {
  let out = '';
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i]! & 255, b = i + 1 < n ? bytes[i + 1]! & 255 : 0, c = i + 2 < n ? bytes[i + 2]! & 255 : 0;
    const v = (a << 16) | (b << 8) | c;
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + (i + 1 < n ? B64[(v >> 6) & 63]! : '=') + (i + 2 < n ? B64[v & 63]! : '=');
  }
  return out;
}
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1] ?? 'A') << 12) | (B64.indexOf(clean[i + 2] ?? 'A') << 6) | B64.indexOf(clean[i + 3] ?? 'A');
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}
