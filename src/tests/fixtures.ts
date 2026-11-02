import { deflateSync } from 'node:zlib';
import { crc32 } from '../shared/photo.ts';

export function makePng(w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const raw = new Uint8Array((w * 3 + 1) * h);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** JPEG estruturalmente válido (não decodificável): testa apenas o validador de estrutura. */
export function makeJpeg(w: number, h: number, withEnd = true): Uint8Array {
  const b: number[] = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  b.push(0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  b.push(0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0, 1, 2, 3, 4, 5, 6, 7, 8);
  if (withEnd) b.push(0xff, 0xd9);
  return new Uint8Array(b);
}

// ---------- fixtures do motor de partidas ----------
import { generateWorld } from '../game/world/generator.ts';
import { buildSheet, toMatchPlayer } from '../game/match-engine/team-builder.ts';
import type { TeamSheet, TeamTactics } from '../game/match-engine/types.ts';

export const BALANCED: TeamTactics = { mentality: 'balanced', tempo: 3, width: 3, defensiveLine: 3, pressing: 3, buildUp: 'mixed' };
let cached: ReturnType<typeof generateWorld> | null = null;
export const calibWorld = () => (cached ??= generateWorld({ seed: 'calib' }));

export function sheetOf(clubId: string, tactics: TeamTactics = BALANCED, formationId?: string): TeamSheet {
  const w = calibWorld();
  const club = w.clubs.find((c) => c.id === clubId)!;
  const squad = w.players.filter((p) => p.clubId === clubId).map(toMatchPlayer);
  return buildSheet({ clubId, name: club.name, squad, tactics, formationId });
}

/** Clubes de nível médio e parecido da 1ª liga do universo de calibração. */
export function midClubs(): string[] {
  const w = calibWorld();
  const lg = w.leagues[0]!;
  return w.clubs.filter((c) => c.leagueId === lg.id).sort((a, b) => a.reputation - b.reputation).slice(6, 14).map((c) => c.id);
}
