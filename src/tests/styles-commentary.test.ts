import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { commentate } from '../game/match-engine/commentary.ts';
import type { ChanceType, MatchEvent } from '../game/match-engine/types.ts';

test('CSS: nenhuma classe simples é definida duas vezes (colisão silenciosa já cortou os cabeçalhos do painel)', () => {
  const css = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');
  const seen = new Map<string, number>();
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const sel = m[1]!.trim();
    if (/^\.[a-zA-Z][\w-]*$/.test(sel)) seen.set(sel, (seen.get(sel) ?? 0) + 1);
  }
  const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dups, [], `classes duplicadas: ${dups.join(', ')}`);
});

const ctx = { teamNames: ['Casa FC', 'Fora FC'] as [string, string], playerName: (id?: string) => (id === 'a' ? 'Ana Autora' : id === 'b' ? 'Beto Passe' : 'Jogador') };
const goal = (i: number, chance: ChanceType): MatchEvent => ({ i, minute: 10 + i, label: `${10 + i}'`, type: 'goal', team: 0, player: 'a', player2: 'b', chance, outcome: 'goal', xg: 0.1 });

test('Comentários: gol sempre começa a frase com maiúscula, cita autor e placar, e as frases variam', () => {
  const chances: ChanceType[] = ['buildup', 'counter', 'cross', 'long', 'corner', 'freekick', 'penalty'];
  for (const c of chances) {
    const phrases = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const line = commentate([goal(i, c)], ctx)[0]!;
      assert.match(line.text, /^GOOOL do Casa FC! [A-ZÀ-Ú]/, line.text);
      assert.ok(line.text.includes('Ana Autora') && line.text.includes('1 x 0'));
      phrases.add(line.text.split('! ')[1]!.split('.')[0]!.replace('Ana Autora', '{x}'));
    }
    assert.ok(phrases.size >= 3, `${c}: só ${phrases.size} variações`);
  }
});

test('Comentários: placar corrente acumula corretamente e há um comentário por evento', () => {
  const events: MatchEvent[] = [goal(0, 'buildup'), { ...goal(1, 'cross'), team: 1 }, goal(2, 'long'),
    { i: 3, minute: 90, label: "90+2'", type: 'period_end', team: 0, detail: 'fulltime' }];
  const lines = commentate(events, ctx);
  assert.equal(lines.length, events.length);
  assert.ok(lines[0]!.text.includes('Casa FC 1 x 0 Fora FC') && lines[1]!.text.includes('1 x 1') && lines[2]!.text.includes('2 x 1'));
  assert.ok(lines[3]!.text.includes('Fim de jogo. Casa FC 2 x 1 Fora FC'));
});
