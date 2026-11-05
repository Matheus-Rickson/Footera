/**
 * Pacotes de dados do usuário (etapa 2 da base editável): pasta `<dados>/packs/<id>/`, ordem de carga em `<dados>/packs/load-order.json`.
 * A base fixa vem sempre primeiro; depois os pacotes ativos, na ordem. O universo resultante é o que a carreira nova usa.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compileUniverse, type EntityOrigin } from '../game/data-pack/compile.ts';
import { fmtIssue, PACK_FILES, PackError, parsePack, type Pack, type PackFile } from '../game/data-pack/format.ts';
import { ID_PATTERN } from '../shared/slug.ts';
import type { PackInfoDto, PacksOverviewDto } from '../shared/api.ts';
import type { World } from '../shared/types.ts';
import { ValidationError } from './careerService.ts';
import { readPackDir, writePackDir } from './packService.node.ts';
import { basePack, EMPTY_WORLD } from './universeService.node.ts';
import { readZip, writeZip, ZipError } from './zip.node.ts';
import { IMAGE_PATH, imagesVersion, invalidateImages, listPackImages, validateImage } from './imageService.node.ts';

export const packsDir = (dataDir: string) => path.join(dataDir, 'packs');
const orderFile = (dataDir: string) => path.join(packsDir(dataDir), 'load-order.json');

interface Scanned { folder: string; dir: string; pack: Pack | null; issues: string[]; mtime: number }

function scan(dataDir: string): Scanned[] {
  const root = packsDir(dataDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().map((folder) => {
    const dir = path.join(root, folder);
    const mtime = Math.max(0, ...fs.readdirSync(dir).map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
    try { return { folder, dir, pack: readPackDir(dir), issues: [], mtime }; } catch (e) {
      if (e instanceof PackError) return { folder, dir, pack: null, issues: e.issues.map(fmtIssue), mtime };
      return { folder, dir, pack: null, issues: [(e as Error).message], mtime };
    }
  });
}

function readOrder(dataDir: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(orderFile(dataDir), 'utf8')) as { enabled?: unknown };
    return Array.isArray(raw.enabled) ? raw.enabled.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** Pacotes ativos e válidos, na ordem de carga (ids que não existem mais ou com erro de estrutura ficam de fora). */
function activePacks(scanned: Scanned[], order: string[]): Pack[] {
  return order.map((id) => scanned.find((s) => s.pack?.manifest.id === id)?.pack).filter((p): p is Pack => !!p);
}

/** origem das entidades com o NOME dos pacotes do usuário (a base do jogo não aparece) */
export type NamedOrigin = Map<string, EntityOrigin>;
let cache: { key: string; world: World; applied: string[]; warnings: string[]; origin: NamedOrigin } | null = null;

/**
 * Universo da carreira nova: base fixa + pacotes ativos. Lança ValidationError se a combinação tiver erros (a tela de pacotes mostra
 * os detalhes). Cache pela ordem e pelas datas de modificação dos arquivos.
 */
export function careerUniverse(dataDir: string): { world: World; applied: string[]; warnings: string[]; origin: NamedOrigin } {
  const scanned = scan(dataDir), order = readOrder(dataDir);
  const packs = activePacks(scanned, order);
  const key = JSON.stringify(packs.map((p) => [p.manifest.id, p.manifest.version, scanned.find((s) => s.pack === p)!.mtime]));
  if (cache && cache.key === key) return cache;
  try {
    const r = compileUniverse(EMPTY_WORLD, [basePack(), ...packs]);
    const baseId = basePack().manifest.id;
    const nameOf = new Map(packs.map((p) => [p.manifest.id, p.manifest.name]));
    const origin: NamedOrigin = new Map();
    for (const [id, o] of r.origin) {
      const created = o.created && o.created !== baseId ? nameOf.get(o.created) ?? o.created : null;
      const edited = o.edited.filter((x) => x !== baseId).map((x) => nameOf.get(x) ?? x);
      if (created || edited.length) origin.set(id, { created, edited });
    }
    cache = { key, world: r.world, applied: r.applied, warnings: r.warnings.map(fmtIssue), origin };
    return cache;
  } catch (e) {
    if (e instanceof PackError) throw new ValidationError(`Os pacotes de dados ativos têm erros (veja em Pacotes de dados): ${fmtIssue(e.issues[0]!)}${e.issues.length > 1 ? ` e mais ${e.issues.length - 1}` : ''}.`);
    throw e;
  }
}

