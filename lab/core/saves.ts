/**
 * Saves do usuário vistos pelo Laboratório: SÓ LEITURA do disco original. Para listar, lê apenas profiles.json e os metadados
 * dos arquivos (nunca abre o career.db original: abrir um banco pode rodar migrações). Para usar um save, copia o career.db
 * (e o -wal) para uma pasta temporária e trabalha na cópia, que é apagada no fim.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ParamError } from './types.ts';

export function savesRoot(): string {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'football-manager-simulator', 'data');
}

export interface SaveRef { file: string; profileId: string; careerId: string; profileName: string; modified: string; mb: number }

export function listSaves(root = savesRoot()): SaveRef[] {
  const savesDir = path.join(root, 'saves');
  if (!fs.existsSync(savesDir)) return [];
  let names = new Map<string, string>();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'profiles.json'), 'utf8')) as { profiles?: Array<{ id: string; name: string }> };
    names = new Map((j.profiles ?? []).map((p) => [p.id, p.name]));
  } catch { /* sem nomes de perfil: mostra o id */ }
  const out: SaveRef[] = [];
  for (const profileId of fs.readdirSync(savesDir)) {
    const pdir = path.join(savesDir, profileId);
    if (!fs.statSync(pdir).isDirectory()) continue;
    for (const careerId of fs.readdirSync(pdir)) {
      if (careerId.startsWith('.')) continue; // pastas temporárias do jogo
      const file = path.join(pdir, careerId, 'career.db');
      if (!fs.existsSync(file)) continue;
      const st = fs.statSync(file);
      out.push({ file, profileId, careerId, profileName: names.get(profileId) ?? profileId.slice(0, 8), modified: st.mtime.toISOString(), mb: st.size / 1048576 });
    }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

export const saveOptions = (): Array<{ value: string; label: string }> =>
  listSaves().map((s) => ({ value: s.file, label: `${s.profileName} · carreira ${s.careerId.slice(0, 8)} · salvo em ${s.modified.slice(0, 16).replace('T', ' ')} · ${s.mb.toFixed(0)} MB` }));

export interface SaveCopy { base: string; profile: string; career: string; file: string; dispose: () => void }

const PROFILE = '00000000-0000-4000-8000-0000000001ab';
const CAREER = '00000000-0000-4000-8000-0000000001ac';

/** copia o save para uma pasta temporária no formato que o saveService espera (<base>/saves/<perfil>/<carreira>/career.db) */
export function copySave(source: string): SaveCopy {
  if (!source) throw new ParamError('Escolha um save (ou informe o caminho de um career.db).');
  if (!fs.existsSync(source) || path.basename(source) !== 'career.db') throw new ParamError(`Save não encontrado: ${source}`);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'footera-lab-'));
  const dir = path.join(base, 'saves', PROFILE, CAREER);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'career.db');
  fs.copyFileSync(source, file);
  if (fs.existsSync(`${source}-wal`)) fs.copyFileSync(`${source}-wal`, `${file}-wal`);
  return { base, profile: PROFILE, career: CAREER, file, dispose: () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* arquivo preso: o sistema limpa a pasta temporária */ } } };
}
