import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { getCareerState, moveClock } from '../database/repositories/competitionRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import { addDays, daysBetween, weekday } from '../shared/date.ts';
import { effSharp } from '../database/repositories/fitnessState.ts';
import { loadSquad } from '../database/repositories/squadRepository.ts';
import { conditionAfter, simulateMatch, startFatigue } from '../game/match-engine/engine.ts';
import { assignLineup, chooseFormation, pickBench, toMatchPlayer } from '../game/match-engine/team-builder.ts';
import { readiness, selectionCondition, sharpnessFactor } from '../game/match-engine/roles.ts';
import { FORMATIONS } from '../game/match-engine/formations.ts';
import type { MatchPlayer, TeamTactics } from '../game/match-engine/types.ts';
import { adjustWeek, bestGkSession, gkCoachFactor, monthlyMultipliers, SESSION, sessionFor, TEMPLATES, type Session } from '../game/training-engine/sessions.ts';
import { acuteAt, nextAcuteLoad, nextSharpness, recoverDay, recoveryRate, sharpnessAfterMatch, sharpnessAt, sharpnessDecay, SHARP, type RecoveryCtx } from '../game/training-engine/condition.ts';
import { chooseTemplate } from '../game/training-engine/training.ts';
import { getStaffOverview, hireStaff } from '../database/repositories/staffRepository.ts';
import {
  applyTemplate, getMedicalOverview, getTrainingOverview, processTrainingMonth, riskReasons, setAutoAdjust, setDelegated, setGkSession, setWeekSession, TrainingError, weekPlan,
} from '../database/repositories/trainingRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'tsess', teams = 6) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  db.exec("UPDATE fixtures SET status = 'played', home_goals = 0, away_goals = 0"); // só o relógio, sem partidas no caminho
  return { db, clubId: world.clubs[0]!.id };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const clockTo = (db: SqlDb, to: string) => withTransaction(db, () => moveClock(db, getCareerState(db).gameDate, to, new Date('2030-01-01T00:00:00Z')));
const hireRole = (db: SqlDb, role: string, best = true) => {
  const c = getStaffOverview(db).roles.find((r) => r.role === role)!.candidates.sort((a, b) => (best ? b.ability - a.ability : a.ability - b.ability))[0]!;
  hireStaff(db, c.id);
  return c;
};
const ctx = (session: Session, extra: Partial<RecoveryCtx> = {}): RecoveryCtx => ({ session, loadMul: 1, fitnessQ: 5, medicalLevel: 10, age: 26, naturalFitness: 10, ...extra });

test('Semana: o dia de jogo é Jogo; com o ajuste, o dia seguinte vira Recuperação e a véspera Pré-jogo; sem o ajuste vale a grade', () => {
  const week = TEMPLATES.balanced.week; // dom folga, seg técnico, ter físico, qua tático, qui técnico, sex tático, sáb pré-jogo
  assert.deepEqual(adjustWeek(week, new Set([0])), ['match', 'recovery', 'physical', 'tactical', 'technical', 'tactical', 'prematch']);
  // dois jogos (domingo e quarta): entre eles só recuperação e pré-jogo
  assert.deepEqual(adjustWeek(week, new Set([0, 3])), ['match', 'recovery', 'prematch', 'match', 'recovery', 'tactical', 'prematch']);
  // jogos com um dia de intervalo: a recuperação vence a véspera
  assert.equal(sessionFor('physical', { today: false, yesterday: true, tomorrow: true }, true), 'recovery');
  assert.deepEqual(adjustWeek(week, new Set([0]), false), ['match', 'technical', 'physical', 'tactical', 'technical', 'tactical', 'prematch']);
  assert.equal(chooseTemplate(95, 2, 10), 'double');
  assert.equal(chooseTemplate(78, 1, 10), 'recovery');
  assert.equal(chooseTemplate(95, 0, 10), 'preseason');
  assert.equal(chooseTemplate(95, 1, 10), 'balanced');
});

