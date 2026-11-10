import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { compileUniverse } from '../game/data-pack/compile.ts';
import { exportUniverse } from '../game/data-pack/export.ts';
import { PACK_FORMAT, parsePack, type Pack } from '../game/data-pack/format.ts';
import { formatHonours, parseHonours, rowsToRecords } from '../game/data-pack/csv.ts';
import { classifyCompetition, getTrophyRoom, seasonLabelOf } from '../database/repositories/trophyRepository.ts';
import type { SqlDb } from '../database/types.ts';
import type { Coach } from '../shared/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
const base = generateWorld({ seed: 'trofeus', teamsPerLeagueOverride: 6 });
const pack = (id: string, clubs: unknown[]): Pack => parsePack({ manifest: { format: PACK_FORMAT, id, name: id, version: '1.0' }, files: { clubs } }, id);
const row = (o: Record<string, unknown>) => ({ league_id: null, country_id: 'bra', format_json: null, league_name: null, tier: null, season: 2026, ...o }) as Parameters<typeof classifyCompetition>[0];

test('Taças: chave estável por competição, tipo, logo e rótulo da temporada (ano civil × jul–jun)', () => {
  assert.equal(seasonLabelOf('Premier League 2026/27', 2026), '2026/27');
  assert.equal(seasonLabelOf('Campeonato Paulista 2026', 2026), '2026');
  assert.equal(seasonLabelOf('Sem rótulo', 2027), '2027');
  const lg = classifyCompetition(row({ id: 'cmp_bra-1_2026', kind: 'league', league_id: 'bra-1', name: 'Série A 2026', league_name: 'Série A', tier: 1 }));
  assert.deepEqual([lg.key, lg.name, lg.kind, lg.tier, lg.logo, lg.label], ['bra-1', 'Série A', 'league', 1, { kind: 'leagues', id: 'bra-1' }, '2026']);
  const cup = classifyCompetition(row({ id: 'cup_bra_2026', kind: 'cup', name: 'Copa do Brasil 2026', format_json: JSON.stringify({ format: { id: 'cup-bra', kind: 'cup', name: 'Copa do Brasil' } }) }));
  assert.deepEqual([cup.key, cup.kind, cup.logo], ['cup-bra', 'cup', { kind: 'cups', id: 'cup-bra' }]);
  const sup = classifyCompetition(row({ id: 'sup_bra_2026', kind: 'cup', name: 'Supercopa 2026', format_json: JSON.stringify({ format: { id: 'sup-bra', kind: 'supercup', name: 'Supercopa do Brasil' } }) }));
  assert.deepEqual([sup.key, sup.kind, sup.name], ['sup-bra', 'supercup', 'Supercopa do Brasil']);
  assert.deepEqual(Object.values(classifyCompetition(row({ id: 'est_sp1_2026', kind: 'state', name: 'Paulistão 2026', format_json: '{"formatId":"est_sp1"}' }))).slice(0, 3), ['est_sp1', 'Paulistão', 'state']);
  assert.equal(classifyCompetition(row({ id: 'cest_rj_2026', kind: 'state', name: 'Copa Rio 2026', format_json: '{"formatId":"x"}' })).kind, 'state');
  assert.equal(classifyCompetition(row({ id: 'reg_ne_2026', kind: 'state', name: 'Copa do Nordeste 2026', format_json: '{"formatId":"reg_ne"}' })).kind, 'regional');
  const rus = classifyCompetition(row({ id: 'rcup_2026', kind: 'state', country_id: 'rus', name: 'Copa da Rússia 2026/27', format_json: '{"formatId":"rcup"}' }));
  assert.deepEqual([rus.key, rus.kind, rus.label], ['cup-rus', 'cup', '2026/27'], 'Copa da Rússia é a copa nacional do país');
});

