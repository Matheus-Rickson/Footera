import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../game/match-engine/engine.ts';
import type { MatchOutcome, TeamSheet } from '../game/match-engine/types.ts';
import { BALANCED, calibWorld, midClubs, sheetOf } from './fixtures.ts';

const mid = midClubs();
const pairOf = (i: number): [string, string] => { const a = mid[i % mid.length]!; let b = mid[(i * 3 + 1) % mid.length]!; if (a === b) b = mid[(i + 1) % mid.length]!; return [a, b]; };
const sheets = new Map<string, TeamSheet>();
const sheet = (id: string) => sheets.get(id) ?? (sheets.set(id, sheetOf(id)), sheets.get(id)!);
const play = (i: number, opts: { knockout?: boolean; seed?: string } = {}): MatchOutcome => {
  const [a, b] = pairOf(i);
  return simulateMatch(sheet(a), sheet(b), { seed: opts.seed ?? `t-${i}`, knockout: opts.knockout });
};
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

test('Motor: determinístico por semente e sensível a ela', () => {
  assert.deepEqual(play(1, { seed: 'a' }), play(1, { seed: 'a' }));
  const results = new Set(Array.from({ length: 12 }, (_, k) => JSON.stringify(play(1, { seed: `s${k}` }).events.map((e) => e.type + e.minute))));
  assert.ok(results.size > 8, 'sementes diferentes devem gerar partidas diferentes');
});

test('Motor (invariantes): placar, estatísticas, linha do tempo, cartões e substituições são coerentes em 150 partidas', () => {
  for (let i = 0; i < 150; i++) {
    const r = play(i, { knockout: i % 3 === 0 });
    const ev = r.events;
    ev.forEach((e, k) => assert.equal(e.i, k, 'índices sequenciais'));
    for (let k = 1; k < ev.length; k++) assert.ok(ev[k]!.minute >= ev[k - 1]!.minute, `partida ${i}: minutos fora de ordem`);
    const goals = (t: 0 | 1) => ev.filter((e) => e.type === 'goal' && e.team === t).length;
    assert.equal(r.homeGoals, goals(0)); assert.equal(r.awayGoals, goals(1));
    assert.equal(r.players.filter((p) => p.team === 0).reduce((s, p) => s + p.goals, 0), r.homeGoals);
    for (const t of [0, 1] as const) {
      const s = r.stats[t], o = r.stats[1 - t as 0 | 1];
      const shotEv = ev.filter((e) => (e.type === 'shot' || e.type === 'goal') && e.team === t);
      assert.equal(s.shots, shotEv.length, 'finalizações = eventos de finalização');
      assert.ok(s.shotsOnTarget >= goals(t));
      assert.equal(o.saves, shotEv.filter((e) => e.outcome === 'saved').length, 'defesas do adversário = chutes defendidos');
      assert.ok(s.shotsOnTarget <= s.shots && s.passesCompleted <= s.passes);
      assert.equal(s.yellowCards, ev.filter((e) => e.type === 'yellow_card' && e.team === t).length);
      assert.equal(s.redCards, ev.filter((e) => e.type === 'red_card' && e.team === t).length);
      assert.equal(s.corners, ev.filter((e) => e.type === 'corner' && e.team === t).length);
      assert.equal(s.fouls, ev.filter((e) => e.type === 'foul' && e.team === t).length);
      assert.ok(ev.filter((e) => e.type === 'substitution' && e.team === t).length <= 5, 'no máximo 5 substituições');
      assert.equal(r.players.filter((p) => p.team === t && p.starter).length, 11);
      assert.ok(Math.abs(s.xg - r.players.filter((p) => p.team === t).reduce((a, p) => a + p.xg, 0)) < 1e-6);
    }
    assert.ok(Math.abs(r.stats[0].possession + r.stats[1].possession - 100) < 0.25);

    // quem sai de campo não volta a agir; quem entra só age depois de entrar; nunca menos de 7 em campo
    const gone = new Map<string, number>(), entered = new Map<string, number>();
    const onPitch = [11, 11];
    ev.forEach((e, k) => {
      if (e.type === 'substitution') { gone.set(e.player2!, k); entered.set(e.player!, k); }
      if (e.type === 'red_card') { assert.ok(!gone.has(e.player!)); gone.set(e.player!, k); onPitch[e.team]!--; assert.ok(onPitch[e.team]! >= 7, 'abaixo de 7 jogadores'); }
      if (e.type === 'injury' && !ev.some((x, j) => j > k && j <= k + 1 && x.type === 'substitution' && x.player2 === e.player)) { gone.set(e.player!, k); onPitch[e.team]!--; }
    });
    const starters = new Set(r.players.filter((p) => p.starter).map((p) => p.id));
    ev.forEach((e, k) => {
      if (!['goal', 'shot', 'foul', 'offside'].includes(e.type) || !e.player) return;
      const outAt = gone.get(e.player);
      assert.ok(outAt === undefined || outAt > k, `partida ${i}: ${e.type} de jogador já fora (evento ${k})`);
      assert.ok(starters.has(e.player) || (entered.get(e.player) ?? Infinity) < k, 'jogador agiu antes de entrar');
    });
    const yellows = new Map<string, number>();
    for (const e of ev) {
      if (e.type === 'yellow_card') yellows.set(e.player!, (yellows.get(e.player!) ?? 0) + 1);
      if (e.type === 'red_card' && e.detail === 'second_yellow') assert.equal(yellows.get(e.player!), 2, 'segundo amarelo precisa de dois amarelos');
    }
    for (const n of yellows.values()) assert.ok(n <= 2);
    for (const p of r.players) { assert.ok(p.rating >= 3 && p.rating <= 10); assert.ok(p.minutes >= 0 && p.minutes <= 120); }
    const ends = ev.filter((e) => e.type === 'period_end').map((e) => e.detail);
    assert.deepEqual(ends.slice(0, 2), ['halftime', 'fulltime']);
    if (r.decidedIn === 'regular') assert.equal(ends.length, 2);
  }
});

