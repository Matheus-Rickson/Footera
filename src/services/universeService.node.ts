/**
 * Base de dados fixa (data/base) carregada do disco e montada uma vez por sessão (cache). Toda carreira nova parte dela.
 * O processo principal informa a pasta (dentro do app instalado); nos testes e na linha de comando, o padrão é ./data/base.
 */
import path from 'node:path';
import { compileUniverse } from '../game/data-pack/compile.ts';
import type { World } from '../shared/types.ts';
import { readPackDir } from './packService.node.ts';

let baseDir = path.join(process.cwd(), 'data', 'base');
let cache: { dir: string; world: World; applied: string[] } | null = null;

export function setBaseUniverseDir(dir: string): void { baseDir = dir; cache = null; }

/** Universo da base fixa (sem pacotes do usuário ainda: etapa 2). Data de início 01/07/2026. Não modifique o objeto devolvido. */
export function baseUniverse(): { world: World; applied: string[] } {
  if (!cache || cache.dir !== baseDir) {
    const pack = readPackDir(baseDir);
    const empty: World = { seed: 'base', startDate: '2026-07-01', countries: [], leagues: [], stadiums: [], clubs: [], players: [] };
    const { world, applied } = compileUniverse(empty, [pack]);
    cache = { dir: baseDir, world, applied };
  }
  return { world: cache.world, applied: cache.applied };
}
