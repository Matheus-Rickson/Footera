import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { advanceTime, listCompetitions } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { formatOutcomesOf, formatStateOf } from '../database/repositories/formatRepository.ts';
import { copaDaRussia, copaDaRussiaDates } from '../game/format-engine/formats.ts';
import { stageEntrants, stageTables, tieOutcome } from '../game/format-engine/engine.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { cupStateOf, previousChampions } from '../database/repositories/cupRepository.ts';
import { supercupEntrants, supercupRuleFor } from '../game/cup-engine/supercups.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ivan', lastName: 'Petrov', birthDate: '1980-05-10', nationality: 'RUS', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

test('Copa da Rússia (formato): caminho das Regiões até 4, grupos da RPL com pênaltis, dupla eliminação e superfinal', () => {
  const f = copaDaRussia(34)!; // 16 da Premier Liga + 18 da Pervaya Liga (base)
  assert.deepEqual(f.stages.map((s) => s.id), ['r4', 'r5', 'r6', 'g', 'qf', 'rq1', 'rq2', 'sf', 'rs1', 'rs2', 'fr', 'freg', 'super']);
  const r4 = f.stages[0]!, r5 = f.stages[1]!;
  assert.deepEqual(r4.entrants, [30, 31, 32, 33].map((seed) => ({ seed })), 'preliminar com os 4 de pior semente');
  assert.equal(r5.entrants.length, 16, '14 com folga + 2 vencedores');
  const g = f.stages[3]!;
  assert.ok(g.kind === 'league' && g.groups === 4 && g.legs === 2 && g.drawPens);
  assert.equal(copaDaRussia(19), null, 'menos de 4 clubes no caminho das Regiões: sem copa');
  assert.deepEqual(copaDaRussia(32)!.stages.slice(0, 3).map((s) => s.id), ['r5', 'r6', 'g'], '16 da 1ª divisão: sem preliminar');
  // datas: quartas-feiras (jogos de liga aos sábados); superfinal num domingo de maio
  const all = f.stages.flatMap((s) => copaDaRussiaDates(2026, s.id)!);
  assert.ok(all.slice(0, -1).every((d) => dow(d) === 3));
  assert.deepEqual(copaDaRussiaDates(2026, 'g')!.map((d) => d.slice(5)), ['07-29', '08-12', '08-26', '09-16', '09-30', '10-21']);
  assert.equal(copaDaRussiaDates(2026, 'super')![0], '2027-05-23');
  assert.equal(copaDaRussiaDates(2026, 'xx'), null);
});

