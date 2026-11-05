/**
 * Base de dados fixa (data/base) carregada do disco uma vez por sessão (cache). Toda carreira nova parte dela, mais os pacotes de dados
 * ativos do usuário (packManager). O processo principal informa a pasta (dentro do app instalado); nos testes e na linha de comando, o
 * padrão é ./data/base.
 */
import path from 'node:path';
import { compileUniverse } from '../game/data-pack/compile.ts';
import type { Pack } from '../game/data-pack/format.ts';
import type { World } from '../shared/types.ts';
import { readPackDir } from './packService.node.ts';

let baseDir = path.join(process.cwd(), 'data', 'base');
let cache: { dir: string; pack: Pack; world: World; applied: string[] } | null = null;

export function setBaseUniverseDir(dir: string): void { baseDir = dir; cache = null; }

/** Universo vazio de partida: a base fixa é um pacote "base: none", que preenche tudo. Data de início da carreira: 01/07/2026. */
export const EMPTY_WORLD: World = { seed: 'base', startDate: '2026-07-01', countries: [], leagues: [], stadiums: [], clubs: [], players: [] };

function load() {
  if (!cache || cache.dir !== baseDir) {
    const pack = readPackDir(baseDir);
    const { world, applied } = compileUniverse(EMPTY_WORLD, [pack]);
    cache = { dir: baseDir, pack, world, applied };
  }
  return cache;
}

/** Universo só da base fixa. Não modifique o objeto devolvido. */
export function baseUniverse(): { world: World; applied: string[] } {
  const c = load();
  return { world: c.world, applied: c.applied };
}
/** A base fixa como pacote (primeiro da ordem de carga). */
export function basePack(): Pack { return load().pack; }
