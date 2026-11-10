import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState, moveClock } from '../database/repositories/competitionRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import { evaluateSeason } from '../game/board-engine/board.ts';
import { clubPhase, clubSize, IMPORTANCE, objectiveStatus, seasonObjectives, type ObjectiveContext } from '../game/board-engine/objectives.ts';
import { ensureBoard, getBoardOverview, setBoardForSeason } from '../database/repositories/boardRepository.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'bo', teams = 6) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const playAll = (db: SqlDb) => { for (let i = 0; i < 80 && n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled'") > 0; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); } };
const ctx = (over: Partial<ObjectiveContext> = {}): ObjectiveContext => ({
  league: { objective: 'top_half', target: 10, label: 'Terminar na metade de cima' }, cup: { name: 'Copa', stages: ['1ª fase', '2ª fase', 'Oitavas', 'Quartas', 'Semifinal', 'Final'], entry: 0 },
  state: null, payroll: 1_000_000, wageCeiling: 1_100_000, youthTarget: 1, squadAge: 26, tier: 1, ...over,
});

test('Tamanho e fase: critérios e prioridade', () => {
  assert.equal(clubSize({ reputation: 82, tier: 1, repRankInCountry: 5 }), 'giant');
  assert.equal(clubSize({ reputation: 60, tier: 1, repRankInCountry: 2 }), 'giant');
  assert.equal(clubSize({ reputation: 66, tier: 1, repRankInCountry: 12 }), 'big');
  assert.equal(clubSize({ reputation: 50, tier: 1, repRankInCountry: 15 }), 'medium');
  assert.equal(clubSize({ reputation: 45, tier: 2, repRankInCountry: 25 }), 'medium');
  assert.equal(clubSize({ reputation: 30, tier: 3, repRankInCountry: 40 }), 'small');
  const base = { lastOutcome: null, lastPosition: 8, expected: 8, balance: 1e6, projectedNet: 0, annualIncome: 1e7, squadAge: 26, strengthRank: 8, repRank: 8 } as const;
  assert.equal(clubPhase({ ...base, lastOutcome: 'relegated', balance: -1 }), 'relegated', 'rebaixamento vem antes da crise');
  assert.equal(clubPhase({ ...base, lastOutcome: 'promoted' }), 'promoted');
  assert.equal(clubPhase({ ...base, balance: -1 }), 'crisis');
  assert.equal(clubPhase({ ...base, projectedNet: -1.1e6 }), 'crisis', 'prejuízo previsto acima de 10% da receita');
  assert.equal(clubPhase({ ...base, projectedNet: -0.9e6 }), 'stable');
  assert.equal(clubPhase({ ...base, squadAge: 29.6 }), 'rebuilding');
  assert.equal(clubPhase({ ...base, strengthRank: 12 }), 'rebuilding', 'elenco 4 posições abaixo da reputação');
  assert.equal(clubPhase({ ...base, lastPosition: 5 }), 'rising');
  assert.equal(clubPhase({ ...base, lastPosition: 6 }), 'stable');
});

test('Objetivos por tamanho e fase: liga essencial, copa pela grandeza, crise corta folha, reconstrução dá minutos aos jovens', () => {
  const giant = seasonObjectives('giant', 'stable', ctx());
  assert.equal(giant[0]!.kind, 'league'); assert.equal(giant[0]!.importance, 'essential');
  const cup = (size: Parameters<typeof seasonObjectives>[0]) => seasonObjectives(size, 'stable', ctx()).find((o) => o.kind === 'cup')!;
  assert.deepEqual([cup('giant').target.stage, cup('big').target.stage, cup('medium').target.stage, cup('small').target.stage], [5, 4, 3, 1]);
  assert.equal(cup('giant').importance, 'important'); assert.equal(cup('small').importance, 'desirable');
  assert.match(cup('giant').label, /final/);
  const crisis = seasonObjectives('medium', 'crisis', ctx());
  assert.deepEqual(crisis.filter((o) => o.kind === 'payroll_cut').map((o) => [o.importance, o.target.payroll]), [['important', 900_000]]);
  assert.ok(!crisis.some((o) => o.kind === 'wage_ceiling'));
  const rebuild = seasonObjectives('big', 'rebuilding', ctx({ squadAge: 30.2 }));
  assert.ok(rebuild.some((o) => o.kind === 'youth_minutes' && o.importance === 'important'));
  assert.equal(rebuild.find((o) => o.kind === 'squad_age')!.target.age, 29.5);
  assert.ok(!rebuild.some((o) => o.kind === 'youth_promote'));
  for (const size of ['giant', 'big', 'medium', 'small'] as const) for (const phase of ['relegated', 'promoted', 'crisis', 'rebuilding', 'rising', 'stable'] as const) {
    const l = seasonObjectives(size, phase, ctx({ state: { name: 'Estadual', teams: 12, relegationSlots: 2 } }));
    assert.ok(l.length >= 4 && l.length <= 6, `${size}/${phase}: ${l.length}`);
  }
  const promoted = seasonObjectives('medium', 'promoted', ctx());
  assert.equal(promoted.find((o) => o.kind === 'finance_black')!.importance, 'important', 'recém-promovido: não comprometer as finanças');
});

