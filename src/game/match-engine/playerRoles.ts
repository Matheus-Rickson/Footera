/**
 * Funções táticas (não confundir com posição): a posição é onde o jogador joga (ZAG, ME, CA…); a função é COMO ele joga ali
 * (Zagueiro Construtor, Armador Aberto, Pivô…). Cada função tem:
 *  - `weights`: atributos que a função exige (compatibilidade do jogador com a função, 0–100);
 *  - `fx`: efeito no motor — inclinação entre ataque/meio/defesa (o peso total da função não muda: o equilíbrio entre formações se mantém),
 *    participação nos lances (finalização, passe, cruzamento, cabeceio, chute de longe, desarme, faltas, impedimento), desgaste e efeitos de
 *    equipe (saída de bola, risco de contra-ataque nas costas, goleiro que cobre a profundidade).
 * Regra pura e determinística (sem sorteio).
 */
import type { Attributes, Position } from '../../shared/types.ts';
import { flattenAttributes } from '../world/overall.ts';

export interface RoleFx {
  tilt?: { att?: number; mid?: number; def?: number };
  shoot?: number; pass?: number; cross?: number; head?: number; long?: number; tackle?: number; foul?: number; victim?: number; offside?: number;
  fatigue?: number;
  /** saída de bola: melhora a precisão de passe do time */ build?: number;
  /** espaço nas costas: aumenta as chances de contra-ataque do adversário */ risk?: number;
  /** goleiro que sai para cobrir a profundidade: reduz as chances de contra-ataque do adversário */ sweep?: number;
}
export interface RoleDef { id: string; name: string; positions: Position[]; summary: string[]; weights: Partial<Record<string, number>>; fx: RoleFx }

const FB: Position[] = ['LB', 'RB'], WB: Position[] = ['LWB', 'RWB'], WM: Position[] = ['LM', 'RM'], W: Position[] = ['LW', 'RW'];
/** ATA (universos anteriores à v0.8.6) pode exercer as funções de segundo atacante e de centroavante. */
const SS: Position[] = ['SS', 'ST'], CF: Position[] = ['CF', 'ST'];