test('Condição: recuperação não linear — de 70% a ~95% em 3 dias leves; preparador, recuperação e juventude aceleram; físico e veterano freiam', () => {
  // 3 dias leves depois do jogo (recuperação, pré-jogo, manhã do jogo): ~72 h para voltar
  let c = 70;
  for (const s of ['recovery', 'prematch', 'match'] as const) c = recoverDay(c, ctx(s));
  assert.ok(c >= 94 && c <= 97.5, `domingo → quarta: ${c}%`);
  c = 70;
  for (const s of ['recovery', 'rest', 'rest'] as const) c = recoverDay(c, ctx(s));
  assert.ok(c >= 95, `3 dias de descanso: ${c}%`);
  // semana padrão entre dois domingos: chega inteiro ao jogo
  c = 70;
  for (const s of adjustWeek(TEMPLATES.balanced.week, new Set([0])).slice(1)) c = recoverDay(c, ctx(s));
  c = recoverDay(c, ctx('match'));
  assert.ok(c >= 94, `domingo seguinte: ${c}%`);
  // equilíbrio de quem só treina (sem jogos): perto de 94% em sessões de carga 3
  c = 100;
  for (let i = 0; i < 20; i++) c = recoverDay(c, ctx('technical'));
  assert.ok(c > 92 && c < 96, `equilíbrio no treino técnico: ${c}%`);
  assert.ok(recoveryRate(ctx('recovery')) > recoveryRate(ctx('technical')) && recoveryRate(ctx('technical')) > recoveryRate(ctx('physical')));
  assert.ok(recoveryRate(ctx('technical', { fitnessQ: 20 })) > recoveryRate(ctx('technical', { fitnessQ: 5 })), 'preparador acelera');
  assert.ok(recoveryRate(ctx('technical', { medicalLevel: 20 })) > recoveryRate(ctx('technical', { medicalLevel: 1 })), 'departamento médico acelera');
  assert.ok(recoveryRate(ctx('technical', { age: 21 })) > recoveryRate(ctx('technical')) && recoveryRate(ctx('technical')) > recoveryRate(ctx('technical', { age: 32 }))
    && recoveryRate(ctx('technical', { age: 32 })) > recoveryRate(ctx('technical', { age: 35 })), 'idade');
  assert.ok(recoveryRate(ctx('technical', { naturalFitness: 18 })) > recoveryRate(ctx('technical', { naturalFitness: 4 })), 'recuperação física');
  assert.ok(recoverDay(90, ctx('physical', { loadMul: 1.4 })) < recoverDay(90, ctx('physical', { loadMul: 0.6 })), 'intensidade forte cansa mais');
  assert.equal(recoverDay(32, ctx('physical', { loadMul: 10 })), 30, 'piso de 30%');
  // carga aguda: média móvel exponencial de 7 dias
  assert.equal(nextAcuteLoad(0, 10), 10);
  assert.ok(Math.abs(nextAcuteLoad(10, 0) - 10 * Math.exp(-1 / 7)) < 0.06);
});

test('Condição pós-jogo: deriva da fadiga do jogo (sublinear), quem entra cansado começa com fadiga e rende menos', () => {
  assert.equal(conditionAfter(100, 0, 0), 100);
  const full = conditionAfter(100, 31, 90);
  assert.ok(full >= 68 && full <= 72, `90 minutos com fadiga típica: ${full}%`);
  assert.ok(conditionAfter(100, 6, 20) > 90, 'substituto que entra aos 70 perde pouco');
  // sublinear: o dobro da fadiga custa menos que o dobro
  assert.ok(100 - conditionAfter(100, 62, 0) < 2 * (100 - conditionAfter(100, 31, 0)));
  assert.equal(conditionAfter(40, 60, 120), 30, 'piso de 30%');
  assert.equal(startFatigue(100), 0); assert.equal(startFatigue(95), 0);
  assert.ok(Math.abs(startFatigue(70) - 15) < 1e-9);
  // prontidão: condição pesa pouco (o cansaço vem da fadiga inicial); o ritmo de jogo pesa até 8%
  const p = { condition: 100, morale: 70, form: 60 } as MatchPlayer;
  assert.ok(readiness({ ...p, condition: 70 }) / readiness(p) > 0.98);
  assert.equal(sharpnessFactor(undefined), 1); assert.equal(sharpnessFactor(100), 1); assert.ok(Math.abs(sharpnessFactor(0) - 0.92) < 1e-9);
  assert.ok(readiness({ ...p, sharpness: 0 }) < readiness({ ...p, sharpness: 100 }));
});

