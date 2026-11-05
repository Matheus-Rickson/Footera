import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../game/match-engine/engine.ts';
import type { MatchOutcome, TeamSheet } from '../game/match-engine/types.ts';
import { calibWorld, midClubs, sheetOf } from './fixtures.ts';
import {
  cardMultiplier, coachFactor, hireConfidence, inGameMultiplier, tacticsMultiplier, initialCoachReputation, negotiationMultiplier, seasonPoints, spendError, talkWithMotivation, youthGrowthMultiplier,
} from '../game/coach-engine/coach.ts';
import { baseCoachAttributes, type CoachAttributes } from '../shared/coachAttributes.ts';
import { playerReputation, toStars } from '../shared/scale.ts';
import { evaluateSeason } from '../game/board-engine/board.ts';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { coachOf, getBoardOverview, spendCoachPoint } from '../database/repositories/boardRepository.ts';
import { proposeFee, searchMarket } from '../database/repositories/transferRepository.ts';
import { processTrainingMonth } from '../database/repositories/trainingRepository.ts';
import { ageOn } from '../shared/date.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const maxed = (k: keyof CoachAttributes): CoachAttributes => ({ ...baseCoachAttributes(), [k]: 20 });

test('Estrelas: reputação 0–100 vira 0–5 estrelas de meia em meia; reputação de jogador vem só de dados públicos', () => {
  assert.deepEqual([0, 1, 4, 5, 20, 24, 25, 50, 74, 75, 95, 100].map(toStars), [0, 0, 0, 0.5, 1, 1, 1.5, 2.5, 3.5, 4, 5, 5]);
  for (let r = 0; r <= 100; r++) { const s = toStars(r); assert.ok(s >= 0 && s <= 5 && Number.isInteger(s * 2), `meia estrela: ${r}`); }
  assert.ok(playerReputation(50_000_000, 80) > playerReputation(2_000_000, 80), 'mais valor, mais fama');
  assert.ok(playerReputation(2_000_000, 90) > playerReputation(2_000_000, 30), 'clube grande dá visibilidade');
  assert.equal(playerReputation(1e12, 100), 100); assert.equal(playerReputation(0, null), 6);
});

test('Treinador (regras): atributos na base não mudam nada; no máximo dão vantagens pequenas; pontos por temporada e reputação', () => {
  const base = baseCoachAttributes();
  assert.equal(coachFactor(5), 0); assert.equal(coachFactor(20), 1); assert.equal(coachFactor(undefined), 0); assert.equal(coachFactor(1), 0);
  assert.deepEqual([tacticsMultiplier(base), cardMultiplier(base), inGameMultiplier(base)], [1, 1, 1]);
  assert.deepEqual([tacticsMultiplier(maxed('tactics')), cardMultiplier(maxed('discipline')), inGameMultiplier(maxed('adaptability'))], [1.025, 0.7, 1.05]);
  assert.equal(negotiationMultiplier(base), 1); assert.equal(negotiationMultiplier(maxed('negotiation')), 0.92);
  assert.equal(youthGrowthMultiplier(maxed('youth'), 21), 1.25); assert.equal(youthGrowthMultiplier(maxed('youth'), 22), 1); assert.equal(youthGrowthMultiplier(base, 18), 1);
  assert.deepEqual([talkWithMotivation(4, base), talkWithMotivation(4, maxed('motivation')), talkWithMotivation(-5, maxed('motivation'))], [4, 6, -3]);
  assert.deepEqual([seasonPoints({ met: false, champion: false, promoted: false }), seasonPoints({ met: true, champion: true, promoted: false }), seasonPoints({ met: true, champion: false, promoted: true })], [1, 3, 3]);
  assert.equal(spendError(base, 0, 'tactics'), 'Não há pontos de atributo para distribuir.');
  assert.match(spendError(maxed('tactics'), 3, 'tactics')!, /máximo/);
  assert.equal(spendError(base, 1, 'tactics'), null);
  assert.deepEqual([initialCoachReputation(1), initialCoachReputation(40), initialCoachReputation(99)], [15, 20, 35]);
  assert.equal(hireConfidence(65, 50, 50, base), 65);
  assert.equal(hireConfidence(65, 90, 30, maxed('adaptability')), 65 + 8 + 8);
  assert.equal(hireConfidence(65, 20, 90, base), 65 - 8);
  // superar a meta com folga rende mais reputação
  const ev = (position: number) => evaluateSeason({ objective: 'top_half', target: 10, position, champion: false, promoted: false, relegated: false, balance: 1, youthTarget: 0, youthPromoted: 0 }).reputationDelta;
  assert.deepEqual([ev(10), ev(8), ev(3), ev(11)], [5, 7, 9, -4]);
});