export function listPacks(dataDir: string): PacksOverviewDto {
  const scanned = scan(dataDir), order = readOrder(dataDir);
  const base = basePack();
  const packs: PackInfoDto[] = scanned.map((s) => {
    const m = s.pack?.manifest;
    const id = m?.id ?? s.folder;
    const pos = order.indexOf(id);
    return {
      id, folder: s.folder, name: m?.name ?? s.folder, version: m?.version ?? '?', author: m?.author ?? null, description: m?.description ?? null,
      enabled: !!s.pack && pos >= 0, order: s.pack && pos >= 0 ? pos : null,
      counts: s.pack ? Object.fromEntries(PACK_FILES.map((f) => [f, s.pack!.data[f].length])) as PackInfoDto['counts'] : null,
      issues: s.issues, requires: m?.requires ?? [], fullBase: m?.base === 'none',
    };
  }).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
  let universe: PacksOverviewDto['universe'];
  try {
    const r = compileUniverse(EMPTY_WORLD, [base, ...activePacks(scanned, order)]);
    universe = { ok: true, errors: [], warnings: r.warnings.map(fmtIssue), countries: r.world.countries.length, leagues: r.world.leagues.length, clubs: r.world.clubs.length, players: r.world.players.length };
  } catch (e) {
    if (!(e instanceof PackError)) throw e;
    universe = { ok: false, errors: e.issues.map(fmtIssue), warnings: [], countries: 0, leagues: 0, clubs: 0, players: 0 };
  }
  return { base: { name: base.manifest.name, version: base.manifest.version }, packs, universe, folder: packsDir(dataDir) };
}

/** Grava a ordem de carga (só ids de pacotes existentes e sem erro de estrutura, sem repetir). */
export function setLoadOrder(dataDir: string, enabled: string[]): PacksOverviewDto {
  const valid = new Set(scan(dataDir).filter((s) => s.pack).map((s) => s.pack!.manifest.id));
  const clean = [...new Set(enabled)].filter((id) => valid.has(id));
  fs.mkdirSync(packsDir(dataDir), { recursive: true });
  fs.writeFileSync(orderFile(dataDir), `${JSON.stringify({ enabled: clean }, null, 2)}\n`);
  invalidateImages();
  return listPacks(dataDir);
}

/**
 * Importa um pacote .zip: aceita os arquivos na raiz ou dentro de uma única pasta. Valida a estrutura antes de gravar; com o mesmo id já
 * instalado, devolve `exists` (a tela pergunta) a menos que `overwrite`. Grava em `packs/<id>/`.
 */
