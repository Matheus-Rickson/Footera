import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld, buildPlayer } from '../game/world/generator.ts';
import { COUNTRY_TEMPLATES } from '../game/world/names.ts';
import { createRng } from '../game/rng.ts';
import { getCareerState, moveClock } from '../database/repositories/competitionRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import { developPlayer, PEAK_AGE } from '../game/career-engine/development.ts';
import {
  bestFocus, chooseIntensity, FOCUS_KEYS, INTENSITY, recoveryFactor, stadiumExpansion, staffCandidates, trainingInjuryChance, upgradeCost, upgradeDays,
} from '../game/training-engine/training.ts';
import { staffUserMonthly } from '../game/finance-engine/finance.ts';
import { loadClubEcon } from '../database/repositories/financeRepository.ts';
import { fireStaff, getStaffOverview, hireStaff, medicalFactor, StaffError } from '../database/repositories/staffRepository.ts';
import { getMedicalOverview, getTrainingOverview, processTrainingMonth, setDelegated, setFocus, setIntensity, TrainingError } from '../database/repositories/trainingRepository.ts';
import { getInfrastructureOverview, InfrastructureError, startUpgrade } from '../database/repositories/infrastructureRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import type { Coach, Player } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'ts', teams = 6) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: teams });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  db.exec("UPDATE fixtures SET status = 'played', home_goals = 0, away_goals = 0"); // só o relógio, sem partidas no caminho
  return { db, clubId: world.clubs[0]!.id, initial: new Map(world.clubs.map((c) => [c.id, c.balance])) };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const clockTo = (db: SqlDb, to: string) => withTransaction(db, () => moveClock(db, getCareerState(db).gameDate, to, new Date('2030-01-01T00:00:00Z')));
function assertBooksBalance(db: SqlDb, initial: Map<string, number>) {
  for (const [id, start] of initial) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', id), start + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', id), `saldo de ${id}`);
}
const young = (seed: string, age: number, pos: Player['position'] = 'ST'): Player => {
  let k = 0;
  return buildPlayer(createRng(seed), (p) => `${p}_${++k}`, COUNTRY_TEMPLATES[0]!, 'c', 60, pos, '2026-07-01', { first: 'A', last: 'B' }, { forceAge: age });
};
const hireRole = (db: SqlDb, role: string, best = true) => {
  const c = getStaffOverview(db).roles.find((r) => r.role === role)!.candidates.sort((a, b) => (best ? b.ability - a.ability : a.ability - b.ability))[0]!;
  hireStaff(db, c.id);
  return c;
};

test('Evolução mensal: 12 meses ≈ 1 ano, respeita o teto antes dos 28, e o foco faz os atributos escolhidos crescerem mais', () => {
  let monthly = 0, annual = 0, focused = 0, other = 0;
  for (let i = 0; i < 150; i++) {
    const base = young(`m${i}`, 17 + (i % 6));
    const a = developPlayer(base, 17 + (i % 6), 0.5, createRng(`a${i}`));
    annual += a.overall - base.overall;
    let b = base, p = base;
    for (let m = 0; m < 12; m++) {
      b = { ...b, ...developPlayer(b, 17 + (i % 6), 0.5, createRng(`mb${i}-${m}`), { fraction: 1 / 12 }) };
      const d = developPlayer(p, 17 + (i % 6), 0.5, createRng(`mm${i}-${m}`), { fraction: 1 / 12, focusKeys: new Set(FOCUS_KEYS.finishing) });
      if (17 + (i % 6) < PEAK_AGE) assert.ok(d.overall <= base.potentialHidden && b.overall <= base.potentialHidden, 'teto respeitado mês a mês');
      p = { ...p, ...d };
    }
    monthly += b.overall - base.overall;
    for (const k of Object.keys(base.attributes.technical)) {
      const diff = (p.attributes.technical as unknown as Record<string, number>)[k]! - (base.attributes.technical as unknown as Record<string, number>)[k]!;
      if (FOCUS_KEYS.finishing.includes(k)) focused += diff; else other += diff;
    }
  }
  assert.ok(Math.abs(monthly / 150 - annual / 150) < 0.8, `média mensal ${(monthly / 150).toFixed(2)} vs anual ${(annual / 150).toFixed(2)}`);
  // técnicos: 3 do foco "finalização" (finishing, firstTouch, heading, longShots são técnicos: 4) contra 6 fora dele
  assert.ok(focused / 4 > (other / 6) * 1.3, `foco ${(focused / 4).toFixed(2)} vs demais ${(other / 6).toFixed(2)} por atributo`);
});