test('Motor: prorrogação e pênaltis só em mata-mata, com vencedor definido e contagem consistente', () => {
  let et = 0, pens = 0, regularDraws = 0;
  for (let i = 0; i < 260; i++) {
    const r = play(i, { knockout: true, seed: `ko-${i}` });
    assert.notEqual(r.winner, null);
    if (r.decidedIn === 'regular') { assert.notEqual(r.homeGoals, r.awayGoals); assert.equal(r.shootout, null); continue; }
    et++;
    assert.ok(r.events.some((e) => e.minute > 90), 'prorrogação tem eventos após os 90 minutos');
    assert.deepEqual(r.events.filter((e) => e.type === 'period_end').map((e) => e.detail).slice(2), r.decidedIn === 'penalties' || r.decidedIn === 'extra_time' ? ['extra1', 'extra2'] : []);
    if (r.decidedIn === 'extra_time') { assert.notEqual(r.homeGoals, r.awayGoals); assert.equal(r.shootout, null); }
    else {
      pens++; regularDraws++;
      assert.equal(r.homeGoals, r.awayGoals);
      const kicks = r.events.filter((e) => e.type === 'shootout_kick');
      assert.equal(kicks.filter((e) => e.team === 0 && e.scored).length, r.shootout!.home);
      assert.equal(kicks.filter((e) => e.team === 1 && e.scored).length, r.shootout!.away);
      assert.notEqual(r.shootout!.home, r.shootout!.away);
      assert.equal(r.winner, r.shootout!.home > r.shootout!.away ? 0 : 1);
      assert.ok(kicks.length >= 6 && kicks.length <= 120);
    }
  }
  assert.ok(et >= 10 && pens >= 3, `cobertura insuficiente: ET=${et} pênaltis=${pens}`);
  for (let i = 0; i < 40; i++) { const r = play(i, { seed: `liga-${i}` }); assert.equal(r.decidedIn, 'regular'); if (r.homeGoals === r.awayGoals) assert.equal(r.winner, null); }
});

test('Motor (calibração): médias de 500 partidas equilibradas ficam dentro de faixas realistas de futebol', () => {
  const runs = Array.from({ length: 500 }, (_, i) => play(i, { seed: `cal-${i}` }));
  const per = (f: (r: MatchOutcome) => number) => mean(runs.map(f));
  const team = (f: (s: MatchOutcome['stats'][0]) => number) => per((r) => (f(r.stats[0]) + f(r.stats[1])) / 2);
  const inRange = (name: string, v: number, lo: number, hi: number) => assert.ok(v >= lo && v <= hi, `${name} = ${v.toFixed(2)} fora de [${lo}, ${hi}]`);
  inRange('gols/jogo', per((r) => r.homeGoals + r.awayGoals), 2.3, 3.3);
  inRange('mandante vence', 100 * mean(runs.map((r) => (r.homeGoals > r.awayGoals ? 1 : 0))), 38, 52);
  inRange('empate', 100 * mean(runs.map((r) => (r.homeGoals === r.awayGoals ? 1 : 0))), 20, 32);
  inRange('visitante vence', 100 * mean(runs.map((r) => (r.homeGoals < r.awayGoals ? 1 : 0))), 22, 36);
  inRange('finalizações/time', team((s) => s.shots), 10, 16);
  inRange('% no alvo', (100 * team((s) => s.shotsOnTarget)) / team((s) => s.shots), 28, 42);
  inRange('escanteios/time', team((s) => s.corners), 4, 7.5);
  inRange('faltas/time', team((s) => s.fouls), 9, 14.5);
  inRange('amarelos/jogo', per((r) => r.stats[0].yellowCards + r.stats[1].yellowCards), 2.5, 5);
  inRange('vermelhos/jogo', per((r) => r.stats[0].redCards + r.stats[1].redCards), 0.03, 0.3);
  inRange('impedimentos/time', team((s) => s.offsides), 1.2, 3.5);
  inRange('passes/time', team((s) => s.passes), 350, 520);
  inRange('precisão de passe', (100 * team((s) => s.passesCompleted)) / team((s) => s.passes), 76, 88);
  inRange('lesões/jogo', per((r) => r.events.filter((e) => e.type === 'injury').length), 0.05, 0.45);
  inRange('substituições/jogo', per((r) => r.events.filter((e) => e.type === 'substitution').length), 4, 10);
  inRange('posse do mandante', per((r) => r.stats[0].possession), 47, 58);
  inRange('pênaltis/jogo', per((r) => r.events.filter((e) => e.type === 'penalty_awarded').length), 0.15, 0.5);
  inRange('xG vs gols', per((r) => r.stats[0].xg + r.stats[1].xg) / per((r) => r.homeGoals + r.awayGoals), 0.85, 1.15);
  inRange('0x0 (%)', 100 * mean(runs.map((r) => (r.homeGoals + r.awayGoals === 0 ? 1 : 0))), 3, 11);
  const added = (tag: string) => per((r) => Number(String(r.events.find((e) => e.type === 'period_end' && e.detail === tag)!.label).split('+')[1]!.replace("'", '')));
  inRange('acréscimos 1º tempo', added('halftime'), 1.2, 3.2);
  inRange('acréscimos 2º tempo', added('fulltime'), 3, 5.5);
});

