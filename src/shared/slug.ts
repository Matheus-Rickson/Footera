/**
 * IDs fixos e legíveis da base de dados (país `bra`, liga `bra-1`, clube `sao-tome-ec`, jogador `joao-silva-1998`).
 * Pacotes de dados (patches) se referem às entidades por esses IDs, então eles não podem mudar entre versões.
 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,59}$/;

/** Texto → trecho de ID: minúsculas, sem acentos, só letras, números e hífen (no máximo 48 caracteres). */
export function slugify(text: string): string {
  const s = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  return s || 'x';
}

/** Gera IDs únicos a partir de um texto: o primeiro uso fica com o slug puro; os seguintes ganham -2, -3… */
export function uniqueIds(taken: Iterable<string> = []): (text: string) => string {
  const used = new Set(taken);
  return (text: string) => {
    const base = slugify(text);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
}
