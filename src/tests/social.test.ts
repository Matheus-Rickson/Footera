import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../game/rng.ts';
import { commentsFor, engagement, previewText, OUTLETS } from '../game/social-engine/social.ts';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime, getCareerState } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { getSocialFeed, processSocialDay } from '../database/repositories/socialRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';

test('Rede social (regras): 2 a 5 comentários sem repetir, tom pelo humor do clube; engajamento cresce com a reputação', () => {
  const clubs = [{ id: 'a', name: 'Alfa FC' }, { id: 'b', name: 'Beta EC' }];
  for (let i = 0; i < 50; i++) {
    const cs = commentsFor(createRng(`c${i}`), 'match', clubs, { a: 1, b: -1 });
    assert.ok(cs.length >= 2 && cs.length <= 5, `${cs.length} comentários`);
    assert.equal(new Set(cs.map((c) => c.text)).size, cs.length, 'sem texto repetido');
    for (const c of cs) {
      if (c.clubId === 'a') assert.doesNotMatch(c.text, /Vergonha|Inadmissível|diretoria|explicar/, 'torcedor do vencedor não reclama');
      if (c.clubId === 'b') assert.doesNotMatch(c.text, /gigante|Que time|Respeita|meu /, 'torcedor do perdedor não comemora');
    }
  }
  const avg = (rep: number) => Array.from({ length: 200 }, (_, i) => engagement(createRng(`e${i}`), 'match', rep, true).likes).reduce((s, x) => s + x, 0) / 200;
  assert.ok(avg(90) > avg(50) && avg(50) > avg(20));
  assert.match(previewText(createRng('p'), { leader: 'Alfa FC', second: 'Beta EC', gap: 0, comp: 'Liga X', round: 10, official: true }), /empatados/);
  assert.equal(new Set(OUTLETS.map((o) => o.handle)).size, OUTLETS.length);
});

const coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession' as const, reputation: 20, photoPath: null };
async function season(seed: string, rounds: number) {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  for (let i = 0; i < rounds; i++) { advanceTime(db, 'nextMatchday'); simulateMatchday(db); }
  return db;
}
const dump = (db: SqlDb) => JSON.stringify([db.prepare('SELECT * FROM social_posts ORDER BY id').all(), db.prepare('SELECT * FROM social_comments ORDER BY id').all(), db.prepare('SELECT * FROM social_accounts ORDER BY id').all()]);