export const ROLES: RoleDef[] = [
  // ---------------- goleiro
  { id: 'gk_tradicional', name: 'Goleiro Tradicional', positions: ['GK'], summary: ['Prioriza a defesa da meta e o posicionamento.', 'Evita sair do gol; defesas convencionais.', 'Reposição segura e simples.'],
    weights: { reflexes: 3, handling: 2.5, aerial: 1.5, positioning: 1.5, agility: 1, composure: 1 }, fx: {} },
  { id: 'gk_libero', name: 'Goleiro Líbero', positions: ['GK'], summary: ['Joga adiantado, acompanhando a linha defensiva.', 'Sai da área para cortar lançamentos e bolas em profundidade.', 'Participa da construção com passes e lançamentos.'],
    weights: { rushingOut: 3, oneOnOne: 2.5, pace: 1.5, decisions: 1.5, positioning: 1, reflexes: 1 }, fx: { sweep: 1, build: 0.4, risk: 0.3 } },
  { id: 'gk_construtor', name: 'Goleiro Construtor', positions: ['GK'], summary: ['Prioriza a distribuição e o início das jogadas.', 'Procura passes curtos para defensores e meio-campistas.', 'Participa mais da construção desde a defesa.'],
    weights: { kicking: 3, passing: 2.5, firstTouch: 1.5, composure: 1.5, vision: 1, reflexes: 1.5 }, fx: { build: 1.4, risk: 0.3 } },
  // ---------------- zagueiro
  { id: 'cb_defensivo', name: 'Zagueiro Defensivo', positions: ['CB'], summary: ['Prioriza marcação, posicionamento e proteção da área.', 'Não abandona a linha para perseguir adversários.', 'Intercepta passes e neutraliza atacantes.'],
    weights: { marking: 3, tackling: 2.5, positioning: 2.5, heading: 2, strength: 1.5 }, fx: { tackle: 1.1, pass: 0.85, risk: -0.4 } },
  { id: 'cb_construtor', name: 'Zagueiro Construtor', positions: ['CB'], summary: ['Participa ativamente da saída de bola.', 'Passes verticais, inversões e lançamentos.', 'Mantém bom posicionamento defensivo.'],
    weights: { passing: 2.5, composure: 2, positioning: 2, vision: 1.5, tackling: 1.5, marking: 1.5 }, fx: { build: 1, pass: 1.6, long: 1.3, tilt: { mid: 0.15 } } },
  { id: 'cb_agressivo', name: 'Zagueiro Agressivo', positions: ['CB'], summary: ['Pressiona os atacantes e antecipa as jogadas.', 'Sai da linha para disputar bolas e interceptar.', 'Recupera a posse rápido, assumindo riscos.'],
    weights: { tackling: 3, aggression: 2, pace: 2, marking: 1.5, strength: 1.5, decisions: 1 }, fx: { tackle: 1.3, foul: 1.3, risk: 0.6, tilt: { mid: 0.1 } } },
  // ---------------- laterais
  { id: 'fb_defensivo', name: 'Lateral Defensivo', positions: FB, summary: ['Fica próximo aos zagueiros.', 'Prioriza marcação, interceptações e o corredor.', 'Avança só com segurança defensiva.'],
    weights: { marking: 2.5, tackling: 2.5, positioning: 2, strength: 1, stamina: 1 }, fx: { tilt: { def: 0.15, att: -0.08 }, cross: 0.7, risk: -0.4, fatigue: 0.95 } },
  { id: 'fb_completo', name: 'Lateral Completo', positions: FB, summary: ['Alterna apoio ao ataque e defesa.', 'Ultrapassa, cruza e participa da construção.', 'Busca equilíbrio nas transições.'],
    weights: { crossing: 2, stamina: 2, pace: 2, tackling: 1.5, marking: 1.5, passing: 1.5 }, fx: {} },
  { id: 'fb_ofensivo', name: 'Lateral Ofensivo', positions: FB, summary: ['Avança com frequência pelo corredor.', 'Ultrapassagens, profundidade e cruzamentos.', 'Vive o último terço, com mais risco atrás.'],
    weights: { crossing: 2.5, pace: 2.5, stamina: 2.5, dribbling: 1.5, workRate: 1 }, fx: { tilt: { att: 0.15, def: -0.12 }, cross: 1.4, shoot: 1.3, risk: 0.6, fatigue: 1.1 } },
  // ---------------- alas
  { id: 'wb_ofensivo', name: 'Ala Ofensivo', positions: WB, summary: ['Avança constantemente pelo corredor.', 'Profundidade, cruzamentos e participação no ataque.', 'Assume mais riscos defensivos.'],
    weights: { crossing: 2.5, pace: 2.5, stamina: 3, dribbling: 1.5 }, fx: { tilt: { att: 0.15, def: -0.12 }, cross: 1.3, shoot: 1.3, risk: 0.5, fatigue: 1.08 } },
  { id: 'wb_equilibrado', name: 'Ala Equilibrado', positions: WB, summary: ['Alterna apoio e recomposição.', 'Participa da construção e dá opção de passe.', 'Disciplina tática nas transições.'],
    weights: { stamina: 2.5, pace: 2, crossing: 2, passing: 1.5, tackling: 1.5, marking: 1.5 }, fx: {} },
  { id: 'wb_defensivo', name: 'Ala Defensivo', positions: WB, summary: ['Protege o corredor.', 'Fica próximo da linha defensiva.', 'Avança seletivamente, sem deixar espaço nas costas.'],
    weights: { marking: 2.5, tackling: 2.5, positioning: 2, stamina: 2, pace: 1.5 }, fx: { tilt: { def: 0.15, att: -0.1 }, cross: 0.8, risk: -0.4, fatigue: 0.95 } },
  // ---------------- volante
  { id: 'dm_primeiro', name: 'Primeiro Volante', positions: ['DM'], summary: ['Protege os zagueiros à frente da defesa.', 'Interceptações, desarmes e recuperação de posse.', 'Não avança demais; mantém o equilíbrio.'],
    weights: { tackling: 3, positioning: 2.5, marking: 2, strength: 1.5, decisions: 1.5 }, fx: { tilt: { def: 0.15, mid: -0.05 }, tackle: 1.2, pass: 0.85, shoot: 0.6, risk: -0.4 } },
  { id: 'dm_construtor', name: 'Volante Construtor', positions: ['DM'], summary: ['Primeiro organizador da saída de bola.', 'Passes curtos e longos ligando defesa e meio.', 'Controla o ritmo da circulação.'],
    weights: { passing: 3, vision: 2, decisions: 2, composure: 1.5, firstTouch: 1.5, positioning: 1 }, fx: { build: 1.2, pass: 1.4, long: 1.3, tackle: 0.85, tilt: { mid: 0.1, def: -0.05 } } },
  { id: 'dm_dinamico', name: 'Volante Dinâmico', positions: ['DM'], summary: ['Percorre vários setores do meio-campo.', 'Marca, constrói e chega ao ataque.', 'Pressiona e oferece opção de passe o tempo todo.'],
    weights: { stamina: 2.5, workRate: 2.5, tackling: 2, passing: 1.5, pace: 1 }, fx: { tilt: { att: 0.1 }, shoot: 1.4, tackle: 1.05, fatigue: 1.08 } },
  // ---------------- meio-campista
  { id: 'cm_box', name: 'Meio-campista Box-to-Box', positions: ['CM'], summary: ['Atua entre as duas áreas, atacando e defendendo.', 'Infiltra, pressiona e ajuda na recomposição.', 'Exige muita resistência e versatilidade.'],
    weights: { stamina: 3, workRate: 2.5, tackling: 1.5, passing: 1.5, finishing: 1, pace: 1 }, fx: { tilt: { att: 0.1, def: 0.05, mid: -0.15 }, shoot: 1.4, tackle: 1.1, fatigue: 1.1 } },
  { id: 'cm_organizador', name: 'Organizador', positions: ['CM'], summary: ['Controla o ritmo e a circulação.', 'Passes, inversões, visão de jogo e distribuição.', 'Procura espaços para receber e organizar.'],
    weights: { passing: 3, vision: 3, decisions: 2, firstTouch: 1.5, composure: 1 }, fx: { build: 1, pass: 1.4, long: 1.2, tackle: 0.8, tilt: { mid: 0.1, def: -0.1 } } },
  { id: 'cm_recuperador', name: 'Meio-campista Recuperador', positions: ['CM'], summary: ['Prioriza pressão, marcação e recuperação.', 'Combate no meio e protege as zonas centrais.', 'Constrói de forma simples e objetiva.'],
    weights: { tackling: 3, marking: 2, workRate: 2, positioning: 1.5, stamina: 1.5, aggression: 1 }, fx: { tilt: { def: 0.15, att: -0.1 }, tackle: 1.3, foul: 1.2, shoot: 0.7, pass: 0.85, risk: -0.3 } },
  // ---------------- meia esquerda / direita
  { id: 'wm_aberto', name: 'Meia Aberto', positions: WM, summary: ['Mantém a amplitude pelo lado.', 'Cruzamentos, dribles e passes para os atacantes.', 'Ajuda a proteger o corredor.'],
    weights: { crossing: 3, dribbling: 2, pace: 2, stamina: 1.5, passing: 1 }, fx: { cross: 1.35, tilt: { def: 0.05 } } },
  { id: 'wm_armador', name: 'Armador Aberto', positions: WM, summary: ['Parte do lado e vem para o centro.', 'Criação, passes decisivos e tabelas.', 'Aproxima-se dos atacantes para organizar.'],
    weights: { passing: 3, vision: 2.5, firstTouch: 2, decisions: 1.5, dribbling: 1 }, fx: { pass: 1.4, cross: 0.8, build: 0.5, tilt: { mid: 0.1, def: -0.05 } } },
  { id: 'wm_infiltrador', name: 'Meia Infiltrador', positions: WM, summary: ['Faz diagonais em direção à área.', 'Busca espaço para finalizar e bolas em profundidade.', 'Prioriza a chegada ao último terço.'],
    weights: { finishing: 2.5, pace: 2, positioning: 2, dribbling: 1.5, composure: 1.5 }, fx: { tilt: { att: 0.2, def: -0.1, mid: -0.1 }, shoot: 1.7, cross: 0.7, offside: 1.3, risk: 0.3 } },
  // ---------------- meia ofensivo
  { id: 'am_classico', name: 'Armador Clássico', positions: ['AM'], summary: ['Organiza entre as linhas adversárias.', 'Visão, passes decisivos e criação de chances.', 'Serve os atacantes e controla o ritmo.'],
    weights: { vision: 3, passing: 3, firstTouch: 2, decisions: 1.5, dribbling: 1 }, fx: { pass: 1.35, long: 1.1 } },
  { id: 'am_atacante', name: 'Meia Atacante', positions: ['AM'], summary: ['Aproxima-se da área para finalizar.', 'Explora espaços entre os defensores e infiltra.', 'Combina criação com presença ofensiva.'],
    weights: { finishing: 2.5, dribbling: 2, positioning: 1.5, composure: 1.5, longShots: 1.5, firstTouch: 1 }, fx: { tilt: { att: 0.15, mid: -0.15 }, shoot: 1.5, pass: 0.85, offside: 1.2 } },
  { id: 'am_recuado', name: 'Organizador Recuado', positions: ['AM'], summary: ['Aproxima-se dos meio-campistas para construir.', 'Distribui e controla a circulação.', 'Organiza de mais atrás, longe da área.'],
    weights: { passing: 3, vision: 2, decisions: 2, composure: 1.5, firstTouch: 1.5 }, fx: { tilt: { mid: 0.15, att: -0.15 }, build: 0.8, pass: 1.2, shoot: 0.7 } },
  // ---------------- pontas
  { id: 'w_aberto', name: 'Ponta Aberto', positions: W, summary: ['Fica perto da linha lateral.', 'Velocidade, dribles e cruzamentos.', 'Vence no um contra um e cria chances.'],
    weights: { pace: 3, dribbling: 2.5, crossing: 2.5, agility: 1.5 }, fx: { cross: 1.4, shoot: 0.85 } },
  { id: 'w_invertido', name: 'Ponta Invertido', positions: W, summary: ['Parte do lado e conduz para o centro.', 'Finaliza com o pé dominante e combina com os atacantes.', 'Jogadas individuais e diagonais.'],
    weights: { pace: 2.5, finishing: 2.5, dribbling: 2, composure: 1.5, agility: 1 }, fx: { shoot: 1.5, cross: 0.6, tilt: { att: 0.05 } } },
  { id: 'w_construtor', name: 'Ponta Construtor', positions: W, summary: ['Aproxima-se do meio para criar.', 'Passes, tabelas e construção.', 'Alterna entre o corredor e o centro.'],
    weights: { passing: 2.5, vision: 2, firstTouch: 2, dribbling: 1.5, decisions: 1 }, fx: { pass: 1.35, shoot: 0.8, cross: 0.9, tilt: { mid: 0.15, att: -0.1 } } },
  // ---------------- segundo atacante
  { id: 'ss_segundo', name: 'Segundo Atacante', positions: SS, summary: ['Joga perto do centroavante, explorando os espaços.', 'Participa das combinações e finaliza.', 'Alterna entre recuar para construir e atacar a área.'],
    weights: { finishing: 2.5, firstTouch: 2, passing: 1.5, dribbling: 1.5, composure: 1.5, positioning: 1 }, fx: {} },
  { id: 'ss_falso9', name: 'Falso 9', positions: SS, summary: ['Recua entre as linhas para receber e construir.', 'Atrai os zagueiros e abre espaço para infiltrações.', 'Movimentação, passes e inteligência tática.'],
    weights: { vision: 2.5, passing: 2.5, firstTouch: 2, dribbling: 1.5, decisions: 1.5 }, fx: { tilt: { mid: 0.25, att: -0.2 }, pass: 1.5, shoot: 0.7, build: 0.4 } },
  { id: 'ss_profundidade', name: 'Atacante de Profundidade', positions: SS, summary: ['Ataca as costas da defesa o tempo todo.', 'Diagonais para receber em profundidade.', 'Velocidade, posicionamento e finalização.'],
    weights: { pace: 3, finishing: 2.5, positioning: 2, composure: 1, agility: 1 }, fx: { shoot: 1.3, offside: 1.5, tilt: { att: 0.1, mid: -0.1 } } },
  // ---------------- centroavante
  { id: 'cf_pivo', name: 'Pivô', positions: CF, summary: ['Usa o corpo para proteger a bola e disputar com os zagueiros.', 'Segura a posse e distribui para os companheiros.', 'Força física, posicionamento e jogo aéreo.'],
    weights: { strength: 3, heading: 2.5, firstTouch: 2, positioning: 1.5, passing: 1 }, fx: { head: 1.3, pass: 1.3, shoot: 0.85 } },
  { id: 'cf_referencia', name: 'Atacante de Referência', positions: CF, summary: ['Fica perto da área adversária.', 'Recebe cruzamentos e passes para finalizar.', 'Posicionamento e capacidade de conclusão.'],
    weights: { finishing: 3, positioning: 2.5, heading: 2, composure: 1.5 }, fx: { shoot: 1.2, head: 1.15, offside: 1.1 } },
  { id: 'cf_movel', name: 'Atacante Móvel', positions: CF, summary: ['Movimenta-se por todo o setor ofensivo.', 'Explora espaços e faz diagonais para finalizar.', 'Velocidade, movimentação e definição.'],
    weights: { pace: 2.5, finishing: 2.5, dribbling: 1.5, agility: 1.5, positioning: 1, workRate: 1 }, fx: { tilt: { mid: 0.1 }, offside: 1.2, victim: 1.2, fatigue: 1.05 } },
];

