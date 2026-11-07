import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { continueDay, createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { getCareerState, getCompetitionTable } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { getClubProfile } from '../database/repositories/clubProfileRepository.ts';
import { getConversations, processPromisesDay, talkToBoard, talkToPlayer } from '../database/repositories/promiseRepository.ts';
import { getBoardOverview } from '../database/repositories/boardRepository.ts';
import { EFFECT, judgeMinutes, judgeWins, promisedPosition, talkOutcome, TALK } from '../game/promise-engine/promises.ts';
import { addDays } from '../shared/date.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed: string): Promise<{ db: SqlDb; clubId: string }> {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const morale = (db: SqlDb, id: string) => n(db, 'SELECT morale AS n FROM players WHERE id = ?', id);
/** joga um jogo do clube: Continuar até o dia do jogo (passando por decisões) e simula a rodada */
function playOne(db: SqlDb) {
  for (let i = 0; i < 200; i++) { const s = continueDay(db); if (s.stop === 'user_match') { simulateMatchday(db); return; } }
  throw new Error('sem jogo do clube');
}

test('Regras puras: elogio/cobrança conforme forma e moral; julgamento de minutos e vitórias; posição prometida', () => {
  assert.equal(talkOutcome('praise', { form: 70, morale: 50 }).moraleDelta, 6);
  assert.equal(talkOutcome('praise', { form: 50, morale: 50 }).moraleDelta, 2);
  assert.equal(talkOutcome('praise', { form: 30, morale: 50 }).moraleDelta, -3);
  assert.deepEqual([talkOutcome('demand', { form: 40, morale: 60 }).formDelta, talkOutcome('demand', { form: 40, morale: 60 }).moraleDelta], [6, -2]);
  assert.equal(talkOutcome('demand', { form: 40, morale: 30 }).moraleDelta, -6);
  assert.equal(talkOutcome('demand', { form: 60, morale: 60 }).moraleDelta, -5);
  assert.deepEqual([judgeMinutes(225, 5), judgeMinutes(224, 5), judgeMinutes(0, 0)], ['kept', 'broken', 'void']);
  assert.deepEqual([judgeWins(3, 5), judgeWins(2, 5), judgeWins(2, 3), judgeWins(1, 3), judgeWins(0, 0)], ['kept', 'broken', 'kept', 'broken', 'void']);
  assert.deepEqual([promisedPosition(1), promisedPosition(2), promisedPosition(8)], [null, 1, 6]);
});

test('Conversa com jogador: efeito na moral, intervalo entre conversas, só com jogador do elenco', async () => {
  const { db, clubId } = await setup('conversa');
  const p = db.prepare('SELECT id, morale, form FROM players WHERE club_id = ? ORDER BY id LIMIT 1').get(clubId)!;
  const id = String(p.id);
  db.prepare('UPDATE players SET form = 70, morale = 50 WHERE id = ?').run(id);
  const r = talkToPlayer(db, id, 'praise');
  assert.equal(morale(db, id), 56);
  assert.match(r.message, /reconhecimento/);
  assert.throws(() => talkToPlayer(db, id, 'demand'), /conversaram há pouco/);
  const c = r.conversations.players.find((x) => x.id === id)!;
  assert.equal(c.nextTalk, addDays(getCareerState(db).gameDate, TALK.playerCooldown));
  assert.match(c.topics.praise!, /nova conversa/);
  const other = String(db.prepare('SELECT id FROM players WHERE club_id <> ? LIMIT 1').get(clubId)!.id);
  assert.throws(() => talkToPlayer(db, other, 'praise'), /não é do seu elenco/);
  // pedem conversa: moral abaixo de 40
  const sad = String(db.prepare('SELECT id FROM players WHERE club_id = ? AND id <> ? ORDER BY id LIMIT 1').get(clubId, id)!.id);
  db.prepare('UPDATE players SET morale = 25 WHERE id = ?').run(sad);
  assert.deepEqual(getConversations(db).requests.map((x) => x.playerId), [sad]);
});

test('Promessa de renovação: cumprida ao renovar; quebrada no prazo (moral exata); anulada se o jogador sair', async () => {
  const { db, clubId } = await setup('renovacao');
  const today = getCareerState(db).gameDate;
  const ps = db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 3').all(clubId).map((r) => String(r.id));
  for (const id of ps) db.prepare('UPDATE players SET contract_end = ?, morale = 60 WHERE id = ?').run(addDays(today, 300), id);
  const far = String(db.prepare('SELECT id FROM players WHERE club_id = ? AND id NOT IN (?, ?, ?) LIMIT 1').get(clubId, ...ps)!.id);
  db.prepare('UPDATE players SET contract_end = ? WHERE id = ?').run(addDays(today, 1000), far);
  assert.throws(() => talkToPlayer(db, far, 'promise_renewal'), /mais de 18 meses/);
  for (const id of ps) talkToPlayer(db, id, 'promise_renewal');
  assert.equal(morale(db, ps[0]!), 60 + EFFECT.renewal.now);
  assert.throws(() => talkToPlayer(db, ps[0]!, 'promise_minutes'), /conversaram há pouco/);
  // renovou → cumprida
  db.prepare('UPDATE players SET contract_end = ? WHERE id = ?').run(addDays(today, 1400), ps[0]);
  processPromisesDay(db, today);
  assert.equal(morale(db, ps[0]!), 60 + EFFECT.renewal.now + EFFECT.renewal.kept);
  // jogador vendido → anulada, sem efeito
  const otherClub = String(db.prepare('SELECT id FROM clubs WHERE id <> ? LIMIT 1').get(clubId)!.id);
  db.prepare('UPDATE players SET club_id = ? WHERE id = ?').run(otherClub, ps[2]);
  // prazo vencido sem renovar → quebrada
  const due = String(db.prepare('SELECT due FROM promises WHERE player_id = ?').get(ps[1])!.due);
  assert.equal(due, addDays(today, TALK.renewalDays));
  processPromisesDay(db, addDays(due, -1));
  assert.equal(db.prepare('SELECT status FROM promises WHERE player_id = ?').get(ps[1])!.status, 'open', 'antes do prazo continua aberta');
  processPromisesDay(db, due);
  assert.equal(morale(db, ps[1]!), 60 + EFFECT.renewal.now + EFFECT.renewal.broken);
  const st = Object.fromEntries(db.prepare('SELECT player_id, status FROM promises').all().map((r) => [String(r.player_id), String(r.status)]));
  assert.deepEqual([st[ps[0]!], st[ps[1]!], st[ps[2]!]], ['kept', 'broken', 'void']);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM news WHERE title LIKE 'Promessa %'"), 2, 'cumprida e quebrada viram mensagem; anulada não');
});

test('Promessa de minutos (jogador lesionado não joga → quebrada) e de vitórias à diretoria, julgadas depois de 5 jogos', async () => {
  const { db, clubId } = await setup('minutos');
  const id = String(db.prepare("SELECT id FROM players WHERE club_id = ? AND position <> 'GK' ORDER BY id LIMIT 1").get(clubId)!.id);
  talkToPlayer(db, id, 'promise_minutes');
  db.prepare("INSERT INTO player_status (player_id, injury_until, injury_note, suspension_matches, yellow_cards) VALUES (?, '2027-06-01', 'teste', 0, 0) ON CONFLICT(player_id) DO UPDATE SET injury_until = '2027-06-01'").run(id);
  const conf0 = getBoardOverview(db).club!.confidence;
  talkToBoard(db, 'promise_wins');
  assert.equal(getBoardOverview(db).club!.confidence, Math.min(100, conf0 + EFFECT.wins.now));
  assert.throws(() => talkToBoard(db, 'promise_position'), /diretoria só recebe/);
  for (let i = 0; i < TALK.minutesMatches - 1; i++) playOne(db);
  playOne(db);
  // 5º jogo disputado: a cobrança é no fim do dia (moveClock); aqui chamamos direto para medir o efeito exato
  const m0 = morale(db, id), c0 = getBoardOverview(db).club!.confidence;
  processPromisesDay(db, getCareerState(db).gameDate);
  const rows = Object.fromEntries(db.prepare('SELECT kind, status FROM promises').all().map((r) => [String(r.kind), String(r.status)]));
  assert.equal(rows.minutes, 'broken');
  assert.equal(morale(db, id), Math.max(10, m0 + EFFECT.minutes.broken));
  const res = db.prepare("SELECT home_club_id, home_goals, away_goals FROM fixtures WHERE status = 'played' AND (home_club_id = ? OR away_club_id = ?) ORDER BY match_date, id").all(clubId, clubId);
  const wins = res.filter((f) => (String(f.home_club_id) === clubId ? 1 : -1) * (Number(f.home_goals) - Number(f.away_goals)) > 0).length;
  assert.equal(res.length, 5);
  assert.equal(rows.wins, judgeWins(wins, 5));
  const eff = rows.wins === 'kept' ? EFFECT.wins.kept : EFFECT.wins.broken;
  assert.equal(getBoardOverview(db).club!.confidence, Math.max(0, Math.min(100, Math.round((c0 + eff) * 10) / 10)));
});

test('Ficha completa do clube: campanha igual à tabela, estatísticas do elenco, últimos e próximos jogos; humor da torcida', async () => {
  const { db, clubId } = await setup('ficha');
  for (let i = 0; i < 3; i++) playOne(db);
  const other = String(db.prepare('SELECT home_club_id AS c FROM fixtures WHERE status = \'played\' AND home_club_id <> ? AND away_club_id <> ? LIMIT 1').get(clubId, clubId)!.c);
  for (const id of [clubId, other]) {
    const f = getClubProfile(db, id);
    const t = getCompetitionTable(db, f.league!.competitionId);
    assert.deepEqual(f.league!.row, t.rows.find((r) => r.clubId === id));
    assert.equal(f.squad.length, n(db, 'SELECT COUNT(*) AS n FROM players WHERE club_id = ?', id));
    assert.equal(f.squad.reduce((s, p) => s + p.goals, 0), n(db, 'SELECT COALESCE(SUM(goals), 0) AS n FROM player_season_stats WHERE club_id = ?', id));
    assert.ok(f.recent.length > 0 && f.recent.every((x) => x.status === 'played' && (x.homeId === id || x.awayId === id)));
    for (let i = 1; i < f.recent.length; i++) assert.ok(f.recent[i - 1]!.date <= f.recent[i]!.date, 'últimos jogos em ordem');
    assert.ok(f.upcoming.length > 0 && f.upcoming.every((x) => x.status === 'scheduled'));
    assert.ok(!('overall' in f.squad[0]!), 'sem força dos jogadores (estimativas só no perfil)');
  }
  const fans = getBoardOverview(db).club!.fans;
  assert.ok(fans.mood >= 0 && fans.mood <= 100);
  assert.match(fans.detail, /Últimos jogos: [VED]( [VED]){2}/);
});
