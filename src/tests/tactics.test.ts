import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime } from '../database/repositories/competitionRepository.ts';
import { getMatchReport, simulateMatchday } from '../database/repositories/matchRepository.ts';
import {
  activateScheme, autoLineup, deleteScheme, duplicateScheme, ensureSchemes, getActiveScheme, getTacticsOverview, listSchemes, saveScheme, TacticsError,
} from '../database/repositories/tacticsRepository.ts';
import { tacticsForMethodology } from '../game/match-engine/team-builder.ts';
import { createProfile } from '../services/profileService.node.ts';
import { createCareerSave, getTactics } from '../services/saveService.node.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach, Methodology } from '../shared/types.ts';
import type { TeamTactics } from '../game/match-engine/types.ts';

const coachOf = (m: Methodology): Coach => ({ firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: m, reputation: 20, photoPath: null });
async function setup(m: Methodology = 'aggressive'): Promise<{ db: SqlDb; clubId: string; world: ReturnType<typeof generateWorld> }> {
  const world = generateWorld({ seed: 'tac-test', teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coachOf(m), world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id, world };
}
const SETTINGS: TeamTactics = { mentality: 'defensive', tempo: 2, width: 2, defensiveLine: 1, pressing: 1, buildUp: 'long' };
const n = (db: SqlDb, sql: string, ...p: unknown[]) => Number(db.prepare(sql).get(...p)!.n);

test('Esquemas: os 7 padrão são criados, o ativo segue a metodologia e a criação é idempotente', async () => {
  for (const [m, formation] of [['aggressive', '4-2-3-1'], ['possession', '4-3-3'], ['defensive', '5-3-2']] as const) {
    const { db } = await setup(m);
    const all = listSchemes(db);
    assert.deepEqual(all.map((s) => s.formation), ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '3-4-3', '5-3-2', '4-1-4-1']);
    assert.ok(all.every((s) => s.builtin && s.lineup === null));
    assert.deepEqual(all.find((s) => s.active)!.formation, formation);
    assert.deepEqual(all[0]!.settings, tacticsForMethodology(m));
    const before = JSON.stringify(listSchemes(db));
    ensureSchemes(db, new Date('2030-01-01'));
    assert.equal(JSON.stringify(listSchemes(db)), before);
  }
});

test('Esquemas: save no formato anterior (sem esquemas) é reparado', async () => {
  const { db } = await setup();
  db.exec('UPDATE career SET active_scheme_id = NULL; DELETE FROM tactic_schemes;');
  assert.equal(getActiveScheme(db), null);
  ensureSchemes(db);
  assert.equal(listSchemes(db).length, 7);
  assert.equal(getActiveScheme(db)!.formation, '4-2-3-1');
});

test('Esquemas: criar, editar, duplicar, ativar e excluir seguem as regras', async () => {
  const { db } = await setup();
  const created = saveScheme(db, { name: '  Meu   4-4-2  ', formation: '4-4-2', settings: SETTINGS, lineup: null });
  assert.equal(created.name, 'Meu 4-4-2'); assert.equal(created.builtin, false); assert.equal(created.id, 'sch_u_1');
  const edited = saveScheme(db, { id: created.id, name: 'Meu 4-4-2', formation: '3-5-2', settings: { ...SETTINGS, tempo: 5 }, lineup: null });
  assert.deepEqual([edited.formation, edited.settings.tempo], ['3-5-2', 5]);
  const d1 = duplicateScheme(db, created.id), d2 = duplicateScheme(db, created.id);
  assert.deepEqual([d1.name, d2.name], ['Meu 4-4-2 (cópia)', 'Meu 4-4-2 (cópia) 2']);
  assert.deepEqual([d1.id, d2.id], ['sch_u_2', 'sch_u_3']);
  assert.equal(duplicateScheme(db, 'sch_b_4-3-3').builtin, false, 'cópia de esquema padrão é editável');
  activateScheme(db, d1.id);
  assert.equal(getActiveScheme(db)!.id, d1.id);
  deleteScheme(db, d1.id);
  assert.equal(getActiveScheme(db)!.id, 'sch_b_4-2-3-1', 'excluir o ativo volta ao padrão da metodologia');
  assert.equal(listSchemes(db).some((s) => s.id === d1.id), false);
  assert.equal(listSchemes(db).filter((s) => !s.builtin).length, 3);
});

