import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleMotion } from '../game/match-engine/roleMotion.ts';
import { ROLES, roleById } from '../game/match-engine/playerRoles.ts';
import type { Position } from '../shared/types.ts';

const m = (id: string, pos: Position) => roleMotion(roleById(id)!, pos);
const inField = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;

test('Campinho das funções: toda função em cada posição tem um ciclo válido (começa e termina na base, dentro do campo, com texto)', () => {
  for (const r of ROLES) for (const pos of r.positions) {
    const x = roleMotion(r, pos);
    const f = x.player;
    assert.deepEqual([f[0]!.t, f.at(-1)!.t], [0, 1], r.id);
    assert.ok(f.every((p, i) => i === 0 || p.t > f[i - 1]!.t), `${r.id}: tempos crescentes`);
    assert.deepEqual([f[0]!.x, f[0]!.y], [x.base.x, x.base.y]); assert.deepEqual([f.at(-1)!.x, f.at(-1)!.y], [x.base.x, x.base.y]);
    assert.ok(f.every(inField), `${r.id}: dentro do campo`);
    if (x.ball) { assert.ok(inField(x.ball.from) && inField(x.ball.to)); assert.ok(x.ball.t0 > 0 && x.ball.t1 > x.ball.t0 && x.ball.t1 < 1); }
    assert.ok(x.tags.length > 0, `${r.id}: descreve o que mostra`);
  }
  assert.deepEqual(roleMotion(roleById('fb_completo')!, 'LB'), roleMotion(roleById('fb_completo')!, 'LB'), 'determinístico');
});

test('Campinho das funções: o desenho segue os efeitos da função no motor', () => {
  const far = (id: string, pos: Position) => Math.max(...m(id, pos).player.map((p) => p.x));
  // lateral ofensivo vai mais longe que o completo, que vai mais longe que o defensivo; e cruza da linha de fundo
  assert.ok(far('fb_ofensivo', 'LB') > far('fb_completo', 'LB') && far('fb_completo', 'LB') > far('fb_defensivo', 'LB'));
  const fo = m('fb_ofensivo', 'LB');
  assert.ok(fo.player.some((p) => p.y <= 6) && fo.ball?.air, 'vai à linha de fundo e cruza pelo alto');
  assert.equal(fo.zone?.kind, 'risk'); assert.equal(m('fb_defensivo', 'LB').zone?.kind, 'cover'); assert.equal(m('fb_completo', 'LB').zone, null);
  // lado direito espelha o esquerdo
  assert.ok(m('fb_ofensivo', 'RB').player.some((p) => p.y >= 94));
  // falso 9 recua; atacante de profundidade corre nas costas; goleiro líbero sai da área; ponta invertido corta para dentro e finaliza
  const f9 = m('ss_falso9', 'SS'); assert.ok(f9.player[1]!.x < f9.base.x);
  assert.ok(far('ss_profundidade', 'SS') >= 86);
  assert.ok(far('gk_libero', 'GK') > far('gk_tradicional', 'GK'));
  const inv = m('w_invertido', 'LW'); assert.ok(inv.ball && inv.ball.to.x === 98 && inv.player[2]!.y > inv.base.y);
  assert.ok(m('dm_construtor', 'DM').ball, 'construtor distribui');
});