test('Copa da Rússia na carreira (base fixa): temporada inteira, pênaltis nos grupos, mando do azarão, perdedores da RPL nas Regiões', async () => {
  const w = baseUniverse().world;
  const club = w.clubs.find((c) => c.leagueId === 'rus-1')!;
  const db = await openDatabase(':memory:');
  createCareer(db, { ...w, seed: 'copa-russia' }, coach, club.id, new Date(), [], ['rus-1']);
  const comp = n(db, "SELECT COUNT(*) AS n FROM competitions WHERE id GLOB 'rcup_*'");
  assert.equal(comp, 1);
  const id = String(db.prepare("SELECT id FROM competitions WHERE id GLOB 'rcup_*'").get()!.id);
  const listed = listCompetitions(db).competitions.find((c) => c.id === id)!;
  assert.deepEqual([listed.scope, listed.teamCount, listed.name], ['nacional', 34, 'Copa da Rússia 2026/27']);
  // criação: grupos da RPL e a preliminar das Regiões
  assert.deepEqual(db.prepare('SELECT stage_id FROM competition_stages WHERE competition_id = ? ORDER BY stage_id').all(id).map((r) => r.stage_id), ['g', 'r4']);
  for (let i = 0; i < 800; i++) { const r = advanceTime(db, 'nextMatchday'); simulateMatchday(db); if (!r.advanced && r.reason === 'season_complete') break; }

  const fs = formatStateOf(db, id)!, out = formatOutcomesOf(db, id)!;
  assert.ok(out.complete && out.champion, 'copa concluída');
  const seeds = fs.state.seeds, seedIx = (c: string) => seeds.indexOf(c);
  const rpl = new Set(seeds.slice(0, 16));
  // grupos: todo empate com vencedor nos pênaltis; pontos 3/2/1/0
  const g = fs.state.stages.g!;
  const draws = g.results.filter((r) => r.homeGoals === r.awayGoals);
  assert.ok(draws.length > 0 && draws.every((r) => r.pens === r.home || r.pens === r.away), 'empates decididos nos pênaltis');
  const tables = stageTables(fs.def, fs.state, 'g').groups;
  for (const t of tables) for (const row of t) {
    const mine = g.results.filter((r) => r.home === row.teamId || r.away === row.teamId);
    const pts = mine.reduce((s, r) => { const gf = r.home === row.teamId ? r.homeGoals : r.awayGoals, ga = r.home === row.teamId ? r.awayGoals : r.homeGoals;
      return s + (gf > ga ? 3 : gf < ga ? 0 : r.pens === row.teamId ? 2 : 1); }, 0);
    assert.equal(row.points, pts, `pontos de ${row.teamId}`);
  }
  // 1º e 2º → quartas da RPL; 3º → quartas das Regiões; 4º eliminado
  const qf = new Set(stageEntrants(fs.def, fs.state, 'qf')!), rq1 = new Set(stageEntrants(fs.def, fs.state, 'rq1')!);
  for (const t of tables) {
    assert.ok(qf.has(t[0]!.teamId) && qf.has(t[1]!.teamId) && rq1.has(t[2]!.teamId));
    const last = t[3]!.teamId;
    assert.ok(!['qf', 'rq1', 'rq2', 'sf', 'rs1', 'rs2', 'fr', 'freg', 'super'].some((s) => stageEntrants(fs.def, fs.state, s)!.includes(last)), '4º eliminado');
  }
  // Regiões: só a Pervaya Liga nas rodadas; jogo único em casa do de pior semente (divisão inferior); 4 chegam às quartas
  for (const s of ['r4', 'r5', 'r6']) for (const t of fs.state.stages[s]!.ties!) {
    assert.ok(!rpl.has(t.a) && !rpl.has(t.b));
    assert.equal(t.host, seedIx(t.a) > seedIx(t.b) ? t.a : t.b);
  }
  for (const t of fs.state.stages.rq1!.ties!) assert.ok(!rpl.has(t.host), 'etapa 1 das quartas: em casa do clube das Regiões');
  // perdedores da RPL descem: quartas → etapa 2 das quartas; semifinal → etapa 2 da semifinal; final da RPL → eliminado
  const losers = (s: string) => fs.state.stages[s]!.ties!.map((_, i) => tieOutcome(fs.def, fs.state, s, i)!.loser);
  assert.deepEqual(new Set(losers('qf').filter((c) => stageEntrants(fs.def, fs.state, 'rq2')!.includes(c))).size, 4);
  assert.ok(losers('sf').every((c) => stageEntrants(fs.def, fs.state, 'rs2')!.includes(c)));
  const frLoser = losers('fr')[0]!;
  assert.ok(!stageEntrants(fs.def, fs.state, 'freg')!.includes(frLoser) && !stageEntrants(fs.def, fs.state, 'super')!.includes(frLoser));
  assert.equal(out.ranking[1], losers('super')[0], 'vice = perdedor da superfinal');
  // superfinal: campo neutro, domingo de maio; troféu e premiação pelo extrato
  const sup = db.prepare("SELECT match_date, neutral FROM fixtures WHERE competition_id = ? AND stage = 'super'").get(id)!;
  assert.deepEqual([String(sup.match_date).slice(5, 7), dow(String(sup.match_date)), Number(sup.neutral)], ['05', 0, 1]);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM trophies WHERE competition_id = ? AND club_id = ?', id, out.champion), 1);
  // premiação do campeão = economia (0,8) × 400 mil × 6, no resumo mensal do clube (regra 1: tudo pelo makePoster)
  assert.ok(n(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ? AND category = 'prize'", out.champion) >= 1_920_000);
  // nenhum clube russo joga duas vezes com menos de 3 dias
  const games = db.prepare(`SELECT f.match_date AS d, f.home_club_id AS h, f.away_club_id AS a FROM fixtures f JOIN competitions c ON c.id = f.competition_id
    WHERE c.country_id = 'rus' ORDER BY f.match_date`).all();
  const lastDay = new Map<string, string>();
  for (const x of games) for (const c of [String(x.h), String(x.a)]) {
    const prev = lastDay.get(c);
    if (prev) assert.ok((Date.parse(String(x.d)) - Date.parse(prev)) / 86_400_000 >= 3, `${c}: ${prev} e ${x.d}`);
    lastDay.set(c, String(x.d));
  }

  // Supercopa da Rússia na temporada seguinte: campeão da Premier Liga × vencedor da Copa da Rússia, campo neutro, antes da liga
  startNextSeason(db); // grava a classificação final (season_results) e abre 2027/28
  const league1 = String(db.prepare("SELECT s.club_id FROM season_results s JOIN competitions c ON c.id = s.competition_id WHERE c.league_id = 'rus-1' AND c.season = 2026 ORDER BY s.position LIMIT 1").get()!.club_id);
  const prev = previousChampions(db, 'rus', 2027);
  assert.deepEqual([prev.league[0], prev.cupWinner, prev.cupRunnerUp], [league1, out.champion, out.ranking[1]]);
  const supId = 'sup_rus_2027';
  const st = cupStateOf(db, supId);
  assert.deepEqual(st.clubs.map((c) => c.id), supercupEntrants(supercupRuleFor('RUS')!, prev));
  assert.ok(st.clubs.some((c) => c.id === league1), 'campeão da liga na supercopa');
  const sg = db.prepare('SELECT match_date, neutral FROM fixtures WHERE competition_id = ?').all(supId);
  const firstLeague = String(db.prepare("SELECT MIN(f.match_date) AS d FROM fixtures f JOIN competitions c ON c.id = f.competition_id WHERE c.league_id = 'rus-1' AND c.season = 2027").get()!.d);
  assert.deepEqual([sg.length, Number(sg[0]!.neutral)], [1, 1]);
  assert.ok(String(sg[0]!.match_date) < firstLeague, 'abre a temporada');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE id = 'rcup_2027'"), 1, 'nova Copa da Rússia');
});