test('Motor (causal): desnível grande (6º da 1ª × 11º da 2ª) decide a maioria dos jogos, e um desnível pequeno decide menos', () => {
  const w = calibWorld();
  const byTier = (tier: number) => w.clubs.filter((c) => c.leagueId === w.leagues.find((l) => l.countryId === w.leagues[0]!.countryId && l.tier === tier)!.id).sort((a, b) => b.reputation - a.reputation);
  const t1 = byTier(1), t2 = byTier(2);
  const rate = (strongId: string, weakId: string) => {
    const strong = sheet(strongId), weak = sheet(weakId);
    let sw = 0, ww = 0;
    for (let i = 0; i < 200; i++) {
      const home = i % 2 === 0;
      const r = home ? simulateMatch(strong, weak, { seed: `sw-${i}` }) : simulateMatch(weak, strong, { seed: `sw-${i}` });
      const diff = home ? r.homeGoals - r.awayGoals : r.awayGoals - r.homeGoals;
      if (diff > 0) sw++; else if (diff < 0) ww++;
    }
    return { sw: sw / 200, ww: ww / 200 };
  };
  const big = rate(t1[5]!.id, t2[10]!.id), small = rate(t1[0]!.id, t1[t1.length - 1]!.id);
  assert.ok(big.sw > 0.7, `desnível grande: forte venceu ${(big.sw * 100).toFixed(0)}%`);
  assert.ok(big.ww > 0.005 && big.ww < 0.25, `zebra existe, mas é rara: ${(big.ww * 100).toFixed(1)}%`);
  assert.ok(big.sw > small.sw + 0.05, 'quanto maior o desnível, mais vitórias do favorito');
});

test('Motor (causal): mando de campo favorece o mandante (mesmo confronto em campo neutro rende menos saldo)', () => {
  const gd = (neutral: boolean) => mean(Array.from({ length: 400 }, (_, i) => {
    const [a, b] = pairOf(i); const r = simulateMatch(sheet(a), sheet(b), { seed: `home-${i}`, neutral }); return r.homeGoals - r.awayGoals;
  }));
  assert.ok(gd(false) - gd(true) > 0.12, `vantagem de mando insuficiente: ${(gd(false) - gd(true)).toFixed(3)}`);
});

test('Motor (causal): táticas alteram o jogo na direção esperada', () => {
  const [a, b] = [mid[0]!, mid[3]!];
  const run = (tA: Partial<typeof BALANCED>) => Array.from({ length: 300 }, (_, i) =>
    simulateMatch({ ...sheetOf(a, { ...BALANCED, ...tA }) }, sheet(b), { seed: `tac-${i}` }));
  const atk = run({ mentality: 'attacking' }), def = run({ mentality: 'defensive' });
  assert.ok(mean(atk.map((r) => r.stats[0].shots)) > mean(def.map((r) => r.stats[0].shots)) * 1.08, 'mentalidade ofensiva gera mais finalizações');
  assert.ok(mean(atk.map((r) => r.stats[1].shots)) > mean(def.map((r) => r.stats[1].shots)), 'mentalidade ofensiva cede mais finalizações');
  const hi = run({ pressing: 5 }), lo = run({ pressing: 1 });
  const accOpp = (rs: MatchOutcome[]) => mean(rs.map((r) => r.stats[1].passesCompleted / r.stats[1].passes));
  assert.ok(accOpp(lo) - accOpp(hi) > 0.015, 'pressão alta reduz a precisão de passe do adversário');
  const shortB = run({ buildUp: 'short' }), longB = run({ buildUp: 'long' });
  assert.ok(mean(shortB.map((r) => r.stats[0].passes)) > mean(longB.map((r) => r.stats[0].passes)) * 1.2, 'saída curta gera mais passes');
});

