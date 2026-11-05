import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';
import { generateWorld } from '../game/world/generator.ts';
import { advanceTime } from '../database/repositories/competitionRepository.ts';
import { simulateMatchday } from '../database/repositories/matchRepository.ts';
import { activateScheme, autoLineup, getTacticsOverview, listSchemes, saveScheme, TacticsError } from '../database/repositories/tacticsRepository.ts';
import { processTrainingMonth, setRoleFocus, TrainingError } from '../database/repositories/trainingRepository.ts';
import { getPlayerProfile } from '../database/repositories/scoutRepository.ts';
import { ROLE_MATCH_GAIN } from '../database/repositories/roleRepository.ts';
import { getFormation } from '../game/match-engine/formations.ts';
import { simulateMatch, zoneWithRole, zoneProfile } from '../game/match-engine/engine.ts';
import { bestRole, defaultFamiliarity, familiarity, roleById, roleFactor, roleFactorFrom, ROLES, rolesFor, roleSuitability } from '../game/match-engine/playerRoles.ts';
import { overallFor } from '../game/world/overall.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import { withTransaction, type SqlDb } from '../database/types.ts';
import { BALANCED, midClubs, sheetOf } from './fixtures.ts';
import type { Coach, Position } from '../shared/types.ts';
import type { TeamSheet } from '../game/match-engine/types.ts';

const coach: Coach = { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null };
async function setup() {
  const world = generateWorld({ seed: 'roles-test', teamsPerLeagueOverride: 8 });
  const db = await openDatabase(':memory:');
  createCareer(db, world, coach, world.clubs[0]!.id);
  return { db, clubId: world.clubs[0]!.id };
}
const playerOf = (db: SqlDb, id: string) => rowToPlayer(db.prepare('SELECT * FROM players WHERE id = ?').get(id)!);
const famRow = (db: SqlDb, pid: string, role: string) => db.prepare('SELECT familiarity FROM player_roles WHERE player_id = ? AND role_id = ?').get(pid, role)?.familiarity as number | undefined;
const withRoles = (s: TeamSheet, pick: (pos: Position) => string | undefined): TeamSheet => ({ ...s, lineup: s.lineup.map((l) => { const r = pick(l.slot); return r ? { ...l, role: r } : l; }) });

// ---------------------------------------------------------------- catálogo e regra pura
let sheetDb: SqlDb | undefined; let firstId: string | undefined;
test.before(async () => { const { db, clubId } = await setup(); sheetDb = db; firstId = String(db.prepare('SELECT id FROM players WHERE club_id = ? LIMIT 1').get(clubId)!.id); });

test('Funções: 3 por posição (ATA antigo exerce as de SA e CA), ids únicos e atributos exigidos existentes', () => {
  const positions: Position[] = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF'];
  for (const p of positions) assert.equal(rolesFor(p).length, 3, `${p}: ${rolesFor(p).map((r) => r.id)}`);
  assert.equal(rolesFor('ST').length, 6);
  assert.equal(new Set(ROLES.map((r) => r.id)).size, ROLES.length);
  const p = playerOf(sheetDb!, firstId!);
  for (const r of ROLES) { const s = roleSuitability(p.attributes, r); assert.ok(s >= 5 && s <= 100, `${r.id}: ${s}`); }
});

test('Funções: domínio inicial pelo perfil — 100% na melhor da posição natural, 55% nas outras dela, menos fora dela; o aprendido prevalece', () => {
  const db = sheetDb!;
  const cb = rowToPlayer(db.prepare("SELECT * FROM players WHERE position = 'CB' LIMIT 1").get()!);
  const best = rolesFor('CB').reduce((a, b) => (roleSuitability(cb.attributes, b) > roleSuitability(cb.attributes, a) ? b : a));
  for (const r of rolesFor('CB')) assert.equal(defaultFamiliarity(cb, r), r.id === best.id ? 100 : 55);
  assert.equal(defaultFamiliarity(cb, roleById('cf_pivo')!), cb.secondaryPositions.some((s) => ['CF', 'ST'].includes(s)) ? 55 : 20);
  assert.equal(familiarity({ ...cb, roleFamiliarity: { cf_pivo: 73.4 } }, roleById('cf_pivo')!), 73);
});

