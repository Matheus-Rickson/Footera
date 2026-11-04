import type { Attributes, Position } from '../../shared/types.ts';

type Weights = Partial<Record<string, number>>;

/** Pesos por posição. Chaves usam o nome do atributo (únicos entre grupos). */
const WEIGHTS: Record<Position, Weights> = {
  GK: { goalkeeping: 6, positioning: 2, composure: 1, agility: 1.5, jumping: 1, decisions: 1 },
  CB: { marking: 3, tackling: 3, heading: 2, positioning: 2, strength: 2, jumping: 1.5, pace: 1, composure: 1 },
  LB: { tackling: 2, marking: 1.5, pace: 2.5, stamina: 2, crossing: 1.5, positioning: 1.5, workRate: 1 },
  RB: { tackling: 2, marking: 1.5, pace: 2.5, stamina: 2, crossing: 1.5, positioning: 1.5, workRate: 1 },
  // ala: corredor inteiro — muita resistência, velocidade, cruzamento e marcação (AE) / posicionamento e defesa (AD)
  LWB: { stamina: 3, pace: 2.5, crossing: 2.5, marking: 2, tackling: 1.5, workRate: 1.5 },
  RWB: { stamina: 3, pace: 2.5, crossing: 2.5, positioning: 2, tackling: 2, workRate: 1 },
  DM: { tackling: 3, marking: 2, positioning: 2, passing: 2, stamina: 2, workRate: 1.5, decisions: 1.5 },
  CM: { passing: 3, vision: 2, stamina: 2, decisions: 2, tackling: 1.5, firstTouch: 1.5, workRate: 1.5 },
  // meia aberto: ME = visão, passe, cruzamento, controle e resistência; MD = velocidade, passe, cruzamento, drible e recomposição
  LM: { passing: 2.5, vision: 2, crossing: 2.5, firstTouch: 2, stamina: 2, workRate: 1 },
  RM: { pace: 2, passing: 2.5, crossing: 2.5, dribbling: 2, workRate: 1.5, stamina: 1 },
  AM: { passing: 2.5, vision: 3, dribbling: 2.5, firstTouch: 2, longShots: 1.5, decisions: 1.5, finishing: 1 },
  LW: { dribbling: 3, pace: 3, crossing: 2, firstTouch: 1.5, finishing: 1.5, agility: 1.5 },
  RW: { dribbling: 3, pace: 3, crossing: 2, firstTouch: 1.5, finishing: 1.5, agility: 1.5 },
  // segundo atacante: perto do centroavante, combina, finaliza e recua para construir
  SS: { finishing: 2.5, firstTouch: 2, passing: 2, dribbling: 2, vision: 1.5, composure: 1.5, pace: 1.5 },
  // centroavante: referência na área
  CF: { finishing: 4, composure: 2, positioning: 2.5, heading: 2, strength: 1.5, firstTouch: 1.5 },
  ST: { finishing: 4, composure: 2, firstTouch: 2, pace: 2, heading: 1.5, positioning: 2, strength: 1 },
};

export function flattenAttributes(a: Attributes): Record<string, number> {
  return { ...a.technical, ...a.mental, ...a.physical };
}

export function positionWeights(pos: Position): Weights { return WEIGHTS[pos]; }

/** Overall na escala 1..100 para a posição indicada. */
export function overallFor(a: Attributes, pos: Position): number {
  const flat = flattenAttributes(a);
  const w = WEIGHTS[pos];
  let sum = 0, tot = 0;
  for (const [k, wt] of Object.entries(w)) {
    sum += (flat[k] ?? 1) * (wt ?? 0);
    tot += wt ?? 0;
  }
  return Math.round((sum / tot) * 5); // 1..20 -> 5..100
}