// base real: calibração com milhares de jogadores (mesma semente = mesmo resultado)
const w = baseUniverse().world;
const byClub = new Map<string, typeof w.players>();
for (const pl of w.players) if (pl.clubId) (byClub.get(pl.clubId) ?? byClub.set(pl.clubId, []).get(pl.clubId)!).push(pl);
const clubs = w.clubs.filter((c) => (byClub.get(c.id)?.length ?? 0) >= 20);
const squad = (id: string, pre: string, condition = 100) => (byClub.get(id) ?? []).map((pl) => ({ ...toMatchPlayer({ ...pl, condition, morale: 70, form: 60 }), id: pre + pl.id }));
const T = (pressing: number, tempo: number): TeamTactics => ({ mentality: 'balanced', tempo, width: 3, defensiveLine: 3, pressing, buildUp: 'mixed' });
const sheetOf = (id: string, pl: MatchPlayer[], tac: TeamTactics) => { const f = chooseFormation(pl).formation; const { lineup } = assignLineup(pl, f); return { clubId: id, name: id, formation: f.id, lineup, bench: pickBench(pl, lineup), tactics: tac, cohesion: 1 }; };
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]!; };

test('Calibração da condição (base real): 90 minutos terminam perto de 70%; pressão alta e calor cansam mais', () => {
  const run = (tac: TeamTactics, weather: 'clear' | 'heat') => {
    const full: number[] = [];
    for (let i = 0; i < 120; i++) {
      const a = clubs[(i * 7) % clubs.length]!.id, b = clubs[(i * 13 + 5) % clubs.length]!.id;
      if (a === b) continue;
      const o = simulateMatch(sheetOf(a, squad(a, 'H:'), tac), sheetOf(b, squad(b, 'A:'), tac), { seed: `cal-${i}`, conditions: { weather, pitch: 'good' } });
      for (const r of o.players) if (r.minutes >= 90) full.push(conditionAfter(100, r.fatigue, r.minutes));
    }
    return full;
  };
  const std = run(T(3, 3), 'clear'), press = run(T(5, 4), 'clear'), heat = run(T(3, 3), 'heat');
  assert.ok(q(std, 0.5) >= 66 && q(std, 0.5) <= 74, `mediana com a tática padrão: ${q(std, 0.5)}% (antes ~87%)`);
  assert.ok(q(std, 0.1) >= 58 && q(std, 0.9) <= 80, `P10/P90: ${q(std, 0.1)} / ${q(std, 0.9)}`);
  assert.ok(q(press, 0.5) < q(std, 0.5) - 5, `pressão alta: ${q(press, 0.5)}%`);
  assert.ok(q(heat, 0.5) < q(std, 0.5), `calor: ${q(heat, 0.5)}%`);
});

test('Cansaço pesa: time inteiro a 70% rende menos; a escalação poupa quem está abaixo de 88%', () => {
  let fresh = 0, tired = 0;
  for (let i = 0; i < 160; i++) {
    const a = clubs[(i * 11) % clubs.length]!.id, b = clubs[(i * 11 + 1) % clubs.length]!.id;
    const B = sheetOf(b, squad(b, 'A:'), T(3, 3));
    const o1 = simulateMatch(sheetOf(a, squad(a, 'H:'), T(3, 3)), B, { seed: `tired-${i}` });
    const o2 = simulateMatch(sheetOf(a, squad(a, 'H:', 70), T(3, 3)), B, { seed: `tired-${i}` });
    fresh += o1.homeGoals - o1.awayGoals; tired += o2.homeGoals - o2.awayGoals;
  }
  assert.ok(tired < fresh - 15, `saldo de gols: descansado ${fresh}, cansado ${tired}`);
  // escolha: titular a 70% perde a vaga para um reserva pouco pior e descansado
  assert.equal(selectionCondition(95), 1); assert.equal(selectionCondition(88), 1); assert.ok(Math.abs(selectionCondition(78) - 0.9) < 1e-9);
  const id = clubs[0]!.id;
  const pl = squad(id, 'S:');
  const f = FORMATIONS.find((x) => x.id === '4-4-2') ?? FORMATIONS[0]!;
  const starters = assignLineup(pl, f).lineup.map((l) => l.player.id);
  const tiredIds = new Set(starters.filter((x, i) => i > 0 && i <= 4)); // quatro titulares de linha cansados
  const pl2 = pl.map((p) => (tiredIds.has(p.id) ? { ...p, condition: 65 } : p));
  const after = new Set(assignLineup(pl2, f).lineup.map((l) => l.player.id));
  assert.ok([...tiredIds].filter((x) => !after.has(x)).length >= 2, 'a maioria dos cansados vai para o banco');
});