test('Motor (causal): improvisar jogador de linha no gol e jogar cansado pioram o resultado', () => {
  const [a, b] = [mid[1]!, mid[4]!];
  const base = sheet(a), opp = sheet(b);
  const swapped: TeamSheet = (() => {
    const gkIdx = base.lineup.findIndex((l) => l.slot === 'GK'), stIdx = base.lineup.findIndex((l) => l.slot === 'CF');
    const lineup = base.lineup.map((l) => ({ ...l }));
    lineup[gkIdx] = { ...lineup[gkIdx]!, player: base.lineup[stIdx]!.player };
    lineup[stIdx] = { ...lineup[stIdx]!, player: base.lineup[gkIdx]!.player };
    return { ...base, lineup };
  })();
  const conceded = (s: TeamSheet) => mean(Array.from({ length: 250 }, (_, i) => simulateMatch(s, opp, { seed: `fit-${i}` }).awayGoals));
  assert.ok(conceded(swapped) > conceded(base) + 0.5, 'atacante no gol e goleiro no ataque deveria custar caro');

  const tired: TeamSheet = { ...base, lineup: base.lineup.map((l) => ({ ...l, player: { ...l.player, condition: 50 } })) };
  const gd = (s: TeamSheet) => mean(Array.from({ length: 300 }, (_, i) => { const r = simulateMatch(s, opp, { seed: `tired-${i}` }); return r.homeGoals - r.awayGoals; }));
  assert.ok(gd(base) - gd(tired) > 0.2, 'time com 50% de condição física deve render menos');
});

test('Motor (causal): entrosamento alto ajuda e baixo atrapalha', () => {
  const [a, b] = [mid[2]!, mid[5]!];
  const gd = (c: number) => mean(Array.from({ length: 400 }, (_, i) => { const r = simulateMatch({ ...sheet(a), cohesion: c }, sheet(b), { seed: `coh-${i}` }); return r.homeGoals - r.awayGoals; }));
  assert.ok(gd(1.03) - gd(0.95) > 0.2, `entrosamento: ${(gd(1.03) - gd(0.95)).toFixed(3)}`);
});

test('Motor: desempenho — média abaixo de 40 ms por partida', () => {
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) play(i, { seed: `perf-${i}` });
  assert.ok((performance.now() - t0) / 60 < 40);
});

test('Linha do tempo: só observa (resultado idêntico), cobre cada minuto e termina igual ao relatório final', async () => {
  const { conditionAfter, rateReport } = await import('../game/match-engine/engine.ts');
  const { TICK_STATS } = await import('../game/match-engine/types.ts');
  for (let i = 0; i < 24; i++) {
    const [a, b] = pairOf(i), seed = `tl-${i}`, knockout = i % 3 === 0;
    const plain = simulateMatch(sheet(a), sheet(b), { seed, knockout });
    const live = simulateMatch(sheet(a), sheet(b), { seed, knockout, timeline: true });
    assert.equal(plain.timeline, null);
    assert.deepEqual({ ...live, timeline: null }, plain, 'registrar a linha do tempo não pode mudar nada');
    const tl = live.timeline!;
    const regular = live.decidedIn === 'regular' ? 90 : 120;
    assert.deepEqual([...new Set(tl.filter((t) => !t.label.includes('+')).map((t) => t.minute))], Array.from({ length: regular }, (_, k) => k + 1), 'um registro por minuto');
    for (let k = 1; k < tl.length; k++) {
      assert.ok(tl[k]!.ev >= tl[k - 1]!.ev);
      for (const s of [0, 1] as const) tl[k]!.s[s].forEach((v, j) => assert.ok(v >= tl[k - 1]!.s[s][j]!, `estatística ${TICK_STATS[j]} só cresce`));
    }
    const last = tl.at(-1)!;
    const lastRegular = live.events.findLast((e) => e.type === 'period_end')!;
    assert.equal(last.ev, lastRegular.i + 1, 'o último minuto inclui o apito final (pênaltis vêm depois)');
    for (const s of [0, 1] as const) {
      TICK_STATS.forEach((k, j) => assert.equal(last.s[s][j], k === 'xg' ? Math.round(live.stats[s].xg * 100) : live.stats[s][k], `${k} final`));
      const ps = live.players.filter((p) => p.team === s);
      const sh = s === 0 ? sheet(a) : sheet(b);
      const byId = new Map([...sh.lineup.map((l) => l.player), ...sh.bench].map((p) => [p.id, p]));
      assert.equal(last.p[s].length, ps.length * 2);
      ps.forEach((p, j) => {
        assert.equal(last.p[s][2 * j], Math.round(p.rating * 10), `nota final de ${p.name}`);
        const mp = byId.get(p.id)!;
        assert.equal(last.p[s][2 * j + 1], Math.round(conditionAfter(mp.condition, mp.attributes.physical.stamina, p.minutes, live.conditions.weather) * 10), 'condição final');
      });
    }
    assert.equal(rateReport(live.players[0]!, live.players[0]!.minutes, live.homeGoals, live.awayGoals), live.players[0]!.rating);
  }
});

