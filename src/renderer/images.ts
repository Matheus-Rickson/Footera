/**
 * Imagens dos pacotes de dados na tela: quais existem (índice vindo do processo principal) e o endereço para exibir.
 * Sem imagem, cada tela usa o seu substituto (escudo gerado, ilustração do estádio, iniciais do jogador).
 */
import { useCallback, useEffect, useState } from 'react';

export type ImageKind = 'players' | 'clubs' | 'stadiums' | 'leagues' | 'coaches' | 'cups';
export interface ImageKeys { version: number; keys: string[] }
interface Index { version: number; keys: Set<string> }

const EMPTY: Index = { version: 0, keys: new Set() };

/**
 * Índice das imagens dos pacotes ATIVOS, compartilhado por todas as telas: pedido ao processo principal uma vez (são dezenas de
 * milhares de chaves) e renovado só quando alguém chama `refresh`/`apply` (troca de pacotes, imagem nova no editor).
 */
const shared: { index: Index | null; pending: Promise<void> | null; subs: Set<(i: Index) => void> } = { index: null, pending: null, subs: new Set() };
function publish(i: Index): void { shared.index = i; for (const s of shared.subs) s(i); }
function loadShared(force: boolean): Promise<void> {
  if (!force && shared.index) return Promise.resolve();
  if (!force && shared.pending) return shared.pending;
  const p = window.api.imageKeys().then((r) => { if (r.ok) publish({ version: r.data.version, keys: new Set(r.data.keys) }); }).finally(() => { if (shared.pending === p) shared.pending = null; });
  shared.pending = p;
  return p;
}

/** `packId`: imagens só daquele pacote (editor, mesmo inativo); sem ele, as dos pacotes ativos (o resto do jogo). */
export function useImages(packId?: string) {
  const [st, setSt] = useState<Index>(() => (packId ? EMPTY : shared.index ?? EMPTY));
  const apply = useCallback((k: ImageKeys) => {
    const i = { version: k.version, keys: new Set(k.keys) };
    if (packId) setSt(i); else publish(i);
  }, [packId]);
  const refresh = useCallback(async () => {
    if (!packId) { await loadShared(true); return; }
    const r = await window.api.editorImageKeys(packId);
    if (r.ok) setSt({ version: r.data.version, keys: new Set(r.data.keys) });
  }, [packId]);
  useEffect(() => {
    if (packId) { void refresh(); return; }
    shared.subs.add(setSt);
    if (!shared.index) void loadShared(false);
    else {
      setSt(shared.index);
      // pacotes ou imagens podem ter mudado em outra tela: confere só a versão e recarrega as chaves se ela mudou
      void window.api.imageVersion().then((r) => { if (r.ok && shared.index && r.data !== shared.index.version) void loadShared(true); });
    }
    return () => { shared.subs.delete(setSt); };
  }, [packId, refresh]);
  const has = (kind: ImageKind, id: string | null | undefined) => !!id && st.keys.has(`${kind}/${id}`);
  const url = (kind: ImageKind, id: string | null | undefined) => (has(kind, id) ? `footera-img://img/${kind}/${id}?v=${st.version}${packId ? `&pack=${packId}` : ''}` : null);
  return { has, url, refresh, apply };
}