test('Treino: comissão/instalação melhores e intensidade forte aceleram a evolução; preparador freia o declínio físico', () => {
  let low = 0, high = 0, decLow = 0, decHigh = 0;
  for (let i = 0; i < 200; i++) {
    const p = young(`q${i}`, 18);
    const run = (g: number) => { let x = p; for (let m = 0; m < 12; m++) x = { ...x, ...developPlayer(x, 18, 0.5, createRng(`r${i}-${m}`), { fraction: 1 / 12, growth: { technical: g, mental: g, physical: g } }) }; return x.overall - p.overall; };
    low += run(0.9 * INTENSITY.light.growth); high += run(1.1 * INTENSITY.hard.growth);
    const v = young(`v${i}`, 33);
    const decl = (f: number) => developPlayer(v, 34, 0.5, createRng(`d${i}`), { physicalDecline: f });
    decLow += Object.values(decl(1.1).attributes.physical).reduce((s, x) => s + x, 0); decHigh += Object.values(decl(0.9).attributes.physical).reduce((s, x) => s + x, 0);
  }
  assert.ok(high > low * 1.15, `forte+comissão ${high} vs leve+sem comissão ${low}`);
  assert.ok(decHigh > decLow, 'veterano com bom preparador perde menos físico');
});

test('Regras puras: melhor foco, intensidade do preparador, risco de lesão, recuperação, custos e prazos de obras', () => {
  const st = young('f1', 22, 'ST');
  st.attributes.technical.finishing = 3; st.attributes.mental.composure = 3; st.attributes.technical.firstTouch = 3; st.attributes.technical.heading = 3;
  assert.equal(bestFocus('ST', st.attributes, 22), 'finishing');
  assert.equal(bestFocus('GK', st.attributes, 22), 'goalkeeping');
  assert.equal(bestFocus('CM', st.attributes, 33), 'physical');
  for (let i = 0; i < 60; i++) {
    const cb = young(`cb${i}`, 20, 'CB'), w = young(`st${i}`, 20, 'ST');
    assert.ok(['defense', 'physical', 'creation'].includes(bestFocus('CB', cb.attributes, 20)), 'zagueiro não treina finalização');
    assert.notEqual(bestFocus('ST', w.attributes, 20), 'defense', 'atacante não treina defesa');
  }
  assert.equal(chooseIntensity(75, 0), 'light'); assert.equal(chooseIntensity(96, 2), 'light');
  assert.equal(chooseIntensity(97, 0), 'hard'); assert.equal(chooseIntensity(90, 1), 'normal');
  const inj = (i: keyof typeof INTENSITY) => INTENSITY[i].injury;
  assert.ok(trainingInjuryChance(90, inj('hard'), 5) > trainingInjuryChance(90, inj('normal'), 5) && trainingInjuryChance(90, inj('normal'), 5) > trainingInjuryChance(90, inj('light'), 5));
  assert.equal(trainingInjuryChance(60, 1, 5), 2 * trainingInjuryChance(90, 1, 5));
  assert.ok(trainingInjuryChance(90, 1, 20) < trainingInjuryChance(90, 1, 1), 'preparador previne');
  assert.equal(trainingInjuryChance(90, 0, 5), 0, 'folga, recuperação e dia de jogo: sem risco de treino');
  assert.equal(trainingInjuryChance(90, 1, 5, 20), trainingInjuryChance(90, 1, 5), 'carga de jogos normal não muda o risco');
  assert.ok(Math.abs(trainingInjuryChance(90, 1, 5, 35) - 2 * trainingInjuryChance(90, 1, 5)) < 1e-12, 'carga 15 acima do limite dobra o risco');
  assert.equal(recoveryFactor(0, 0), 1.15); assert.ok(Math.abs(recoveryFactor(20, 20) - 0.85) < 1e-9);
  for (const k of ['training', 'youth', 'medical', 'stadium'] as const) assert.ok(upgradeCost(k, 10, 1) > upgradeCost(k, 5, 1) && upgradeDays(k, 10) > upgradeDays(k, 5));
  assert.ok(upgradeCost('stadium', 5, 1) > upgradeCost('training', 5, 1));
  assert.equal(stadiumExpansion(40_000), 2000);
  const c = staffCandidates('s', '2026-07', COUNTRY_TEMPLATES, 0.6);
  assert.equal(c.length, 12); assert.deepEqual(c, staffCandidates('s', '2026-07', COUNTRY_TEMPLATES, 0.6));
});