test('Técnico ao vivo: decisões só mudam o jogo a partir do minuto escolhido; sem substituição automática sob controle; erros claros', async () => {
  const { MatchInterventionError } = await import('../game/match-engine/engine.ts');
  for (let i = 0; i < 12; i++) {
    const [a, b] = pairOf(i), seed = `iv-${i}`, side = (i % 2) as 0 | 1;
    const base = { seed, timeline: true as const };
    // controle até o fim: o time do técnico nunca troca sozinho (nem por lesão)
    const ctl = simulateMatch(sheet(a), sheet(b), { ...base, control: { team: side, until: 10_000 } });
    assert.ok(!ctl.events.some((e) => e.type === 'substitution' && e.team === side), 'sem troca automática sob controle');
    // controle que termina no início = jogo normal (auxiliar decide tudo)
    assert.deepEqual(simulateMatch(sheet(a), sheet(b), { ...base, control: { team: side, until: 0 } }), simulateMatch(sheet(a), sheet(b), base));
    // substituição do técnico no minuto registrado T: tudo antes de T é idêntico
    const T = 55 + i;
    const tl = ctl.timeline!;
    const onPitch = ctl.lineups[side]!.slots.map((s) => s.playerId).filter((id) => !ctl.events.some((e) => e.i < tl[T - 1]!.ev && e.team === side && (e.type === 'red_card' || e.type === 'injury') && e.player === id));
    const outId = onPitch.find((id) => id !== ctl.lineups[side]!.slots[0]!.playerId)!;
    const benchId = (side === 0 ? sheet(a) : sheet(b)).bench[0]!.id;
    const sub = simulateMatch(sheet(a), sheet(b), { ...base, control: { team: side, until: 10_000 }, interventions: [{ tick: T, kind: 'sub', team: side, out: outId, in: benchId }] });
    assert.deepEqual(sub.timeline!.slice(0, T), tl.slice(0, T), 'minutos anteriores à decisão não mudam');
    assert.deepEqual(sub.events.slice(0, tl[T - 1]!.ev), ctl.events.slice(0, tl[T - 1]!.ev));
    const ev = sub.events.find((e) => e.type === 'substitution' && e.team === side)!;
    assert.deepEqual([ev.player, ev.player2, ev.detail], [benchId, outId, 'coach']);
    assert.equal(sub.players.find((p) => p.id === benchId)!.subbedInAt, sub.timeline![T]!.minute);
    // impossíveis: quem já saiu, quem não está no banco, sexta troca
    assert.throws(() => simulateMatch(sheet(a), sheet(b), { ...base, interventions: [{ tick: T, kind: 'sub', team: side, out: outId, in: benchId }, { tick: T + 1, kind: 'sub', team: side, out: outId, in: (side === 0 ? sheet(a) : sheet(b)).bench[1]!.id }] }), MatchInterventionError);
    assert.throws(() => simulateMatch(sheet(a), sheet(b), { ...base, interventions: [{ tick: T, kind: 'sub', team: side, out: onPitch[3]!, in: 'ninguem' }] }), MatchInterventionError);
    // determinismo com decisões: mesmas decisões = mesmo jogo
    assert.deepEqual(simulateMatch(sheet(a), sheet(b), { ...base, control: { team: side, until: 10_000 }, interventions: [{ tick: T, kind: 'sub', team: side, out: outId, in: benchId }] }), sub);
  }
});