// ---------------------------------------------------------------- partida
const mid = midClubs();
const pair = (i: number): [TeamSheet, TeamSheet] => { const a = mid[i % mid.length]!; let b = mid[(i * 3 + 1) % mid.length]!; if (a === b) b = mid[(i + 1) % mid.length]!; return [sheetOf(a), sheetOf(b)]; };
const withCoach = (s: TeamSheet, c?: CoachAttributes): TeamSheet => (c ? { ...s, coach: c } : s);
const run = (n: number, c: CoachAttributes | undefined, f: (o: MatchOutcome) => number): number => {
  calibWorld();
  let sum = 0;
  for (let i = 0; i < n; i++) { const [h, a] = pair(i); sum += f(simulateMatch(withCoach(h, c), a, { seed: `coach-${i}` })); }
  return sum;
};

test('Treinador na partida: com atributos na base o resultado é idêntico ao de sempre (mesma semente)', () => {
  for (let i = 0; i < 20; i++) {
    const [h, a] = pair(i);
    assert.deepEqual(simulateMatch(withCoach(h, baseCoachAttributes()), a, { seed: `n-${i}` }), simulateMatch(h, a, { seed: `n-${i}` }), `partida ${i}`);
  }
});

test('Treinador na partida: disciplina reduz cartões; conhecimento tático melhora o desempenho; motivação amplia a conversa', () => {
  const cards = (o: MatchOutcome) => o.stats[0].yellowCards + o.stats[0].redCards;
  const c0 = run(300, undefined, cards), c1 = run(300, maxed('discipline'), cards);
  assert.ok(c1 < c0 * 0.85, `cartões: ${c1} com disciplina 20 × ${c0} sem`);
  const xg = (o: MatchOutcome) => o.stats[0].xg - o.stats[1].xg;
  const x0 = run(300, undefined, xg), x1 = run(300, maxed('tactics'), xg);
  assert.ok(x1 > x0, `saldo de xG: ${x1.toFixed(1)} com tática 20 × ${x0.toFixed(1)} sem`);
  // conversa no 1º minuto registrado (0 × 0): "incentivar" com o time empatando dá +4 de moral; motivação 20 → +6
  const [h, a] = pair(1);
  const talk = (c?: CoachAttributes) => simulateMatch(withCoach(h, c), a, { seed: 'talk', timeline: true, control: { team: 0, until: 0 }, interventions: [{ tick: 1, kind: 'talk', team: 0, tone: 'incentivar' }] }).moraleDelta;
  const d0 = Object.values(talk()), d1 = Object.values(talk(maxed('motivation')));
  assert.ok(d0.length > 11 && d0.every((d) => d === 4), `sem motivação: ${d0}`);
  assert.ok(d1.every((d) => d === 6), `motivação 20: ${d1}`);
  // adaptabilidade: com uma troca do técnico, quem entra rende mais (a partida muda); sem troca, nada muda
  const subIv = (s: TeamSheet) => [{ tick: 40, kind: 'sub' as const, team: 0 as const, out: s.lineup[9]!.player.id, in: s.bench.find((b) => b.position !== 'GK')!.id }];
  const withSub = (c?: CoachAttributes) => simulateMatch(withCoach(h, c), a, { seed: 'adapt', control: { team: 0, until: 0 }, interventions: subIv(h) });
  assert.notDeepEqual(withSub(maxed('adaptability')).events, withSub().events, 'adaptabilidade muda a partida depois da troca');
  assert.deepEqual(simulateMatch(withCoach(h, maxed('adaptability')), a, { seed: 'adapt' }), simulateMatch(h, a, { seed: 'adapt' }), 'sem troca do técnico, adaptabilidade não age');
});

