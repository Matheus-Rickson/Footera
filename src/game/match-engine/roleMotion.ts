/**
 * Animação ilustrativa de uma função tática no campinho (tela de Táticas). NÃO é um lance simulado: é o desenho das tendências
 * que a função tem no motor (`RoleDef.fx`): para onde ela empurra o jogador (inclinação ataque/meio/defesa) e em que lances ele
 * mais aparece (cruzamento, finalização, passe/saída de bola, lançamento, desarme, profundidade, cobertura do goleiro), além do
 * espaço que deixa nas costas. Regra pura e determinística.
 *
 * Campo na horizontal: x = profundidade (0 = próprio gol, 100 = gol adversário); y = largura (0 = lado esquerdo, 100 = direito).
 */
import type { Position } from '../../shared/types.ts';
import type { RoleDef } from './playerRoles.ts';

export interface MotionPoint { x: number; y: number }
/** Quadro-chave: `t` de 0 a 1 no ciclo da animação. */
export interface MotionFrame extends MotionPoint { t: number }
export interface RoleMotion {
  /** ponto de partida (posição na formação) */ base: MotionPoint;
  /** trajeto do jogador (começa e termina na base, para repetir sem salto) */ player: MotionFrame[];
  /** trajeto da bola quando ele age com ela (null = a função não tem um lance característico com bola) */ ball: { from: MotionPoint; to: MotionPoint; t0: number; t1: number; air: boolean } | null;
  /** zona nas costas: 'risk' = deixa espaço; 'cover' = protege */ zone: { kind: 'risk' | 'cover'; x: number; y: number; w: number; h: number } | null;
  /** o que a animação mostra, em texto (mesma origem dos dados) */ tags: string[];
}

