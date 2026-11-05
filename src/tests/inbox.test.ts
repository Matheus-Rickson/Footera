import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { addNews, getNews, markRead, unreadCount } from '../database/repositories/newsRepository.ts';
import { setListed } from '../database/repositories/transferRepository.ts';

const coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' as const, reputation: 20, photoPath: null };
async function career(seed: string) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return db;
}

test('Caixa de entrada: remetente e ação padrão por tipo, ação explícita (ou nenhuma), lida/não lida', async () => {
  const db = await career('ib-a');
  db.exec('DELETE FROM news');
  addNews(db, '2026-07-02', 'medical', 'Lesão: X fora por 10 dias', 'corpo');
  addNews(db, '2026-07-03', 'staff', 'Obra iniciada', 'corpo', { sender: 'Departamento de infraestrutura', action: 'infrastructure', actionLabel: 'Ver infraestrutura' });
  addNews(db, '2026-07-04', 'season', 'Começa a temporada', '', { action: null });
  const [noAction, obra, lesao] = getNews(db);
  assert.deepEqual([lesao!.sender, lesao!.action, lesao!.actionLabel, lesao!.read], ['Departamento médico', 'tactics', 'Ajustar a escalação em Táticas', false]);
  assert.deepEqual([obra!.sender, obra!.action, obra!.actionLabel], ['Departamento de infraestrutura', 'infrastructure', 'Ver infraestrutura']);
  assert.deepEqual([noAction!.action, noAction!.actionLabel], [null, null], 'sem ação: sem botão');
  assert.equal(unreadCount(db), 3);
  markRead(db, lesao!.id);
  assert.equal(unreadCount(db), 2); assert.equal(getNews(db).find((m) => m.id === lesao!.id)!.read, true);
  markRead(db, null);
  assert.equal(unreadCount(db), 0);
  // mensagens antigas (sem remetente/ação): reclassificadas pelo assunto
  db.prepare("INSERT INTO news (date, kind, title, body, read) VALUES ('2026-07-05', 'staff', 'Departamento médico: X se lesionou no treino', 'Previsão de retorno em 5 dias.', 1)").run();
  db.prepare("INSERT INTO news (date, kind, title, body, read) VALUES ('2026-07-06', 'season', 'Diretoria em alerta: o cargo do treinador está ameaçado', 'x', 1)").run();
  const [alerta, antiga] = getNews(db);
  assert.deepEqual([antiga!.kind, antiga!.sender, antiga!.action], ['medical', 'Departamento médico', 'tactics']);
  assert.deepEqual([alerta!.kind, alerta!.sender, alerta!.action], ['board', 'Diretoria', 'board']);
});

test('Caixa de entrada na carreira: toda lesão e suspensão de jogador seu e toda proposta recebida chegam com ação para resolver', async () => {
  // amostra: a primeira semente (de uma lista fixa) em que houve lesão de jogador seu nas partidas
  const userInjuries = (db: Awaited<ReturnType<typeof career>>, club: string) => db.prepare('SELECT report_json FROM matches').all()
    .flatMap((m) => { const r = JSON.parse(String(m.report_json)) as { home: { clubId: string }; away: { clubId: string }; players: Array<{ team: 0 | 1; injuredDays?: number }> }; return r.players.filter((p) => (p.team === 0 ? r.home : r.away).clubId === club && (p.injuredDays ?? 0) > 0); }).length;
  let db = await career('ib-e');
  for (const seed of ['ib-e', 'ib-c', 'ib-d', 'ib-f', 'ib-g', 'ib-h']) {
    db = await career(seed);
    const club = getCareerState(db).clubId;
    // jogadores transferíveis atraem propostas da IA
    for (const r of db.prepare('SELECT id FROM players WHERE club_id = ? ORDER BY market_value DESC LIMIT 6').all(club)) setListed(db, String(r.id), true);
    for (let i = 0; i < 14; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
    if (userInjuries(db, club) > 0) break;
  }
  const st = getCareerState(db);
  const inbox = getNews(db);
  // lesões e suspensões nas partidas (relatórios das partidas do usuário)
  let injuries = 0, suspensions = 0;
  for (const m of db.prepare('SELECT report_json FROM matches').all()) {
    const r = JSON.parse(String(m.report_json)) as { home: { clubId: string }; away: { clubId: string }; players: Array<{ team: 0 | 1; injuredDays?: number }> };
    for (const p of r.players) if ((p.team === 0 ? r.home : r.away).clubId === st.clubId && (p.injuredDays ?? 0) > 0) injuries++;
  }
  suspensions = inbox.filter((m) => m.kind === 'squad').length;
  const med = inbox.filter((m) => m.kind === 'medical' && m.title.startsWith('Lesão:'));
  assert.ok(injuries > 0, 'a amostra precisa ter lesões');
  assert.equal(med.length, injuries, 'uma mensagem por lesão em partida');
  assert.ok([...med, ...inbox.filter((m) => m.kind === 'squad')].every((m) => m.action === 'tactics' && /Táticas/.test(m.actionLabel ?? '') && m.body.length > 80), 'leva para Táticas, com detalhes');
  assert.ok(med.every((m) => /Previsão de retorno: \d\d\/\d\d\/\d{4}/.test(m.body)));
  const yellowsOrReds = Number(db.prepare('SELECT COUNT(*) AS n FROM player_season_stats WHERE club_id = ? AND (red_cards > 0 OR yellow_cards >= 5)').get(st.clubId)!.n);
  if (yellowsOrReds > 0) assert.ok(suspensions > 0, 'suspensões avisadas');
  // propostas recebidas
  const offers = Number(db.prepare('SELECT COUNT(*) AS n FROM transfer_offers WHERE seller_club_id = ?').get(st.clubId)!.n);
  const market = inbox.filter((m) => m.kind === 'market');
  assert.ok(offers > 0, 'a amostra precisa ter propostas');
  assert.equal(market.length, offers, 'uma mensagem por proposta');
  assert.ok(market.every((m) => m.action === 'transfers' && /€/.test(m.title)));
  // toda mensagem gerada no jogo é detalhada (mais de um parágrafo)
  const thin = inbox.filter((m) => !m.body.includes(String.fromCharCode(10, 10)) || m.body.length < 120);
  assert.deepEqual(thin.map((m) => m.title), [], 'mensagens curtas demais');
});
