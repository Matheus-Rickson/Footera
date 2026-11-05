/**
 * Imagens dos pacotes de dados na tela: quais existem (índice vindo do processo principal) e o endereço para exibir.
 * Sem imagem, cada tela usa o seu substituto (escudo gerado, ilustração do estádio, iniciais do jogador).
 */
import { useCallback, useEffect, useState } from 'react';

export type ImageKind = 'players' | 'clubs' | 'stadiums' | 'leagues';
export interface ImageKeys { version: number; keys: string[] }

/** `packId`: imagens só daquele pacote (editor, mesmo inativo); sem ele, as dos pacotes ativos (o resto do jogo). */
export function useImages(packId?: string) {
  const [st, setSt] = useState<{ version: number; keys: Set<string> }>({ version: 0, keys: new Set() });
  const apply = useCallback((k: ImageKeys) => setSt({ version: k.version, keys: new Set(k.keys) }), []);
  const refresh = useCallback(async () => {
    const r = packId ? await window.api.editorImageKeys(packId) : await window.api.imageKeys();
    if (r.ok) apply(r.data);
  }, [packId, apply]);
  useEffect(() => { void refresh(); }, [refresh]);
  const has = (kind: ImageKind, id: string | null | undefined) => !!id && st.keys.has(`${kind}/${id}`);
  const url = (kind: ImageKind, id: string | null | undefined) => (has(kind, id) ? `footera-img://img/${kind}/${id}?v=${st.version}${packId ? `&pack=${packId}` : ''}` : null);
  return { has, url, refresh, apply };
}