test('Esquemas: entradas inválidas são rejeitadas sem alterar nada', async () => {
  const { db, world } = await setup();
  const ok = { name: 'Valido', formation: '4-3-3', settings: SETTINGS, lineup: null };
  const mine = world.players.filter((p) => p.clubId === world.clubs[0]!.id).map((p) => p.id);
  const foreign = world.players.find((p) => p.clubId !== world.clubs[0]!.id)!.id;
  const bad: Array<[string, Parameters<typeof saveScheme>[1]]> = [
    ['nome vazio', { ...ok, name: '   ' }], ['nome longo', { ...ok, name: 'x'.repeat(41) }], ['nome com símbolos', { ...ok, name: 'a<script>' }],
    ['nome repetido (sem distinguir caixa)', { ...ok, name: '4-3-3 (PADRÃO)' }],
    ['formação inexistente', { ...ok, formation: '9-9-9' }],
    ['mentalidade inválida', { ...ok, settings: { ...SETTINGS, mentality: 'louca' as never } }],
    ['ritmo 6', { ...ok, settings: { ...SETTINGS, tempo: 6 } }], ['pressão 0', { ...ok, settings: { ...SETTINGS, pressing: 0 } }],
    ['amplitude fracionada', { ...ok, settings: { ...SETTINGS, width: 2.5 } }], ['saída inválida', { ...ok, settings: { ...SETTINGS, buildUp: 'x' as never } }],
    ['escalação com 10', { ...ok, lineup: mine.slice(0, 10) }], ['escalação com repetido', { ...ok, lineup: [...mine.slice(0, 10), mine[0]!] }],
    ['jogador de outro clube', { ...ok, lineup: [...mine.slice(0, 10), foreign] }],
    ['editar esquema inexistente', { ...ok, id: 'sch_u_99' }], ['editar esquema padrão', { ...ok, id: 'sch_b_4-3-3' }],
  ];
  for (const [label, input] of bad) assert.throws(() => saveScheme(db, input), TacticsError, label);
  assert.equal(listSchemes(db).length, 7, 'nada foi criado');
  assert.throws(() => deleteScheme(db, 'sch_b_4-3-3'), /padrão/);
  assert.throws(() => deleteScheme(db, 'nao-existe'), TacticsError);
  assert.throws(() => activateScheme(db, 'nao-existe'), TacticsError);
  assert.throws(() => duplicateScheme(db, 'nao-existe'), TacticsError);
  saveScheme(db, { ...ok, lineup: mine.slice(0, 11) }); // escalação legal é aceita
  assert.throws(() => saveScheme(db, ok), /Já existe/);
});

test('Escalação automática: 11 jogadores distintos do clube, goleiro no gol, sem lesionados nem suspensos', async () => {
  const { db, clubId } = await setup();
  const ids = autoLineup(db, '4-3-3');
  assert.equal(new Set(ids).size, 11);
  const own = new Set(db.prepare('SELECT id FROM players WHERE club_id = ?').all(clubId).map((r) => String(r.id)));
  assert.ok(ids.every((id) => own.has(id)));
  assert.equal(String(db.prepare('SELECT position FROM players WHERE id = ?').get(ids[0]!)!.position), 'GK');
  db.prepare('INSERT INTO player_status (player_id, injury_until, injury_note, suspension_matches, yellow_cards) VALUES (?, ?, ?, 0, 0)').run(ids[3]!, '2027-01-01', 'Lesão');
  db.prepare('INSERT INTO player_status (player_id, injury_until, injury_note, suspension_matches, yellow_cards) VALUES (?, NULL, NULL, 2, 0)').run(ids[5]!);
  const again = autoLineup(db, '4-3-3');
  assert.ok(!again.includes(ids[3]!) && !again.includes(ids[5]!));
  assert.throws(() => autoLineup(db, 'x'), TacticsError);
  const ov = getTacticsOverview(db);
  assert.equal(ov.squad.length, 25);
  assert.deepEqual(ov.squad.find((p) => p.id === ids[3])!.unavailable, { kind: 'injured', until: '2027-01-01' });
  assert.deepEqual(ov.squad.find((p) => p.id === ids[5])!.unavailable, { kind: 'suspended', matches: 2 });
  assert.equal(ov.formations.length, 7);
  const gk = ov.squad.find((p) => p.position === 'GK')!;
  assert.ok(gk.slotScores.GK > gk.slotScores.ST + 15, 'goleiro rende muito mais no gol do que no ataque');
});