test('Comissão técnica: 3 candidatos por função, um profissional por função, salário mensal e multa pela porta única, contrato que vence', async () => {
  const { db, clubId, initial } = await setup('ts-staff');
  const ov = getStaffOverview(db);
  assert.equal(ov.roles.length, 4);
  assert.ok(ov.roles.every((r) => r.candidates.length === 3 && r.member === null));
  const doc = hireRole(db, 'doctor'), ass = hireRole(db, 'assistant');
  const otherDoc = getStaffOverview(db).roles.find((r) => r.role === 'doctor')!.candidates[0]!;
  assert.throws(() => hireStaff(db, otherDoc.id), StaffError, 'um por função');
  assert.throws(() => hireStaff(db, 'stf_inventado'), StaffError);
  clockTo(db, '2026-08-02');
  assert.equal(n(db, "SELECT amount AS n FROM finance_months WHERE club_id = ? AND month = '2026-08' AND category = 'coaching'", clubId), -(doc.salary + ass.salary));
  assert.equal(n(db, "SELECT amount AS n FROM finance_months WHERE club_id = ? AND month = '2026-08' AND category = 'staff'", clubId), -staffUserMonthly(loadClubEcon(db, clubId)));
  const before = medicalFactor(db, clubId);
  const member = getStaffOverview(db).roles.find((r) => r.role === 'doctor')!.member!;
  assert.equal(fireStaff(db, member.id), member.salary * 3);
  assert.ok(medicalFactor(db, clubId) > before, 'sem médico, lesões demoram mais');
  assertBooksBalance(db, initial);
  db.prepare("UPDATE staff SET contract_end = '2026-08-02'").run();
  clockTo(db, '2026-08-03');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM staff'), 0);
  assert.ok(getNews(db).some((x) => x.kind === 'staff' && x.title.startsWith('Fim de contrato')));
});

