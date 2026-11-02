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
    const gkIdx = base.lineup.findIndex((l) => l.slot === 'GK'), stIdx = base.lineup.findIndex((l) => l.slot === 'ST');
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