test('Andamento: copa eliminada falha antes da virada; liga e folha julgadas no fim', () => {
  const [cupObj] = seasonObjectives('big', 'stable', ctx()).filter((o) => o.kind === 'cup');
  assert.equal(objectiveStatus(cupObj!, { cupStage: 2, cupEliminated: true }, false), 'missed');
  assert.equal(objectiveStatus(cupObj!, { cupStage: 4, cupEliminated: true }, false), 'met', 'chegou à semifinal: cumpriu');
  assert.equal(objectiveStatus(cupObj!, { cupStage: 1 }, false), 'on_track');
  assert.equal(objectiveStatus(cupObj!, { cupStage: 1 }, true), 'missed');
  const league = seasonObjectives('big', 'stable', ctx())[0]!;
  assert.equal(objectiveStatus(league, { position: 11, played: 10 }, false), 'close');
  assert.equal(objectiveStatus(league, { position: 13, played: 10 }, false), 'off_track');
  assert.equal(objectiveStatus(league, { position: 10, played: 38 }, true), 'met');
  const wage = seasonObjectives('big', 'stable', ctx()).find((o) => o.kind === 'wage_ceiling')!;
  assert.equal(objectiveStatus(wage, { payroll: 1_100_000 }, true), 'met');
  assert.equal(objectiveStatus(wage, { payroll: 1_100_001 }, true), 'missed');
});

test('Avaliação: cada objetivo extra soma o peso da importância; sem objetivos vale a regra antiga', () => {
  const base = { objective: 'top4' as const, target: 4, position: 3, champion: false, promoted: false, relegated: false, balance: -1, youthTarget: 1, youthPromoted: 0 };
  const old = evaluateSeason(base);
  assert.equal(old.confidenceDelta, 15 - 5 - 5, 'regra antiga: azul e base ±5');
  const neu = evaluateSeason({ ...base, objectives: [{ label: 'A', met: true, delta: IMPORTANCE.important.met }, { label: 'B', met: false, delta: IMPORTANCE.desirable.missed }] });
  assert.equal(neu.confidenceDelta, 15 + 6 - 2);
  assert.ok(neu.lines.some((l) => l.startsWith('Cumprido: A')) && neu.lines.some((l) => l.startsWith('Não cumprido: B')));
});

test('No jogo: objetivos gravados com tamanho e fase, tela com andamento, crise detectada e save antigo recebe objetivos', async () => {
  const { db, clubId } = await setup();
  const ov = getBoardOverview(db).club!;
  assert.ok(ov.profile, 'tamanho e fase');
  assert.ok(ov.objectives.length >= 4 && ov.objectives[0]!.kind === 'league' && ov.objectives[0]!.importance === 'essential');
  assert.ok(ov.objectives.every((o) => o.progress >= 0 && o.progress <= 1 && o.detail.length > 0));
  assert.deepEqual(ov.secondary.map((s) => s.label), ov.objectives.slice(1).map((o) => o.label), 'Visão geral usa os mesmos objetivos');
  // crise: caixa negativo no início da temporada
  withTransaction(db, () => { db.prepare('UPDATE clubs SET balance = -1000000 WHERE id = ?').run(clubId); setBoardForSeason(db, 60); });
  const crisis = getBoardOverview(db).club!;
  assert.equal(crisis.profile!.phase, 'crisis');
  assert.ok(crisis.objectives.some((o) => o.kind === 'payroll_cut'));
  // save anterior: sem objetivos gravados, ensureBoard monta
  db.exec('DELETE FROM board_objectives');
  ensureBoard(db);
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM board_objectives') >= 4);
  // confiança registrada no dia 1º
  withTransaction(db, () => moveClock(db, getCareerState(db).gameDate, '2026-08-01', new Date('2030-01-01T00:00:00Z')));
  assert.equal(getBoardOverview(db).club!.confidenceHistory.at(-1)!.date, '2026-08-01');
});

test('Virada: os objetivos são julgados (cumprido/não), entram na avaliação e a temporada nova recebe outros', async () => {
  const { db, clubId } = await setup('bo-turn');
  db.prepare('UPDATE board_state SET confidence = 90').run();
  const season = getCareerState(db).season;
  playAll(db); advanceTime(db, 'nextMatchday');
  const r = startNextSeason(db);
  assert.ok(r.board);
  const judged = db.prepare('SELECT kind, status FROM board_objectives WHERE club_id = ? AND season = ?').all(clubId, season);
  assert.ok(judged.length >= 4 && judged.every((o) => o.status === 'met' || o.status === 'missed'));
  assert.ok(r.board!.lines.some((l) => /^(Cumprido|Não cumprido): /.test(l)), 'linhas por objetivo no relatório');
  if (getCareerState(db).clubId) assert.ok(n(db, 'SELECT COUNT(*) AS n FROM board_objectives WHERE club_id = ? AND season = ? AND status IS NULL', clubId, getCareerState(db).season) >= 4, 'objetivos da temporada nova');
});