test('Treino: o técnico define intensidade e focos; delegar exige preparador físico, que escolhe focos e intensidade; demiti-lo retoma o controle', async () => {
  const { db, clubId } = await setup('ts-train');
  const pid = String(db.prepare('SELECT id FROM players WHERE club_id = ? LIMIT 1').get(clubId)!.id);
  setIntensity(db, 'hard'); setFocus(db, pid, 'defense');
  let ov = getTrainingOverview(db);
  assert.equal(ov.intensity, 'hard'); assert.equal(ov.players.find((p) => p.id === pid)!.focus, 'defense');
  const other = String(db.prepare('SELECT id FROM players WHERE club_id <> ? LIMIT 1').get(clubId)!.id);
  assert.throws(() => setFocus(db, other, 'defense'), TrainingError);
  assert.throws(() => setDelegated(db, true), /preparador físico/);
  hireRole(db, 'fitness');
  setDelegated(db, true);
  ov = getTrainingOverview(db);
  assert.equal(ov.delegated, true);
  assert.ok(ov.players.every((p) => p.focus === p.suggestedFocus), 'o preparador aplica o melhor foco de cada jogador');
  // quem entra no elenco depois da revisão também segue o preparador (sem esperar a segunda-feira)
  const newcomer = String(db.prepare('SELECT id FROM players WHERE youth_club_id = ? LIMIT 1').get(clubId)!.id);
  db.prepare('UPDATE players SET club_id = youth_club_id, youth_club_id = NULL WHERE id = ?').run(newcomer);
  const nc = getTrainingOverview(db).players.find((p) => p.id === newcomer)!;
  assert.equal(nc.focus, nc.suggestedFocus);
  assert.throws(() => setIntensity(db, 'light'), TrainingError);
  assert.throws(() => setFocus(db, pid, 'finishing'), TrainingError);
  clockTo(db, '2026-07-05');
  db.exec('UPDATE players SET condition_pct = 70'); // elenco cansado na véspera
  clockTo(db, '2026-07-06'); // segunda-feira: revisão da rotina
  assert.equal(getTrainingOverview(db).intensity, 'light', 'elenco cansado: o preparador alivia');
  fireStaff(db, getStaffOverview(db).roles.find((r) => r.role === 'fitness')!.member!.id);
  assert.equal(getTrainingOverview(db).delegated, false);
});

test('Treino no dia a dia: intensidade forte recupera menos; lesionado fica com condição limitada; evolução só no dia 1º e uma vez por mês', async () => {
  const { db, clubId } = await setup('ts-daily');
  const mine = db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 2').all(clubId).map((r) => String(r.id));
  db.exec('UPDATE players SET condition_pct = 50');
  db.exec('DELETE FROM player_status');
  setIntensity(db, 'hard'); clockTo(db, '2026-07-02');
  const hard = n(db, 'SELECT condition_pct AS n FROM players WHERE id = ?', mine[0]);
  setIntensity(db, 'light'); db.exec('UPDATE players SET condition_pct = 50'); clockTo(db, '2026-07-03');
  const light = n(db, 'SELECT condition_pct AS n FROM players WHERE id = ?', mine[0]);
  assert.ok(light > hard, `leve ${light} vs forte ${hard}`);
  db.prepare("INSERT INTO player_status (player_id, injury_until, injury_note) VALUES (?, '2026-07-20', 'teste') ON CONFLICT(player_id) DO UPDATE SET injury_until = excluded.injury_until").run(mine[1]);
  db.prepare('UPDATE players SET condition_pct = 100 WHERE id = ?').run(mine[1]);
  clockTo(db, '2026-07-10');
  assert.equal(n(db, 'SELECT condition_pct AS n FROM players WHERE id = ?', mine[1]), 60, 'lesionado sem ritmo');
  assert.ok(getMedicalOverview(db).injured.some((x) => x.id === mine[1] && x.daysLeft === 10));
  const snap = () => JSON.stringify(db.prepare('SELECT id, overall, attributes_json FROM players ORDER BY id').all());
  const s0 = snap();
  clockTo(db, '2026-07-31');
  assert.equal(snap(), s0, 'sem evolução no meio do mês');
  clockTo(db, '2026-08-01');
  const s1 = snap();
  assert.notEqual(s1, s0, 'evolução no dia 1º');
  assert.equal(withTransaction(db, () => processTrainingMonth(db, '2026-08-02')), 0, 'fora do dia 1º não evolui');
});

