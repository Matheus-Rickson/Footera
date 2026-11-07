/**
 * Imagens dos pacotes de dados (etapa 3 da base editável): `images/players/<id>`, `images/clubs/<id>` (escudo) e
 * `images/stadiums/<id>`, `images/leagues/<id>` (logo da liga), `images/coaches/<id>` (foto do técnico), `images/cups/<id>` (logo da copa ou supercopa), em PNG ou JPEG (validados pelo conteúdo, até 5 MB, de 64 a 4096 px). O jogo só serve imagens deste
 * índice (nenhum caminho vem da tela), então um pacote não consegue fazer o jogo ler outros arquivos do computador.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ImageError, inspectImage } from '../shared/photo.ts';
import { ID_PATTERN } from '../shared/slug.ts';
import { ValidationError } from './careerService.ts';

export type ImageKind = 'players' | 'clubs' | 'stadiums' | 'leagues' | 'coaches' | 'cups';
export const IMAGE_KINDS: readonly ImageKind[] = ['players', 'clubs', 'stadiums', 'leagues', 'coaches', 'cups'];
const EXTS = ['png', 'jpg'] as const;
/** caminho de imagem dentro de um pacote/zip: images/<tipo>/<id>.<png|jpg|jpeg> */
export const IMAGE_PATH = /^images\/(players|clubs|stadiums|leagues|coaches|cups)\/([a-z0-9][a-z0-9_-]{0,59})\.(png|jpg|jpeg)$/;

export function validateImage(bytes: Uint8Array, label: string): 'png' | 'jpg' {
  try { return inspectImage(bytes).format === 'png' ? 'png' : 'jpg'; } catch (e) {
    if (e instanceof ImageError) throw new ValidationError(`${label}: ${e.message}`);
    throw e;
  }
}

/** arquivo de imagem de uma entidade num pacote (ou null) */
export function packImageFile(packDir: string, kind: ImageKind, id: string): string | null {
  for (const ext of EXTS) { const f = path.join(packDir, 'images', kind, `${id}.${ext}`); if (fs.existsSync(f)) return f; }
  return null;
}

/** grava (ou troca) a imagem de uma entidade no pacote; valida o conteúdo antes */
export function setPackImage(packDir: string, kind: ImageKind, id: string, bytes: Uint8Array): void {
  if (!IMAGE_KINDS.includes(kind) || !ID_PATTERN.test(id)) throw new ValidationError('Imagem inválida.');
  const ext = validateImage(bytes, 'Imagem');
  const dir = path.join(packDir, 'images', kind);
  fs.mkdirSync(dir, { recursive: true });
  for (const e of EXTS) fs.rmSync(path.join(dir, `${id}.${e}`), { force: true });
  fs.writeFileSync(path.join(dir, `${id}.${ext}`), bytes);
  invalidateImages();
}

export function removePackImage(packDir: string, kind: ImageKind, id: string): void {
  for (const e of EXTS) fs.rmSync(path.join(packDir, 'images', kind, `${id}.${e}`), { force: true });
  invalidateImages();
}

/** imagens de um pacote: [caminho relativo "images/<tipo>/<arquivo>", caminho absoluto] */
export function listPackImages(packDir: string): Array<{ kind: ImageKind; id: string; rel: string; file: string }> {
  const out: Array<{ kind: ImageKind; id: string; rel: string; file: string }> = [];
  for (const kind of IMAGE_KINDS) {
    const dir = path.join(packDir, 'images', kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const rel = `images/${kind}/${f}`, m = IMAGE_PATH.exec(rel);
      if (m) out.push({ kind, id: m[2]!, rel, file: path.join(dir, f) });
    }
  }
  return out;
}

/** versão do índice: muda sempre que uma imagem ou a ordem de pacotes muda (a tela usa para renovar o cache do navegador) */
let version = 1;
export function invalidateImages(): void { version++; }
export function imagesVersion(): number { return version; }
