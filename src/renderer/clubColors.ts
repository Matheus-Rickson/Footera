/**
 * Cores do clube na interface (docs/INTERFACE.md): pedidas ao processo principal (tiradas do escudo) uma vez por clube e
 * guardadas para todas as telas. Sem escudo, as matizes do escudo gerado (`clubHues`), as mesmas que o jogador vê no escudo.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { paletteFromHues, type ClubPalette } from '../shared/crestColor.ts';
import { clubHues } from './flags.tsx';

const cache = new Map<string, ClubPalette>();
const waiting = new Map<string, Promise<void>>();
let cacheVersion = -1;

const fallback = (id: string) => { const { hue, hue2 } = clubHues(id); return paletteFromHues(hue, hue2); };

/** Busca as cores de vários clubes de uma vez (uma chamada IPC para a lista). */
async function load(ids: string[]): Promise<void> {
  const v = await window.api.imageVersion();
  if (v.ok && v.data !== cacheVersion) { cache.clear(); cacheVersion = v.data; } // escudo novo no editor ou outro pacote: recalcula
  const missing = ids.filter((id) => !cache.has(id) && !waiting.has(id));
  if (missing.length) {
    const p = window.api.clubColors(missing.slice(0, 64)).then((r) => {
      for (const id of missing) cache.set(id, (r.ok ? r.data[id] : null) ?? fallback(id));
    }).finally(() => { for (const id of missing) waiting.delete(id); });
    for (const id of missing) waiting.set(id, p);
  }
  await Promise.all(ids.map((id) => waiting.get(id)).filter(Boolean));
}

/** Paleta de um clube (null = sem clube). Mostra o substituto do escudo gerado enquanto a cor do escudo não chega. */
export function useClubPalette(clubId: string | null | undefined): ClubPalette | null {
  const [pal, setPal] = useState<ClubPalette | null>(() => (clubId ? cache.get(clubId) ?? fallback(clubId) : null));
  useEffect(() => {
    if (!clubId) { setPal(null); return; }
    let stale = false;
    setPal(cache.get(clubId) ?? fallback(clubId));
    void load([clubId]).then(() => { if (!stale) setPal(cache.get(clubId) ?? fallback(clubId)); });
    return () => { stale = true; };
  }, [clubId]);
  return pal;
}

/** Variáveis CSS da paleta (`--club`, `--club-2`, `--club-text`, `--club-ink` e as do tema claro). Sem paleta, os padrões do tema. */
export function clubVars(p: ClubPalette | null): CSSProperties {
  if (!p) return {};
  return {
    ['--club-d' as string]: p.primary, ['--club-2-d' as string]: p.secondary, ['--club-text-d' as string]: p.text, ['--club-ink-d' as string]: p.ink,
    ['--club-l' as string]: p.light.primary, ['--club-text-l' as string]: p.light.text, ['--club-ink-l' as string]: p.light.ink,
  };
}