test('Funções: rendimento cresce com a compatibilidade e com o domínio; a automática é a de maior rendimento', () => {
  assert.ok(roleFactorFrom(80, 100, 70) > roleFactorFrom(60, 100, 70));
  assert.ok(roleFactorFrom(70, 100, 70) > roleFactorFrom(70, 20, 70));
  assert.ok(Math.abs(roleFactorFrom(70, 100, 70) - 1) < 1e-9, 'compatibilidade = força na posição e domínio total: neutro');
  assert.ok(roleFactorFrom(100, 100, 50) <= 1 + 0.35 * 0.12 + 1e-9 && roleFactorFrom(0, 0, 90) >= (1 - 0.35 * 0.15) * 0.93 - 1e-9, 'efeito limitado');
  const p = rowToPlayer(sheetDb!.prepare("SELECT * FROM players WHERE position = 'CM' LIMIT 1").get()!);
  const rating = overallFor(p.attributes, 'CM');
  const b = bestRole(p, 'CM', rating);
  for (const r of rolesFor('CM')) assert.ok(roleFactor(p, b, rating) >= roleFactor(p, r, rating));
});

test('Equilíbrio: a inclinação da função não muda o peso total da vaga (nenhuma função dá força de graça)', () => {
  for (const r of ROLES) for (const pos of r.positions) {
    if (pos === 'GK') continue;
    const z = zoneWithRole(pos, r), b = zoneProfile(pos);
    assert.ok(Math.abs(z.att + z.mid + z.def - (b.att + b.mid + b.def)) < 1e-9, `${r.id} em ${pos}`);
  }
  // e muda o perfil no sentido anunciado
  assert.ok(zoneWithRole('LB', roleById('fb_ofensivo')).att > zoneWithRole('LB', roleById('fb_defensivo')).att);
  assert.ok(zoneWithRole('DM', roleById('dm_primeiro')).def > zoneWithRole('DM', roleById('dm_construtor')).def);
});

// ---------------------------------------------------------------- motor
test('Motor (causal): lateral ofensivo participa mais do ataque (finalizações e passes decisivos) e deixa mais espaço nas costas que o defensivo', () => {
  const mid = midClubs();
  let shotsOff = 0, shotsDef = 0, conOff = 0, conDef = 0;
  for (let i = 0; i < 400; i++) {
    const h = mid[i % mid.length]!, a = mid[(i * 5 + 3) % mid.length] === h ? mid[(i + 1) % mid.length]! : mid[(i * 5 + 3) % mid.length]!;
    const away = sheetOf(a, BALANCED, '4-3-3');
    for (const [role, isOff] of [['fb_ofensivo', true], ['fb_defensivo', false]] as const) {
      const home = withRoles(sheetOf(h, BALANCED, '4-4-2'), (pos) => (pos === 'LB' || pos === 'RB' ? role : undefined));
      const r = simulateMatch(home, away, { seed: `fb-${i}` });
      const fbShots = r.players.filter((p) => p.team === 0 && (p.slot === 'LB' || p.slot === 'RB')).reduce((s, p) => s + p.shots + p.keyPasses, 0);
      if (isOff) { shotsOff += fbShots; conOff += r.awayGoals; } else { shotsDef += fbShots; conDef += r.awayGoals; }
    }
  }
  // medido em 1.500 jogos: finalizações +16%, passes decisivos +19%, assistências de cruzamento +53%, gols sofridos +9%; nestes 400, +10% e +9%
  assert.ok(shotsOff > shotsDef * 1.05, `finalizações + passes decisivos dos laterais: ofensivo ${shotsOff}, defensivo ${shotsDef}`);
  assert.ok(conOff > conDef, `gols sofridos: ofensivo ${conOff}, defensivo ${conDef}`);
});