test('Ritmo de jogo: sobe jogando, cai parado (o preparador freia) e cai mais lesionado; sessões tática e pré-jogo dão um pouco', () => {
  assert.equal(sharpnessAfterMatch(50, 90), 50 + SHARP.perMatch);
  assert.equal(sharpnessAfterMatch(95, 90), 100);
  assert.equal(sharpnessAfterMatch(50, 45), 56);
  const base = { injured: false, session: 'technical' as Session, fitnessQ: 0 };
  assert.equal(nextSharpness(80, { ...base, idle: 3 }), 80, 'jogou há poucos dias: mantém');
  assert.equal(nextSharpness(80, { ...base, idle: 6 }), 80 - SHARP.decay);
  assert.equal(nextSharpness(80, { ...base, idle: null }), 80 - SHARP.decay, 'nunca jogou: cai');
  assert.equal(nextSharpness(80, { ...base, idle: 6, fitnessQ: 20 }), 80 - SHARP.decayBestCoach, 'preparador de qualidade máxima freia');
  assert.equal(nextSharpness(80, { ...base, idle: 6, injured: true }), 80 - SHARP.injured);
  assert.equal(nextSharpness(80, { ...base, idle: 2, session: 'tactical' }), 80 + SESSION.tactical.sharp);
  assert.equal(nextSharpness(0, { ...base, idle: 30 }), 0);
  // piso da inatividade: parado não cai abaixo de 60; abaixo dele (lesão), parado não cai mais
  assert.equal(nextSharpness(60.5, { ...base, idle: 6 }), SHARP.idleFloor);
  assert.equal(nextSharpness(55, { ...base, idle: 6 }), 55);
  assert.equal(nextSharpness(55, { ...base, idle: 6, injured: true }), 55 - SHARP.injured, 'lesionado cai abaixo do piso');
  // cálculo preguiçoso (sem gravar todo dia) = aplicar a regra dia a dia, com e sem preparador, jogou ou nunca jogou
  for (const [q, lp] of [[0, null], [20, null], [0, '2026-03-01'], [10, '2026-03-08'], [20, '2026-02-20']] as Array<[number, string | null]>) {
    let s = 97, d = '2026-03-05';
    for (let i = 0; i < 60; i++) {
      d = addDays(d, 1);
      s = nextSharpness(s, { ...base, fitnessQ: q, idle: lp ? daysBetween(lp, d) : null });
      assert.ok(Math.abs(sharpnessAt(97, '2026-03-05', lp, d, sharpnessDecay(q)) - s) < 0.05 * (i + 1), `q ${q}, último jogo ${lp}, ${d}: ${s}`);
    }
    assert.equal(s, SHARP.idleFloor, 'dois meses parado: piso');
  }
  assert.equal(sharpnessAt(80, null, null, '2026-05-01'), 80, 'sem data: sem queda');
  let a = 25;
  for (let i = 1; i <= 10; i++) { a = nextAcuteLoad(a, 0); assert.ok(Math.abs(acuteAt(25, '2026-03-05', addDays('2026-03-05', i)) - a) <= 0.15, `carga dia ${i}`); }
  assert.equal(acuteAt(25, '2026-03-05', '2026-03-05'), 25);
});

