/**
 * Base de dados fixa (data/base) carregada do disco uma vez por sessão (cache). Toda carreira nova parte dela, mais os pacotes de dados
 * ativos do usuário (packManager). O processo principal informa a pasta (dentro do app instalado); nos testes e na linha de comando, o
 * padrão é ./data/base.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compileUniverse } from '../game/data-pack/compile.ts';
import type { Pack } from '../game/data-pack/format.ts';
import type { World } from '../shared/types.ts';
import { readPackDir } from './packService.node.ts';

let baseDir = path.join(process.cwd(), 'data', 'base');
let packCache: { dir: string; pack: Pack } | null = null;
let worldCache: { dir: string; world: World; applied: string[] } | null = null;

export function setBaseUniverseDir(dir: string): void { baseDir = dir; packCache = null; worldCache = null; }

/** Universo vazio de partida: a base fixa é um pacote "base: none", que preenche tudo. Data de início da carreira: 01/07/2026. */
export const EMPTY_WORLD: World = { seed: 'base', startDate: '2026-07-01', countries: [], leagues: [], stadiums: [], clubs: [], players: [] };

/** A base fixa como pacote (primeiro da ordem de carga), lida do disco uma vez. */
export function basePack(): Pack {
  if (!packCache || packCache.dir !== baseDir) packCache = { dir: baseDir, pack: readPackDir(baseDir) };
  return packCache.pack;
}

/** Universo só da base fixa (montado uma vez). Não modifique o objeto devolvido. */
export function baseUniverse(): { world: World; applied: string[] } {
  if (!worldCache || worldCache.dir !== baseDir) {
    const { world, applied } = compileUniverse(EMPTY_WORLD, [basePack()]);
    worldCache = { dir: baseDir, world, applied };
  }
  return { world: worldCache.world, applied: worldCache.applied };
}

/**
 * Identificação da base fixa sem carregá-la (cache do universo em disco): o manifesto e o tamanho e a data de cada arquivo da pasta.
 */
export function baseFingerprint(): string {
  try {
    const files = fs.readdirSync(baseDir).filter((f) => f.endsWith('.json')).sort();
    return JSON.stringify([fs.readFileSync(path.join(baseDir, 'manifest.json'), 'utf8'), files.map((f) => { const st = fs.statSync(path.join(baseDir, f)); return [f, st.size, st.mtimeMs]; })]);
  } catch { return 'base-indisponivel'; }
}
