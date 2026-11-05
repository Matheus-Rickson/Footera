/**
 * Leitor mínimo de arquivos .zip (sem dependências): lê o diretório central e devolve o conteúdo dos arquivos em memória.
 * Suporta "stored" (0) e "deflate" (8), os métodos de qualquer compactador comum (Windows, 7-Zip, WinRAR em modo zip).
 * Segurança: limites de quantidade e tamanho (contra "zip bomb"), nomes com ".." ou caminho absoluto são recusados, e nada é
 * gravado aqui — quem chama decide o que extrair.
 */
import zlib from 'node:zlib';

export class ZipError extends Error {}
export interface ZipLimits { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number }
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 512, maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 };

/** Lê um .zip. Pastas são ignoradas; os nomes usam "/" como separador. */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Map<string, Buffer> {
  // fim do diretório central: assinatura 0x06054b50 nos últimos 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError('O arquivo não é um .zip válido.');
  const count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > limits.maxEntries) throw new ZipError(`O .zip tem arquivos demais (${count}; limite ${limits.maxEntries}).`);
  const out = new Map<string, Buffer>();
  let p = cdOffset, total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('Diretório do .zip corrompido.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // pasta
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) throw new ZipError(`Caminho inseguro no .zip: ${name}`);
    if (flags & 0x1) throw new ZipError(`Arquivo protegido por senha no .zip: ${name}`);
    if (size > limits.maxEntryBytes) throw new ZipError(`Arquivo grande demais no .zip: ${name}`);
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError('O conteúdo do .zip é grande demais.');
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError(`Entrada corrompida no .zip: ${name}`);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: limits.maxEntryBytes });
    else throw new ZipError(`Compressão não suportada no .zip (${name}): use "zip" padrão (deflate).`);
    if (data.length !== size) throw new ZipError(`Tamanho inconsistente no .zip: ${name}`);
    out.set(name, data);
  }
  return out;
}

/** Cria um .zip (para exportar pacotes e para os testes). Compacta com deflate. */
export function writeZip(files: Array<[string, Buffer]>): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