export function importPackZip(dataDir: string, zip: Buffer, overwrite: boolean): { status: 'imported' | 'exists'; id: string; name: string } {
  let entries: Map<string, Buffer>;
  try { entries = readZip(zip); } catch (e) { if (e instanceof ZipError) throw new ValidationError(e.message); throw e; }
  const manifestPath = [...entries.keys()].filter((n) => n === 'manifest.json' || /^[^/]+\/manifest\.json$/.test(n)).sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new ValidationError('O .zip não tem manifest.json (na raiz ou em uma pasta).');
  const prefix = manifestPath.slice(0, -'manifest.json'.length);
  const parse = (name: string): unknown => {
    const b = entries.get(prefix + name);
    if (!b) return undefined;
    try { return JSON.parse(b.toString('utf8').replace(/^﻿/, '')); } catch (e) { throw new ValidationError(`${name}: JSON inválido (${(e as Error).message}).`); }
  };
  const files: Partial<Record<PackFile, unknown>> = {};
  for (const f of PACK_FILES) { const v = parse(`${f}.json`); if (v !== undefined) files[f] = v; }
  let pack: Pack;
  try { pack = parsePack({ manifest: parse('manifest.json'), files }, 'pacote importado'); } catch (e) {
    if (e instanceof PackError) throw new ValidationError(`O pacote tem erros: ${e.issues.slice(0, 3).map(fmtIssue).join(' | ')}${e.issues.length > 3 ? ` (e mais ${e.issues.length - 3})` : ''}`);
    throw e;
  }
  const id = pack.manifest.id;
  if (!ID_PATTERN.test(id)) throw new ValidationError('Id do pacote inválido.');
  if (id === basePack().manifest.id) throw new ValidationError('Este id é reservado para a base do jogo.');
  const dir = path.join(packsDir(dataDir), id);
  if (fs.existsSync(dir) && !overwrite) return { status: 'exists', id, name: pack.manifest.name };
  // imagens: só images/<players|clubs|stadiums|leagues|coaches>/<id>.<png|jpg>, validadas pelo conteúdo (antes de gravar qualquer coisa)
  const images: Array<[string, Buffer]> = [];
  for (const [name, bytes] of entries) {
    if (!name.startsWith(`${prefix}images/`)) continue;
    const rel = name.slice(prefix.length), m = IMAGE_PATH.exec(rel);
    if (!m) throw new ValidationError(`Imagem com nome inválido no pacote: ${rel} (use images/players|clubs|stadiums|leagues|coaches/<id>.png ou .jpg).`);
    validateImage(bytes, rel);
    images.push([`images/${m[1]}/${m[2]}.${m[3] === 'jpeg' ? 'jpg' : m[3]}`, bytes]);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  writePackDir(pack, dir);
  for (const [rel, bytes] of images) { const f = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); }
  invalidateImages();
  return { status: 'imported', id, name: pack.manifest.name };
}

/** Remove um pacote do disco (e da ordem de carga). */
export function removePack(dataDir: string, id: string): PacksOverviewDto {
  const s = scan(dataDir).find((x) => (x.pack?.manifest.id ?? x.folder) === id);
  if (!s) throw new ValidationError('Pacote não encontrado.');
  fs.rmSync(s.dir, { recursive: true, force: true });
  invalidateImages();
  return setLoadOrder(dataDir, readOrder(dataDir).filter((x) => x !== id));
}

/** Pacote instalado em .zip (para compartilhar): manifesto e arquivos de dados. */
export function exportPackZip(dataDir: string, id: string): Buffer {
  const s = scan(dataDir).find((x) => x.pack?.manifest.id === id);
  if (!s) throw new ValidationError('Pacote não encontrado.');
  const names = ['manifest.json', ...PACK_FILES.map((f) => `${f}.json`)].filter((n) => fs.existsSync(path.join(s.dir, n)));
  return writeZip([...names.map((n): [string, Buffer] => [n, fs.readFileSync(path.join(s.dir, n))]), ...listPackImages(s.dir).map((im): [string, Buffer] => [im.rel, fs.readFileSync(im.file)])]);
}

/** Índice de imagens dos pacotes ATIVOS (o último da ordem vence): "tipo/id" → arquivo. Cache pela versão. */
let imgCache: { version: number; dir: string; map: Map<string, string> } | null = null;
export function imageIndex(dataDir: string): Map<string, string> {
  if (imgCache && imgCache.version === imagesVersion() && imgCache.dir === dataDir) return imgCache.map;
  const scanned = scan(dataDir), order = readOrder(dataDir);
  const map = new Map<string, string>();
  for (const id of order) {
    const s = scanned.find((x) => x.pack?.manifest.id === id);
    if (s) for (const im of listPackImages(s.dir)) map.set(`${im.kind}/${im.id}`, im.file);
  }
  imgCache = { version: imagesVersion(), dir: dataDir, map };
  return map;
}
