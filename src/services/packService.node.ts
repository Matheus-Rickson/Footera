/**
 * Pacotes de dados em disco: uma pasta com manifest.json e os arquivos de dados (countries.json, leagues.json, …).
 * Leitura com limite de tamanho e erros que dizem o arquivo; gravação legível (JSON indentado) para edição em editores de texto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PACK_FILES, PackError, parsePack, type Pack, type PackFile, type PackIssue } from '../game/data-pack/format.ts';

/** limite por arquivo (um universo completo com milhares de jogadores fica bem abaixo disso) */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function readJson(file: string, pack: string, issues: PackIssue[]): unknown {
  const name = path.basename(file);
  const size = fs.statSync(file).size;
  if (size > MAX_FILE_BYTES) { issues.push({ pack, file: name, message: `arquivo grande demais (${Math.round(size / 1048576)} MB; limite ${MAX_FILE_BYTES / 1048576} MB)` }); return undefined; }
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); // aceita UTF-8 com BOM (Bloco de Notas, Excel)
  try { return JSON.parse(text); } catch (e) {
    issues.push({ pack, file: name, message: `JSON inválido: ${(e as Error).message}` });
    return undefined;
  }
}

/** Lê e valida a estrutura de um pacote numa pasta. Lança `PackError` com todos os problemas encontrados. */
export function readPackDir(dir: string): Pack {
  const source = path.basename(path.resolve(dir));
  const issues: PackIssue[] = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new PackError([{ pack: source, file: dir, message: 'pasta do pacote não encontrada' }]);
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new PackError([{ pack: source, file: 'manifest.json', message: 'o pacote precisa de um manifest.json' }]);
  const manifest = readJson(manifestFile, source, issues);
  const files: Partial<Record<PackFile, unknown>> = {};
  for (const f of PACK_FILES) {
    const file = path.join(dir, `${f}.json`);
    if (fs.existsSync(file)) files[f] = readJson(file, source, issues);
  }
  const known = new Set(['manifest.json', ...PACK_FILES.map((f) => `${f}.json`)]);
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.json') && !known.has(entry)) issues.push({ pack: source, file: entry, message: `arquivo não reconhecido (esperados: ${[...known].join(', ')})` });
  }
  if (issues.length) throw new PackError(issues);
  return parsePack({ manifest, files }, source);
}

/** Grava um pacote numa pasta (cria a pasta; sobrescreve os arquivos do pacote). Lista vazia = o arquivo é apagado (não fica um antigo). */
export function writePackDir(pack: Pack, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(pack.manifest, null, 2)}\n`);
  for (const f of PACK_FILES) {
    const rows = pack.data[f];
    const file = path.join(dir, `${f}.json`);
    if (!rows.length) { fs.rmSync(file, { force: true }); continue; }
    // um registro por linha: arquivos grandes continuam navegáveis e o diff entre versões de um patch fica limpo
    fs.writeFileSync(file, `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]\n`);
  }
}