/** Posição de partida de cada posição no campinho horizontal. */
export const MOTION_BASE: Record<Position, MotionPoint> = {
  GK: { x: 5, y: 50 }, CB: { x: 20, y: 40 }, LB: { x: 24, y: 12 }, RB: { x: 24, y: 88 }, LWB: { x: 36, y: 8 }, RWB: { x: 36, y: 92 },
  DM: { x: 34, y: 50 }, CM: { x: 46, y: 44 }, LM: { x: 54, y: 12 }, RM: { x: 54, y: 88 }, AM: { x: 62, y: 50 },
  LW: { x: 70, y: 10 }, RW: { x: 70, y: 90 }, SS: { x: 72, y: 44 }, CF: { x: 80, y: 50 }, ST: { x: 80, y: 50 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const pt = (x: number, y: number): MotionPoint => ({ x: r1(clamp(x, 2, 98)), y: r1(clamp(y, 3, 97)) });

export function roleMotion(role: RoleDef, pos: Position): RoleMotion {
  const fx = role.fx, tilt = fx.tilt ?? {};
  const base = MOTION_BASE[pos] ?? MOTION_BASE.CM;
  const wide = base.y < 25 || base.y > 75, side = base.y < 50 ? -1 : 1; // -1 = lado esquerdo
  const ta = tilt.att ?? 0, td = tilt.def ?? 0, tm = tilt.mid ?? 0;
  const tags: string[] = [];
  let ball: RoleMotion['ball'] = null;

  // ---- goleiro: sai do gol para cobrir a profundidade e/ou inicia a jogada com os pés
  if (pos === 'GK') {
    const out = (fx.sweep ?? 0) > 0;
    const p1 = out ? pt(24, 50) : pt(8, 50);
    if (out) tags.push('Sai da área para cobrir as costas da defesa');
    else tags.push('Fica na meta, posicionado');
    if ((fx.build ?? 0) >= 0.4) { ball = { from: p1, to: pt(30, 22), t0: 0.45, t1: 0.65, air: false }; tags.push('Inicia a jogada com passe curto'); }
    return { base: pt(base.x, base.y), player: [{ t: 0, ...pt(base.x, base.y) }, { t: 0.4, ...p1 }, { t: 0.7, ...p1 }, { t: 1, ...pt(base.x, base.y) }], ball, zone: null, tags };
  }

  // ---- até onde ele vai na fase ofensiva (inclinação da função)
  let ax = base.x + 12 + 70 * ta - 55 * td;
  let ay = base.y;
  const drop = tm >= 0.15 && ta <= 0; // falso 9, organizador recuado: recua para construir
  if (drop) { ax = base.x - 14; tags.push('Recua para receber e construir'); }
  if (ta >= 0.1) tags.push('Ataca o último terço');
  if (td >= 0.15) tags.push('Segura a posição perto da defesa');

  const cross = fx.cross ?? 1, shoot = fx.shoot ?? 1, pass = fx.pass ?? 1, build = fx.build ?? 0, long = fx.long ?? 1;
  const tackle = fx.tackle ?? 1, offside = fx.offside ?? 1, head = fx.head ?? 1;
  let action: MotionPoint | null = null;

  if (cross >= 1.3 && wide) {
    // corredor: vai à linha de fundo e cruza na área
    ax = Math.max(ax, 84); ay = side < 0 ? 5 : 95;
    action = pt(ax, ay);
    ball = { from: action, to: pt(90, 50 - side * 4), t0: 0.5, t1: 0.68, air: true };
    tags.push('Vai à linha de fundo e cruza');
  } else if (shoot >= 1.3) {
    // chega à área para finalizar (de fora para dentro, se parte do lado)
    ax = Math.max(ax, 82); ay = wide ? 50 + side * 14 : base.y + (50 - base.y) * 0.6;
    action = pt(ax, ay);
    ball = { from: action, to: pt(100, 50 - side * 3), t0: 0.55, t1: 0.68, air: false };
    tags.push(wide ? 'Corta para dentro e finaliza' : 'Infiltra na área e finaliza');
  } else if (offside >= 1.2) {
    // ataca as costas da defesa (corrida na última linha)
    ax = Math.max(ax, 86); ay = base.y + (wide ? -side * 14 : side * 10);
    action = pt(ax, ay);
    ball = { from: pt(55, 50), to: action, t0: 0.42, t1: 0.58, air: false };
    tags.push('Corre nas costas da zaga');
  } else if (head >= 1.15) {
    ax = Math.max(ax, 88); ay = 50;
    action = pt(ax, ay);
    ball = { from: pt(88, side < 0 ? 95 : 5), to: action, t0: 0.4, t1: 0.58, air: true };
    tags.push('Disputa pelo alto na área');
  } else if (pass >= 1.3 || build >= 0.8) {
    // organiza: se aproxima do meio e distribui para frente
    if (wide && !drop) ay = base.y + (50 - base.y) * 0.55;
    action = pt(ax, ay);
    const far = long >= 1.2;
    ball = { from: action, to: far ? pt(ax + 38, base.y < 50 ? 80 : 20) : pt(ax + 18, ay + (ay < 50 ? 10 : -10)), t0: 0.5, t1: far ? 0.7 : 0.62, air: far };
    tags.push(far ? 'Distribui com passes longos e inversões' : 'Organiza com passes curtos');
  } else if (tackle >= 1.2) {
    // pressiona o portador e recupera a bola
    action = pt(base.x + 10, base.y + (50 - base.y) * 0.3);
    ax = action.x; ay = action.y;
    tags.push('Pressiona e desarma');
  } else if (cross >= 1.3) {
    action = pt(ax, ay);
    ball = { from: action, to: pt(88, 50), t0: 0.5, t1: 0.66, air: true };
    tags.push('Cruza para a área');
  }
  if (!tags.length) tags.push('Equilibra apoio ao ataque e recomposição');

  const go = pt(ax, ay);
  const player: MotionFrame[] = [{ t: 0, ...pt(base.x, base.y) }, { t: 0.45, ...go }, { t: 0.72, ...(action ?? go) }, { t: 1, ...pt(base.x, base.y) }];
  return { base: pt(base.x, base.y), player, ball, zone: zoneOf(fx.risk ?? 0, base), tags: [...tags, ...zoneTag(fx.risk ?? 0)] };
}

function zoneOf(risk: number, base: MotionPoint): RoleMotion['zone'] {
  if (Math.abs(risk) < 0.3) return null;
  return { kind: risk > 0 ? 'risk' : 'cover', x: r1(Math.max(2, base.x - 16)), y: r1(clamp(base.y - 12, 3, 73)), w: 16, h: 24 };
}
const zoneTag = (risk: number): string[] => (risk >= 0.3 ? ['Deixa espaço nas costas'] : risk <= -0.3 ? ['Protege a zona atrás dele'] : []);
