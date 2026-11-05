/**
 * Atributos do treinador (escala 1–20, a mesma dos jogadores). Na criação, todos partem de COACH_ATTR_BASE e o usuário distribui
 * COACH_ATTR_POINTS pontos (no máximo COACH_ATTR_MAX_START em cada um). Gravados com o treinador no save. Efeitos no jogo e evolução
 * (pontos ganhos a cada temporada): `game/coach-engine/coach.ts`.
 */
export interface CoachAttributes { tactics: number; motivation: number; youth: number; discipline: number; negotiation: number; adaptability: number }
export type CoachAttrKey = keyof CoachAttributes;

export const COACH_ATTR_BASE = 5;
export const COACH_ATTR_POINTS = 12;
export const COACH_ATTR_MAX_START = 15;

export const COACH_ATTRS: Array<{ key: CoachAttrKey; label: string; description: string }> = [
  { key: 'tactics', label: 'Conhecimento tático', description: 'Leitura de jogo e preparação das partidas.' },
  { key: 'motivation', label: 'Motivação', description: 'Conversas no vestiário e moral do grupo.' },
  { key: 'youth', label: 'Desenvolvimento de jovens', description: 'Evolução de atletas jovens e aproveitamento da base.' },
  { key: 'discipline', label: 'Disciplina', description: 'Organização, comportamento e profissionalismo do elenco.' },
  { key: 'negotiation', label: 'Negociação', description: 'Contratações, vendas e renovações de contrato.' },
  { key: 'adaptability', label: 'Adaptabilidade', description: 'Mudanças táticas durante o jogo e adaptação a novos clubes.' },
];

export const baseCoachAttributes = (): CoachAttributes =>
  Object.fromEntries(COACH_ATTRS.map((a) => [a.key, COACH_ATTR_BASE])) as unknown as CoachAttributes;
export const spentPoints = (a: CoachAttributes): number => COACH_ATTRS.reduce((s, x) => s + a[x.key] - COACH_ATTR_BASE, 0);

/** Problema na distribuição inicial (null = válida): todos os pontos usados, cada atributo entre a base e o máximo de criação. */
export function startingAttributesError(a: CoachAttributes): string | null {
  for (const x of COACH_ATTRS) {
    const v = a[x.key];
    if (!Number.isInteger(v) || v < COACH_ATTR_BASE || v > COACH_ATTR_MAX_START) return `${x.label}: use de ${COACH_ATTR_BASE} a ${COACH_ATTR_MAX_START}.`;
  }
  const spent = spentPoints(a);
  if (spent !== COACH_ATTR_POINTS) return `Distribua exatamente ${COACH_ATTR_POINTS} pontos entre os atributos (usados: ${spent}).`;
  return null;
}
