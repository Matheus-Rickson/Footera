/**
 * Desempenho (v0.8.9): as otimizações não podem mudar resultados. Montagem do universo idêntica, cache em disco equivalente ao
 * universo montado, conexões dos saves reaproveitadas sem esconder mudanças.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRng, clamp } from '../game/rng.ts';
import { attributesForAbility } from '../game/data-pack/compile.ts';
import { genAttributes } from '../game/world/generator.ts';
import { deriveGoalkeeper } from '../game/world/goalkeeper.ts';
import { overallFor } from '../game/world/overall.ts';
import { POS_ORDER } from '../shared/positions.ts';
import type { Attributes, Position } from '../shared/types.ts';
import { writeZip } from '../services/zip.node.ts';
import { careerUniverse, importPackZip, setLoadOrder, setUniverseCacheTag, warmUniverse } from '../services/packManager.node.ts';
import { baseUniverse } from '../services/universeService.node.ts';
import { createProfile } from '../services/profileService.node.ts';
import { advanceCareer, closeAllCareerDbs, createCareerSave, getTactics, listCareerSaves } from '../services/saveService.node.ts';
import { openDatabase } from '../database/connection.ts';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Implementação anterior (v0.8.8) de `attributesForAbility`, usada como referência. */
function referenceAttributes(seed: string, pos: Position, ability: number): Attributes {
  const rng = createRng(seed);
  const base = genAttributes(rng, pos, 10);
  const target = ability * 5;
  const shift = (d: number): Attributes => {
    const mv = <T extends object>(g: T): T => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, clamp(Math.round((v as number) + d), 1, 20)])) as T;
    return { technical: mv(base.technical), mental: mv(base.mental), physical: mv(base.physical) };
  };
  let best = base, bestErr = Infinity;
  for (let d = -12; d <= 12; d += 0.25) {
    const a = shift(d);
    a.goalkeeper = deriveGoalkeeper(a.technical.goalkeeping);
    const err = Math.abs(overallFor(a, pos) - target);
    if (err < bestErr) { best = a; bestErr = err; }
  }
  return best;
}

test('Desempenho: atributos por força (montagem do universo) iguais aos da implementação anterior em todas as posições e forças', () => {
  let n = 0;
  for (const pos of POS_ORDER as readonly Position[]) {
    for (let ability = 1; ability <= 20; ability++) {
      for (let k = 0; k < 6; k++) {
        const seed = `perf:${pos}:${ability}:${k}`;
        assert.deepEqual(attributesForAbility(createRng(seed), pos, ability), referenceAttributes(seed, pos, ability), `${pos} força ${ability} (${k})`);
        n++;
      }
    }
  }
  assert.ok(n >= 1500);
});

const json = (v: unknown) => Buffer.from(JSON.stringify(v));
const packZip = (id: string, files: Record<string, unknown>) =>
  writeZip([['manifest.json', json({ format: 1, id, name: `Pacote ${id}`, version: '1.0' })], ...Object.entries(files).map(([k, v]): [string, Buffer] => [`${k}.json`, json(v)])]);