const BY_ID = new Map(ROLES.map((r) => [r.id, r]));
export const roleById = (id: string | null | undefined): RoleDef | undefined => (id ? BY_ID.get(id) : undefined);
export const rolesFor = (pos: Position): RoleDef[] => ROLES.filter((r) => r.positions.includes(pos));

/** Compatibilidade (0–100) dos atributos do jogador com a função. */
export function roleSuitability(attrs: Attributes, role: RoleDef): number {
  const flat = flattenAttributes(attrs);
  let sum = 0, tot = 0;
  for (const [k, w] of Object.entries(role.weights)) { sum += (flat[k] ?? 1) * (w ?? 0); tot += w ?? 0; }
  return Math.round((sum / tot) * 5);
}

/** Jogador para fins de função: posição natural/secundárias, atributos e domínio aprendido (id da função → 0–100). */
export interface RolePlayer { position: Position; secondaryPositions: Position[]; attributes: Attributes; roleFamiliarity?: Record<string, number> }

/**
 * Domínio inicial (sem histórico): 100% na função da posição natural que mais combina com o perfil; 55% nas outras da posição natural
 * e na melhor de cada posição secundária; 30% nas demais das secundárias; 20% em qualquer outra.
 */
export function defaultFamiliarity(p: RolePlayer, role: RoleDef): number {
  const best = (pos: Position) => rolesFor(pos).reduce((a, b) => (roleSuitability(p.attributes, b) > roleSuitability(p.attributes, a) ? b : a), rolesFor(pos)[0]!);
  if (role.positions.includes(p.position)) return best(p.position).id === role.id ? 100 : 55;
  for (const s of p.secondaryPositions) if (role.positions.includes(s)) return best(s).id === role.id ? 55 : 30;
  return 20;
}
export const familiarity = (p: RolePlayer, role: RoleDef): number => Math.round(p.roleFamiliarity?.[role.id] ?? defaultFamiliarity(p, role));

/**
 * Multiplicador de rendimento na função: compatibilidade dos atributos com a função (comparada com a posição) e domínio.
 * Função ideal e dominada: até ~+4%; função que não combina: até ~−5%; sem domínio: até −7%.
 */
export function roleFactor(p: RolePlayer, role: RoleDef, positionRating: number): number {
  return roleFactorFrom(roleSuitability(p.attributes, role), familiarity(p, role), positionRating);
}
/** Mesmo cálculo a partir dos números já prontos (compatibilidade, domínio e força na posição) — usado também pela tela de Táticas. */
export function roleFactorFrom(suitability: number, familiarityPct: number, positionRating: number): number {
  const ratio = Math.min(1.12, Math.max(0.85, suitability / Math.max(1, positionRating)));
  return (1 + 0.35 * (ratio - 1)) * (0.93 + 0.07 * (familiarityPct / 100));
}

/** Melhor função para o jogador naquela posição (compatibilidade × domínio). */
export function bestRole(p: RolePlayer, slot: Position, positionRating: number): RoleDef {
  const options = rolesFor(slot);
  return options.reduce((a, b) => (roleFactor(p, b, positionRating) > roleFactor(p, a, positionRating) ? b : a), options[0]!);
}
