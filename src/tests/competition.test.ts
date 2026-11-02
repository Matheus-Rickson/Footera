import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../game/rng.ts';
import { generateRounds } from '../game/competition-engine/roundRobin.ts';
import { DEFAULT_CALENDAR, scheduleLeague, firstMatchday } from '../game/competition-engine/schedule.ts';
import { computeStandings, seasonOutcome, type MatchResult } from '../game/competition-engine/standings.ts';
import { weekday, daysBetween } from '../shared/date.ts';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);

test('Rodadas: para 2..21 times, todos jogam 1x por rodada e cada mando de cada confronto ocorre exatamente 1x no turno/returno', () => {
  for (let n = 2; n <= 21; n++) {
    const teams = ids(n);
    const rounds = generateRounds(teams, 2, createRng(`rr-${n}`));
    const even = n % 2 === 0 ? n : n + 1;
    assert.equal(rounds.length, 2 * (even - 1), `n=${n}: nº de rodadas`);
    assert.equal(rounds.flatMap((r) => r.matches).length, n * (n - 1), `n=${n}: nº de jogos`);
    const hosted = new Set<string>();
    for (const r of rounds) {
      const seen = new Set<string>();
      for (const m of r.matches) {
        assert.notEqual(m.home, m.away);
        assert.ok(!seen.has(m.home) && !seen.has(m.away), `n=${n} rodada ${r.round}: time repetido`);
        seen.add(m.home); seen.add(m.away);
        const key = `${m.home}>${m.away}`;
        assert.ok(!hosted.has(key), `n=${n}: ${key} repetido`);
        hosted.add(key);
      }
      assert.equal(seen.size, n % 2 === 0 ? n : n - 1, `n=${n}: times jogando na rodada`);
    }
    assert.equal(hosted.size, n * (n - 1));
  }
});

test('Rodadas: mandos equilibrados e sem longas sequências em casa/fora (20 times, turno e returno)', () => {
  const teams = ids(20);
  const rounds = generateRounds(teams, 2, createRng('seq'));
  const seq = new Map(teams.map((t) => [t, [] as string[]]));
  for (const r of rounds) for (const m of r.matches) { seq.get(m.home)!.push('H'); seq.get(m.away)!.push('A'); }
  let worst = 0;
  for (const [t, s] of seq) {
    assert.equal(s.length, 38);
    assert.equal(s.filter((x) => x === 'H').length, 19, `${t}: 19 jogos em casa`);
    let run = 1; for (let i = 1; i < s.length; i++) { run = s[i] === s[i - 1] ? run + 1 : 1; worst = Math.max(worst, run); }
  }
  assert.ok(worst <= 3, `sequência máxima = ${worst}`);
});

test('Rodadas: determinísticas por semente, variam entre sementes, e rejeitam entradas inválidas', () => {
  const a = generateRounds(ids(10), 2, createRng('x')), b = generateRounds(ids(10), 2, createRng('x')), c = generateRounds(ids(10), 2, createRng('y'));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.throws(() => generateRounds(['a', 'a', 'b'], 2, createRng('z')), /duplicados/);
  assert.throws(() => generateRounds(['a'], 2, createRng('z')), /ao menos 2/);
  assert.throws(() => generateRounds(ids(4), 0, createRng('z')), /legs/);
});

test('Calendário: 1ª rodada é o primeiro sábado em/após 1º de agosto e as rodadas têm 7 dias de intervalo', () => {
  assert.equal(weekday(firstMatchday(2026, DEFAULT_CALENDAR)), 6);
  assert.equal(firstMatchday(2026, DEFAULT_CALENDAR), '2026-08-01');
  assert.equal(firstMatchday(2027, DEFAULT_CALENDAR), '2027-08-07');
  const games = scheduleLeague(ids(20), 2, 2026, DEFAULT_CALENDAR, createRng('cal'));
  const byRound = new Map<number, string>();
  for (const g of games) { byRound.set(g.round, g.date); assert.equal(weekday(g.date), 6); }
  assert.equal(byRound.size, 38);
  for (let r = 2; r <= 38; r++) assert.equal(daysBetween(byRound.get(r - 1)!, byRound.get(r)!), 7);
  assert.equal(byRound.get(38), '2027-04-17'); // 1º/ago/2026 + 37 semanas
});