test('Determinismo: treino, lesões de treino e evolução mensal idênticos com a mesma semente', async () => {
  const dump = async () => {
    const { db } = await setup('ts-det');
    hireRole(db, 'fitness'); setDelegated(db, true);
    clockTo(db, '2026-11-15');
    return JSON.stringify([db.prepare('SELECT id, overall, attributes_json, condition_pct FROM players ORDER BY id').all(), db.prepare('SELECT * FROM player_status ORDER BY player_id').all(), db.prepare('SELECT * FROM player_training ORDER BY player_id').all()]);
  };
  assert.equal(await dump(), await dump());
});

test('Infraestrutura: obra paga na hora pela porta única, uma por vez, conclui no prazo e sobe o nível (estádio ganha lugares; manutenção aumenta)', async () => {
  const { db, clubId, initial } = await setup('ts-infra');
  db.prepare('UPDATE clubs SET balance = balance + 80000000 WHERE id = ?').run(clubId); initial.set(clubId, initial.get(clubId)! + 80_000_000); // aporte do teste
  const ov = getInfrastructureOverview(db);
  const stadium = ov.facilities.find((f) => f.kind === 'stadium')!, training = ov.facilities.find((f) => f.kind === 'training')!;
  assert.ok(training.extraMonthly! > 0 && stadium.extraSeats! > 0);
  db.prepare('UPDATE clubs SET balance = 10 WHERE id = ?').run(clubId);
  assert.throws(() => startUpgrade(db, 'training'), /Caixa insuficiente/);
  db.prepare('UPDATE clubs SET balance = ? WHERE id = ?').run(initial.get(clubId)!, clubId); // volta ao valor (nenhum lançamento ainda)
  const staffBefore = staffUserMonthly(loadClubEcon(db, clubId));
  startUpgrade(db, 'training');
  assert.throws(() => startUpgrade(db, 'stadium'), InfrastructureError, 'uma obra por vez');
  assert.equal(n(db, "SELECT amount AS n FROM finance_ledger WHERE category = 'infrastructure'"), -training.cost!);
  assertBooksBalance(db, initial);
  const end = getInfrastructureOverview(db).project!.end;
  assert.equal(getInfrastructureOverview(db).project!.toLevel, training.level + 1);
  clockTo(db, end);
  const after = getInfrastructureOverview(db);
  assert.equal(after.project, null);
  assert.equal(after.facilities.find((f) => f.kind === 'training')!.level, training.level + 1);
  assert.equal(staffUserMonthly(loadClubEcon(db, clubId)) - staffBefore, training.extraMonthly, 'manutenção mensal maior');
  startUpgrade(db, 'stadium');
  // o prazo real passaria da virada (o relógio para em 1º/jul): aqui só importa a conclusão, então a obra é encurtada
  db.prepare("UPDATE construction_projects SET end_date = date(?, '+5 days') WHERE status = 'active'").run(getCareerState(db).gameDate);
  clockTo(db, getInfrastructureOverview(db).project!.end);
  assert.equal(getInfrastructureOverview(db).capacity, ov.capacity + stadium.extraSeats!);
  assert.ok(getNews(db).filter((x) => x.title.startsWith('Obra concluída')).length === 2);
  assertBooksBalance(db, initial);
});

test('Virada: registra o saldo da temporada a partir da força do início e reinicia a referência', async () => {
  const { db } = await setup('ts-turn');
  const { startNextSeason } = await import('../database/repositories/seasonRepository.ts');
  clockTo(db, '2027-07-01');
  const sample = db.prepare('SELECT id, season_start_overall FROM players WHERE retired = 0 ORDER BY id LIMIT 50').all();
  startNextSeason(db);
  for (const r of sample) {
    const d = db.prepare('SELECT overall_before, overall_after FROM player_development WHERE player_id = ? AND season = 2026').get(String(r.id));
    if (!d) continue; // aposentado na virada
    assert.deepEqual([Number(d.overall_before), Number(d.overall_after)], [Number(r.season_start_overall), n(db, 'SELECT overall AS n FROM players WHERE id = ?', String(r.id))]);
  }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM players WHERE retired = 0 AND season_start_overall <> overall'), 0);
});