test('Motor: a função escolhida para a vaga é a exercida (relatório); sem escolha, a de maior rendimento; mesma semente = mesmo jogo', () => {
  const [h, a] = midClubs();
  const base = sheetOf(h!, BALANCED, '4-4-2');
  const forced = withRoles(base, (pos) => rolesFor(pos)[2]!.id);
  const r1 = simulateMatch(forced, sheetOf(a!, BALANCED, '4-4-2'), { seed: 'role-rep' });
  for (const l of forced.lineup) {
    const rep = r1.players.find((p) => p.id === l.player.id)!;
    if (rep.slot === l.slot) assert.equal(rep.role, l.role, `${l.slot}`);
  }
  const auto = simulateMatch(base, sheetOf(a!, BALANCED, '4-4-2'), { seed: 'role-rep' });
  const gk = base.lineup[0]!;
  assert.equal(auto.players.find((p) => p.id === gk.player.id)!.role, bestRole(gk.player, 'GK', overallFor(gk.player.attributes, 'GK')).id);
  assert.deepEqual(simulateMatch(forced, sheetOf(a!, BALANCED, '4-4-2'), { seed: 'role-rep' }), r1);
});

// ---------------------------------------------------------------- esquema, aprendizado, treino, ficha
test('Esquema: funções por vaga são validadas, gravadas e usadas na partida; o domínio cresce com os minutos jogados na função', async () => {
  const { db, clubId } = await setup();
  const slots = getFormation('4-4-2').slots;
  const lineup = autoLineup(db, '4-4-2');
  const roles = slots.map((s) => rolesFor(s.pos)[1]!.id);
  const before = JSON.stringify(listSchemes(db));
  assert.throws(() => saveScheme(db, { name: 'X', formation: '4-4-2', settings: BALANCED, lineup, roles: roles.slice(0, 10) }), TacticsError);
  assert.throws(() => saveScheme(db, { name: 'X', formation: '4-4-2', settings: BALANCED, lineup, roles: ['cf_pivo', ...roles.slice(1)] }), /não é desta posição/);
  assert.throws(() => saveScheme(db, { name: 'X', formation: '4-4-2', settings: BALANCED, lineup, roles: ['gk_inexistente', ...roles.slice(1)] }), /inválida/);
  assert.equal(JSON.stringify(listSchemes(db)), before, 'nada gravado');

  const s = saveScheme(db, { name: 'Funções', formation: '4-4-2', settings: BALANCED, lineup, roles });
  assert.deepEqual(s.roles, roles);
  assert.equal(saveScheme(db, { id: s.id, name: 'Funções', formation: '4-4-2', settings: BALANCED, lineup, roles: Array(11).fill(null) }).roles, null, 'tudo automático = null');
  saveScheme(db, { id: s.id, name: 'Funções', formation: '4-4-2', settings: BALANCED, lineup, roles });
  activateScheme(db, s.id);

  const pre = new Map(lineup.map((id, i) => { const p = playerOf(db, id); return [id, familiarity(p, roleById(roles[i]!)!)]; }));
  advanceTime(db, 'nextMatchday');
  const day = simulateMatchday(db);
  const rep = JSON.parse(String(db.prepare('SELECT report_json FROM matches WHERE fixture_id = ?').get(day.userMatch!.fixtureId)!.report_json)) as { players: Array<{ id: string; slot: Position; role?: string; minutes: number }> };
  let checked = 0;
  lineup.forEach((id, i) => {
    const rp = rep.players.find((p) => p.id === id);
    if (!rp) return; // lesionado no treino antes do jogo: ficou fora
    if (rp.slot !== slots[i]!.pos) return; // reorganizado por substituição/expulsão
    assert.equal(rp.role, roles[i], `vaga ${i}`);
    const expected = Math.min(100, Math.round((pre.get(id)! + (ROLE_MATCH_GAIN * rp.minutes) / 90) * 10) / 10);
    // domínio inicial guardado sem arredondar (pre usa o arredondado, igual à regra: o inicial é inteiro)
    assert.equal(famRow(db, id, roles[i]!), expected, `domínio de ${id}`);
    checked++;
  });
  assert.ok(checked >= 9, `vagas conferidas: ${checked}`);
  // a IA também aprende (vale para todos os clubes)
  const aiLearned = Number(db.prepare('SELECT COUNT(*) AS n FROM player_roles pr JOIN players p ON p.id = pr.player_id WHERE p.club_id <> ?').get(clubId)!.n);
  assert.ok(aiLearned > 100, `jogadores da IA com domínio registrado: ${aiLearned}`);
  // a Tática mostra o domínio novo
  const ov = getTacticsOverview(db);
  const sq = ov.squad.find((p) => p.id === lineup[5])!;
  assert.equal(sq.roles.find((r) => r.id === roles[5])!.familiarity, Math.round(famRow(db, lineup[5]!, roles[5]!)!));
  assert.equal(ov.roleCatalog.length, ROLES.length);
});

