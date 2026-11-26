import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchInterventionError, simulateMatch } from '../game/match-engine/engine.ts';
import type { Intervention, MatchOutcome, TeamSheet } from '../game/match-engine/types.ts';
import { decodeTrack, framesByTick, sceneAt, type TrackFrame } from '../game/match-engine/v2/track.ts';
import { rolesFor } from '../game/match-engine/playerRoles.ts';
import { BALANCED, midClubs, sheetOf } from './fixtures.ts';

const mid = midClubs();
const H: TeamSheet = sheetOf(mid[0]!), A: TeamSheet = sheetOf(mid[3]!);
const play = (seed: string, extra: { interventions?: Intervention[]; track?: boolean } = {}): MatchOutcome =>
  simulateMatch(H, A, { seed, engine: 'v2', timeline: true, ...extra });
/** eventos até o fim do minuto registrado `tick - 1` (o que já tinha acontecido antes da decisão) */
const before = (o: MatchOutcome, tick: number) => o.events.slice(0, o.timeline![tick - 1]!.ev);

test('v2: mesma semente e mesmas decisões = mesma partida; gravar o trajeto não muda nada', () => {
  const ivs: Intervention[] = [{ tick: 50, kind: 'tactics', team: 0, settings: { ...BALANCED, mentality: 'attacking', pressing: 5 } }];
  const a = play('v2-det', { interventions: ivs, track: true }), b = play('v2-det', { interventions: ivs, track: true });
  assert.deepEqual(a, b);
  const c = play('v2-det', { interventions: ivs });
  assert.equal(c.track, null);
  assert.deepEqual({ ...a, track: null }, c);
  assert.equal(a.engine, 'v2');
});

test('v2: o trajeto decodifica com um quadro por ação, dentro do campo e na ordem do relógio', () => {
  const o = play('v2-track', { track: true });
  const t = o.track!;
  const frames = decodeTrack(t);
  assert.equal(frames.length, t.frames);
  assert.ok(frames.length > 600, `poucos quadros: ${frames.length}`);
  const by = framesByTick(frames);
  assert.equal(Math.max(...by.keys()) + 1, o.timeline!.length, 'o último minuto do trajeto é o último da linha do tempo');
  assert.ok(t.ids[0].length >= 11 && t.ids[1].length >= 11);
  let last = -1;
  for (const f of frames) {
    assert.ok(f.tick >= last, 'minutos fora de ordem'); last = f.tick;
    assert.ok(f.sec >= 0 && f.sec < 64, `segundo fora do minuto: ${f.sec}`);
    assert.ok(f.ball.x >= 0 && f.ball.x <= 105 && f.ball.y >= 0 && f.ball.y <= 68, 'bola fora do campo');
    for (const side of [0, 1] as const) {
      const on = f.pos[side].filter((p) => p);
      assert.ok(on.length >= 7 && on.length <= 11, `jogadores em campo: ${on.length}`);
      for (const p of on) assert.ok(p!.x >= 0 && p!.x <= 105 && p!.y >= 0 && p!.y <= 68, 'jogador fora do campo');
      f.pos[side].forEach((p, i) => { if (p) assert.ok(t.ids[side][i], 'posição sem jogador'); });
    }
    if (f.poss !== null) assert.ok(f.holder !== null && f.pos[f.poss][f.holder], 'quem tem a bola está em campo');
  }
  for (const list of by.values()) for (let i = 1; i < list.length; i++) assert.ok(list[i]!.sec >= list[i - 1]!.sec, 'segundos fora de ordem');
  // há quadros de gol quando houve gol
  if (o.homeGoals + o.awayGoals > 0) assert.ok(frames.some((f) => f.kind === 'goal'));
});

test('v2: a cena interpola entre dois quadros e para no último', () => {
  const mk = (sec: number, x: number): TrackFrame => ({ tick: 0, sec, kind: 'pass', poss: 0, holder: 0, ball: { x, y: 10 }, pos: [[{ x, y: 20 }], [null]] });
  const fr = [mk(10, 20), mk(20, 40)];
  assert.equal(sceneAt(fr, null, 15)!.ball.x, 30);
  assert.equal(sceneAt(fr, null, 15)!.pos[0][0]!.x, 30);
  assert.equal(sceneAt(fr, null, 15)!.current, fr[0]);
  assert.equal(sceneAt(fr, null, 50)!.ball.x, 40);
  assert.equal(sceneAt(fr, mk(55, 0), 5)!.ball.x, 10, 'parte do último quadro do minuto anterior');
  assert.equal(sceneAt([], null, 5), null);
  // quem sai de campo some (não fica parado na última posição)
  const out = [mk(10, 20), { ...mk(20, 40), pos: [[null], [null]] as TrackFrame['pos'] }];
  assert.equal(sceneAt(out, null, 15)!.pos[0][0], null);
});

test('v2: mudança de tática vale a partir do minuto escolhido (antes dele o jogo é idêntico) e vira evento', () => {
  const tick = 40;
  const base = play('v2-tac');
  const changed = play('v2-tac', { interventions: [{ tick, kind: 'tactics', team: 0, settings: { ...BALANCED, mentality: 'attacking', tempo: 5, pressing: 5, defensiveLine: 5 } }] });
  assert.deepEqual(before(changed, tick), before(base, tick));
  const ev = changed.events.find((e) => e.type === 'tactics_change' && e.team === 0 && e.detail === 'coach');
  assert.ok(ev, 'evento da mudança');
  assert.equal(ev.i, changed.timeline![tick - 1]!.ev, 'o evento é o primeiro do minuto da decisão');
  assert.notDeepEqual(changed.events.slice(ev.i + 1), base.events.slice(ev.i), 'depois da decisão o jogo muda');
  assert.throws(() => play('v2-tac', { interventions: [{ tick, kind: 'tactics', team: 0, settings: { ...BALANCED, tempo: 9 } }] }), MatchInterventionError);
});

