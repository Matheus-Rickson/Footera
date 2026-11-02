/** Validação estrutural de imagens PNG/JPEG. Pura (Uint8Array), sem dependências de Node. */

export type ImageFormat = 'png' | 'jpeg';
export interface ImageInfo { format: ImageFormat; width: number; height: number; bytes: number }
export class ImageError extends Error {}

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MIN_PHOTO_DIM = 64;
export const MAX_PHOTO_DIM = 4096;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(d: Uint8Array, start = 0, end = d.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ d[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (d: Uint8Array, o: number) => (((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0);
const u16 = (d: Uint8Array, o: number) => (d[o]! << 8) | d[o + 1]!;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function inspectPng(d: Uint8Array): { width: number; height: number } {
  let off = 8, width = 0, height = 0, sawIhdr = false, sawIdat = false, sawIend = false;
  while (off < d.length && !sawIend) {
    if (off + 12 > d.length) throw new ImageError('PNG truncado.');
    const len = u32(d, off);
    const typeStart = off + 4, dataStart = off + 8, dataEnd = dataStart + len;
    if (dataEnd + 4 > d.length) throw new ImageError('PNG truncado.');
    const type = String.fromCharCode(d[typeStart]!, d[typeStart + 1]!, d[typeStart + 2]!, d[typeStart + 3]!);
    if (crc32(d, typeStart, dataEnd) !== u32(d, dataEnd)) throw new ImageError(`PNG corrompido (CRC inválido no bloco ${type}).`);
    if (!sawIhdr) {
      if (type !== 'IHDR' || len !== 13) throw new ImageError('PNG inválido (cabeçalho ausente).');
      width = u32(d, dataStart); height = u32(d, dataStart + 4); sawIhdr = true;
    } else if (type === 'IDAT') sawIdat = true;
    else if (type === 'IEND') sawIend = true;
    off = dataEnd + 4;
  }
  if (!sawIend) throw new ImageError('PNG truncado (sem bloco final).');
  if (!sawIdat) throw new ImageError('PNG sem dados de imagem.');
  if (off !== d.length) throw new ImageError('PNG com dados extras após o fim do arquivo.');
  return { width, height };
}

function inspectJpeg(d: Uint8Array): { width: number; height: number } {
  let off = 2, width = 0, height = 0, sawSof = false;
  for (;;) {
    if (off + 2 > d.length) throw new ImageError('JPEG truncado.');
    if (d[off] !== 0xff) throw new ImageError('JPEG inválido (marcador esperado).');
    while (off + 1 < d.length && d[off + 1] === 0xff) off++;
    if (off + 1 >= d.length) throw new ImageError('JPEG truncado.');
    const m = d[off + 1]!;
    off += 2;
    if (m === 0xd9) throw new ImageError('JPEG sem dados de imagem.');
    if (m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (off + 2 > d.length) throw new ImageError('JPEG truncado.');
    const len = u16(d, off);
    if (len < 2 || off + len > d.length) throw new ImageError('JPEG truncado ou corrompido.');
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 8) throw new ImageError('JPEG corrompido (cabeçalho de imagem curto).');
      height = u16(d, off + 3); width = u16(d, off + 5); sawSof = true;
    }
    if (m === 0xda) {
      if (!sawSof) throw new ImageError('JPEG inválido (dados antes do cabeçalho de imagem).');
      let end = d.length;
      while (end > 0 && d[end - 1] === 0) end--;
      if (end < 2 || d[end - 2] !== 0xff || d[end - 1] !== 0xd9) throw new ImageError('JPEG truncado (sem marcador de fim).');
      return { width, height };
    }
    off += len;
  }
}

export function inspectImage(d: Uint8Array): ImageInfo {
  if (d.length === 0) throw new ImageError('O arquivo está vazio.');
  if (d.length > MAX_PHOTO_BYTES) throw new ImageError(`A imagem excede o limite de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
  let format: ImageFormat;
  let dims: { width: number; height: number };
  if (d.length >= 8 && PNG_SIG.every((b, i) => d[i] === b)) { format = 'png'; dims = inspectPng(d); }
  else if (d.length >= 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) { format = 'jpeg'; dims = inspectJpeg(d); }
  else throw new ImageError('Formato não suportado. Use PNG ou JPEG/JPG.');
  if (dims.width < MIN_PHOTO_DIM || dims.height < MIN_PHOTO_DIM) throw new ImageError(`Imagem muito pequena (mínimo ${MIN_PHOTO_DIM}×${MIN_PHOTO_DIM}).`);
  if (dims.width > MAX_PHOTO_DIM || dims.height > MAX_PHOTO_DIM) throw new ImageError(`Imagem muito grande (máximo ${MAX_PHOTO_DIM}×${MAX_PHOTO_DIM}).`);
  return { format, width: dims.width, height: dims.height, bytes: d.length };
}