test('Simulação: usa formação, escalação e tática do esquema ativo e avisa quando um titular está indisponível', async () => {
  const { db, clubId } = await setup();
  const base = autoLineup(db, '5-3-2');
  const manual = [...base];
  [manual[7], manual[8]] = [manual[8]!, manual[7]!]; // troca dois meias de lugar: continua legal
  const s = saveScheme(db, { name: 'Retranca', formation: '5-3-2', settings: SETTINGS, lineup: manual });
  activateScheme(db, s.id);
  assert.equal(advanceTime(db, 'nextMatchday').toDate, '2026-08-01');
  const first = simulateMatchday(db);
  assert.deepEqual(first.notes, []);
  const rep1 = getMatchReport(db, first.userMatch!.fixtureId);
  const side = rep1.home.clubId === clubId ? 0 : 1;
  assert.equal([rep1.home, rep1.away][side]!.formation, '5-3-2');
  assert.deepEqual(rep1.lineups[side]!.slots.map((x) => x.playerId), manual, 'escalação manual respeitada na ordem das posições');
  assert.deepEqual(rep1.tactics![side], SETTINGS);

  // próxima rodada: um titular escolhido se lesiona antes do jogo
  const hurt = manual[9]!;
  db.prepare('INSERT INTO player_status (player_id, injury_until, injury_note, suspension_matches, yellow_cards) VALUES (?, ?, ?, 0, 0)').run(hurt, '2027-06-01', 'Lesão');
  advanceTime(db, 'nextMatchday');
  const second = simulateMatchday(db);
  assert.equal(second.notes.length, 1);
  assert.match(second.notes[0]!, /lesionado/);
  const rep2 = getMatchReport(db, second.userMatch!.fixtureId);
  const slots2 = rep2.lineups[rep2.home.clubId === clubId ? 0 : 1]!.slots.map((x) => x.playerId);
  assert.ok(!slots2.includes(hurt));
  assert.equal(slots2.filter((id, i) => id === manual[i]).length, 10, 'só a vaga do lesionado muda');
  assert.equal(new Set(slots2).size, 11);

  // trocar o esquema ativo muda a formação do jogo seguinte
  activateScheme(db, 'sch_b_4-4-2');
  advanceTime(db, 'nextMatchday');
  const third = simulateMatchday(db);
  const rep3 = getMatchReport(db, third.userMatch!.fixtureId);
  assert.equal([rep3.home, rep3.away][rep3.home.clubId === clubId ? 0 : 1]!.formation, '4-4-2');
});

test('Saves em arquivo: esquemas são criados/reparados ao abrir e persistem entre aberturas', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fmsim-tac-'));
  const prof = createProfile(base, 'Teste');
  const world = generateWorld({ seed: 'tac-file' });
  const c = await createCareerSave(base, { profileId: prof.id, seed: 'tac-file', clubId: world.clubs[0]!.id,
    coach: { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession' } });
  const db = await openDatabase(path.join(base, 'saves', prof.id, c.id, 'career.db'));
  db.exec('UPDATE career SET active_scheme_id = NULL; DELETE FROM tactic_schemes;'); db.close();
  const ov = await getTactics(base, prof.id, c.id);
  assert.equal(ov.schemes.length, 7);
  assert.equal(ov.schemes.find((s) => s.active)!.formation, '4-3-3');
  assert.equal(n(await openDatabase(path.join(base, 'saves', prof.id, c.id, 'career.db')), 'SELECT COUNT(*) AS n FROM tactic_schemes'), 7);
});
