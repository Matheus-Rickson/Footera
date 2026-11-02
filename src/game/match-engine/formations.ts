import type { Position } from '../../shared/types.ts';

export interface FormationSlot { pos: Position; x: number; y: number }
export interface Formation { id: string; slots: FormationSlot[] }

const S = (pos: Position, x: number, y: number): FormationSlot => ({ pos, x, y });
const GK = S('GK', 50, 5);

/** x: 0 = esquerda, 100 = direita; y: 0 = próprio gol, 100 = gol adversário. */
export const FORMATIONS: Formation[] = [
  { id: '4-4-2', slots: [GK, S('LB', 12, 24), S('CB', 36, 20), S('CB', 64, 20), S('RB', 88, 24),
    S('LW', 12, 52), S('CM', 38, 48), S('CM', 62, 48), S('RW', 88, 52), S('ST', 38, 82), S('ST', 62, 82)] },
  { id: '4-3-3', slots: [GK, S('LB', 12, 24), S('CB', 36, 20), S('CB', 64, 20), S('RB', 88, 24),
    S('DM', 50, 38), S('CM', 32, 52), S('CM', 68, 52), S('LW', 14, 76), S('ST', 50, 86), S('RW', 86, 76)] },
  { id: '4-2-3-1', slots: [GK, S('LB', 12, 24), S('CB', 36, 20), S('CB', 64, 20), S('RB', 88, 24),
    S('DM', 38, 40), S('DM', 62, 40), S('LW', 14, 66), S('AM', 50, 66), S('RW', 86, 66), S('ST', 50, 86)] },
  { id: '3-5-2', slots: [GK, S('CB', 26, 20), S('CB', 50, 18), S('CB', 74, 20),
    S('LB', 8, 50), S('DM', 50, 38), S('CM', 32, 52), S('CM', 68, 52), S('RB', 92, 50), S('ST', 38, 82), S('ST', 62, 82)] },
  { id: '3-4-3', slots: [GK, S('CB', 26, 20), S('CB', 50, 18), S('CB', 74, 20),
    S('LB', 8, 50), S('CM', 38, 48), S('CM', 62, 48), S('RB', 92, 50), S('LW', 18, 78), S('ST', 50, 86), S('RW', 82, 78)] },
  { id: '5-3-2', slots: [GK, S('LB', 8, 30), S('CB', 28, 20), S('CB', 50, 18), S('CB', 72, 20), S('RB', 92, 30),
    S('DM', 50, 38), S('CM', 32, 52), S('CM', 68, 52), S('ST', 38, 82), S('ST', 62, 82)] },
  { id: '4-1-4-1', slots: [GK, S('LB', 12, 24), S('CB', 36, 20), S('CB', 64, 20), S('RB', 88, 24),
    S('DM', 50, 36), S('LW', 12, 56), S('CM', 38, 52), S('CM', 62, 52), S('RW', 88, 56), S('ST', 50, 84)] },
];

export function getFormation(id: string): Formation {
  const f = FORMATIONS.find((x) => x.id === id);
  if (!f) throw new Error(`Formação desconhecida: ${id}`);
  return f;
}