test('Evolução por sessões: semana Equilibrada = multiplicador 1 (sem inflação); grade física aumenta o físico; goleiros pelo treinador de goleiros', () => {
  const acc = (week: Session[], growth = 1) => {
    const actual: Record<string, number> = {}, ref: Record<string, number> = {};
    for (let d = 0; d < 28; d++) {
      const m = new Set([0]); // um jogo por semana, no domingo
      const s = adjustWeek(week, m)[d % 7]!, r = adjustWeek(TEMPLATES.balanced.week, m)[d % 7]!;
      for (const g of ['physical', 'technical', 'mental'] as const) { actual[g] = (actual[g] ?? 0) + SESSION[s].growth[g] * growth; ref[g] = (ref[g] ?? 0) + SESSION[r].growth[g]; }
      actual.role = (actual.role ?? 0) + SESSION[s].role; ref.role = (ref.role ?? 0) + SESSION[r].role;
    }
    return monthlyMultipliers({ actual, ref });
  };
  assert.deepEqual(acc(TEMPLATES.balanced.week), { physical: 1, technical: 1, mental: 1, role: 1 });
  const hard = acc(TEMPLATES.balanced.week, 1.14);
  assert.ok(Math.abs(hard.physical - 1.14) < 1e-9 && Math.abs(hard.technical - 1.14) < 1e-9, 'intensidade forte = +14% como antes');
  const pre = acc(TEMPLATES.preseason.week);
  assert.ok(pre.physical > 1.15 && pre.technical <= 1 && pre.mental < 1, `pré-temporada: ${JSON.stringify(pre)}`);
  const tac = acc(TEMPLATES.tactical.week);
  assert.ok(tac.mental > 1 && tac.role > 1, 'tática: mental e domínio da função');
  const rec = acc(TEMPLATES.recovery.week);
  assert.ok(rec.physical < 1 && rec.technical < 1 && rec.mental < 1, 'semana de recuperação: evolui menos');
  assert.deepEqual(monthlyMultipliers({ actual: { physical: 100 }, ref: { physical: 1 } }).physical, 1.3, 'teto');
  assert.deepEqual(monthlyMultipliers({ actual: {}, ref: {} }), { physical: 1, technical: 1, mental: 1, role: 1 }, 'sem acumulado');
  assert.equal(gkCoachFactor(0), 0.8); assert.equal(gkCoachFactor(20), 1.1); assert.equal(gkCoachFactor(5), 0.875);
  const gk = { technical: { passing: 15 }, goalkeeper: { reflexes: 15, oneOnOne: 15, handling: 15, aerial: 15, rushingOut: 15, kicking: 6 } } as never;
  assert.equal(bestGkSession(gk), 'distribution', 'o treinador de goleiros escolhe o ponto mais fraco');
});

test('Treino no banco: grade com jogos, modelos, ajuste, sessão de goleiros e travas da delegação', async () => {
  const { db, clubId } = await setup('tsess-week');
  assert.deepEqual(weekPlan(db), TEMPLATES.balanced.week, 'carreira nova: semana Equilibrada');
  const ov = getTrainingOverview(db);
  assert.equal(ov.week.length, 7); assert.equal(ov.autoAdjust, true); assert.equal(ov.template, 'balanced');
  const games = new Set(db.prepare('SELECT match_date AS d FROM fixtures WHERE home_club_id = ? OR away_club_id = ?').all(clubId, clubId).map((r) => String(r.d)));
  for (const d of ov.week) {
    if (games.has(d.date)) { assert.equal(d.session, 'match'); assert.ok(d.opponent); }
    else if (games.has(addDays(d.date, -1))) assert.equal(d.session, 'recovery', `${d.date}: dia seguinte ao jogo`);
    else if (games.has(addDays(d.date, 1))) assert.equal(d.session, 'prematch', `${d.date}: véspera`);
    else assert.equal(d.session, d.planned);
  }
  setWeekSession(db, 2, 'tactical');
  assert.equal(weekPlan(db)[2], 'tactical'); assert.equal(getTrainingOverview(db).template, 'custom');
  applyTemplate(db, 'preseason');
  assert.deepEqual(weekPlan(db), TEMPLATES.preseason.week);
  setAutoAdjust(db, false);
  assert.ok(getTrainingOverview(db).week.every((d) => d.session === 'match' || d.session === d.planned), 'sem ajuste: vale a grade');
  assert.throws(() => setWeekSession(db, 7, 'rest'), TrainingError);
  assert.throws(() => setWeekSession(db, 1, 'match' as never), TrainingError);
  const gk = String(db.prepare("SELECT id FROM players WHERE club_id = ? AND position = 'GK' LIMIT 1").get(clubId)!.id);
  const out = String(db.prepare("SELECT id FROM players WHERE club_id = ? AND position <> 'GK' LIMIT 1").get(clubId)!.id);
  setGkSession(db, gk, 'aerial');
  assert.equal(getTrainingOverview(db).players.find((p) => p.id === gk)!.gkSession, 'aerial');
  setGkSession(db, gk, null);
  assert.equal(getTrainingOverview(db).players.find((p) => p.id === gk)!.gkSession, null);
  assert.throws(() => setGkSession(db, out, 'aerial'), TrainingError, 'só goleiros');
  hireRole(db, 'fitness');
  setDelegated(db, true);
  assert.throws(() => setWeekSession(db, 1, 'rest'), TrainingError);
  assert.throws(() => applyTemplate(db, 'balanced'), TrainingError);
  assert.throws(() => setAutoAdjust(db, true), TrainingError);
  assert.equal(getTrainingOverview(db).autoAdjust, true, 'o preparador sempre ajusta aos jogos');
});

