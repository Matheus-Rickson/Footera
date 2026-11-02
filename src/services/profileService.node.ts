import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ValidationError } from './careerService.ts';
import type { ProfileDto } from '../shared/api.ts';

export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME_RE = /^[\p{L}\p{N} _.-]+$/u;

interface ProfilesFile { version: 1; profiles: ProfileDto[] }

const profilesPath = (base: string) => path.join(base, 'profiles.json');

export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function listProfiles(base: string): ProfileDto[] {
  const file = profilesPath(base);
  if (!fs.existsSync(file)) return [];
  let parsed: ProfilesFile;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ProfilesFile; }
  catch { throw new Error(`O arquivo de perfis está ilegível: ${file}. Nenhum dado foi alterado.`); }
  if (!Array.isArray(parsed.profiles)) throw new Error(`O arquivo de perfis tem formato inesperado: ${file}.`);
  return parsed.profiles;
}

export function createProfile(base: string, rawName: string): ProfileDto {
  const name = rawName.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 40) throw new ValidationError('O nome do perfil deve ter de 1 a 40 caracteres.');
  if (!NAME_RE.test(name)) throw new ValidationError('Use apenas letras, números, espaços, ponto, hífen e sublinhado no nome do perfil.');
  const profiles = listProfiles(base);
  if (profiles.some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new ValidationError('Já existe um perfil com esse nome.');
  }
  const profile: ProfileDto = { id: randomUUID(), name, createdAt: new Date().toISOString() };
  writeJsonAtomic(profilesPath(base), { version: 1, profiles: [...profiles, profile] } satisfies ProfilesFile);
  fs.mkdirSync(path.join(base, 'saves', profile.id), { recursive: true });
  return profile;
}