// ---------------------------------------------------------------- carreira
const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed: string, attrs: CoachAttributes = baseCoachAttributes()) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  setAttrs(db, { attributes: attrs }); // a criação exige a distribuição inicial (12 pontos); aqui os atributos são postos direto
  return { db, clubId: world.clubs[0]!.id };
}
const setAttrs = (db: SqlDb, patch: Partial<Coach>) => db.prepare('UPDATE career SET coach_json = ? WHERE id = 1').run(JSON.stringify({ ...coachOf(db), ...patch }));

test('Treinador na carreira: distribuir pontos (com limite), negociação baixa a taxa pedida, jovens evoluem mais rápido', async () => {
  const { db } = await setup('coach-car');
  assert.throws(() => spendCoachPoint(db, 'tactics'), /Não há pontos/);
  setAttrs(db, { attributePoints: 2 });
  spendCoachPoint(db, 'tactics'); spendCoachPoint(db, 'tactics');
  assert.deepEqual([coachOf(db).attributes!.tactics, coachOf(db).attributePoints, getBoardOverview(db).coachPoints], [7, 0, 0]);
  setAttrs(db, { attributePoints: 1, attributes: { ...baseCoachAttributes(), youth: 20 } });
  assert.throws(() => spendCoachPoint(db, 'youth'), /máximo/);
  // save antigo, sem atributos: o ponto parte da base de criação
  const legacy = coachOf(db); delete legacy.attributes;
  db.prepare('UPDATE career SET coach_json = ? WHERE id = 1').run(JSON.stringify({ ...legacy, attributePoints: 1 }));
  spendCoachPoint(db, 'motivation');
  assert.deepEqual(coachOf(db).attributes, { ...baseCoachAttributes(), motivation: 6 });

  // negociação: a contraproposta do clube vendedor (= taxa pedida) cai 8% com negociação 20
  const t = searchMarket(db, {}).filter((p) => p.clubId && p.marketValue > 200_000).sort((a, b) => a.marketValue - b.marketValue)[0]!;
  const askOf = () => { for (let k = 0.3; k < 5; k += 0.01) { const r = proposeFee(db, t.id, Math.round(t.marketValue * k)); if (r.outcome === 'club_counter') return r.counterFee!; } return null; };
  setAttrs(db, { attributes: baseCoachAttributes() });
  const ask0 = askOf();
  setAttrs(db, { attributes: maxed('negotiation') });
  const ask1 = askOf();
  assert.ok(ask0 && ask1, 'há contraproposta');
  assert.equal(ask1, Math.round(ask0! * 0.92));

  // jovens: mesma semente, mês de treino com "desenvolvimento de jovens" 5 × 20; só os jovens do clube do usuário mudam
  let youthClub = '';
  const snapshot = async (youth: number) => {
    const s = await setup('coach-youth', { ...baseCoachAttributes(), youth });
    processTrainingMonth(s.db, '2026-08-01');
    youthClub = s.clubId;
    return s.db.prepare('SELECT id, COALESCE(club_id, youth_club_id) AS club, birth_date, attributes_json FROM players ORDER BY id').all().map((r) => ({ id: String(r.id), club: r.club == null ? null : String(r.club), age: ageOn(String(r.birth_date), '2026-08-01'), attrs: String(r.attributes_json) }));
  };
  const a = await snapshot(5), b = await snapshot(20);
  const total = (j: string) => { const x = JSON.parse(j) as Record<string, Record<string, number>>; return ['technical', 'mental', 'physical'].reduce((s, g) => s + Object.values(x[g]!).reduce((u, v) => u + v, 0), 0); };
  let young = 0, gain = 0;
  a.forEach((p, i) => {
    const q = b[i]!;
    if (p.club !== youthClub || p.age > 21) assert.equal(q.attrs, p.attrs, `só jovens do usuário mudam (${p.id})`);
    else { young++; gain += total(q.attrs) - total(p.attrs); assert.ok(total(q.attrs) >= total(p.attrs)); }
  });
  assert.ok(young > 0 && gain > 0, `jovens do usuário evoluem mais: ${young} jovens, +${gain} pontos`);
});
