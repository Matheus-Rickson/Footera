import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { advanceTime, getCompetitionTable } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { startNextSeason } from '../database/repositories/seasonRepository.ts';
import { formatOutcomesOf, formatStateOf } from '../database/repositories/formatRepository.ts';
import { regionalGroups } from '../game/format-engine/formats.ts';
import { tieOutcome } from '../game/format-engine/engine.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);
const leagueCount = (db: SqlDb, id: string) => n(db, 'SELECT COUNT(*) AS n FROM clubs WHERE league_id = ?', id);

test('Grupos regionais da Série D: 16 grupos de 6, no máximo 3 clubes do mesmo estado, em ordem geográfica', () => {
  const ufs = ['RJ', 'RJ', 'RJ', 'RJ', 'RJ', 'RJ', 'SP', 'SP', 'SP', 'SP', 'SP', 'AC', 'AC', 'AC'];
  const clubs = Array.from({ length: 96 }, (_, i) => ({ id: `c${String(i).padStart(2, '0')}`, state: ufs[i % ufs.length]! }));
  const groups = regionalGroups(clubs, 16);
  assert.equal(groups.length, 16);
  assert.ok(groups.every((g) => g.length === 6));
  assert.deepEqual(groups.flat().sort(), clubs.map((c) => c.id).sort());
  const stateOf = new Map(clubs.map((c) => [c.id, c.state]));
  for (const g of groups) for (const uf of new Set(g.map((c) => stateOf.get(c)))) assert.ok(g.filter((c) => stateOf.get(c) === uf).length <= 3, `${uf} com mais de 3 no grupo`);
  assert.ok(groups[0]!.some((c) => stateOf.get(c) === 'AC'), 'começa pelo norte (ordem geográfica)');
});

test('Séries C e D reais na carreira (base fixa): fases montadas conforme avançam, mata-mata com pênaltis, acessos, Série C cresce para 24 e Série D é remontada com 96', async () => {
  const w = baseUniverse().world;
  const club = w.clubs.find((c) => c.leagueId === 'bra-3')!;
  const db = await openDatabase(':memory:');
  createCareer(db, { ...w, seed: 'series-cd' }, coach, club.id, new Date(), [], ['bra-3', 'bra-4']); // C e D lance a lance (desempate do jogo decisivo na partida completa)
  const c = 'cmp_bra-3_2026', d = 'cmp_bra-4_2026';
  // criação: só a 1ª fase existe (Série C: turno único com 20; Série D: 16 grupos de 6 em ida e volta, até 3 do mesmo estado)
  assert.deepEqual(db.prepare('SELECT competition_id, stage_id FROM competition_stages ORDER BY competition_id').all().map((r) => `${r.competition_id}:${r.stage_id}`), [`${c}:f1`, `${d}:f1`]);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', c), 190);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', d), 480);
  const dGroups = formatStateOf(db, d)!.state.stages.f1!.groups!;
  assert.equal(dGroups.length, 16);
  const stateOf = new Map(db.prepare("SELECT id, state FROM clubs WHERE league_id = 'bra-4'").all().map((r) => [String(r.id), String(r.state)]));
  for (const g of dGroups) for (const uf of new Set(g.map((x) => stateOf.get(x)))) assert.ok(g.filter((x) => stateOf.get(x) === uf).length <= 3);
  // temporada inteira
  const before = { d: new Set(db.prepare("SELECT id FROM clubs WHERE league_id = 'bra-4'").all().map((r) => String(r.id))) };
  for (let i = 0; i < 600; i++) { const r = advanceTime(db, 'nextMatchday'); simulateMatchday(db); if (!r.advanced && r.reason === 'season_complete') break; }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', c), 190 + 24 + 2, 'Série C: 1ª fase, 2 grupos de 4 em ida e volta, final');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ?', d), 610, 'Série D: 610 jogos (como no regulamento)');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM competitions WHERE id IN (?, ?) AND status = 'finished'", c, d), 2);
  // tabela de liga = 1ª fase (19 jogos por clube na Série C)
  const table = getCompetitionTable(db, c);
  assert.equal(table.rows.length, 20);
  assert.ok(table.rows.every((r) => r.played === 19));
  // confrontos empatados no agregado foram decididos nos pênaltis (registrados no jogo decisivo)
  const fs = formatStateOf(db, d)!;
  for (const s of ['f2', 'f3', 'f4', 'f5', 'sf', 'po', 'final']) fs.state.stages[s]!.ties!.forEach((_, i) => assert.ok(tieOutcome(fs.def, fs.state, s, i), `${s}/${i} decidido`));
  assert.ok(n(db, 'SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = ? AND pens_winner IS NOT NULL', d) > 0, 'houve decisão por pênaltis');
  const oc = formatOutcomesOf(db, c)!, od = formatOutcomesOf(db, d)!;
  assert.deepEqual([oc.complete, oc.promoted.length, oc.relegated.length, od.complete, od.promoted.length], [true, 4, 2, true, 6]);
  // virada: Série C com 24 (20 − 4 + 4 − 2 + 6); Série D remontada com 96; os rebaixados da C estão nela; quem sobe da D está na C
  startNextSeason(db);
  assert.deepEqual(['bra-1', 'bra-2', 'bra-3', 'bra-4'].map((l) => leagueCount(db, l)), [20, 20, 24, 96]);
  const league = (id: string) => String(db.prepare('SELECT league_id AS l FROM clubs WHERE id = ?').get(id)!.l);
  assert.ok(od.promoted.every((id) => league(id) === 'bra-3'), 'acesso da D para a C');
  assert.ok(oc.relegated.every((id) => league(id) === 'bra-4'), 'rebaixados da C na Série D');
  assert.ok(oc.promoted.every((id) => league(id) === 'bra-2'), 'acesso da C para a B');
  const after = new Set(db.prepare("SELECT id FROM clubs WHERE league_id = 'bra-4'").all().map((r) => String(r.id)));
  assert.ok([...before.d].some((id) => !after.has(id) && league(id) === 'bra-sd'), 'quem não se classificou volta para a "Sem divisão"');
  assert.ok([...after].some((id) => !before.d.has(id) && !oc.relegated.includes(id)), 'clubes sem divisão entraram pela vaga do estado');
  // nova temporada: Série C de 24 em turno único (23 rodadas) e Série D de novo com 96
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = 'cmp_bra-3_2027'"), 276);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM fixtures WHERE competition_id = 'cmp_bra-4_2027'"), 480);
  // dinheiro: saldo = inicial + extrato para todos os clubes
  for (const cl of w.clubs.slice(0, 40)) assert.equal(n(db, 'SELECT balance AS n FROM clubs WHERE id = ?', cl.id), cl.balance + n(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM finance_months WHERE club_id = ?', cl.id), `saldo de ${cl.id}`);
});