test('Conversa no vestiário: efeito pelo tom e placar, vale para todos os relacionados, entra no relatório e só muda o 2º tempo', async () => {
  const { talkDelta, TALK_MESSAGES, TALK_TONES } = await import('../game/match-engine/teamTalk.ts');
  assert.equal(TALK_MESSAGES.length, 12); assert.deepEqual(Object.keys(TALK_TONES), ['incentivar', 'cobrar', 'encorajar', 'consolar']);
  assert.ok(talkDelta('incentivar', 1, 12) > 0 && talkDelta('incentivar', -1, 12) < 0);
  assert.ok(talkDelta('cobrar', -1, 14) > 0 && talkDelta('cobrar', -1, 6) < 0 && talkDelta('cobrar', 2, 14) < 0, 'cobrança: acorda quem perde, abala os frágeis, irrita quem ganha');
  assert.ok(talkDelta('encorajar', -1, 10) > talkDelta('encorajar', 2, 10));
  assert.ok(talkDelta('consolar', -3, 10) > 0 && talkDelta('consolar', 1, 10) < 0);
  const [a, b] = pairOf(3);
  const moraleBefore = sheet(a).lineup.map((l) => l.player.morale);
  const plain = simulateMatch(sheet(a), sheet(b), { seed: 'talk', timeline: true, control: { team: 0, until: 10_000 } });
  const H = plain.timeline!.findIndex((t) => t.ev > plain.events.find((e) => e.type === 'period_end')!.i) + 1; // 1º minuto do 2º tempo
  const talk = simulateMatch(sheet(a), sheet(b), { seed: 'talk', timeline: true, control: { team: 0, until: 10_000 }, interventions: [{ tick: H, kind: 'talk', team: 0, tone: 'encorajar' }] });
  assert.deepEqual(talk.timeline!.slice(0, H), plain.timeline!.slice(0, H), '1º tempo idêntico');
  const htDiff = plain.timeline![H - 1]!;
  const goals = plain.events.filter((e) => e.type === 'goal' && e.i < htDiff.ev);
  const diff = goals.filter((g) => g.team === 0).length - goals.filter((g) => g.team === 1).length;
  const squad = [...sheet(a).lineup.map((l) => l.player), ...sheet(a).bench];
  assert.equal(Object.keys(talk.moraleDelta).length, squad.length, 'titulares e banco');
  for (const p of squad) assert.equal(talk.moraleDelta[p.id], talkDelta('encorajar', diff, p.attributes.mental.composure));
  assert.ok(talk.events.some((e) => e.type === 'team_talk' && e.detail === 'encorajar'));
  assert.deepEqual(plain.moraleDelta, {});
  assert.deepEqual(sheet(a).lineup.map((l) => l.player.morale), moraleBefore, 'as fichas de quem chamou não são alteradas');
});

test('Técnico ao vivo: no máximo 5 substituições (a sexta é recusada com mensagem clara)', async () => {
  const { MatchInterventionError } = await import('../game/match-engine/engine.ts');
  const [a, b] = pairOf(5);
  const sh = sheet(a);
  assert.ok(sh.bench.length >= 6, 'banco com pelo menos 6');
  const outs = sh.lineup.filter((l) => l.slot !== 'GK').map((l) => l.player.id);
  const subs = (k: number) => Array.from({ length: k }, (_, j) => ({ tick: 50 + j, kind: 'sub' as const, team: 0 as const, out: outs[j]!, in: sh.bench[j]!.id }));
  // escolhe uma semente em que nenhum dos que sairiam foi expulso/lesionado antes (o erro tem que ser o do limite)
  const ok = simulateMatch(sh, sheet(b), { seed: 'lim', control: { team: 0, until: 10_000 }, interventions: subs(5) });
  assert.equal(ok.events.filter((e) => e.type === 'substitution' && e.team === 0).length, 5);
  assert.throws(() => simulateMatch(sh, sheet(b), { seed: 'lim', control: { team: 0, until: 10_000 }, interventions: subs(6) }),
    (e) => e instanceof MatchInterventionError && /5 substituições/.test(e.message));
});

test('Auxiliar: sob controle do técnico sugere (sem executar) as mesmas trocas que faria sozinho, com motivo; aceitar aplica a troca', async () => {
  let compared = 0, injuries = 0;
  for (let i = 0; i < 40; i++) {
    const [a, b] = pairOf(i), seed = `sg-${i}`, side = (i % 2) as 0 | 1;
    const auto = simulateMatch(sheet(a), sheet(b), { seed, timeline: true });
    const ctl = simulateMatch(sheet(a), sheet(b), { seed, timeline: true, control: { team: side, until: 10_000 } });
    assert.ok(!ctl.events.some((e) => e.type === 'substitution' && e.team === side), 'o auxiliar não troca sozinho');
    for (const s of ctl.suggestions) {
      assert.equal(s.team, side); assert.ok(s.reason.length > 30);
      assert.ok(ctl.players.some((p) => p.id === s.out), 'quem sairia estava em campo');
    }
    for (const s of ctl.suggestions.filter((x) => x.kind === 'injury')) { injuries++; assert.match(s.reason, /lesionou/); }
    // até a primeira troca do auxiliar (sem lesão antes), os dois jogos são idênticos: a 1ª sugestão = a 1ª troca automática
    const firstAuto = auto.events.find((e) => e.type === 'substitution' && e.team === side);
    const injBefore = firstAuto && auto.events.some((e) => e.type === 'injury' && e.team === side && e.i < firstAuto.i);
    if (firstAuto && !firstAuto.detail && !injBefore) {
      const sg = ctl.suggestions.find((x) => x.kind !== 'injury' && x.kind !== 'goalkeeper')!;
      assert.deepEqual([sg.out, sg.in, ctl.timeline![sg.tick]!.minute], [firstAuto.player2, firstAuto.player, firstAuto.minute], `semente ${seed}`);
      // aceitar a sugestão no minuto seguinte: a troca acontece, na posição sugerida
      const acc = simulateMatch(sheet(a), sheet(b), { seed, timeline: true, control: { team: side, until: 10_000 }, interventions: [{ tick: sg.tick + 1, kind: 'sub', team: side, out: sg.out, in: sg.in, slot: sg.slot }] });
      assert.ok(acc.events.some((e) => e.type === 'substitution' && e.player === sg.in && e.player2 === sg.out && e.detail === 'coach'));
      assert.equal(acc.players.find((p) => p.id === sg.in)!.slot, sg.slot);
      compared++;
    }
  }
  assert.ok(compared >= 10, `comparações: ${compared}`);
  assert.ok(injuries >= 1, 'pelo menos uma sugestão por lesão nas sementes testadas');
});

