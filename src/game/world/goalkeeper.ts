/**
 * Atributos específicos de goleiro (1–20). O atributo técnico "goalkeeping" (o que o motor usa como qualidade do goleiro) passa a ser
 * DERIVADO: média ponderada destes seis. Assim cada um deles mexe de verdade no rendimento do goleiro; as funções táticas de goleiro
 * também usam os específicos (Tradicional: reflexos/manejo; Líbero: saídas/1×1; Construtor: reposição).
 *
 * Dados antigos (base fixa, saves anteriores) não têm o grupo: ele é derivado do "goalkeeping" atual de forma que a média continue
 * IGUAL (a força do goleiro não muda); só um par de atributos com o mesmo peso varia ±1, para não ficarem todos idênticos.
 */
import type { Attributes, GoalkeeperAttributes } from '../../shared/types.ts';

export const GK_ATTRS: Array<{ key: keyof GoalkeeperAttributes; label: string; weight: number; description: string }> = [
  { key: 'reflexes', label: 'Reflexos', weight: 3, description: 'Defesas em chutes de perto e à queima-roupa.' },
  { key: 'oneOnOne', label: 'Um contra um', weight: 2, description: 'Frente a frente com o atacante.' },
  { key: 'handling', label: 'Manejo', weight: 2, description: 'Segurar a bola sem dar rebote.' },
  { key: 'aerial', label: 'Jogo aéreo', weight: 1.5, description: 'Cruzamentos e bolas altas na área.' },
  { key: 'rushingOut', label: 'Saídas do gol', weight: 1, description: 'Sair da área para cortar lançamentos.' },
  { key: 'kicking', label: 'Reposição', weight: 0.5, description: 'Chutes, tiros de meta e lançamentos com as mãos e os pés.' },
];
const TOTAL = GK_ATTRS.reduce((s, a) => s + a.weight, 0);
const clamp = (v: number) => Math.max(1, Math.min(20, Math.round(v)));

/** "Goleiro (geral)": média ponderada dos seis atributos de goleiro. */
export function gkComposite(g: GoalkeeperAttributes): number {
  return clamp(GK_ATTRS.reduce((s, a) => s + g[a.key] * a.weight, 0) / TOTAL);
}

/** variação fixa por jogador (−1, 0 ou +1) para o par 1×1 / manejo, que têm o mesmo peso */
export function gkVariation(id: string): number {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 3) - 1;
}

/** Grupo derivado de um "goalkeeping" existente, mantendo a média igual. */
export function deriveGoalkeeper(goalkeeping: number, variation = 0): GoalkeeperAttributes {
  const g = goalkeeping;
  const d = g + variation >= 1 && g + variation <= 20 && g - variation >= 1 && g - variation <= 20 ? variation : 0;
  return { reflexes: g, oneOnOne: g + d, handling: g - d, aerial: g, rushingOut: g, kicking: g };
}

/** Garante o grupo de goleiro (dados antigos): derivado sem mudar a força. Não altera o objeto recebido. */
export function withGoalkeeper(a: Attributes, id: string): Attributes {
  if (a.goalkeeper) return a;
  return { ...a, goalkeeper: deriveGoalkeeper(a.technical.goalkeeping, gkVariation(id)) };
}

/** Recalcula o "goalkeeping" a partir do grupo (depois de editar ou evoluir os atributos de goleiro). Altera o objeto. */
export function syncGoalkeeping(a: Attributes): Attributes {
  if (a.goalkeeper) a.technical.goalkeeping = gkComposite(a.goalkeeper);
  return a;
}
