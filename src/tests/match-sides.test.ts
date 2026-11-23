import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_FALLBACK, colorsClash, contrast, matchSides, NEUTRAL_PALETTE, paletteFromHues } from '../shared/crestColor.ts';

// paletas de escudos gerados (matiz principal, matiz secundária)
const RED_WHITE = paletteFromHues(0, 0);      // vermelho com secundária vermelha
const RED_BLUE = paletteFromHues(355, 220);   // vermelho com secundária azul
const BLUE = paletteFromHues(220, 220);
const GREEN = paletteFromHues(130, 50);

test('Partida: times de cores diferentes jogam com as primárias', () => {
  const [h, a] = matchSides(RED_WHITE, BLUE);
  assert.equal(h.color, RED_WHITE.primary);
  assert.equal(a.color, BLUE.primary);
});

test('Partida: visitante da mesma cor troca para a secundária; sem secundária diferente, para a prata', () => {
  const [, a1] = matchSides(RED_WHITE, RED_BLUE);
  assert.equal(a1.color, RED_BLUE.secondary, 'vermelho × vermelho com azul → visitante de azul');
  const [, a2] = matchSides(RED_BLUE, RED_WHITE);
  assert.equal(a2.color, NEUTRAL_PALETTE.primary, 'vermelho × vermelho (secundária vermelha) → visitante de prata');
});

test('Partida: dois escudos sem cor → visitante de grafite (brilho diferente); se ainda confundir, âmbar', () => {
  const [h, a] = matchSides(NEUTRAL_PALETTE, NEUTRAL_PALETTE);
  assert.equal(h.color, NEUTRAL_PALETTE.primary);
  assert.equal(a.color, NEUTRAL_PALETTE.secondary, 'prata × prata → grafite');
  const silverOnly = { ...NEUTRAL_PALETTE, secondary: NEUTRAL_PALETTE.primary };
  const [, b] = matchSides(silverOnly, silverOnly);
  assert.equal(b.color, AWAY_FALLBACK[0], 'sem grafite → âmbar');
});

test('Partida: as duas cores nunca se confundem e o texto sobre elas tem contraste', () => {
  const all = [RED_WHITE, RED_BLUE, BLUE, GREEN, NEUTRAL_PALETTE, ...Array.from({ length: 24 }, (_, i) => paletteFromHues(i * 15, (i * 15 + 30) % 360))];
  for (const x of all) for (const y of all) {
    const [h, a] = matchSides(x, y);
    assert.equal(colorsClash(h.color, a.color), false, `${h.color} × ${a.color}`);
    assert.ok(contrast(h.ink, h.color) >= 3, `tinta ${h.ink} sobre ${h.color}`);
    assert.ok(contrast(a.ink, a.color) >= 3, `tinta ${a.ink} sobre ${a.color}`);
  }
});

test('Partida: cinza só se confunde com cinza de brilho parecido', () => {
  assert.equal(colorsClash('#c3ccd9', '#e53935'), false);
  assert.equal(colorsClash('#c3ccd9', '#8ec5ff'), false, 'prata × azul-claro de brilho parecido: cor e cinza nunca se confundem');
  assert.equal(colorsClash('#c3ccd9', '#b8c0cc'), true);
  assert.equal(colorsClash('#c3ccd9', '#3a3f47'), false);
});