test('Títulos históricos: pacote → universo → save; somam na mesma taça da competição do jogo; "-"/null apaga', async () => {
  const club = base.clubs[0]!;
  const honours = [{ competitionId: club.leagueId, name: 'Liga', count: 3, years: '1990, 1995, 2001' }, { name: 'Torneio Início', count: 9 }, { competitionId: 'cup-' + club.countryId, name: 'Copa', count: 1 }];
  const w = compileUniverse(base, [pack('hist', [{ id: club.id, honours }])]).world;
  assert.deepEqual(w.clubs.find((c) => c.id === club.id)!.honours, honours);
  assert.deepEqual((exportUniverse(w).data.clubs as unknown as Array<{ id: string; honours?: unknown }>).find((c) => c.id === club.id)!.honours, honours, 'exportação leva os títulos');
  assert.equal(compileUniverse(w, [pack('limpa', [{ id: club.id, honours: null }])]).world.clubs.find((c) => c.id === club.id)!.honours, undefined);

  const db = await openDatabase(':memory:');
  createCareer(db, w, coach, club.id);
  let room = getTrophyRoom(db);
  assert.equal(room.club?.id, club.id);
  assert.deepEqual(room.totals, { all: 13, inGame: 0, historical: 13, byUser: 0 });
  const league = room.cases.find((c) => c.key === club.leagueId)!;
  assert.deepEqual([league.kind, league.total, league.historical, league.historicalYears, league.wins.length], ['league', 3, 3, '1990, 1995, 2001', 0]);
  assert.equal(room.cases.find((c) => c.name === 'Torneio Início')!.kind, 'other');
  assert.deepEqual(room.cases.map((c) => c.kind), ['league', 'cup', 'other'], 'prateleiras: liga, copa, outras (não pela quantidade)');
  assert.equal(room.cases[0]!.kind, 'league', 'ligas na primeira prateleira, mesmo com menos títulos que a taça "outra"');

  // título no jogo cai na mesma taça
  const comp = String(db.prepare("SELECT id FROM competitions WHERE kind = 'league' AND league_id = ?").get(club.leagueId)!.id);
  db.prepare('INSERT INTO trophies (season, club_id, competition_id, won_by_user) VALUES (2026, ?, ?, 1)').run(club.id, comp);
  room = getTrophyRoom(db);
  const merged = room.cases.find((c) => c.key === club.leagueId)!;
  assert.deepEqual([merged.total, merged.historical, merged.wins.length, merged.wins[0]!.byUser], [4, 3, 1, true]);
  assert.deepEqual(room.totals, { all: 14, inGame: 1, historical: 13, byUser: 1 });
  db.close();
});

test('Títulos do treinador em clubes diferentes; desempregado vê o último clube; seletor aceita outro clube', async () => {
  const db: SqlDb = await openDatabase(':memory:');
  const [a, b] = [base.clubs[0]!, base.clubs.find((c) => c.leagueId !== base.clubs[0]!.leagueId)!];
  createCareer(db, base, coach, a.id);
  const compA = String(db.prepare("SELECT id FROM competitions WHERE kind = 'league' AND league_id = ?").get(a.leagueId)!.id);
  const compB = String(db.prepare("SELECT id FROM competitions WHERE kind = 'league' AND league_id = ?").get(b.leagueId)!.id);
  db.prepare('INSERT INTO trophies (season, club_id, competition_id, won_by_user) VALUES (2026, ?, ?, 1)').run(a.id, compA);
  db.prepare('INSERT INTO trophies (season, club_id, competition_id, won_by_user) VALUES (2026, ?, ?, 1)').run(b.id, compB);
  // o clube B foi o último (passagem encerrada) e o treinador está sem clube
  db.prepare("INSERT INTO coach_spells (club_id, start_date, end_date, end_reason) VALUES (?, '2027-01-01', '2027-06-01', 'left')").run(b.id);
  db.prepare('UPDATE career SET club_id = NULL WHERE id = 1').run();
  const room = getTrophyRoom(db);
  assert.deepEqual(room.coachTitles.map((t) => t.clubId).sort(), [a.id, b.id].sort(), 'títulos do treinador nos dois clubes');
  assert.equal(room.club?.id, b.id, 'sem clube: o último por onde passou');
  assert.ok(room.clubs.every((c) => !c.current));
  const other = getTrophyRoom(db, a.id);
  assert.equal(other.club?.id, a.id);
  assert.equal(other.cases.length, 1);
  assert.equal(getTrophyRoom(db, 'nao-existe').club?.id, b.id, 'id inválido volta ao padrão');
  db.close();
});

test('Planilha: coluna de títulos históricos (texto) ida e volta, "-" apaga e erro aponta a parte ilegível', () => {
  const list = [{ competitionId: 'bra-1', name: 'Brasileirão', count: 7, years: '1980, 1982' }, { name: 'Copa Sul', count: 2 }];
  const text = formatHonours(list)!;
  assert.equal(text, '[bra-1] Brasileirão: 7 (1980, 1982); Copa Sul: 2');
  assert.deepEqual(parseHonours(text), { value: list });
  assert.deepEqual(parseHonours(' - '), { value: null });
  assert.ok('error' in parseHonours('Copa Sul dois'));
  assert.equal(formatHonours([]), null);
  const r = rowsToRecords('clubs', 'Nome;Títulos históricos\nNovo FC;Copa Sul: 2\n').records[0]!.record;
  assert.deepEqual(r.honours, [{ name: 'Copa Sul', count: 2 }]);
  assert.ok(rowsToRecords('clubs', 'Nome;Títulos históricos\nNovo FC;Copa Sul\n').issues.length > 0);
});