test('v2: troca de função vale a partir do minuto escolhido; função que não serve para a posição é recusada', () => {
  const tick = 30;
  const base = play('v2-role');
  const cm = H.lineup.find((l) => l.slot !== 'GK' && rolesFor(l.slot).length > 1)!;
  const current = base.players.find((p) => p.id === cm.player.id)!.role;
  const other = rolesFor(cm.slot).find((r) => r.id !== current)!;
  const o = play('v2-role', { interventions: [{ tick, kind: 'role', team: 0, playerId: cm.player.id, role: other.id }] });
  assert.deepEqual(before(o, tick), before(base, tick));
  assert.ok(o.events.some((e) => e.type === 'role_change' && e.player === cm.player.id && e.detail === other.id));
  assert.equal(o.players.find((p) => p.id === cm.player.id)!.role, other.id);
  const gkRole = rolesFor('GK')[0]!.id;
  assert.throws(() => play('v2-role', { interventions: [{ tick, kind: 'role', team: 0, playerId: cm.player.id, role: gkRole }] }), MatchInterventionError);
  assert.throws(() => play('v2-role', { interventions: [{ tick, kind: 'role', team: 0, playerId: 'ninguem', role: other.id }] }), MatchInterventionError);
});

test('v2: mudança de formação reposiciona o time a partir do minuto escolhido', () => {
  const tick = 55;
  const target = H.formation === '3-5-2' ? '4-4-2' : '3-5-2';
  const base = play('v2-form');
  const o = play('v2-form', { interventions: [{ tick, kind: 'formation', team: 0, formation: target }] });
  assert.deepEqual(before(o, tick), before(base, tick));
  const ev = o.events.find((e) => e.type === 'formation_change' && e.team === 0);
  assert.ok(ev && ev.detail?.endsWith(`>${target}`), `evento: ${ev?.detail}`);
  assert.equal(ev.moves?.length, 11);
  assert.equal(ev.moves!.filter((m) => m.slot === 'CB').length, 3, 'três zagueiros no 3-5-2');
  assert.throws(() => play('v2-form', { interventions: [{ tick, kind: 'formation', team: 0, formation: '9-9-9' }] }), MatchInterventionError);
});

test('v2: o técnico da IA reage ao placar no fim (perdendo, vai para o ataque) e isso aparece no relatório', () => {
  let found = 0;
  for (let i = 0; i < 40 && found < 3; i++) {
    const o = play(`v2-ai-${i}`);
    for (const e of o.events.filter((x) => x.type === 'tactics_change' && x.detail === 'ai')) {
      assert.ok(e.minute >= 75, `mudança cedo demais: ${e.minute}'`);
      const score = o.events.filter((g) => g.type === 'goal' && g.i < e.i);
      const own = score.filter((g) => g.team === e.team).length, opp = score.length - own;
      if (e.tactics?.mentality === 'attacking') { assert.ok(own < opp, 'só ataca quando está perdendo'); found++; }
    }
  }
  assert.ok(found > 0, 'nenhuma reação da IA em 40 jogos');
});

test('v2: cada quadro do trajeto sai na hora em que as posições valem (ninguém corre mais rápido que um jogador entre dois quadros)', () => {
  // até a v0.11.0 o quadro levava a hora do início do lance com as posições do fim: na tela, saltos acima da velocidade de um jogador

  let n = 0, fast = 0;
  for (let g = 0; g < 4; g++) {
    const o = simulateMatch(sheetOf(mid[g % mid.length]!), sheetOf(mid[(g + 3) % mid.length]!), { seed: `spd-${g}`, engine: 'v2', track: true });
    const f = decodeTrack(o.track!);
    for (let i = 1; i < f.length; i++) {
      const a = f[i - 1]!, b = f[i]!, dt = b.sec - a.sec;
      if (a.tick !== b.tick || dt <= 0 || b.kind === 'restart' || a.kind === 'goal') continue;
      for (const t of [0, 1] as const) b.pos[t].forEach((p, k) => { const q = a.pos[t][k]; if (p && q) { n++; if (Math.hypot(p.x - q.x, p.y - q.y) / dt > 9.5) fast++; } });
    }
  }
  assert.ok(n > 10000);
  assert.ok(fast / n < 0.001, `${(100 * fast / n).toFixed(2)}% dos deslocamentos acima de 9,5 m/s`);
});

test('v2: na tela, o jogador anda em curva suave pelos quadros (passa por eles; entre eles segue os vizinhos)', () => {
  const mk = (sec: number, x: number, y: number): TrackFrame => ({ tick: 0, sec, kind: 'pass', poss: 0, holder: 0, ball: { x, y }, pos: [[{ x, y }], [null]] });
  const fr = [mk(0, 10, 10), mk(10, 20, 10), mk(20, 20, 20), mk(30, 30, 20)];
  assert.deepEqual(sceneAt(fr, null, 10)!.pos[0][0], { x: 20, y: 10 }, 'passa pelo quadro');
  const m = sceneAt(fr, null, 12.5)!;
  assert.equal(m.ball.x, 20, 'a bola vai em linha reta');
  assert.ok(m.pos[0][0]!.x > 20, `a curva segue o caminho (entra na curva): x ${m.pos[0][0]!.x}`);
});