test('Treino de função: só no próprio elenco, função válida; ganho mensal só para quem treina, limitado a 100', async () => {
  const { db, clubId } = await setup();
  const [a, b] = db.prepare("SELECT id FROM players WHERE club_id = ? AND position = 'CB' ORDER BY id LIMIT 2").all(clubId).map((r) => String(r.id));
  const other = String(db.prepare('SELECT id FROM players WHERE club_id <> ? LIMIT 1').get(clubId)!.id);
  assert.throws(() => setRoleFocus(db, other, 'cb_agressivo'), TrainingError);
  assert.throws(() => setRoleFocus(db, a!, 'nada'), TrainingError);
  setRoleFocus(db, a!, 'cf_pivo'); // função de outra posição: pode treinar (vira opção)
  setRoleFocus(db, b!, 'cb_agressivo'); setRoleFocus(db, b!, null);
  assert.equal(getTacticsOverview(db).squad.find((p) => p.id === a)!.roleFocus, 'cf_pivo');
  const start = familiarity(playerOf(db, a!), roleById('cf_pivo')!);
  db.exec("UPDATE fixtures SET status = 'played', home_goals = 0, away_goals = 0");
  withTransaction(db, () => processTrainingMonth(db, '2026-09-01'));
  const after = famRow(db, a!, 'cf_pivo')!;
  assert.ok(after - start >= 7 && after - start <= 14, `ganho no mês: ${after - start}`);
  assert.equal(famRow(db, b!, 'cb_agressivo'), undefined, 'sem foco, sem ganho de treino');
  db.prepare("UPDATE player_roles SET familiarity = 99 WHERE player_id = ? AND role_id = 'cf_pivo'").run(a);
  withTransaction(db, () => processTrainingMonth(db, '2026-10-01'));
  assert.equal(famRow(db, a!, 'cf_pivo'), 100);
});

test('Treino de função (com foco Equilibrado) puxa os atributos da função: a compatibilidade sobe mais que sem treino', async () => {
  // mesmo save e mesmas sementes nos dois bancos: só muda a função treinada
  const runYear = async (train: boolean) => {
    const { db, clubId } = await setup();
    const young = db.prepare("SELECT id FROM players WHERE club_id = ? AND position <> 'GK' ORDER BY birth_date DESC LIMIT 20").all(clubId).map((r) => String(r.id));
    const role = (pid: string) => rolesFor(playerOf(db, pid).position).at(-1)!;
    const before = young.map((pid) => roleSuitability(playerOf(db, pid).attributes, role(pid)));
    if (train) for (const pid of young) setRoleFocus(db, pid, role(pid).id);
    db.exec("UPDATE fixtures SET status = 'played', home_goals = 0, away_goals = 0");
    for (let m = 0; m < 12; m++) withTransaction(db, () => processTrainingMonth(db, `20${26 + Math.floor((m + 8) / 12)}-${String(((m + 8) % 12) + 1).padStart(2, '0')}-01`));
    return young.reduce((s, pid, i) => s + roleSuitability(playerOf(db, pid).attributes, role(pid)) - before[i]!, 0) / young.length;
  };
  const trained = await runYear(true), plain = await runYear(false);
  assert.ok(trained - plain >= 0.15, `compatibilidade média: treinando +${trained.toFixed(2)} × sem treino +${plain.toFixed(2)}`);
});