test('Auxiliar: troca de outra posição vem com a formação reorganizada; aceitar muda a função de cada jogador para a nova formação', async () => {
  const { FORMATIONS } = await import('../game/match-engine/formations.ts');
  let checked = 0;
  for (let i = 0; i < 60 && checked < 6; i++) {
    const [a, b] = pairOf(i), seed = `rs-${i}`, side = (i % 2) as 0 | 1;
    const ctl = simulateMatch(sheet(a), sheet(b), { seed, timeline: true, control: { team: side, until: 10_000 } });
    const sg = ctl.suggestions.find((s) => (s.kind === 'chase' || s.kind === 'protect') && s.reshape && s.reshape.to !== s.reshape.from);
    for (const s of ctl.suggestions.filter((x) => x.kind === 'fresh' || x.kind === 'injury' || x.kind === 'goalkeeper')) assert.equal(s.reshape, null, 'mesma posição: sem mudança de formação');
    if (!sg) continue;
    const target = FORMATIONS.find((f) => f.id === sg.reshape!.to)!;
    assert.ok(target, 'formação conhecida');
    assert.match(sg.reason, new RegExp(`para ${sg.reshape!.to}`));
    const acc = simulateMatch(sheet(a), sheet(b), { seed, timeline: true, control: { team: side, until: 10_000 },
      interventions: [{ tick: sg.tick + 1, kind: 'sub', team: side, out: sg.out, in: sg.in, slot: sg.slot, reshape: true }] });
    assert.deepEqual(acc.timeline!.slice(0, sg.tick + 1), ctl.timeline!.slice(0, sg.tick + 1), 'antes da decisão, nada muda');
    const fc = acc.events.find((e) => e.type === 'formation_change' && e.team === side)!;
    assert.ok(fc, 'evento de mudança de formação');
    assert.equal(fc.detail, `${sg.reshape!.from}>${sg.reshape!.to}`);
    const slots = fc.moves!.map((m) => m.slot).sort();
    assert.deepEqual(slots, target.slots.map((s) => s.pos).sort(), 'o time ocupa exatamente as funções da nova formação');
    assert.equal(fc.moves!.find((m) => m.id === sg.in)!.slot, sg.slot, 'quem entra joga na posição dele');
    for (const c of sg.reshape!.changes) assert.equal(fc.moves!.find((m) => m.id === c.id)!.slot, c.to, 'mudanças anunciadas = aplicadas');
    assert.deepEqual(simulateMatch(sheet(a), sheet(b), { seed, timeline: true, control: { team: side, until: 10_000 },
      interventions: [{ tick: sg.tick + 1, kind: 'sub', team: side, out: sg.out, in: sg.in, slot: sg.slot, reshape: true }] }), acc, 'determinístico');
    checked++;
  }
  assert.ok(checked >= 3, `casos com reorganização: ${checked}`);
});

test('Auxiliar: em toda sugestão aceita, quem entra termina exatamente na posição anunciada (nunca improvisado pela reorganização)', () => {
  let n = 0;
  for (let i = 0; i < 60; i++) {
    const [a, b] = pairOf(i), seed = `pk-${i}`, side = (i % 2) as 0 | 1;
    const ctl = simulateMatch(sheet(a), sheet(b), { seed, control: { team: side, until: 10_000 } });
    for (const sg of ctl.suggestions.filter((s) => s.kind === 'chase' || s.kind === 'protect').slice(0, 1)) {
      const acc = simulateMatch(sheet(a), sheet(b), { seed, control: { team: side, until: 10_000 },
        interventions: [{ tick: sg.tick + 1, kind: 'sub', team: side, out: sg.out, in: sg.in, slot: sg.slot, ...(sg.reshape ? { reshape: true } : {}) }] });
      assert.equal(acc.players.find((p) => p.id === sg.in)!.slot, sg.slot, `semente ${seed}`);
      if (sg.reshape && sg.reshape.to === sg.reshape.from && sg.reshape.changes.length) assert.match(sg.reason, /mantém o/);
      n++;
    }
  }
  assert.ok(n >= 8, `casos: ${n}`);
});

