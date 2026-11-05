import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGoalkeeper, GK_ATTRS, gkComposite, withGoalkeeper } from '../game/world/goalkeeper.ts';
import { generateWorld } from '../game/world/generator.ts';
import { overallFor } from '../game/world/overall.ts';
import { developPlayer } from '../game/career-engine/development.ts';
import { createRng } from '../game/rng.ts';
import { compileUniverse } from '../game/data-pack/compile.ts';
import { PACK_FORMAT, parsePack } from '../game/data-pack/format.ts';
import { roleById, roleSuitability } from '../game/match-engine/playerRoles.ts';
import { rowToPlayer } from '../database/repositories/worldRepository.ts';
import { openDatabase } from '../database/connection.ts';
import { createCareer } from '../services/careerService.ts';

const world = generateWorld({ seed: 'goleiros', teamsPerLeagueOverride: 6 });
const gks = world.players.filter((p) => p.position === 'GK');

test('Goleiro: o grupo derivado mantém a força (geral = média ponderada) e todo jogador gerado tem o grupo coerente', () => {
  const exactAvg = (x: ReturnType<typeof deriveGoalkeeper>) => GK_ATTRS.reduce((t, k) => t + x[k.key] * k.weight, 0) / GK_ATTRS.reduce((t, k) => t + k.weight, 0);
  for (let g = 1; g <= 20; g++) for (const d of [-1, 0, 1]) {
    assert.equal(gkComposite(deriveGoalkeeper(g, d)), g, `g=${g} d=${d}`);
    assert.equal(exactAvg(deriveGoalkeeper(g, d)), g, `média exata (sem depender do arredondamento): g=${g} d=${d}`);
  }
  assert.ok(gks.length > 0);
  for (const p of world.players) {
    assert.ok(p.attributes.goalkeeper, p.id);
    assert.equal(gkComposite(p.attributes.goalkeeper!), p.attributes.technical.goalkeeping, `${p.id}: geral = média dos específicos`);
  }
  assert.ok(new Set(gks.map((p) => p.attributes.goalkeeper!.oneOnOne - p.attributes.goalkeeper!.handling)).size > 1, 'variação entre goleiros');
  // dados antigos sem o grupo: derivado sem mudar o geral
  const old = { ...gks[0]!.attributes }; delete old.goalkeeper;
  const w = withGoalkeeper(old, gks[0]!.id);
  assert.equal(gkComposite(w.goalkeeper!), old.technical.goalkeeping);
});

test('Goleiro: reflexos e cia. mexem na força e nas funções; patch no grupo recalcula o geral; patch no geral deriva o grupo', () => {
  const gk = gks[0]!;
  const better = structuredClone(gk.attributes);
  better.goalkeeper!.reflexes = 20; better.goalkeeper!.handling = 20;
  better.technical.goalkeeping = gkComposite(better.goalkeeper!);
  assert.ok(overallFor(better, 'GK') > overallFor(gk.attributes, 'GK'), 'goleiro com mais reflexos/manejo rende mais');
  const sweeper = structuredClone(gk.attributes); sweeper.goalkeeper!.rushingOut = 20;
  assert.ok(roleSuitability(sweeper, roleById('gk_libero')!) > roleSuitability(gk.attributes, roleById('gk_libero')!), 'saídas do gol pesam no Líbero');
  const pack = (data: Record<string, unknown[]>) => parsePack({ manifest: { format: PACK_FORMAT, id: 'gk', name: 'gk', version: '1' }, files: data }, 'gk');
  const w1 = compileUniverse(world, [pack({ players: [{ id: gk.id, attributes: { goalkeeper: { reflexes: 20, oneOnOne: 20 } } }] })]).world;
  const p1 = w1.players.find((p) => p.id === gk.id)!;
  assert.equal(p1.attributes.goalkeeper!.reflexes, 20);
  assert.equal(p1.attributes.technical.goalkeeping, gkComposite(p1.attributes.goalkeeper!));
  assert.ok(p1.overall > gk.overall);
  const w2 = compileUniverse(world, [pack({ players: [{ id: gk.id, attributes: { technical: { goalkeeping: 6 } } }] })]).world;
  const p2 = w2.players.find((p) => p.id === gk.id)!;
  assert.equal(p2.attributes.technical.goalkeeping, 6); assert.equal(gkComposite(p2.attributes.goalkeeper!), 6);
});

