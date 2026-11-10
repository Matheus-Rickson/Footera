/**
 * Contratos (v0.8.9): tempo de jogo combinado (status), avaliação mensal dos minutos e renegociação a qualquer momento com até 3
 * contrapropostas do jogador.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { getContracts, renegotiateContract, SeasonError } from '../database/repositories/seasonRepository.ts';
import { processPlayingTimeMonth, squadRoles, totalClubMatches } from '../database/repositories/squadRoleRepository.ts';
import { setListed } from '../database/repositories/transferRepository.ts';
import { getNews } from '../database/repositories/newsRepository.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import {
  defaultStatuses, MAX_RENEGOTIATION_ROUNDS, playingTimeVerdict, renegotiationReply, renegotiationTarget, renewalDemand, STATUS_INFO,
} from '../game/career-engine/contracts.ts';
import { addDays } from '../shared/date.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed: string) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 6 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id };
}

test('Tempo de jogo (regras): status padrão pela força, veredito pelos minutos e contraproposta do exemplo (30.000 → oferta 25.000 → pede 27.000)', () => {
  const squad = Array.from({ length: 25 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, overall: 80 - i, age: i >= 22 ? 19 : 27 }));
  const st = defaultStatuses(squad);
  const count = (s: string) => [...st.values()].filter((x) => x === s).length;
  assert.deepEqual([count('key'), count('starter'), count('rotation'), count('prospect'), count('backup')], [3, 8, 7, 3, 4]);
  assert.equal(st.get('p00'), 'key'); assert.equal(st.get('p11'), 'rotation'); assert.equal(st.get('p24'), 'prospect'); assert.equal(st.get('p18'), 'backup');
  // veredito: abaixo de 60% do esperado, insatisfeito; no esperado, satisfeito
  assert.equal(playingTimeVerdict(0.41, 0.7), 'unhappy');
  assert.equal(playingTimeVerdict(0.42, 0.7), 'ok');
  assert.equal(playingTimeVerdict(0.7, 0.7), 'happy');
  // contraproposta: oferta + 40% da diferença; o pedido dele sempre fecha; na 3ª oferta insuficiente ele encerra
  const r1 = renegotiationReply({ offered: 25_000, target: 30_000, round: 0, lastCounter: null });
  assert.deepEqual(r1, { kind: 'counter', wage: 27_000, roundsLeft: 2 });
  assert.deepEqual(renegotiationReply({ offered: 27_000, target: 30_000, round: 1, lastCounter: 27_000 }), { kind: 'accept' });
  const r2 = renegotiationReply({ offered: 26_000, target: 30_000, round: 1, lastCounter: 27_000 });
  assert.deepEqual(r2, { kind: 'counter', wage: 27_000, roundsLeft: 1 }, 'nunca pede mais do que o pedido anterior');
  assert.deepEqual(renegotiationReply({ offered: 26_000, target: 30_000, round: MAX_RENEGOTIATION_ROUNDS - 1, lastCounter: 27_000 }), { kind: 'walkout' });
  assert.deepEqual(renegotiationReply({ offered: 29_100, target: 30_000, round: 0, lastCounter: null }), { kind: 'accept' }, '97% basta');
  assert.equal((renegotiationReply({ offered: 1_000, target: 30_000, round: 0, lastCounter: null }) as { wage: number }).wage, 25_500, 'oferta absurda: piso de 85%');
  // status mais alto pede mais; mais baixo, menos (em relação ao atual)
  assert.equal(renegotiationTarget(30_000, 'rotation', 'starter'), 31_500);
  assert.equal(renegotiationTarget(30_000, 'starter', 'backup'), Math.round((30_000 * STATUS_INFO.backup.wageFactor) / STATUS_INFO.starter.wageFactor / 100) * 100);
  assert.equal(renegotiationTarget(30_000, 'key', 'key'), 30_000);
});

test('Contratos: todo jogador do elenco tem status; renegociar sem temporadas a mais mantém o fim do contrato; lista de transferências e rebaixamento de status', async () => {
  const { db, clubId } = await setup('pt-renego');
  const rows = getContracts(db);
  assert.equal(rows.length, Number(db.prepare('SELECT COUNT(*) AS n FROM players WHERE club_id = ?').get(clubId)!.n));
  assert.equal(rows.filter((r) => r.squadStatus === 'key').length, 3);
  assert.ok(rows.every((r) => r.talk.roundsLeft === MAX_RENEGOTIATION_ROUNDS && r.minutesShare === null && r.canRenew === !r.retiring));
  // lista de transferências aparece na linha
  const star = rows.find((r) => r.squadStatus === 'key')!;
  setListed(db, star.id, true);
  assert.equal(getContracts(db).find((r) => r.id === star.id)!.listed, true);
  // rebaixar de Jogador-chave para Reserva mantendo o salário e o fim do contrato: aceita (pede menos), moral cai 5 por degrau
  const p = rowToPlayer(db.prepare('SELECT * FROM players WHERE id = ?').get(star.id)!);
  const morale = p.morale;
  const r = renegotiateContract(db, { playerId: star.id, wage: p.salary, years: 0, status: 'backup' });
  assert.equal(r.outcome, 'accepted', r.message);
  const after = db.prepare('SELECT salary, contract_end, morale FROM players WHERE id = ?').get(star.id)!;
  assert.deepEqual([Number(after.salary), String(after.contract_end)], [p.salary, p.contractEnd]);
  assert.equal(Number(after.morale), Math.max(10, morale - 5 * 3));
  assert.equal(squadRoles(db).get(star.id)!.status, 'backup');
  assert.ok(getNews(db).some((n) => n.title === `Contrato renegociado: ${p.firstName} ${p.lastName}` && n.body.includes('de Jogador-chave para Reserva')));
  // nada mudou: recusado antes de virar rodada; promessa só até 21 anos
  assert.throws(() => renegotiateContract(db, { playerId: star.id, wage: p.salary, years: 0 }), SeasonError);
  const veteran = rows.find((x) => x.age > 21)!;
  assert.throws(() => renegotiateContract(db, { playerId: veteran.id, wage: veteran.salary * 2, years: 0, status: 'prospect' }), /até 21 anos/);
});

test('Contratos: três ofertas baixas e o jogador encerra a conversa por 30 dias; depois volta a negociar do zero', async () => {
  const { db, clubId } = await setup('pt-walkout');
  const p = rowToPlayer(db.prepare('SELECT * FROM players WHERE club_id = ? ORDER BY overall DESC LIMIT 1').get(clubId)!);
  const low = Math.round(p.salary * 0.5);
  const a = renegotiateContract(db, { playerId: p.id, wage: low, years: 0 });
  const b = renegotiateContract(db, { playerId: p.id, wage: low, years: 0 });
  assert.deepEqual([a.outcome, a.roundsLeft, b.outcome, b.roundsLeft], ['counter', 2, 'counter', 1]);
  assert.equal(getContracts(db).find((r) => r.id === p.id)!.talk.lastCounter, b.counterWage);
  const c = renegotiateContract(db, { playerId: p.id, wage: low, years: 0 });
  const today = String(db.prepare('SELECT game_date AS d FROM career').get()!.d);
  assert.deepEqual([c.outcome, c.lockedUntil], ['walkout', addDays(today, 30)]);
  const row = getContracts(db).find((r) => r.id === p.id)!;
  assert.deepEqual([row.canRenew, row.talk.roundsLeft, row.talk.lockedUntil], [false, 0, addDays(today, 30)]);
  assert.throws(() => renegotiateContract(db, { playerId: p.id, wage: p.salary * 3, years: 0 }), /encerrou a conversa/);
  assert.equal(Number(db.prepare('SELECT salary FROM players WHERE id = ?').get(p.id)!.salary), p.salary, 'nada mudou');
  // passado o bloqueio: conversa nova (3 tentativas)
  db.prepare('UPDATE career SET game_date = ?').run(addDays(today, 30));
  const again = renegotiateContract(db, { playerId: p.id, wage: low, years: 0 });
  assert.deepEqual([again.outcome, again.roundsLeft], ['counter', 2]);
  // aceitar o pedido dele fecha (pode ser abaixo do salário atual: redução negociada)
  const demand = renewalDemand({ marketValue: p.marketValue, salary: p.salary, ambition: p.personality.ambition, loyalty: p.personality.loyalty });
  assert.ok(again.counterWage! < demand);
  assert.equal(renegotiateContract(db, { playerId: p.id, wage: again.counterWage!, years: 0 }).outcome, 'accepted');
  assert.equal(Number(db.prepare('SELECT salary FROM players WHERE id = ?').get(p.id)!.salary), again.counterWage);
  assert.equal(db.prepare('SELECT 1 AS x FROM contract_talks WHERE player_id = ?').get(p.id), undefined, 'conversa encerrada ao fechar');
});

test('Tempo de jogo (mês): com 3+ jogos, quem joga menos que o combinado perde moral e entra no e-mail; lesionado fica de fora; com menos jogos, espera', async () => {
  const { db, clubId } = await setup('pt-month');
  const roles = squadRoles(db);
  const byStatus = (s: string) => [...roles].filter(([, r]) => r.status === s).map(([id]) => id);
  const [happyKey, injuredKey] = byStatus('key');
  const [benchedStarter] = byStatus('starter');
  const backup = byStatus('backup')[0] ?? byStatus('prospect')[0]!;
  const comp = String(db.prepare('SELECT id FROM competitions LIMIT 1').get()!.id);
  const giveMinutes = (id: string, minutes: number) => db.prepare('INSERT OR REPLACE INTO player_season_stats (player_id, competition_id, club_id, appearances, minutes) VALUES (?, ?, ?, 4, ?)').run(id, comp, clubId, minutes);
  giveMinutes(happyKey!, 340); giveMinutes(backup, 60);
  const today = String(db.prepare('SELECT game_date AS d FROM career').get()!.d);
  db.prepare("INSERT OR REPLACE INTO player_status (player_id, injury_until, suspension_matches, yellow_cards) VALUES (?, ?, 0, 0)").run(injuredKey!, addDays(today, 20));
  const matches = totalClubMatches(db, clubId);
  const morale = (id: string) => Number(db.prepare('SELECT morale FROM players WHERE id = ?').get(id)!.morale);
  const before = new Map([happyKey!, injuredKey!, benchedStarter!, backup].map((id) => [id, morale(id)]));
  // só 2 jogos desde a base: ninguém é avaliado
  db.prepare('UPDATE squad_roles SET base_matches = ?, base_minutes = 0').run(matches - 2);
  const month1 = `${addDays(today, 40).slice(0, 7)}-01`;
  assert.equal(processPlayingTimeMonth(db, month1), 0);
  assert.ok([...squadRoles(db).values()].every((r) => r.verdict === null));
  // 4 jogos (360 minutos possíveis)
  db.prepare('UPDATE squad_roles SET base_matches = ?').run(matches - 4);
  assert.ok(processPlayingTimeMonth(db, month1) > 0);
  const now = squadRoles(db);
  assert.equal(now.get(happyKey!)!.verdict, 'happy');      // 94% ≥ 85%
  assert.equal(now.get(backup)!.verdict, 'happy');         // 17% ≥ 15%
  assert.equal(now.get(benchedStarter!)!.verdict, 'unhappy');
  assert.equal(now.get(injuredKey!)!.verdict, null, 'lesionado no período não é julgado');
  assert.equal(morale(happyKey!), Math.min(100, before.get(happyKey!)! + 2));
  assert.equal(morale(benchedStarter!), Math.max(10, before.get(benchedStarter!)! - 6));
  assert.equal(morale(injuredKey!), before.get(injuredKey!));
  const mail = getNews(db).find((n) => n.title.startsWith('Tempo de jogo'))!;
  assert.ok(mail && mail.action === 'contracts');
  const name = (id: string) => { const r = db.prepare('SELECT first_name, last_name FROM players WHERE id = ?').get(id)!; return `${String(r.first_name)} ${String(r.last_name)}`; };
  assert.ok(mail.body.includes(name(benchedStarter!)) && !mail.body.includes(name(happyKey!)) && !mail.body.includes(name(injuredKey!)));
  // a base recomeçou: no mesmo mês, sem jogos novos, nada a julgar
  assert.equal(processPlayingTimeMonth(db, month1), 0);
  // fora do dia 1º não roda
  assert.equal(processPlayingTimeMonth(db, addDays(month1, 1)), 0);
});