test('Cruzamentos: quem cruza é jogador de corredor (alas, meias abertos, laterais e pontas), e alas/meias abertos jogam nas pré-definições certas', () => {
  const wide = new Set(['LB', 'RB', 'LWB', 'RWB', 'LM', 'RM', 'LW', 'RW']);
  let crossGoals = 0, wideAssists = 0, wideRoleAssists = 0;
  for (let i = 0; i < 400; i++) {
    const [a, b] = pairOf(i);
    const r = simulateMatch(sheetOf(a, BALANCED, i % 2 ? '3-5-2' : '4-4-2'), sheetOf(b, BALANCED, '4-1-4-1'), { seed: `cx-${i}` });
    const slotOf = new Map(r.players.map((p) => [p.id, p.slot]));
    for (const e of r.events) if (e.type === 'goal' && e.chance === 'cross' && e.player2) {
      crossGoals++;
      const s = slotOf.get(e.player2)!;
      if (wide.has(s)) wideAssists++;
      if (['LWB', 'RWB', 'LM', 'RM'].includes(s)) wideRoleAssists++;
    }
  }
  assert.ok(crossGoals >= 40, `gols de cruzamento: ${crossGoals}`);
  // medido em 1.200 jogos (com funções táticas): ~69% pelo corredor e ~43% de alas/meias abertos; nestes 400, 65% e 40%.
  // Sem o peso de cruzamento era ~39% pelo corredor (o cruzamento saía de qualquer passador).
  assert.ok(wideAssists / crossGoals >= 0.6, `assistências de cruzamento pelo corredor: ${(100 * wideAssists / crossGoals).toFixed(0)}%`);
  assert.ok(wideRoleAssists / crossGoals >= 0.33, `alas e meias abertos: ${(100 * wideRoleAssists / crossGoals).toFixed(0)}%`);
});

test('Auxiliar: sem goleiro (expulso ou lesionado) sob controle do técnico, alguém de linha vai para o gol e o auxiliar sugere o goleiro reserva', () => {
  let found = 0;
  for (let i = 0; i < 400 && found < 3; i++) {
    const [a, b] = pairOf(i), side = (i % 2) as 0 | 1;
    const r = simulateMatch(sheet(a), sheet(b), { seed: `gk-${i}`, control: { team: side, until: 10_000 } });
    const sg = r.suggestions.find((s) => s.kind === 'goalkeeper');
    if (!sg) continue;
    found++;
    assert.equal(sg.slot, 'GK'); assert.match(sg.reason, /sem goleiro/);
    const benchGk = (side === 0 ? sheet(a) : sheet(b)).bench.find((p) => p.position === 'GK')!;
    assert.equal(sg.in, benchGk.id, 'sugere o goleiro do banco');
    assert.ok(!r.events.some((e) => e.type === 'substitution' && e.team === side), 'nada é trocado sem o técnico');
    // aceitar: o goleiro reserva entra no gol no lugar do improvisado
    const acc = simulateMatch(sheet(a), sheet(b), { seed: `gk-${i}`, control: { team: side, until: 10_000 }, interventions: [{ tick: sg.tick + 1, kind: 'sub', team: side, out: sg.out, in: sg.in, slot: 'GK' }] });
    assert.equal(acc.players.find((p) => p.id === sg.in)!.slot, 'GK');
  }
  assert.ok(found >= 1, 'encontrou ao menos um jogo sem goleiro');
});

test('Equilíbrio: toda função de linha soma o mesmo peso de zona (nenhuma formação ganha força de graça), mantendo o perfil de cada uma', async () => {
  const { zoneProfile } = await import('../game/match-engine/engine.ts');
  const outfield = ['CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST'] as const;
  for (const p of outfield) { const z = zoneProfile(p); assert.ok(Math.abs(z.att + z.mid + z.def - 1.15) < 1e-9, `${p} soma ${z.att + z.mid + z.def}`); }
  assert.deepEqual(zoneProfile('GK'), { att: 0, mid: 0, def: 0 });
  // perfis: ala defende mais que o meia aberto; meia aberto organiza mais que o ponta; atacante só ataca; zagueiro só defende
  assert.ok(zoneProfile('LWB').def > zoneProfile('LM').def && zoneProfile('LM').mid > zoneProfile('LW').mid);
  assert.ok(zoneProfile('ST').att === 1.15 && zoneProfile('CB').def === 1.15);
  const { FORMATIONS } = await import('../game/match-engine/formations.ts');
  for (const f of FORMATIONS) {
    const total = f.slots.reduce((s, x) => { const z = zoneProfile(x.pos); return s + z.att + z.mid + z.def; }, 0);
    assert.ok(Math.abs(total - 11.5) < 1e-9, `${f.id}: peso total ${total}`);
  }
});