test('Treino no dia a dia: jogadores da IA e do usuário recuperam pela sessão; carga aguda e ritmo mudam; o mês acumula a grade × Equilibrada', async () => {
  const { db, clubId } = await setup('tsess-day');
  db.exec('DELETE FROM player_status');
  db.exec('UPDATE players SET condition_pct = 70, acute_load = 0, sharpness = 80, last_played = NULL');
  clockTo(db, addDays(getCareerState(db).gameDate, 1));
  const c = n(db, 'SELECT AVG(condition_pct) AS n FROM players WHERE club_id = ?', clubId);
  const ai = n(db, 'SELECT AVG(condition_pct) AS n FROM players WHERE club_id <> ? AND club_id IS NOT NULL', clubId);
  assert.ok(c > 78 && ai > 78, `um dia: usuário ${c.toFixed(1)}, IA ${ai.toFixed(1)}`);
  assert.ok(n(db, 'SELECT MAX(sharpness) AS n FROM players WHERE club_id IS NOT NULL') <= 81, 'sem jogo: o ritmo não sobe além das sessões');
  assert.ok(n(db, 'SELECT MIN(sharpness) AS n FROM players WHERE club_id = ?', clubId) < 80, 'sem jogar: o ritmo do usuário cai (gravado no dia)');
  // IA: ritmo preguiçoso — a linha não é regravada (desempenho), o valor do dia sai da fórmula e cai igual
  assert.equal(n(db, 'SELECT MIN(sharpness) AS n FROM players WHERE club_id <> ? AND club_id IS NOT NULL', clubId), 80, 'IA: sem escrita diária do ritmo');
  const aiRow = db.prepare('SELECT sharpness, sharp_on, last_played FROM players WHERE club_id <> ? AND club_id IS NOT NULL ORDER BY id LIMIT 1').get(clubId)!;
  assert.ok(effSharp(aiRow, addDays(getCareerState(db).gameDate, 10), sharpnessDecay(0)) < 80, 'IA: o ritmo efetivo cai com os dias');
  // a carga das sessões só gasta a condição do usuário; a IA só recupera (e quem está inteiro não é regravado)
  assert.ok(ai >= c, `IA recupera ao menos o que o usuário recupera no dia de treino: ${ai.toFixed(1)} × ${c.toFixed(1)}`);
  const rows = db.prepare('SELECT key, actual, ref FROM training_month').all();
  assert.ok(rows.length === 4, 'acumulado: físico, técnico, mental e função');
  for (const r of rows) assert.equal(Number(r.actual), Number(r.ref), `semana Equilibrada normal: ${String(r.key)} igual à referência`);
  // o dia 1º consome o acumulado e zera
  const first = (() => { let d = getCareerState(db).gameDate; while (d.slice(8) !== '01') d = addDays(d, 1); return d; })();
  clockTo(db, first);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM training_month WHERE ref > 0 AND actual = 0'), 0);
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM training_month') <= 4);
  // o lesionado fica no teto e perde ritmo mais rápido
  const pid = String(db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 1').get(clubId)!.id);
  db.prepare("INSERT INTO player_status (player_id, injury_until, injury_note) VALUES (?, ?, 'teste') ON CONFLICT(player_id) DO UPDATE SET injury_until = excluded.injury_until").run(pid, addDays(first, 30));
  db.prepare('UPDATE players SET condition_pct = 100, sharpness = 80 WHERE id = ?').run(pid);
  clockTo(db, addDays(first, 2));
  assert.equal(n(db, 'SELECT condition_pct AS n FROM players WHERE id = ?', pid), 60);
  assert.equal(n(db, 'SELECT sharpness AS n FROM players WHERE id = ?', pid), 80 - 2 * SHARP.injured);
  // lesionado da IA também tem o ritmo gravado no dia (cai 3 por dia, abaixo do piso se precisar)
  const aid = String(db.prepare('SELECT id FROM players WHERE club_id <> ? AND club_id IS NOT NULL ORDER BY id LIMIT 1').get(clubId)!.id);
  const d0 = getCareerState(db).gameDate;
  db.prepare("INSERT INTO player_status (player_id, injury_until, injury_note) VALUES (?, ?, 'teste') ON CONFLICT(player_id) DO UPDATE SET injury_until = excluded.injury_until").run(aid, addDays(d0, 30));
  db.prepare('UPDATE players SET sharpness = 62, sharp_on = ?, last_played = NULL WHERE id = ?').run(d0, aid);
  clockTo(db, addDays(d0, 2));
  assert.equal(n(db, 'SELECT sharpness AS n FROM players WHERE id = ?', aid), 62 - 2 * SHARP.injured);
});

test('Ritmo e carga do dia (preguiçosos): escalação, departamento médico e migração usam o valor na data, não o gravado', async () => {
  const { db, clubId } = await setup('tsess-lazy');
  const date = getCareerState(db).gameDate;
  const other = String(db.prepare('SELECT club_id AS c FROM players WHERE club_id <> ? AND club_id IS NOT NULL LIMIT 1').get(clubId)!.c);
  db.prepare('UPDATE players SET sharpness = 90, sharp_on = ?, last_played = NULL WHERE club_id = ?').run(addDays(date, -30), other);
  const sq = loadSquad(db, other, date);
  assert.ok(sq.players.length > 0 && sq.players.every((p) => p.sharpness === SHARP.idleFloor), 'trinta dias parado: a escalação vê o piso, não os 90 gravados');
  // carga gravada há duas semanas já caiu (40 → ~5): não é mais "carga alta"
  const pid = String(db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 1').get(clubId)!.id);
  db.exec('DELETE FROM player_status');
  db.prepare('UPDATE players SET condition_pct = 70, acute_load = 40, acute_on = ?, sharpness = 90, sharp_on = ? WHERE id = ?').run(addDays(date, -14), date, pid);
  const row = getMedicalOverview(db).atRisk.find((x) => x.id === pid)!;
  assert.ok(row && row.acuteLoad < 10 && !row.reasons.some((r) => r.startsWith('carga alta')), `carga do dia: ${row?.acuteLoad}`);
  const { migration034 } = await import('../database/migrations/034_training_sessions.ts');
  assert.match(migration034.sql, /UPDATE players SET sharp_on = \(SELECT game_date FROM career WHERE id = 1\);/, 'save antigo: o ritmo gravado vale na data atual');
});

test('Goleiros: com o melhor treinador de goleiros evoluem mais que sem ninguém (mesma semente)', async () => {
  const gkSum = async (hire: boolean) => {
    const { db, clubId } = await setup('tsess-gk');
    if (hire) hireRole(db, 'goalkeeping');
    db.prepare("UPDATE players SET birth_date = '2006-01-01' WHERE club_id = ? AND position = 'GK'").run(clubId); // jovens: evoluem
    let total = 0;
    for (const d of ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']) {
      withTransaction(db, () => processTrainingMonth(db, d));
    }
    for (const r of db.prepare("SELECT attributes_json FROM players WHERE club_id = ? AND position = 'GK'").all(clubId)) {
      const g = (JSON.parse(String(r.attributes_json)) as { goalkeeper: Record<string, number> }).goalkeeper;
      total += Object.values(g).reduce((s, v) => s + v, 0);
    }
    return total;
  };
  const without = await gkSum(false), withCoach = await gkSum(true);
  assert.ok(withCoach > without, `atributos de goleiro: sem treinador ${without}, com treinador ${withCoach}`);
});

test('Comissão: relatórios semanais só com o profissional contratado; departamento médico lista os motivos de risco e a recomendação', async () => {
  const { db, clubId } = await setup('tsess-staff');
  const monday = (() => { let d = addDays(getCareerState(db).gameDate, 1); while (weekday(d) !== 1) d = addDays(d, 1); return d; })();
  clockTo(db, monday);
  assert.ok(!getNews(db).some((x) => /preparador físico|treinador de goleiros/.test(x.sender ?? '')), 'sem comissão: sem relatório');
  const vacant = getStaffOverview(db).roles.find((r) => r.role === 'goalkeeping')!;
  assert.deepEqual([vacant.quality, vacant.effects[0]], [5, { label: 'Evolução dos goleiros', value: '-12%' }], 'sem treinador de goleiros: qualidade 5 → ×0,875');
  const fitHired = hireRole(db, 'fitness'); hireRole(db, 'goalkeeping');
  const fitRole = getStaffOverview(db).roles.find((r) => r.role === 'fitness')!;
  assert.equal(fitRole.quality, fitHired.ability);
  assert.equal(fitRole.effects.find((e) => e.label === 'Recuperação da condição')!.value, `+${Math.round(((0.08 * fitHired.ability) / 20 / 0.45) * 100)}%`, 'efeitos na tela = fórmulas do treino');
  db.prepare('UPDATE players SET condition_pct = 66, acute_load = 40 WHERE id = (SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 1)').run(clubId);
  clockTo(db, addDays(monday, 7));
  const news = getNews(db);
  const fit = news.find((x) => /preparador físico/.test(x.sender ?? ''));
  assert.ok(fit && /Condição média/.test(fit.body) && /Recomendações/.test(fit.body), 'relatório físico');
  assert.ok(news.some((x) => /treinador de goleiros/.test(x.sender ?? '') && /sessão/.test(x.body)), 'relatório dos goleiros');
  // risco: motivos e recomendação
  assert.deepEqual(riskReasons(95, 10, 90, 25, 1), []);
  assert.deepEqual(riskReasons(68, 40, 30, 33, 3), ['condição 68%', 'carga alta (40, 3 jogos em 7 dias)', 'sem ritmo de jogo (30)', 'veterano (33 anos)']);
  const pid = String(db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 1').get(clubId)!.id);
  db.exec('DELETE FROM player_status');
  db.prepare('UPDATE players SET condition_pct = 66, acute_load = 40, sharpness = 90 WHERE id = ?').run(pid);
  const med = getMedicalOverview(db);
  const row = med.atRisk.find((x) => x.id === pid)!;
  assert.ok(row.reasons.some((r) => r.startsWith('condição')) && row.reasons.some((r) => r.startsWith('carga alta')));
  assert.ok(row.advice && /poupar/.test(row.advice), 'recomendação do preparador');
});

test('Migração 034: colunas e tabelas novas com valores iniciais', async () => {
  const { db } = await setup('tsess-mig');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM training_week'), 7);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM players WHERE sharpness IS NULL OR acute_load IS NULL"), 0);
  assert.equal(n(db, 'SELECT auto_adjust AS n FROM training_settings WHERE id = 1'), 1);
  // save antigo: quem jogou na temporada começa com ritmo 85 (a regra da migração, aplicada de novo)
  const { migration034 } = await import('../database/migrations/034_training_sessions.ts');
  assert.match(migration034.sql, /sharpness = 85 WHERE id IN \(SELECT player_id FROM player_season_stats WHERE minutes > 0\)/);
});