test('Rede social na carreira: cada jogo do usuário vira post da imprensa e do clube; comentários de torcedores; selo só para imprensa e perfis oficiais; determinístico', async () => {
  const db = await season('soc-a', 6);
  const st = getCareerState(db);
  const feed = getSocialFeed(db, 'all', 200);
  const played = Number(db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played' AND (home_club_id = ? OR away_club_id = ?)").get(st.clubId, st.clubId)!.n);
  assert.equal(played, 6);
  assert.equal(feed.posts.filter((p) => p.kind === 'match' && p.author.kind === 'club' && p.author.clubId === st.clubId).length, played, 'perfil oficial do clube posta todo jogo');
  assert.equal(feed.posts.filter((p) => p.kind === 'match' && p.author.kind === 'outlet' && p.mine && p.card?.type === 'match').length, played, 'imprensa noticia todo jogo do usuário com o placar');
  // o placar do cartão é o do banco
  for (const p of feed.posts) {
    if (p.card?.type !== 'match') continue;
    const c = p.card;
    const f = db.prepare("SELECT home_goals, away_goals FROM fixtures WHERE home_club_id = ? AND away_club_id = ? AND match_date = ? AND status = 'played'").get(c.homeId, c.awayId, p.date)!;
    assert.deepEqual([c.hg, c.ag], [Number(f.home_goals), Number(f.away_goals)]);
  }
  for (const p of feed.posts) {
    assert.ok(p.comments.length >= 2 && p.comments.length <= 5, 'comentários por post');
    assert.equal(new Set(p.comments.map((c) => c.author.id)).size, p.comments.length, 'cada torcedor comenta uma vez por post');
    assert.ok(p.comments.every((c) => c.author.kind === 'fan' && !c.author.verified), 'torcedores sem selo');
    assert.equal(p.author.verified, p.author.kind !== 'fan', 'selo: imprensa e perfis oficiais');
  }
  const perDay = new Map<string, number>();
  for (const r of db.prepare('SELECT date, COUNT(*) AS n FROM social_posts GROUP BY date').all()) perDay.set(String(r.date), Number(r.n));
  assert.ok([...perDay.values()].every((n) => n <= 12), 'no máximo 12 posts por dia');
  assert.equal(dump(db), dump(await season('soc-a', 6)), 'mesma semente, mesmo feed');
  assert.ok(getSocialFeed(db, 'mine').posts.every((p) => p.mine));
  assert.ok(getSocialFeed(db, 'league').posts.every((p) => p.author.kind === 'league'));
});

test('Rede social: líder e vice empatados em pontos que se enfrentam na rodada viram matéria, inclusive no perfil oficial da liga', async () => {
  const db = await season('soc-b', 4);
  const st = getCareerState(db);
  const comp = String(db.prepare('SELECT competition_id AS c FROM fixtures WHERE home_club_id = ? OR away_club_id = ? LIMIT 1').get(st.clubId, st.clubId)!.c);
  const next = db.prepare("SELECT home_club_id AS h, away_club_id AS a, match_date AS d FROM fixtures WHERE competition_id = ? AND status = 'scheduled' AND home_club_id <> ? AND away_club_id <> ? ORDER BY match_date, id LIMIT 1").get(comp, st.clubId, st.clubId)!;
  const x = String(next.h), y = String(next.a), date = String(next.d);
  // X e Y ganham todos os jogos anteriores (empatam entre si, se já se enfrentaram): os dois na ponta com os mesmos pontos
  for (const f of db.prepare("SELECT id, home_club_id AS h, away_club_id AS a FROM fixtures WHERE competition_id = ? AND status = 'played'").all(comp)) {
    const h = String(f.h), a = String(f.a);
    const hx = h === x || h === y, ax = a === x || a === y;
    if (hx && ax) db.prepare('UPDATE fixtures SET home_goals = 1, away_goals = 1 WHERE id = ?').run(f.id);
    else if (hx) db.prepare('UPDATE fixtures SET home_goals = 5, away_goals = 0 WHERE id = ?').run(f.id);
    else if (ax) db.prepare('UPDATE fixtures SET home_goals = 0, away_goals = 5 WHERE id = ?').run(f.id);
  }
  db.prepare('DELETE FROM social_comments WHERE post_id IN (SELECT id FROM social_posts WHERE date = ?)').run(date);
  db.prepare('DELETE FROM social_posts WHERE date = ?').run(date);
  withTransaction(db, () => processSocialDay(db, date));
  const names = [x, y].map((id) => String(db.prepare('SELECT name FROM clubs WHERE id = ?').get(id)!.name));
  const posts = db.prepare("SELECT p.text, a.kind FROM social_posts p JOIN social_accounts a ON a.id = p.account_id WHERE p.date = ? AND p.kind = 'preview'").all(date).map((r) => ({ text: String(r.text), kind: String(r.kind) }));
  const about = posts.filter((p) => names.every((n) => p.text.includes(n)));
  assert.ok(about.some((p) => p.kind === 'league' && /empatados/.test(p.text)), `perfil da liga: ${JSON.stringify(posts)}`);
  assert.ok(about.some((p) => p.kind !== 'league'), 'imprensa também repercute');
  // com a disputa decidida (X 5 pontos à frente, Y ainda em 2º), não há matéria de confronto direto
  db.prepare('DELETE FROM social_comments WHERE post_id IN (SELECT id FROM social_posts WHERE date = ?)').run(date);
  db.prepare('DELETE FROM social_posts WHERE date = ?').run(date);
  const yGames = db.prepare("SELECT id, home_club_id AS h FROM fixtures WHERE competition_id = ? AND status = 'played' AND (home_club_id = ? OR away_club_id = ?) ORDER BY match_date, id").all(comp, y, y);
  yGames.forEach((g, i) => {
    const yHome = String(g.h) === y;
    const [yg, og] = i === 0 ? [0, 5] : i === 1 ? [1, 1] : [5, 0]; // Y: uma derrota, um empate, o resto vitórias
    db.prepare('UPDATE fixtures SET home_goals = ?, away_goals = ? WHERE id = ?').run(yHome ? yg : og, yHome ? og : yg, g.id);
  });
  db.prepare("UPDATE fixtures SET home_goals = 0, away_goals = 0 WHERE competition_id = ? AND status = 'played' AND home_club_id NOT IN (?, ?) AND away_club_id NOT IN (?, ?)").run(comp, x, y, x, y);
  const { getCompetitionTable } = await import('../database/repositories/competitionRepository.ts');
  const tb = getCompetitionTable(db, comp).rows;
  assert.deepEqual([tb[0]!.clubId, tb[1]!.clubId], [x, y], 'X e Y continuam nos dois primeiros');
  assert.ok(tb[0]!.points - tb[1]!.points > 3, `diferença: ${tb[0]!.points - tb[1]!.points}`);
  withTransaction(db, () => processSocialDay(db, date));
  assert.ok(!db.prepare("SELECT p.text FROM social_posts p JOIN social_accounts a ON a.id = p.account_id WHERE p.date = ? AND a.kind = 'league'").all(date).some((r) => names.every((n) => String(r.text).includes(n))), 'sem disputa, sem matéria');
});