test('Ficha: funções (compatibilidade e domínio) só de jogadores do próprio clube', async () => {
  const { db, clubId } = await setup();
  const own = String(db.prepare("SELECT id FROM players WHERE club_id = ? AND position = 'DM' LIMIT 1").get(clubId)!.id);
  const other = String(db.prepare('SELECT id FROM players WHERE club_id <> ? AND youth_club_id IS NULL LIMIT 1').get(clubId)!.id);
  setRoleFocus(db, own, 'am_recuado');
  const pf = getPlayerProfile(db, own);
  assert.ok(pf.roles);
  assert.ok(rolesFor('DM').every((r) => pf.roles!.list.some((x) => x.id === r.id)), 'funções da posição natural');
  assert.ok(pf.roles.list.some((x) => x.id === 'am_recuado'), 'a função treinada aparece');
  assert.equal(pf.roles.focus, 'am_recuado');
  assert.equal(getPlayerProfile(db, other).roles, null);
});

test('Motor (causal, isolado): efeito de finalização da função e risco nas costas (zagueiros agressivos e goleiro sem cobertura)', () => {
  const mid = midClubs();
  const pair = (i: number): [string, string] => { const h = mid[i % mid.length]!, a = mid[(i * 5 + 3) % mid.length]!; return [h, a === h ? mid[(i + 1) % mid.length]! : a]; };
  // mesmo jogador e mesma vaga: só muda a função (sem inclinação de zona entre as duas)
  const fin: Record<string, number> = {};
  for (const cf of ['cf_referencia', 'cf_pivo']) {
    fin[cf] = 0;
    for (let i = 0; i < 300; i++) {
      const [h, a] = pair(i);
      const home = withRoles(sheetOf(h, BALANCED, '4-2-3-1'), (pos) => (pos === 'CF' ? cf : undefined));
      const id = home.lineup.find((l) => l.slot === 'CF')!.player.id;
      for (const e of simulateMatch(home, sheetOf(a, BALANCED, '4-4-2'), { seed: `iso-${i}` }).events) {
        if ((e.type === 'shot' || e.type === 'goal') && e.player === id && (e.chance === 'buildup' || e.chance === 'counter')) fin[cf]!++;
      }
    }
  }
  // medido: 772 × 631 (1,22)
  assert.ok(fin.cf_referencia! > fin.cf_pivo! * 1.1, `finalizações do centroavante: referência ${fin.cf_referencia}, pivô ${fin.cf_pivo}`);
  const counters: Record<string, number> = {};
  for (const [name, cb, gk] of [['alto', 'cb_agressivo', 'gk_construtor'], ['baixo', 'cb_defensivo', 'gk_libero']] as const) {
    counters[name] = 0;
    for (let i = 0; i < 300; i++) {
      const [h, a] = pair(i);
      const home = withRoles(sheetOf(h, BALANCED, '4-4-2'), (pos) => (pos === 'CB' ? cb : pos === 'GK' ? gk : pos === 'LB' || pos === 'RB' ? 'fb_completo' : undefined));
      for (const e of simulateMatch(home, sheetOf(a, BALANCED, '4-4-2'), { seed: `iso-${i}` }).events) if ((e.type === 'shot' || e.type === 'goal') && e.team === 1 && e.chance === 'counter') counters[name]!++;
    }
  }
  // medido: 752 × 584 (1,29)
  assert.ok(counters.alto! > counters.baixo! * 1.12, `contra-ataques sofridos: defesa arriscada ${counters.alto}, segura ${counters.baixo}`);
});
