import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { continueDay, createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { getCareerState, getCompetitionLeaders, getCompetitionTable, listCompetitions } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { migration020 } from '../database/migrations/020_clean_sheets.ts';
import { addDays } from '../shared/date.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup(seed = 'continuar'): Promise<{ db: SqlDb; clubId: string }> {
  const world = generateWorld({ seed, teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id };
}
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const userPendingOn = (db: SqlDb, clubId: string, date: string) =>
  n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date <= ? AND (home_club_id = ? OR away_club_id = ?)", date, clubId, clubId);

/** Continua até o jogo do clube (passando pelas decisões, como o usuário apertando Continuar de novo); devolve as datas de cada passo. */
function runUntilStop(db: SqlDb, max = 400) {
  const dates: string[] = [], decisions: string[] = [];
  for (let i = 0; i < max; i++) {
    const before = getCareerState(db).gameDate;
    const s = continueDay(db);
    if (s.date !== before) dates.push(s.date);
    if (s.stop === 'decision') { decisions.push(s.message); continue; }
    if (s.stop) return { stop: s, dates, decisions };
  }
  throw new Error('o Continuar não parou');
}

test('Continuar: um dia por passo, jogos de outros clubes passam direto e para no dia de jogo do seu time (sem jogar por você)', async () => {
  const { db, clubId } = await setup();
  const start = getCareerState(db).gameDate;
  const first = String(db.prepare("SELECT MIN(match_date) AS d FROM fixtures WHERE home_club_id = ? OR away_club_id = ?").get(clubId, clubId)!.d);
  const { stop, dates, decisions } = runUntilStop(db);
  assert.ok(decisions.every((d) => d.startsWith('Proposta:')), 'as decisões do período são propostas por jogadores do elenco');
  assert.equal(stop.stop, 'user_match');
  assert.equal(stop.date, first, 'para no primeiro jogo do clube');
  dates.forEach((d, i) => assert.equal(d, addDays(start, i + 1), 'avança exatamente um dia por passo'));
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE status = 'scheduled' AND match_date < ?", first), 0, 'jogos de outros clubes antes dele foram simulados');
  assert.equal(userPendingOn(db, clubId, first), 1, 'o jogo do seu clube continua a disputar');
  // insistir no Continuar no dia do jogo não avança nem joga por você
  const again = continueDay(db);
  assert.deepEqual([again.stop, again.date, userPendingOn(db, clubId, first)], ['user_match', first, 1]);
  // jogou: o Continuar segue e para no próximo jogo do clube
  simulateMatchday(db);
  const second = String(db.prepare("SELECT MIN(match_date) AS d FROM fixtures WHERE status = 'scheduled' AND (home_club_id = ? OR away_club_id = ?)").get(clubId, clubId)!.d);
  const next = runUntilStop(db);
  assert.deepEqual([next.stop.stop, next.stop.date], ['user_match', second]);
});

test('Continuar: para em decisão importante (proposta, diretoria), não em aviso comum', async () => {
  const { db } = await setup('continuar-decisao');
  // um aviso que não pede decisão (reforço contratado) não para o tempo
  db.exec("CREATE TEMP TRIGGER aviso AFTER UPDATE OF game_date ON career BEGIN INSERT INTO news (date, kind, title, body) VALUES (NEW.game_date, 'transfer', 'Reforço chegou', ''); END;");
  const plain = continueDay(db);
  assert.equal(plain.stop, null);
  db.exec('DROP TRIGGER aviso');
  // proposta por um jogador do elenco: para, com o título da mensagem
  db.exec("CREATE TEMP TRIGGER proposta AFTER UPDATE OF game_date ON career BEGIN INSERT INTO news (date, kind, title, body) VALUES (NEW.game_date, 'market', 'Proposta: 1 milhão por Fulano', ''); END;");
  const before = getCareerState(db).gameDate;
  const s = continueDay(db);
  assert.deepEqual([s.stop, s.message, s.date], ['decision', 'Proposta: 1 milhão por Fulano', addDays(before, 1)]);
  db.exec('DROP TRIGGER proposta');
});

test('Competições: jogos sem sofrer gols (goleiro 60+ min, time sem sofrer gol), líderes, forma, rodada atual e destino das zonas', async () => {
  const { db, clubId } = await setup('lideres');
  for (let r = 0; r < 7; r++) { runUntilStop(db); simulateMatchday(db); }
  const comp = listCompetitions(db).userCompetitionId!;
  // jogos sem sofrer gols conferidos contra os relatórios das partidas
  const expected = new Map<string, number>();
  for (const m of db.prepare('SELECT m.report_json, m.home_goals, m.away_goals FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.competition_id = ?').all(comp)) {
    const rep = JSON.parse(String(m.report_json)) as { players: Array<{ id: string; team: 0 | 1; slot: string; minutes: number }> };
    for (const p of rep.players) {
      const conceded = p.team === 0 ? Number(m.away_goals) : Number(m.home_goals);
      if (p.slot === 'GK' && p.minutes >= 60 && conceded === 0) expected.set(p.id, (expected.get(p.id) ?? 0) + 1);
    }
  }
  assert.ok(expected.size > 0, 'houve jogos sem sofrer gols');
  const stored = new Map(db.prepare('SELECT player_id, clean_sheets FROM player_season_stats WHERE competition_id = ? AND clean_sheets > 0').all(comp).map((r) => [String(r.player_id), Number(r.clean_sheets)]));
  assert.deepEqual(stored, expected);
  // a migração preenche igual a partir dos relatórios (saves antigos)
  const all = () => db.prepare('SELECT player_id, competition_id, clean_sheets FROM player_season_stats ORDER BY player_id, competition_id').all();
  const live = all();
  db.exec('UPDATE player_season_stats SET clean_sheets = 0');
  db.exec(migration020.sql.slice(migration020.sql.indexOf('UPDATE')));
  assert.deepEqual(all(), live);
  // líderes: ordem decrescente, 10 no máximo, valores do banco
  const L = getCompetitionLeaders(db, comp);
  assert.equal(L.hasStats, true);
  for (const [k, col] of [['goals', 'goals'], ['assists', 'assists'], ['cleanSheets', 'clean_sheets']] as const) {
    const rows = L[k];
    assert.ok(rows.length > 0 && rows.length <= 10, k);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1]!.value >= rows[i]!.value, `${k} em ordem`);
    for (const r of rows) assert.equal(r.value, n(db, `SELECT ${col} AS n FROM player_season_stats WHERE player_id = ? AND competition_id = ?`, r.playerId, comp));
    const best = n(db, `SELECT MAX(${col}) AS n FROM player_season_stats WHERE competition_id = ?`, comp);
    assert.equal(rows[0]!.value, best, `${k}: o líder tem o maior número`);
  }
  // tabela: forma (últimos 5), rodada atual, para onde vão as zonas
  const t = getCompetitionTable(db, comp);
  const mine = t.rows.find((r) => r.clubId === clubId)!;
  const last = db.prepare("SELECT home_club_id, home_goals, away_goals FROM fixtures WHERE competition_id = ? AND status = 'played' AND (home_club_id = ? OR away_club_id = ?) ORDER BY match_date, round, id").all(comp, clubId, clubId)
    .map((f) => { const d = (String(f.home_club_id) === clubId ? 1 : -1) * (Number(f.home_goals) - Number(f.away_goals)); return d > 0 ? 'V' : d < 0 ? 'D' : 'E'; });
  assert.deepEqual(mine.form, last.slice(-5));
  assert.equal(mine.form.length, 5);
  assert.equal(t.currentRound, n(db, "SELECT MIN(round) AS n FROM fixtures WHERE competition_id = ? AND status = 'scheduled'", comp));
  const tier = n(db, 'SELECT l.tier AS n FROM competitions c JOIN leagues l ON l.id = c.league_id WHERE c.id = ?', comp);
  const below = db.prepare('SELECT l2.name FROM competitions c JOIN leagues l ON l.id = c.league_id JOIN leagues l2 ON l2.country_id = l.country_id AND l2.tier = ? WHERE c.id = ?').get(tier + 1, comp);
  assert.equal(t.zoneTargets.relegation, below ? String(below.name) : null);
  assert.equal(t.zoneTargets.promotion, null, 'primeira divisão não tem acesso');
});