const rules = { pointsWin: 3, pointsDraw: 1, tiebreakers: ['points', 'wins', 'goalDiff', 'goalsFor', 'headToHead'] as const };
const R = (home: string, away: string, hg: number, ag: number): MatchResult => ({ home, away, homeGoals: hg, awayGoals: ag });

test('Classificação: pontos, saldo e posições básicas', () => {
  const t = computeStandings(['A', 'B', 'C'], [R('A', 'B', 2, 0), R('B', 'C', 1, 1), R('C', 'A', 0, 3)], { ...rules, tiebreakers: ['points', 'goalDiff', 'goalsFor'] });
  assert.deepEqual(t.map((r) => [r.teamId, r.points, r.goalDiff, r.position]), [['A', 6, 5, 1], ['B', 1, -2, 2], ['C', 1, -3, 3]]);
  assert.deepEqual([t[0]!.played, t[0]!.won, t[0]!.drawn, t[0]!.lost], [2, 2, 0, 0]);
});

test('Classificação: critérios de desempate seguem a ordem configurada (confronto direto × saldo)', () => {
  const results = [R('A', 'B', 1, 0), R('A', 'D', 0, 3), R('B', 'E', 4, 0)];
  const teams = ['A', 'B', 'D', 'E'];
  const h2hFirst = computeStandings(teams, results, { ...rules, tiebreakers: ['points', 'headToHead', 'goalDiff'] });
  assert.deepEqual(h2hFirst.map((r) => r.teamId), ['D', 'A', 'B', 'E']);
  const goalsOnly = computeStandings(teams, results, { ...rules, tiebreakers: ['points', 'goalDiff', 'goalsFor'] });
  assert.deepEqual(goalsOnly.map((r) => r.teamId), ['B', 'D', 'A', 'E']);
});

test('Classificação: empate absoluto é resolvido por ID e jogos de times desconhecidos são ignorados', () => {
  const t = computeStandings(['Z', 'B', 'M'], [R('Z', 'X', 5, 0)], rules);
  assert.deepEqual(t.map((r) => r.teamId), ['B', 'M', 'Z']);
  assert.equal(t.find((r) => r.teamId === 'Z')!.played, 0);
});

test('Classificação (propriedade): permutação válida, pontos coerentes e independente da ordem de entrada', () => {
  for (let k = 0; k < 40; k++) {
    const rng = createRng(`prop-${k}`);
    const n = rng.int(3, 12), teams = ids(n);
    const results = generateRounds(teams, 2, rng).flatMap((r) => r.matches)
      .filter(() => rng.chance(0.8)).map((m) => R(m.home, m.away, rng.int(0, 4), rng.int(0, 3)));
    const a = computeStandings(teams, results, rules);
    const b = computeStandings(rng.shuffle(teams), rng.shuffle(results), rules);
    assert.deepEqual(a, b, 'ordem de entrada não pode alterar a tabela');
    assert.deepEqual(a.map((r) => r.position), teams.map((_, i) => i + 1));
    assert.equal(new Set(a.map((r) => r.teamId)).size, n);
    const decisive = results.filter((r) => r.homeGoals !== r.awayGoals).length;
    const draws = results.length - decisive;
    assert.equal(a.reduce((s, r) => s + r.points, 0), decisive * 3 + draws * 2);
    assert.equal(a.reduce((s, r) => s + r.goalsFor, 0), a.reduce((s, r) => s + r.goalsAgainst, 0));
    for (let i = 1; i < a.length; i++) assert.ok(a[i - 1]!.points >= a[i]!.points, 'pontos não crescentes');
  }
});

test('Desfecho da temporada: campeão, promovidos, rebaixados e vagas continentais', () => {
  const table = computeStandings(ids(10), [], rules).map((r, i) => ({ ...r, points: 100 - i }));
  const out = seasonOutcome(table, { promotionSlots: 2, relegationSlots: 3, continentalSlots: 4 });
  assert.equal(out.champion, 't01');
  assert.deepEqual(out.promoted, ['t01', 't02']);
  assert.deepEqual(out.relegated, ['t08', 't09', 't10']);
  assert.deepEqual(out.continental, ['t01', 't02', 't03', 't04']);
  assert.deepEqual(seasonOutcome(table, { promotionSlots: 0, relegationSlots: 0, continentalSlots: 0 }).relegated, []);
});
