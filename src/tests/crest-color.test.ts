import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, crestColors, MIN_GRAPHIC, MIN_TEXT, NEUTRAL_PALETTE, NIGHT_BG, paletteFromHues } from '../shared/crestColor.ts';

type Px = [number, number, number, number];
/** Imagem 10×10 com faixas: cada entrada é [cor RGBA, quantos pixels]. */
function img(parts: Array<[Px, number]>, order: 'rgba' | 'bgra' = 'rgba'): Uint8Array {
  const out: number[] = [];
  for (const [[r, g, b, a], k] of parts) for (let i = 0; i < k; i++) out.push(...(order === 'rgba' ? [r, g, b, a] : [b, g, r, a]));
  while (out.length < 400) out.push(0, 0, 0, 0);
  return Uint8Array.from(out);
}
const hue = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return -1;
  const x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
};
const near = (h: number, target: number, tol = 20) => Math.min(Math.abs(h - target), 360 - Math.abs(h - target)) <= tol;
const WHITE: Px = [255, 255, 255, 255], BLACK: Px = [0, 0, 0, 255], RED: Px = [200, 20, 30, 255], BLUE: Px = [20, 40, 160, 255], YELLOW: Px = [240, 200, 20, 255], GRAY: Px = [128, 128, 128, 255];

test('Cores do escudo: vermelho e branco → primária vermelha; branco ignorado; contraste mínimo contra o fundo noturno', () => {
  const p = crestColors(img([[WHITE, 55], [RED, 30], [BLACK, 5]]), 10, 10);
  assert.equal(p.neutral, false);
  assert.ok(near(hue(p.primary), 356), p.primary);
  assert.ok(contrast(p.primary, NIGHT_BG) >= MIN_GRAPHIC, `primária ${p.primary}`);
  assert.ok(contrast(p.secondary, NIGHT_BG) >= MIN_GRAPHIC, `secundária ${p.secondary}`);
  assert.ok(contrast(p.text, NIGHT_BG) >= MIN_TEXT, `texto ${p.text}`);
  assert.ok(contrast(p.ink, p.primary) >= 3, `tinta ${p.ink} sobre ${p.primary}`);
  // tema claro: a mesma matiz, escurecida contra o branco
  assert.ok(contrast(p.light.primary, '#ffffff') >= MIN_GRAPHIC && contrast(p.light.text, '#ffffff') >= MIN_TEXT, JSON.stringify(p.light));
  assert.ok(near(hue(p.light.primary), 356), p.light.primary);
});

test('Cores do escudo: azul escuro é clareado até o contraste mínimo, sem mudar a matiz', () => {
  const p = crestColors(img([[[10, 20, 90, 255], 60]]), 10, 10);
  assert.ok(contrast(p.primary, NIGHT_BG) >= MIN_GRAPHIC);
  assert.ok(near(hue(p.primary), hue('#0a145a'), 6), `${p.primary}`);
});

test('Cores do escudo: transparente não conta (escudo pequeno numa imagem quase vazia ainda dá a cor dele)', () => {
  const p = crestColors(img([[BLUE, 12], [[255, 0, 0, 40], 80]]), 10, 10);
  assert.ok(near(hue(p.primary), hue('#1428a0')), p.primary);
});

test('Cores do escudo: só preto, branco e cinza → paleta neutra; imagem vazia → neutra', () => {
  assert.deepEqual(crestColors(img([[WHITE, 40], [BLACK, 40], [GRAY, 20]]), 10, 10), NEUTRAL_PALETTE);
  assert.deepEqual(crestColors(img([]), 10, 10), NEUTRAL_PALETTE);
  assert.equal(NEUTRAL_PALETTE.neutral, true);
  assert.ok(contrast(NEUTRAL_PALETTE.primary, NIGHT_BG) >= MIN_GRAPHIC);
});

test('Cores do escudo: secundária é outra matiz quando ela tem presença; ordem BGRA do Electron dá o mesmo resultado', () => {
  const parts: Array<[Px, number]> = [[BLUE, 50], [YELLOW, 30], [WHITE, 20]];
  const p = crestColors(img(parts), 10, 10);
  assert.ok(near(hue(p.primary), hue('#1428a0')), p.primary);
  assert.ok(near(hue(p.secondary), hue('#f0c814')), p.secondary);
  assert.deepEqual(crestColors(img(parts, 'bgra'), 10, 10, 'bgra'), p);
  // sem segunda matiz relevante: secundária = primária mais escura (mesma matiz)
  const mono = crestColors(img([[RED, 60], [BLUE, 3]]), 10, 10);
  assert.ok(near(hue(mono.secondary), hue(mono.primary), 8), `${mono.primary} / ${mono.secondary}`);
});

test('Cores do escudo: determinístico; clubes sem escudo usam as matizes do escudo gerado com o mesmo contraste', () => {
  const a = img([[RED, 30], [BLUE, 30]]);
  assert.deepEqual(crestColors(a, 10, 10), crestColors(a, 10, 10));
  for (let h = 0; h < 360; h += 15) {
    const p = paletteFromHues(h, (h + 90) % 360);
    assert.ok(contrast(p.primary, NIGHT_BG) >= MIN_GRAPHIC && contrast(p.text, NIGHT_BG) >= MIN_TEXT, `matiz ${h}: ${p.primary}`);
  }
});
