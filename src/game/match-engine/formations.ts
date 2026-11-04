import type { Position } from '../../shared/types.ts';

/**
 * Âncoras do campo (a grade da tela de Táticas): goleiro + 5 linhas (defesa, alas/volantes, meio, meia-ofensiva) de 5 vagas
 * e 3 vagas de ataque. Cada âncora tem a função que o motor usa (pos) e um lugar no campo (x, y; só exibição).
 * x: 0 = esquerda, 100 = direita; y: 0 = próprio gol, 100 = gol adversário.
 */
export interface Anchor { id: string; pos: Position; x: number; y: number }
export const ANCHORS: Anchor[] = [
  { id: 'GK', pos: 'GK', x: 50, y: 5 },
  { id: 'D1', pos: 'LB', x: 12, y: 24 }, { id: 'D2', pos: 'CB', x: 32, y: 20 }, { id: 'D3', pos: 'CB', x: 50, y: 18 }, { id: 'D4', pos: 'CB', x: 68, y: 20 }, { id: 'D5', pos: 'RB', x: 88, y: 24 },
  { id: 'W1', pos: 'LWB', x: 8, y: 42 }, { id: 'W2', pos: 'DM', x: 32, y: 38 }, { id: 'W3', pos: 'DM', x: 50, y: 36 }, { id: 'W4', pos: 'DM', x: 68, y: 38 }, { id: 'W5', pos: 'RWB', x: 92, y: 42 },
  { id: 'M1', pos: 'LM', x: 10, y: 56 }, { id: 'M2', pos: 'CM', x: 32, y: 52 }, { id: 'M3', pos: 'CM', x: 50, y: 50 }, { id: 'M4', pos: 'CM', x: 68, y: 52 }, { id: 'M5', pos: 'RM', x: 90, y: 56 },
  { id: 'A1', pos: 'LW', x: 14, y: 72 }, { id: 'A2', pos: 'AM', x: 32, y: 68 }, { id: 'A3', pos: 'AM', x: 50, y: 66 }, { id: 'A4', pos: 'AM', x: 68, y: 68 }, { id: 'A5', pos: 'RW', x: 86, y: 72 },
  { id: 'S1', pos: 'SS', x: 32, y: 80 }, { id: 'S2', pos: 'CF', x: 50, y: 88 }, { id: 'S3', pos: 'SS', x: 68, y: 80 },
];
const ANCHOR = new Map(ANCHORS.map((a) => [a.id, a]));
/** linha de cada âncora (para o nome da formação): defesa inclui os alas */
const LINE: Record<string, number> = { D1: 0, D2: 0, D3: 0, D4: 0, D5: 0, W1: 0, W5: 0, W2: 1, W3: 1, W4: 1, M1: 2, M2: 2, M3: 2, M4: 2, M5: 2, A1: 3, A2: 3, A3: 3, A4: 3, A5: 3, S1: 4, S2: 4, S3: 4 };

export interface FormationSlot { pos: Position; x: number; y: number; anchor: string }
export interface Formation { id: string; slots: FormationSlot[] }

const F = (id: string, anchors: string[]): Formation => ({ id, slots: anchors.map((a) => { const x = ANCHOR.get(a)!; return { pos: x.pos, x: x.x, y: x.y, anchor: a }; }) });

/** Pré-definições (mesma ordem de vagas de sempre: escalações salvas continuam alinhadas). 4-4-2 e 4-1-4-1 usam meias abertos; 3-5-2 e 3-4-3, alas;
 * com dois atacantes, um centroavante (CA) e um segundo atacante (SA); com um, o centroavante. */
export const FORMATIONS: Formation[] = [
  F('4-4-2', ['GK', 'D1', 'D2', 'D4', 'D5', 'M1', 'M2', 'M4', 'M5', 'S1', 'S2']),
  F('4-3-3', ['GK', 'D1', 'D2', 'D4', 'D5', 'W3', 'M2', 'M4', 'A1', 'S2', 'A5']),
  F('4-2-3-1', ['GK', 'D1', 'D2', 'D4', 'D5', 'W2', 'W4', 'A1', 'A3', 'A5', 'S2']),
  F('3-5-2', ['GK', 'D2', 'D3', 'D4', 'W1', 'W3', 'M2', 'M4', 'W5', 'S1', 'S2']),
  F('3-4-3', ['GK', 'D2', 'D3', 'D4', 'W1', 'M2', 'M4', 'W5', 'A1', 'S2', 'A5']),
  F('5-3-2', ['GK', 'D1', 'D2', 'D3', 'D4', 'D5', 'W3', 'M2', 'M4', 'S1', 'S2']),
  F('4-1-4-1', ['GK', 'D1', 'D2', 'D4', 'D5', 'W3', 'M1', 'M2', 'M4', 'M5', 'S2']),
];

/** Formação livre montada pelo técnico: "@" + as 11 âncoras, na ordem das vagas da escalação. */
export const customFormationId = (anchors: readonly string[]): string => `@${anchors.join('.')}`;

/** Erro de formação inválida (âncora desconhecida, repetida, sem goleiro…). */
export class FormationError extends Error {}

export function getFormation(id: string): Formation {
  if (id.startsWith('@')) {
    const anchors = id.slice(1).split('.');
    if (anchors.length !== 11) throw new FormationError('A formação precisa de exatamente 11 posições.');
    if (new Set(anchors).size !== 11) throw new FormationError('A formação tem posição repetida.');
    if (anchors.some((a) => !ANCHOR.has(a))) throw new FormationError('A formação tem posição desconhecida.');
    if (anchors[0] !== 'GK') throw new FormationError('A primeira posição da formação deve ser a do goleiro.');
    return F(id, anchors);
  }
  const f = FORMATIONS.find((x) => x.id === id);
  if (!f) throw new FormationError(`Formação desconhecida: ${id}`);
  return f;
}

export function isFormationId(id: string): boolean {
  try { getFormation(id); return true; } catch { return false; }
}

/** Nome exibido: o da pré-definição quando as posições são as mesmas; senão, a contagem por linha (ex.: 4-1-2-2-1). */
export function formationLabel(id: string): string {
  if (!id.startsWith('@')) return id;
  let f: Formation;
  try { f = getFormation(id); } catch { return id; }
  const set = [...f.slots.map((s) => s.anchor)].sort().join();
  const preset = FORMATIONS.find((p) => [...p.slots.map((s) => s.anchor)].sort().join() === set);
  if (preset) return preset.id;
  const counts = [0, 0, 0, 0, 0];
  for (const s of f.slots) if (s.anchor !== 'GK') counts[LINE[s.anchor]!]!++;
  return counts.filter((c) => c > 0).join('-');
}