test('Goleiro: a evolução mantém o geral igual à média dos específicos (inclusive no teto do potencial)', () => {
  for (const [i, gk] of gks.slice(0, 12).entries()) {
    let p = { ...gk };
    for (let m = 0; m < 24; m++) {
      const d = developPlayer(p, 19, 0.8, createRng(`gk-dev:${i}:${m}`), { fraction: 1 / 12 });
      p = { ...p, ...d };
      assert.equal(p.attributes.technical.goalkeeping, gkComposite(p.attributes.goalkeeper!), `${gk.id} mês ${m}`);
      assert.ok(p.overall <= Math.max(p.potentialHidden, gk.overall));
    }
  }
});

test('Goleiro: save antigo (atributos sem o grupo) é lido com o grupo derivado e a mesma força', async () => {
  const db = await openDatabase(':memory:');
  createCareer(db, world, { firstName: 'A', lastName: 'B', birthDate: '1980-01-01', nationality: 'BRA', methodology: 'possession', reputation: 20, photoPath: null }, world.clubs[0]!.id);
  const gk = gks[0]!;
  const old = structuredClone(gk.attributes); delete old.goalkeeper;
  db.prepare('UPDATE players SET attributes_json = ? WHERE id = ?').run(JSON.stringify(old), gk.id);
  const read = rowToPlayer(db.prepare('SELECT * FROM players WHERE id = ?').get(gk.id)!);
  assert.ok(read.attributes.goalkeeper);
  assert.equal(read.attributes.technical.goalkeeping, gk.attributes.technical.goalkeeping);
  assert.equal(overallFor(read.attributes, 'GK'), overallFor(gk.attributes, 'GK'));
});

test('Informativo dos atributos: todo atributo tem texto (o que é e efeito na partida); "sem efeito" só para quem o motor de fato não usa', async () => {
  const fs = await import('node:fs');
  const { ATTRIBUTE_INFO, attributeHelp, positionsWeighing } = await import('../game/world/attributeInfo.ts');
  const { ATTR_KEYS } = await import('../game/world/generator.ts');
  const all = [...ATTR_KEYS.technical, ...ATTR_KEYS.mental, ...ATTR_KEYS.physical, ...GK_ATTRS.map((a) => a.key)];
  for (const k of all) {
    assert.ok(ATTRIBUTE_INFO[k]?.what && ATTRIBUTE_INFO[k]?.match, `${k}: sem informativo`);
    assert.ok(attributeHelp(k).includes('Na partida:'));
  }
  assert.deepEqual(Object.keys(ATTRIBUTE_INFO).sort(), [...all].sort(), 'nenhum informativo sobrando');
  // honestidade: quem diz "não influencia a partida" não pode aparecer no motor nem nos pesos/funções
  const engine = ['engine.ts', 'roles.ts', 'playerRoles.ts', 'teamTalk.ts'].map((f) => fs.readFileSync(`src/game/match-engine/${f}`, 'utf8')).join('\n') + fs.readFileSync('src/game/world/overall.ts', 'utf8');
  for (const [k, i] of Object.entries(ATTRIBUTE_INFO)) if (/não influencia a partida/.test(i.match)) assert.ok(!new RegExp(`\\b${k}\\b`).test(engine), `${k} é usado pelo motor: atualize o informativo`);
  assert.deepEqual(positionsWeighing('finishing'), ['LW', 'RW', 'SS', 'CF'], 'calculado da tabela de pesos (PE/PD 1,5, SA 2,5, CA 4; MEI 1 fica de fora)');
});