test('Desempenho: universo da carreira nova em cache no disco é igual ao montado; pacote alterado ou outra versão do programa remonta', () => {
  const dir = tmp('footera-perf-');
  try {
    const club = baseUniverse().world.clubs.find((c) => c.leagueId === 'bra-1')!;
    importPackZip(dir, packZip('renomeia', { clubs: [{ id: club.id, name: 'Clube do Cache' }], players: [{ id: 'jogador-do-cache', firstName: 'Cache', lastName: 'Teste', birthDate: '2000-01-01', nationality: 'BRA', position: 'CM', club: club.id, ability: 12 }] }), false);
    setLoadOrder(dir, ['renomeia']);
    setUniverseCacheTag('teste-1');
    const built = careerUniverse(dir);
    const files = () => fs.readdirSync(path.join(dir, 'cache')).filter((f) => f.startsWith('universe-'));
    assert.equal(files().length, 1, 'gravou o cache em disco');
    assert.equal(built.world.clubs.find((c) => c.id === club.id)!.name, 'Clube do Cache');
    // nova sessão (memória vazia): vem do disco, idêntico
    setUniverseCacheTag('teste-1');
    assert.equal(warmUniverse(dir), true, 'pré-carga acha o cache');
    setUniverseCacheTag('teste-1');
    const fromDisk = careerUniverse(dir);
    assert.notEqual(fromDisk, built);
    assert.deepEqual(fromDisk.world, built.world);
    assert.deepEqual(fromDisk.applied, built.applied);
    assert.deepEqual(fromDisk.warnings, built.warnings);
    assert.deepEqual([...fromDisk.origin], [...built.origin]);
    // pacote alterado: chave nova, remonta (e o arquivo antigo é trocado)
    const clubs = path.join(dir, 'packs', 'renomeia', 'clubs.json');
    fs.writeFileSync(clubs, JSON.stringify([{ id: club.id, name: 'Nome Novo' }]));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(clubs, later, later);
    assert.equal(careerUniverse(dir).world.clubs.find((c) => c.id === club.id)!.name, 'Nome Novo');
    assert.equal(files().length, 1);
    // outra versão do programa: o cache gravado não vale
    setUniverseCacheTag('teste-2');
    assert.equal(warmUniverse(dir), false);
  } finally { setUniverseCacheTag('dev'); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Desempenho: conexão do save reaproveitada; verificações de saves antigos rodam de novo só quando a data muda; lista de carreiras atualizada', async () => {
  const base = tmp('footera-perf-save-');
  try {
    const prof = createProfile(base, 'Teste');
    const w = baseUniverse().world;
    const eng = w.countries.find((c) => c.code === 'ENG')!.id;
    const clubId = w.clubs.find((c) => w.leagues.find((l) => l.id === c.leagueId)!.countryId === eng)!.id;
    const c = await createCareerSave(base, { profileId: prof.id, clubId, coach: { firstName: 'Ana', lastName: 'Silva', birthDate: '1980-05-10', nationality: 'BRA', methodology: 'possession' } });
    const before = await getTactics(base, prof.id, c.id);
    const spare = before.schemes.find((s) => s.builtin && !s.active)!;
    // outra conexão apaga um esquema padrão (que `ensureSchemes` recria)
    const file = path.join(base, 'saves', prof.id, c.id, 'career.db');
    const side = await openDatabase(file);
    side.prepare('DELETE FROM tactic_schemes WHERE id = ?').run(spare.id);
    side.close();
    const same = await getTactics(base, prof.id, c.id);
    assert.equal(same.schemes.length, before.schemes.length - 1, 'mesma data: não repete as verificações (e enxerga a mudança da outra conexão)');
    // a lista de carreiras usa a conexão aberta e mostra a data nova depois de avançar
    assert.equal((await listCareerSaves(base, prof.id)).careers[0]!.gameDate, '2026-07-01');
    await advanceCareer(base, prof.id, c.id, 'day');
    assert.equal((await listCareerSaves(base, prof.id)).careers[0]!.gameDate, '2026-07-02');
    const after = await getTactics(base, prof.id, c.id);
    assert.equal(after.schemes.length, before.schemes.length, 'data nova: as verificações rodam e recriam o esquema');
    // fechado: a lista lê o arquivo só para leitura e o resumo acompanha
    closeAllCareerDbs();
    assert.equal((await listCareerSaves(base, prof.id)).careers[0]!.gameDate, '2026-07-02');
    assert.equal((await listCareerSaves(base, prof.id)).careers[0]!.gameDate, '2026-07-02', 'do cache de resumos');
    // o resumo guardado não pode ficar velho quando o save muda
    await advanceCareer(base, prof.id, c.id, 'day');
    closeAllCareerDbs();
    assert.equal((await listCareerSaves(base, prof.id)).careers[0]!.gameDate, '2026-07-03');
  } finally { closeAllCareerDbs(); fs.rmSync(base, { recursive: true, force: true }); }
});
