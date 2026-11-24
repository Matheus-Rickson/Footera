/**
 * Motor de partida v2: lance a lance no campo (docs/MATCH_ENGINE_V2.md).
 *
 * O resultado nasce do que acontece no mapa: os 22 jogadores têm posição (âncora da formação, inclinada pela função e deslocada com a
 * bola, a linha defensiva, a largura e a pressão); quem está com a bola escolhe entre passar, conduzir, cruzar, chutar ou afastar
 * comparando o valor de cada opção (ameaça da posição, risco de perder a bola) com os atributos de quem age e de quem marca; o
 * sucesso é uma disputa entre os jogadores envolvidos. O xG sai da posição do chute.
 *
 * A moldura da partida é a mesma da v1 (mesmo contrato `simulateMatch`): minutos registrados, fadiga, lesões, cartões, substituições
 * da IA e sugestões do auxiliar, intervenções do técnico, linha do tempo, acréscimos, prorrogação e pênaltis. Novidades: o técnico
 * muda a tática, a função de um jogador e a formação durante o jogo; o técnico da IA reage ao placar; o trajeto (`track`) mostra a partida.
 * Determinístico pela semente.
 */
import { createRng, clamp, type Rng } from '../../rng.ts';
import type { Position } from '../../../shared/types.ts';
import { effective, positionFit, readiness } from '../roles.ts';
import { FORMATIONS, formationLabel, getFormation, type Formation } from '../formations.ts';
import type {
  ChanceType, EventType, Intervention, MatchConditions, MatchEvent, MatchOptions, MatchOutcome, MatchPlayer, MatchTick, MatchTrack,
  PlayerReport, ShotOutcome, SubSuggestion, TeamSheet, TeamStats, TeamTactics, TrackKind,
} from '../types.ts';
import { PASS_CROSS, PASS_LONG, PASS_OK, TICK_STATS, TRACK_HEAD, TRACK_KIND, TRACK_SLOTS } from '../types.ts';
import { createAnalysis } from './analysis.ts';
import { talkDelta } from '../teamTalk.ts';
import { cardMultiplier, inGameMultiplier, tacticsMultiplier, talkWithMotivation } from '../../coach-engine/coach.ts';
import { POS_NAME } from '../../../shared/positions.ts';
import { bestRole, roleById, roleFactor, type RoleDef } from '../playerRoles.ts';
import { overallFor } from '../../world/overall.ts';
import { conditionAfter, emptyStats, MatchInterventionError, newReport, rateReport, startFatigue } from '../common.ts';
import {
  L, W, MID_Y, clampN, depthOf, dist, goalAngle, inBox, onPitch, oppGoal, segDist, threat, toBase64, xgAt, xOf, type P, type Side,
} from './pitch.ts';

/** Constantes de calibração da v2 (bateria do Laboratório: cenário "calibracao" com motor=v2; ver docs/MATCH_ENGINE_V2.md). */
export const K2 = {
  /** seletividade da escolha de ação (softmax): maior = escolhe mais a melhor opção */
  beta: 300,
  /** peso da ameaça da posição de destino, do avanço e de manter a bola na utilidade das ações */
  val: 1.0, prog: 0.2, keep: 0.012,
  /** custo de perder a bola (cresce perto do próprio gol) */
  loss: 0.035,
  /** peso do chute (× xG da posição) e custo fixo de finalizar (troca a posse por um chute) */
  shot: 1.65, shotCost: 0.045,
  /** tentativa de desarme de quem está a até 2 m do portador (por ação) e chance de falta numa disputa */
  tackleTry: 0.7, foul: 0.16,
  /** movimento próprio sem a bola (m): amplitude com a bola e sem ela; aproximação de quem está perto do portador (fração) */
  wander: 3, wanderDef: 1.5, support: 0.05,
  /** com um atacante só, quanto os meias a mais atacam a área */
  loneRun: 0.3,
  /** impedimento num passe para frente a um atacante adiantado */
  offside: 0.019,
  /** escanteio: chance de virar finalização de cabeça */
  cornerShot: 0.3,
  /** mando de campo: multiplicador da qualidade de quem joga em casa */
  home: 1.08,
  /** lesão por minuto em campo (mesma base da v1) */
  injury: 0.00006,
  /** desvio da forma do dia de cada time */
  dayFormSd: 0.03,
  /** quem vence por 3+ gols tira o pé (avanço e chute × leadEase^(vantagem − 2)) */
  leadEase: 0.62,
  /** quem vence por 3+ cede mais: xG contra × (1 + leadRelax × (vantagem − 2)) */
  leadRelax: 0.5,
  /** passe em profundidade: vantagem de tempo (s) que quem corre precisa ganhar do defensor mais rápido até a bola (ajuste do domínio e da leitura) */
  thruLag: 0.15,
  /** mentalidade (−1 defensiva, +1 ofensiva): quanto a linha sobe com a bola (m), quanto a linha sem a bola sobe (ofensiva) ou recua (defensiva)
   * e quanto a distância entre as linhas sem a bola encolhe (defensiva) ou estica (ofensiva) */
  mtAtt: 3, mtAttDown: 1.5, mtLineUp: 8, mtLineDown: 2, mtCompact: 0.25,
  /** saturação da diferença de qualidade numa disputa e teto do efeito de um goleiro fraco na conversão */
  duelCap: 0.15, gkModMax: 1.6,
  /** risco das funções do time (soma de fx.risk: laterais ofensivos, zagueiros agressivos…): a linha sobe (m por ponto) e a área fica menos protegida */
  riskLine: 0, riskOrg: 0.09,
  /** mentalidade: proteção da área de quem defende (o xG cedido × (1 + mtOrg × mentalidade)) e o ganho próprio no avanço e no chute */
  mtOrg: 0.25, mtProg: 0.03, mtShot: 0.05,
  /** tempo fixo de um passe certo (s), além do voo da bola: domínio, ajeitar e olhar */
  passT: 3.4,
};

/** Posições que recompõem (a v1 usa o mesmo grupo para "tirar alguém da defesa" ao buscar o resultado). */
const DEFENSIVE_OUT = new Set<Position>(['CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM']);
const ATTACKERS = new Set<Position>(['LW', 'RW', 'SS', 'CF', 'ST']);
/** sem a bola: distância (m) de cada posição à frente da linha defensiva — toda formação recompõe em linhas de 4–5, 4–5 e 1–2 */
export const DEF_DEPTH: Record<Position, number> = { GK: 0, CB: 0, LB: 0.8, RB: 0.8, LWB: 2, RWB: 2, DM: 7, CM: 13, LM: 13.5, RM: 13.5, AM: 16, LW: 12, RW: 12, SS: 19, CF: 22, ST: 22 };
/** com a bola, quanto cada posição sobe além da âncora: meias abertos e alas dão a largura alta que os pontas dão nas outras formações */
export const ATT_PUSH: Partial<Record<Position, number>> = { LM: 5, RM: 5, LWB: 6, RWB: 6, CM: 3 };
/** lateral numa linha de três zagueiros (5-3-2): sobe no ataque como ala */
const FB_BACK3_PUSH = 14;
/** dupla de zaga (linha de 4): fica mais junta que os três zagueiros de uma linha de 3, para fechar o corredor central */
const CB_PAIR_WIDTH = 0.25;
/** sem a bola, fração da largura da âncora que cada posição mantém: o meio fecha por dentro, os pontas recompõem na linha do meio */
export const DEF_WIDTH: Record<Position, number> = { GK: 0, CB: 0.48, LB: 0.6, RB: 0.6, LWB: 0.6, RWB: 0.6, DM: 0.3, CM: 0.4, LM: 0.5, RM: 0.5, AM: 0.5, LW: 0.45, RW: 0.45, SS: 0.6, CF: 0.6, ST: 0.6 };
/** com a bola no último terço: quanto cada posição ataca a área (0 = segura a posição, 1 = sempre chega) */
export const RUN: Record<Position, number> = { GK: 0, CB: 0, LB: 0.05, RB: 0.05, LWB: 0.2, RWB: 0.2, DM: 0, CM: 0.3, LM: 0.4, RM: 0.4, AM: 0.45, LW: 0.6, RW: 0.6, SS: 0.6, CF: 1, ST: 1 };
const CORNER_W: Record<Position, number> = { GK: 0, CB: 0.8, LB: 0.2, RB: 0.2, DM: 0.3, CM: 0.3, AM: 0.2, LW: 0.15, RW: 0.15, ST: 1, LWB: 0.15, RWB: 0.15, LM: 0.15, RM: 0.15, SS: 0.5, CF: 1.1 };

interface Live {
  p: MatchPlayer; slot: Position;
  /** âncora na formação (x = largura 0–100 da esquerda para a direita de quem ataca; y = profundidade 0–100) */ x: number; y: number;
  pos: P; tgt: P;
  fatigue: number; f0: number; yellow: number; out: boolean; rep: PlayerReport;
  role: RoleDef; roleK: number;
  /** multiplicador de rendimento do momento (prontidão × posição × função × cansaço × time) */ m: number;
  /** índice no trajeto */ ti: number;
}
interface TeamState {
  idx: Side; sheet: TeamSheet; tac: TeamTactics; active: Live[]; all: Live[]; bench: MatchPlayer[]; subsUsed: number; formation: string;
  fx: { build: number; risk: number; sweep: number }; stats: TeamStats; held: number; goals: number; mul: number;
}
type Restart = { kind: 'kickoff' | 'goalkick' | 'throw' | 'corner' | 'freekick' | 'penalty'; team: Side; at: P; fouled?: Live | null };

const a20 = (v: number) => v / 20;

export function simulateMatchV2(home: TeamSheet, away: TeamSheet, opts: MatchOptions): MatchOutcome {
  const rng: Rng = createRng(`match2:${opts.seed}`);
  const conditions: MatchConditions = opts.conditions ?? { weather: 'clear', pitch: 'good' };
  const hAdv = opts.neutral ? 0 : 1;
  const events: MatchEvent[] = [];
  const clock = { minute: 0, label: "0'" };
  const decider = opts.decider ?? (opts.knockout ? { extraTime: true, penalties: true } : null);
  const first = decider?.firstLeg ?? [0, 0];
  const subCap = (): number => (clock.minute > 90 && decider?.extraTimeSub ? 6 : 5);

  const mk = (sheet: TeamSheet, idx: Side): TeamState => {
    const all = sheet.lineup.map((l, k) => {
      const f0 = startFatigue(l.player.condition);
      const live = { p: { ...l.player }, slot: l.slot, x: l.x, y: l.y, pos: { x: 0, y: 0 }, tgt: { x: 0, y: 0 }, fatigue: f0, f0, yellow: 0, out: false, rep: newReport(l.player, idx, l.slot, true, 0), m: 1, ti: k } as Live;
      setRole(live, l.role);
      return live;
    });
    return {
      idx, sheet, tac: { ...sheet.tactics }, active: [...all], all, bench: sheet.bench.map((b) => ({ ...b })), subsUsed: 0, formation: formationLabel(sheet.formation),
      fx: { build: 0, risk: 0, sweep: 0 }, stats: emptyStats(), held: 0, goals: 0, mul: 1,
    };
  };
  function setRole(l: Live, roleId?: string | null): void {
    const rating = overallFor(l.p.attributes, l.slot);
    const chosen = roleById(roleId);
    const role = chosen && chosen.positions.includes(l.slot) ? chosen : bestRole(l.p, l.slot, rating);
    l.role = role; l.roleK = roleFactor(l.p, role, rating); l.rep.role = role.id;
  }
  const T: [TeamState, TeamState] = [mk(home, 0), mk(away, 1)];
  const dayForm: [number, number] = [0, 1].map(() => clamp(rng.normal(1, K2.dayFormSd), 1 - 2 * K2.dayFormSd, 1 + 2 * K2.dayFormSd)) as [number, number];

  const emit = (type: EventType, team: Side, extra: Partial<MatchEvent> = {}): MatchEvent => {
    const e: MatchEvent = { i: events.length, minute: clock.minute, label: clock.label, type, team, ...extra };
    events.push(e);
    return e;
  };
  const fatigueMul = (l: Live) => 1 - 0.0035 * l.fatigue;
  const gained = (l: Live) => Math.round((l.fatigue - l.f0) * 10) / 10;
  const opp = (t: TeamState): TeamState => T[1 - t.idx as Side];

  /** rendimento do momento de cada jogador e efeitos de equipe das funções (a cada minuto e a cada mudança) */
  const refresh = (t: TeamState): void => {
    t.mul = t.sheet.cohesion * tacticsMultiplier(t.sheet.coach) * dayForm[t.idx] * (t.idx === 0 ? Math.pow(K2.home, hAdv) : 1);
    t.fx = { build: 0, risk: 0, sweep: 0 };
    for (const l of t.active) {
      l.m = readiness(l.p) * positionFit(l.p, l.slot) * l.roleK * fatigueMul(l) * t.mul;
      t.fx.build += l.role.fx.build ?? 0; t.fx.risk += l.role.fx.risk ?? 0; t.fx.sweep += l.role.fx.sweep ?? 0;
    }
  };
  const refreshAll = () => { refresh(T[0]); refresh(T[1]); };

  // ---------- qualidades usadas nas disputas (0..~1,1) ----------
  const A = (l: Live) => l.p.attributes;
  const q = {
    pass: (l: Live) => (a20(A(l).technical.passing) * 0.55 + a20(A(l).mental.vision) * 0.2 + a20(A(l).technical.firstTouch) * 0.1 + a20(A(l).mental.decisions) * 0.15) * l.m,
    dribble: (l: Live) => (a20(A(l).technical.dribbling) * 0.5 + a20(A(l).physical.agility) * 0.25 + a20(A(l).physical.pace) * 0.25) * l.m,
    hold: (l: Live) => (a20(A(l).technical.firstTouch) * 0.4 + a20(A(l).physical.strength) * 0.35 + a20(A(l).mental.composure) * 0.25) * l.m,
    tackle: (l: Live) => (a20(A(l).technical.tackling) * 0.5 + a20(A(l).mental.positioning) * 0.25 + a20(A(l).physical.strength) * 0.15 + a20(A(l).technical.marking) * 0.1) * l.m,
    read: (l: Live) => (a20(A(l).mental.positioning) * 0.5 + a20(A(l).mental.decisions) * 0.3 + a20(A(l).technical.marking) * 0.2) * l.m,
    finish: (l: Live) => (a20(A(l).technical.finishing) * 0.6 + a20(A(l).mental.composure) * 0.25 + a20(A(l).mental.positioning) * 0.15) * l.m,
    long: (l: Live) => (a20(A(l).technical.longShots) * 0.6 + a20(A(l).technical.passing) * 0.15 + a20(A(l).mental.composure) * 0.25) * l.m,
    head: (l: Live) => (a20(A(l).technical.heading) * 0.6 + a20(A(l).physical.jumping) * 0.4) * l.m,
    aerialDef: (l: Live) => (a20(A(l).technical.heading) * 0.4 + a20(A(l).physical.jumping) * 0.3 + a20(A(l).physical.strength) * 0.3) * l.m,
    cross: (l: Live) => (a20(A(l).technical.crossing) * 0.75 + a20(A(l).mental.vision) * 0.25) * l.m,
    gk: (l: Live) => {
      const g = A(l).goalkeeper;
      const v = g ? a20(g.reflexes) * 0.35 + a20(g.handling) * 0.2 + a20(g.oneOnOne) * 0.2 + a20(A(l).mental.positioning) * 0.15 + a20(g.aerial) * 0.1 : a20(A(l).technical.goalkeeping);
      return v * l.m;
    },
    speed: (l: Live) => (4.3 + 3.4 * a20(A(l).physical.pace)) * (1 - 0.004 * l.fatigue),
  };
  /** disputa entre duas qualidades: chance de `a` vencer (k = quanto a diferença pesa). A diferença satura suavemente (tanh): entre
   * times parecidos vale inteira; num abismo de qualidade, cada disputa ainda pende muito, mas sem virar certeza (sem goleadas absurdas) */
  const duel = (a: number, b: number, base = 0.5, k = 5): number => {
    const dq = K2.duelCap * Math.tanh((a - b) / K2.duelCap);
    return clampN(1 / (1 + Math.exp(-(k * dq + Math.log(base / (1 - base))))), 0.02, 0.98);
  };

  // ---------- estado da bola ----------
  let ball: P = { x: L / 2, y: MID_Y };
  let holder: Live | null = null;
  let poss: Side = 0;
  let restart: Restart | null = null;
  /** última troca de posse (segundos absolutos) e profundidade onde ela aconteceu, para classificar contra-ataques */
  let regainAt = -999, regainDepth = 50, possActions = 0;
  /** último passe completado (assistência / passe decisivo) */
  let lastPass: { from: Live; to: Live; cross: boolean } | null = null;
  let gameSec = 0;
  let secInTick = 0;
  let debt = 0;

  const sideOf = (l: Live): Side => (T[0].active.includes(l) ? 0 : 1);
  const placeAll = (): void => {
    for (const t of T) { shape(t, t.idx === poss); for (const l of t.active) l.pos = { ...l.tgt }; }
    if (holder) holder.pos = { ...ball };
  };

  // ---------- forma do time (alvo de cada jogador) ----------
  const ment = (t: TeamState) => (t.tac.mentality === 'attacking' ? 1 : t.tac.mentality === 'defensive' ? -1 : 0);
  const ease = (t: TeamState) => { const lead = t.goals - opp(t).goals; return lead >= 3 ? Math.pow(K2.leadEase, lead - 2) : 1; };
  // áreas de trabalho da marcação (reaproveitadas: shape roda a cada ação)
  const thD: number[] = new Array(11), thX: number[] = new Array(11), thY: number[] = new Array(11), freeL: Live[] = new Array(11);
  function shape(t: TeamState, attacking: boolean): void {
    const o = opp(t);
    const bd = depthOf(t.idx, ball.x);
    const tac = t.tac, mt = ment(t);
    // linha de impedimento: o defensor de linha mais recuado do adversário (ou a bola)
    let offLine = bd;
    for (const l of o.active) if (l.slot !== 'GK') offLine = Math.max(offLine, depthOf(t.idx, l.pos.x));
    // sem a bola: a linha não deixa atacante às costas (acompanha o mais adiantado, sem passar da pequena área)
    let deepest = L;
    // (antecipa a corrida: usa o mais adiantado entre onde o atacante está e para onde ele vai)
    if (!attacking) for (const l of o.active) if (l.slot !== 'GK') deepest = Math.min(deepest, depthOf(t.idx, l.pos.x), depthOf(t.idx, l.tgt.x));
    let nCB = 0;
    let nFwd = 0;
    for (const l of t.active) { if (l.slot === 'CB') nCB++; else if (ATTACKERS.has(l.slot)) nFwd++; }
    // um atacante só: os meias chegam à área para acompanhá-lo
    const lone = nFwd <= 1 ? K2.loneRun : 0;
    const hOwn = attacking && holder && t.active.includes(holder) ? holder : null;
    for (const l of t.active) {
      if (l.slot === 'GK') {
        const own = attacking ? clampN(5 + 0.12 * (bd - 20), 3, 18) : clampN(3 + 0.1 * (bd - 25), 2.5, 14);
        l.tgt = { x: xOf(t.idx, own + 4 * (l.role.fx.sweep ?? 0)), y: MID_Y + (ball.y - MID_Y) * 0.22 };
        continue;
      }
      const tilt = l.role.fx.tilt ?? {};
      const rel = l.y - 19;
      // lado no campo (-1 = y 0, 1 = y 68): a âncora vai da esquerda (0) à direita (100) de quem ataca; o visitante ataca no sentido
      // contrário, então a esquerda dele fica do outro lado (até a v0.10.0 os dois times usavam o mesmo lado: alas espelhados)
      const sy = (t.idx === 0 ? 1 : -1) * ((l.x - 50) / 50);
      // movimento próprio de cada jogador (determinístico, sem sorteio): procura espaço em ciclos de 25–60 s, em fase diferente
      // dos companheiros — o time não anda como um bloco rígido
      const ph = l.ti * 2.399 + t.idx * 1.7;
      const wx = Math.sin(gameSec / (4 + (l.ti % 3) * 1.3) + ph), wy = Math.sin(gameSec / (5.5 + (l.ti % 4) * 0.9) + ph * 1.7);
      let d: number, yy: number;
      if (attacking) {
        const line = clampN(17 + 0.5 * (bd - 20) + 3 * (tac.defensiveLine - 3) + (mt > 0 ? K2.mtAtt : K2.mtAttDown) * mt, 13, 60);
        d = line + rel * 0.62 * (1 + 0.03 * (tac.tempo - 3)) + 10 * (tilt.att ?? 0) - 8 * (tilt.def ?? 0) + 3 * Math.max(0, l.role.fx.risk ?? 0);
        // no último terço, quem é de área ataca o espaço (cruzamento, infiltração); antes disso, respeita a linha de impedimento
        d += ATT_PUSH[l.slot] ?? 0;
        // com três zagueiros atrás, o lateral apoia como ala
        if ((l.slot === 'LB' || l.slot === 'RB') && nCB >= 3) d += FB_BACK3_PUSH;
        // (função finalizadora ataca mais a área; função de apoio, menos)
        const run = clampN(RUN[l.slot] + (l.slot === 'CM' || l.slot === 'LM' || l.slot === 'RM' || l.slot === 'AM' ? lone : 0) + 1.5 * (tilt.att ?? 0) - 1.2 * (tilt.def ?? 0) + 0.1 * mt + 0.6 * ((l.role.fx.shoot ?? 1) - 1), 0, 1);
        // a corrida cresce conforme a bola avança (de 58 m até 85 m de profundidade)
        const go = run * clampN((bd - 58) / 27, 0, 1);
        if (go > 0) d = Math.max(d, d + (L - 13 + 5 * sy * (ball.y < MID_Y ? -1 : 1) - d) * go);
        d += K2.wander * wx;
        const wf = 0.8 + 0.07 * (tac.width - 3);
        yy = MID_Y + sy * 31 * wf + (ball.y - MID_Y) * 0.18 + K2.wander * 1.2 * wy;
        // quem está perto do portador se aproxima para dar a opção de passe (apoio)
        if (hOwn && hOwn !== l) {
          const hdp = depthOf(t.idx, hOwn.pos.x), hy = hOwn.pos.y - yy;
          if (Math.abs(hdp - d) < 22 && Math.abs(hy) < 22) { d += (hdp - d) * K2.support; yy += hy * K2.support; }
        }
        d = Math.min(d, Math.max(offLine - 0.5, go > 0.45 ? L - 7 : 0));
      } else {
        // a linha segura uns 10–11 m (marca do pênalti) enquanto a bola não entra na área; quem infiltra fica com o marcador
        const floor = bd < 18 ? 5.5 : 10.5;
        // mentalidade: a ofensiva adianta muito a linha (espaço às costas); a defensiva recua pouco e encurta o bloco (abaixo)
        const line = Math.max(floor, Math.min(clampN(9 + 0.42 * bd + 4 * (tac.defensiveLine - 3) + (mt > 0 ? K2.mtLineUp : K2.mtLineDown) * mt + K2.riskLine * t.fx.risk, 6, 44), bd - 2, deepest - 0.8));
        // sem a bola todo time recompõe num bloco compacto: quem joga mais à frente recua para perto da linha do meio
        // (o centroavante fica uns 20 m à frente da defesa), e quem joga aberto fecha por dentro
        d = line + DEF_DEPTH[l.slot] * (1 + K2.mtCompact * mt) + 4 * (tilt.att ?? 0) - 4 * (tilt.def ?? 0);
        // (a linha de defesa não oscila: só quem joga à frente dela)
        if (DEF_DEPTH[l.slot] > 3) d += K2.wanderDef * wx;
        const wDef = l.slot === 'CB' && nCB === 2 ? CB_PAIR_WIDTH : DEF_WIDTH[l.slot];
        yy = MID_Y + sy * 31 * wDef + (ball.y - MID_Y) * 0.36 + K2.wanderDef * wy;
      }
      l.tgt = { x: xOf(t.idx, clampN(d, 4, 101)), y: clampN(yy, 1.5, W - 1.5) };
    }
    if (!attacking) {
      // marcação: os atacantes mais perigosos (mais perto do gol) são cobertos primeiro, cada um pelo defensor livre mais próximo,
      // sempre pelo lado do próprio gol; quem sobra fica na zona. Assim toda formação cobre o meia entre linhas e quem ataca a área.
      const goalX = xOf(t.idx, 0);
      // (sem alocar: roda a cada ação)
      let nT = 0;
      for (const a of o.active) {
        if (a.slot === 'GK') continue;
        const px = a.pos.x * 0.35 + a.tgt.x * 0.65, py = a.pos.y * 0.35 + a.tgt.y * 0.65;
        const dd = depthOf(t.idx, px) + Math.abs(py - MID_Y) * 0.6;
        if (dd >= 52) continue;
        // inserção ordenada (no máximo 10)
        let k = nT++;
        while (k > 0 && thD[k - 1]! > dd) { thD[k] = thD[k - 1]!; thX[k] = thX[k - 1]!; thY[k] = thY[k - 1]!; k--; }
        thD[k] = dd; thX[k] = px; thY[k] = py;
      }
      let nF = 0;
      for (const l of t.active) if (l.slot !== 'GK') freeL[nF++] = l;
      for (let i = 0; i < nT; i++) {
        const px = thX[i]!, py = thY[i]!;
        let mi = -1, md2 = 256;
        for (let j = 0; j < nF; j++) { const l = freeL[j]!, dx = l.tgt.x - px, dy = l.tgt.y - py, d2 = dx * dx + dy * dy; if (d2 < md2) { md2 = d2; mi = j; } }
        if (mi < 0) continue;
        const mk = freeL[mi]!;
        freeL[mi] = freeL[--nF]!;
        const md = Math.sqrt(md2);
        const k = clampN((thD[i]! < 30 ? 0.85 : 0.6) * (1 - md / 22), 0.15, 0.85);
        const gx = px + Math.sign(goalX - px) * 1.4, gy = py + (MID_Y - py) * 0.08;
        mk.tgt = { x: mk.tgt.x + (gx - mk.tgt.x) * k, y: mk.tgt.y + (gy - mk.tgt.y) * k };
      }
      // pressão: os mais próximos vão na bola, conforme a pressão escolhida e a altura da bola
      const reach = 48 + 12 * (tac.pressing - 1);
      if (depthOf(t.idx, ball.x) <= reach) {
        // os dois mais próximos da bola (varredura simples: isto roda a cada ação)
        let n0: Live | null = null, n1: Live | null = null, d0 = Infinity, d1 = Infinity;
        for (const l of t.active) {
          if (l.slot === 'GK') continue;
          const dx = l.pos.x - ball.x, dy = l.pos.y - ball.y, dd = dx * dx + dy * dy;
          if (dd < d0) { n1 = n0; d1 = d0; n0 = l; d0 = dd; } else if (dd < d1) { n1 = l; d1 = dd; }
        }
        // perto do próprio gol, o mais próximo fecha de verdade no portador (sempre); mais à frente, conforme a pressão escolhida
        const own = depthOf(t.idx, ball.x);
        const k1 = own < 40 ? 0.88 : clampN(0.5 + 0.12 * (tac.pressing - 3), 0.2, 0.85);
        const goal = { x: xOf(t.idx, 0), y: MID_Y };
        const toward = (l: Live, k: number) => {
          const gx = goal.x - ball.x, gy = goal.y - ball.y, gl = Math.sqrt(gx * gx + gy * gy) || 1;
          const spot = { x: ball.x + (gx / gl) * 1.2, y: ball.y + (gy / gl) * 1.2 };
          l.tgt = { x: l.tgt.x + (spot.x - l.tgt.x) * k, y: l.tgt.y + (spot.y - l.tgt.y) * k };
        };
        if (n0) toward(n0, k1);
        if (n1 && (tac.pressing >= 3 || own < 40)) toward(n1, own < 40 ? 0.45 : k1 * 0.45);
      }
    }
  }
  /** move todos durante `dt` segundos em direção à forma calculada com a bola onde ela está agora */
  const moveAll = (dt: number): void => {
    shape(T[poss], true); shape(T[1 - poss as Side], false);
    for (const t of T) for (const l of t.active) {
      if (l === holder) continue;
      const dx = l.tgt.x - l.pos.x, dy = l.tgt.y - l.pos.y, d = Math.sqrt(dx * dx + dy * dy), step = q.speed(l) * dt;
      if (d <= step) l.pos = { ...l.tgt }; else l.pos = { x: l.pos.x + (dx / d) * step, y: l.pos.y + (dy / d) * step };
    }
    if (holder) holder.pos = { ...ball };
  };
  /** defensores de `def` entre o ponto e o gol que ele defende (até 14 m à frente, abrindo para os lados): fecham o caminho */
  const cover = (def: TeamState, p: P): number => {
    const att: Side = (1 - def.idx) as Side, pd = depthOf(att, p.x);
    let n = 0;
    for (const o of def.active) {
      const od = depthOf(att, o.pos.x) - pd;
      if (od < 0.5 || od > 14) continue;
      const lat = Math.abs(o.pos.y - (p.y + (MID_Y - p.y) * (od / Math.max(1, L - pd))));
      if (lat < 3 + od * 0.45) n += o.slot === 'GK' ? 0.6 : 1;
    }
    return n;
  };
  const nearest = (t: TeamState, p: P, exclude?: Live | null): { l: Live | null; d: number } => {
    let best: Live | null = null, bd = Infinity;
    for (const l of t.active) { if (l === exclude) continue; const dx = l.pos.x - p.x, dy = l.pos.y - p.y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = l; } }
    return { l: best, d: Math.sqrt(bd) };
  };

  // ---------- trajeto ----------
  const tracking = !!opts.track;
  let tbuf = new Uint8Array(tracking ? 120_000 : 0), tlen = 0, tframes = 0;
  const trackIds: [string[], string[]] = [T[0].all.map((l) => l.p.id), T[1].all.map((l) => l.p.id)];
  const half = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v * 2)));
  const frame = (kind: TrackKind): void => {
    if (!tracking) return;
    const size = TRACK_HEAD + 4 * TRACK_SLOTS;
    if (tlen + size > tbuf.length) { const nb = new Uint8Array(tbuf.length * 2); nb.set(tbuf); tbuf = nb; }
    const b = tbuf, o = tlen;
    b[o] = tickNo >> 8; b[o + 1] = tickNo & 255; b[o + 2] = Math.min(255, Math.round(secInTick * 4)); b[o + 3] = TRACK_KIND.indexOf(kind);
    b[o + 4] = holder ? poss : 2; b[o + 5] = holder ? holder.ti : 255; b[o + 6] = half(ball.x, 210); b[o + 7] = half(ball.y, 136);
    b.fill(255, o + TRACK_HEAD, o + size);
    for (const t of T) for (const l of t.active) {
      if (l.ti >= TRACK_SLOTS) continue;
      const k = o + TRACK_HEAD + (t.idx * TRACK_SLOTS + l.ti) * 2;
      b[k] = half(l.pos.x, 210); b[k + 1] = half(l.pos.y, 136);
    }
    tlen += size; tframes++;
  };

  // ---------- análise pós-jogo (só observa) ----------
  const an = opts.detail ? createAnalysis() : null;
  const sampleAll = (dt: number): void => {
    if (!an) return;
    const ps: Array<{ id: string; pos: P }> = [];
    for (const t of T) for (const l of t.active) ps.push({ id: l.p.id, pos: l.pos });
    an.sample(dt, tickNo, ps, holder ? poss : null, ball);
  };
  const longPass = (d: number) => (d > 30 ? PASS_LONG : 0);

  // ---------- posse ----------
  const giveBall = (l: Live, at: P, regain: boolean): void => {
    const side = sideOf(l);
    if (side !== poss || regain) { regainAt = gameSec; regainDepth = depthOf(side, at.x); possActions = 0; lastPass = null; }
    poss = side; holder = l; ball = onPitch(at); l.pos = { ...ball };
  };
  const setRestart = (r: Restart): void => { restart = r; holder = null; lastPass = null; };

  // ---------- cartões, lesões e substituições (iguais à v1) ----------
  const removeFromPitch = (t: TeamState, l: Live): void => {
    l.out = true;
    t.active = t.active.filter((x) => x !== l);
    if (holder === l) { holder = null; if (!restart) setRestart({ kind: 'freekick', team: opp(t).idx, at: { ...ball } }); }
  };
  const ensureGoalkeeper = (t: TeamState): void => {
    if (t.active.some((l) => l.slot === 'GK') || t.active.length === 0) return;
    const gkBench = t.bench.filter((b) => b.position === 'GK');
    if (gkBench.length && t.subsUsed < subCap() && controlled(t)) {
      const emergency = [...t.active].sort((a, b) => b.p.attributes.technical.goalkeeping - a.p.attributes.technical.goalkeeping)[0]!;
      emergency.slot = 'GK'; setRole(emergency);
      suggestions.push(suggestion(t, emergency, gkBench[0]!, 'GK', 'goalkeeper'));
      return;
    }
    if (gkBench.length && t.subsUsed < subCap()) {
      const victim = [...t.active].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0]!;
      doSub(t, victim, gkBench[0]!, 'GK', 'gk_replacement');
      return;
    }
    const emergency = [...t.active].sort((a, b) => b.p.attributes.technical.goalkeeping - a.p.attributes.technical.goalkeeping)[0]!;
    emergency.slot = 'GK'; setRole(emergency);
  };
  const doSub = (t: TeamState, out: Live, inP: MatchPlayer, slot: Position, detail?: string, roleId?: string): void => {
    const m = clock.minute;
    out.rep.subbedOutAt = m;
    const wasHolder = holder === out;
    removeFromPitch(t, out);
    t.bench = t.bench.filter((b) => b.id !== inP.id);
    t.subsUsed++;
    const f0 = startFatigue(inP.condition);
    const live = { p: inP, slot, x: out.x, y: out.y, pos: { ...out.pos }, tgt: { ...out.tgt }, fatigue: f0, f0, yellow: 0, out: false, rep: newReport(inP, t.idx, slot, false, m), m: 1, ti: t.all.length } as Live;
    setRole(live, roleId);
    t.active.push(live); t.all.push(live); trackIds[t.idx].push(inP.id);
    if (wasHolder && restart?.kind === 'freekick' && restart.team !== t.idx) restart = null; // troca com a bola parada: não vira falta
    if (wasHolder && !restart) giveBall(live, ball, false);
    emit('substitution', t.idx, { player: inP.id, player2: out.p.id, detail });
    refresh(t);
  };
  const bestBenchFor = (t: TeamState, slot: Position): MatchPlayer | null => {
    const pool = t.bench.filter((b) => (slot === 'GK' ? b.position === 'GK' : b.position !== 'GK'));
    if (!pool.length) return null;
    return [...pool].sort((a, b) => effective(b, slot) - effective(a, slot))[0]!;
  };
  const handleInjury = (t: TeamState, l: Live): void => {
    const days = rng.weighted([2, 5, 10, 21, 45, 90], [30, 28, 20, 12, 7, 3]);
    l.rep.injuredDays = days;
    emit('injury', t.idx, { player: l.p.id, days });
    const wasGk = l.slot === 'GK';
    const repl = bestBenchFor(t, l.slot);
    if (repl && t.subsUsed < subCap() && controlled(t)) suggestions.push(suggestion(t, l, repl, l.slot, 'injury', days));
    if (repl && t.subsUsed < subCap() && !controlled(t)) doSub(t, l, repl, l.slot, 'injury');
    else { l.rep.subbedOutAt = clock.minute; removeFromPitch(t, l); if (wasGk) ensureGoalkeeper(t); }
    refresh(t);
  };
  const giveCard = (t: TeamState, l: Live, force?: 'red'): void => {
    if (!force) {
      l.yellow++;
      l.rep.yellow++; t.stats.yellowCards++;
      emit('yellow_card', t.idx, { player: l.p.id });
      if (l.yellow < 2) return;
      if (t.active.length <= 7) { l.yellow = 1; return; }
      emit('red_card', t.idx, { player: l.p.id, detail: 'second_yellow' });
    } else emit('red_card', t.idx, { player: l.p.id, detail: 'straight' });
    l.rep.red++; t.stats.redCards++;
    l.rep.subbedOutAt = clock.minute;
    const wasGk = l.slot === 'GK';
    removeFromPitch(t, l);
    if (wasGk) ensureGoalkeeper(t);
    refresh(t);
  };

  // ---------- finalização ----------
  const at = (p: P) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  const goalkeeperOf = (t: TeamState) => t.active.find((l) => l.slot === 'GK') ?? null;
  const registerGoal = (att: TeamState, shooter: Live, passer: Live | null, chance: ChanceType, xg: number, where: P): void => {
    const def = opp(att);
    att.goals++;
    shooter.rep.goals++;
    if (passer) passer.rep.assists++;
    const gk = goalkeeperOf(def);
    if (gk) gk.rep.goalsConceded++;
    emit('goal', att.idx, { player: shooter.p.id, player2: passer?.p.id, chance, outcome: 'goal', xg: Math.round(xg * 100) / 100, ...at(where) });
    ball = { ...oppGoal(att.idx) }; holder = null;
    frame('goal');
    setRestart({ kind: 'kickoff', team: def.idx, at: { x: L / 2, y: MID_Y } });
  };
  /**
   * Chute de `shooter` do ponto `from`. O xG é o da posição (cabeceio pesa menos), reduzido pela pressão de quem está no caminho; a
   * qualidade de quem chuta e a do goleiro mudam a conversão em torno do xG (média igual ao xG para jogadores médios).
   */
  const shoot = (att: TeamState, shooter: Live, from: P, chance: ChanceType, header: boolean, passer: Live | null): number => {
    const def = opp(att), goal = oppGoal(att.idx), gk = goalkeeperOf(def);
    let lane = 0;
    for (const o of def.active) {
      if (o.slot === 'GK') continue;
      const s = segDist(o.pos, from, goal);
      if (s.t > 0.05 && s.t < 0.98) lane += Math.exp(-(s.d * s.d) / 1.6);
    }
    const near = nearest(def, from).d;
    const pressF = clampN(1 - 0.12 * lane - (near < 1.5 ? 0.1 : near < 3 ? 0.05 : 0), 0.5, 1);
    const base = chance === 'penalty' ? 0.76 : chance === 'freekick' ? xgAt(att.idx, from, false) * 0.7 : xgAt(att.idx, from, header);
    // proteção da área: o time na defensiva fica do lado do gol e se joga na frente da bola; na ofensiva, chega atrasado
    // (quem goleia por 3+ relaxa atrás também: a vantagem já está garantida)
    const defLead = def.goals - att.goals;
    const org = chance === 'penalty' ? 1 : (1 + K2.mtOrg * ment(def) + K2.riskOrg * def.fx.risk) * (defLead >= 3 ? 1 + K2.leadRelax * (defLead - 2) : 1);
    const xg = clampN(base * (chance === 'penalty' ? 1 : pressF) * org * (conditions.weather === 'rain' ? 0.95 : 1), 0.01, 0.85);
    const longShot = !header && dist(from, goal) > 22;
    const skill = clampN((header ? q.head(shooter) : longShot || chance === 'freekick' ? q.long(shooter) : q.finish(shooter)), 0.1, 1.1);
    const gkSkill = gk ? clampN(q.gk(gk), 0.12, 1.1) : 0.12;
    const gkMod = clampN(Math.pow(0.685 / gkSkill, 0.9), 0.72, K2.gkModMax);
    const finishMod = 0.55 + 0.9 * skill;
    const pBlock = chance === 'penalty' ? 0 : clampN(0.05 + 0.22 * lane, 0.03, 0.5);
    const pOff = chance === 'penalty' ? clampN(0.12 - 0.1 * (skill - 0.5), 0.05, 0.2) : clampN(0.54 - 0.3 * (skill - 0.5) + 0.006 * (dist(from, goal) - 14), 0.32, 0.78);
    const g = clampN((xg * finishMod * gkMod) / ((1 - pBlock) * (1 - pOff)), 0.01, 0.97);

    att.stats.shots++; att.stats.xg += xg; shooter.rep.shots++; shooter.rep.xg += xg;
    an?.shot(att.idx, tickNo, xg);
    if (passer && passer !== shooter) { passer.rep.keyPasses++; att.stats.chancesCreated++; an?.keyPass(passer.p.id); }
    let outcome: ShotOutcome;
    if (rng.next() < pBlock) { outcome = 'blocked'; att.stats.shotsBlocked++; }
    else if (rng.next() < pOff) outcome = rng.chance(0.07) ? 'post' : 'off_target';
    else { att.stats.shotsOnTarget++; shooter.rep.shotsOnTarget++; outcome = rng.next() < g ? 'goal' : 'saved'; }
    if (outcome === 'goal') { registerGoal(att, shooter, passer && passer !== shooter && rng.chance(0.92) ? passer : null, chance, xg, from); return xg; }
    if (outcome === 'saved' && gk) { gk.rep.saves++; def.stats.saves++; }
    emit('shot', att.idx, { player: shooter.p.id, player2: outcome === 'saved' ? gk?.p.id : undefined, chance, outcome, xg: Math.round(xg * 100) / 100, ...at(from) });
    // continuação: escanteio, rebote ou tiro de meta
    ball = { x: xOf(att.idx, L - 2), y: MID_Y + (rng.next() - 0.5) * 14 };
    holder = null;
    frame(outcome === 'saved' ? 'save' : 'shot');
    const pCorner = outcome === 'saved' ? 0.3 : outcome === 'blocked' ? 0.38 : outcome === 'post' ? 0.2 : 0;
    if (rng.chance(pCorner)) { setRestart({ kind: 'corner', team: att.idx, at: { x: xOf(att.idx, L - 0.5), y: rng.chance(0.5) ? 0.5 : W - 0.5 } }); return xg; }
    if (outcome === 'off_target' || outcome === 'post') { setRestart({ kind: 'goalkick', team: def.idx, at: { x: xOf(def.idx, 5.5), y: MID_Y } }); return xg; }
    // rebote: quem estiver mais perto da bola (defesa tem vantagem)
    const loose = { x: xOf(att.idx, L - 10 - rng.next() * 8), y: MID_Y + (rng.next() - 0.5) * 24 };
    const nd = nearest(def, loose), na = nearest(att, loose, shooter);
    const attWins = na.l && (!nd.l || rng.next() < 0.32 * (nd.d + 1) / (na.d + nd.d + 2));
    if (attWins && na.l) giveBall(na.l, loose, false); else if (nd.l) { an?.recovery(nd.l.p.id, loose); giveBall(nd.l, loose, true); }
    return xg;
  };

  const chanceType = (att: TeamState, from: P, header: boolean, cross: boolean): ChanceType => {
    if (cross || header) return 'cross';
    if (dist(from, oppGoal(att.idx)) > 22) return 'long';
    if (gameSec - regainAt < 13 && possActions <= 4 && regainDepth < 65) return 'counter';
    return 'buildup';
  };

  // ---------- faltas ----------
  const foul = (def: TeamState, fouler: Live, victim: Live | null, where: P): void => {
    const att = opp(def);
    def.stats.fouls++; fouler.rep.fouls++;
    an?.def(fouler.p.id, 'foul', where);
    emit('foul', def.idx, { player: fouler.p.id, player2: victim?.p.id, ...at(where) });
    frame('foul');
    const box = inBox(att.idx, where);
    const aggr = a20(fouler.p.attributes.mental.aggression);
    const disc = cardMultiplier(def.sheet.coach);
    // quem já tem amarelo comete faltas mais leves (e o árbitro hesita no segundo)
    const pYellow = clampN(0.07 + 0.12 * aggr + (box ? 0.12 : 0) + (depthOf(att.idx, where.x) > 70 ? 0.05 : 0), 0.03, 0.55) * disc * (fouler.yellow > 0 ? 0.4 : 1);
    const pRed = (0.0011 + 0.0025 * aggr + (box && depthOf(att.idx, where.x) > 95 ? 0.01 : 0)) * disc;
    const rc = rng.next();
    if (def.active.length > 8 && rc < pRed) giveCard(def, fouler, 'red');
    else if (rc < pRed + pYellow) giveCard(def, fouler);
    if (box) setRestart({ kind: 'penalty', team: att.idx, at: { x: xOf(att.idx, L - 11), y: MID_Y }, fouled: victim });
    else setRestart({ kind: 'freekick', team: att.idx, at: onPitch(where), fouled: victim });
  };

  // ---------- jogada: uma ação de quem está com a bola ----------
  type Option = { kind: 'pass' | 'through' | 'carry' | 'shot' | 'cross' | 'clear'; u: number; to?: Live; target?: P; pOK: number; header?: boolean; race?: number; acc?: number };
  const playStep = (): number => {
    if (restart) return doRestart();
    const att = T[poss], def = opp(att);
    let c = holder;
    if (!c || c.out) { // bola sem dono: o mais perto pega
      const na = nearest(att, ball), nd = nearest(def, ball);
      const l = (na.d <= nd.d ? na.l : nd.l) ?? na.l ?? nd.l;
      if (!l) return 5;
      if (an && sideOf(l) !== poss) an.recovery(l.p.id, ball);
      giveBall(l, ball, sideOf(l) !== poss);
      return 1.5;
    }
    possActions++;
    an?.touch(c.p.id);
    shape(att, true); shape(def, false);
    const cd = depthOf(att.idx, c.pos.x);
    const tac = att.tac, dtac = def.tac;

    // ---- pressão e desarme antes da ação
    const nOpp = nearest(def, c.pos);
    if (nOpp.l && nOpp.d < 3 && c.slot !== 'GK') {
      // dentro da própria área o defensor evita o bote (pênalti): fecha o espaço e espera
      const ownBox = inBox(att.idx, c.pos);
      const pTry = clampN(K2.tackleTry * (1 + 0.12 * (dtac.pressing - 3)) * (3 - nOpp.d) / 3 * (nOpp.l.role.fx.tackle ?? 1) * (ownBox ? 0.75 : 1) * (nOpp.l.yellow > 0 ? 0.45 : 1), 0, 0.9);
      if (rng.next() < pTry) {
        const d = nOpp.l;
        const aggr = a20(d.p.attributes.mental.aggression), tk = a20(d.p.attributes.technical.tackling);
        const pFoul = clampN(K2.foul * (ownBox ? 0.9 : 1) * (d.yellow > 0 ? 0.5 : 1) * (0.55 + 0.9 * aggr) * (1.35 - 0.7 * tk) * (1 + 0.08 * (dtac.pressing - 3)) * (d.role.fx.foul ?? 1) * (c.role.fx.victim ?? 1), 0.02, 0.6);
        if (rng.next() < pFoul) { foul(def, d, c, c.pos); return 4; }
        const won = rng.next() < duel(q.tackle(d), (q.dribble(c) + q.hold(c)) / 2, 0.42, 4);
        if (won) {
          d.rep.tackles++; def.stats.tackles++;
          if (an) { an.def(d.p.id, 'tackle', c.pos); an.duel(d.p.id, c.p.id); an.lost(c.p.id); }
          giveBall(d, c.pos, true);
          frame('tackle');
          return 1.2;
        }
        // driblou: quem tentou fica para trás
        if (an) { an.dribble(c.p.id, true); an.duel(c.p.id, d.p.id); }
        d.pos = { x: d.pos.x + (att.idx === 0 ? -2.5 : 2.5), y: d.pos.y };
      }
    }

    // ---- opções
    const press = clampN((2.6 - nOpp.d) / 2.6, 0, 1);
    const lossCost = K2.loss * (0.5 + Math.pow(1 - cd / L, 2));
    const prog = K2.prog * (1 + 0.15 * (tac.tempo - 3)) * (1 + K2.mtProg * ment(att)) * ease(att);
    const accAdj = (tac.buildUp === 'short' ? 0.015 : tac.buildUp === 'long' ? -0.03 : 0) + 0.004 * att.fx.build - 0.012 * (dtac.pressing - 3)
      - (conditions.weather === 'rain' ? 0.02 : 0) - (conditions.pitch === 'poor' ? 0.02 : 0);
    const passQ = q.pass(c);
    // leitura de jogo de cada defensor (usada em todas as linhas de passe desta decisão)
    const dA = def.active, nD = dA.length;
    const readOf: number[] = new Array(nD);
    for (let j = 0; j < nD; j++) readOf[j] = 0.65 + 0.4 * q.read(dA[j]!);
    const opts2: Option[] = [];
    const tc = threat(att.idx, c.pos);
    for (const r of att.active) {
      if (r === c) continue;
      if (r.slot === 'GK' && cd > 42) continue;
      const d = dist(c.pos, r.pos);
      if (d < 3 || d > 58) continue;
      // linha do passe: o defensor mais bem posto para cortar (distância à trajetória, calculada aqui sem alocar: laço quente)
      let lane = 0;
      const vx = r.pos.x - c.pos.x, vy = r.pos.y - c.pos.y, len2 = vx * vx + vy * vy;
      for (let j = 0; j < nD; j++) {
        const op = dA[j]!.pos;
        const st = len2 > 0 ? clampN(((op.x - c.pos.x) * vx + (op.y - c.pos.y) * vy) / len2, 0, 1) : 0;
        if (st < 0.08) continue;
        const ex = c.pos.x + vx * st - op.x, ey = c.pos.y + vy * st - op.y;
        const rad = 0.85 + 0.075 * d * st, z = (ex * ex + ey * ey) / (rad * rad);
        if (z > 6) continue; // longe da trajetória: não corta (e^−6 ≈ 0,002)
        const th = Math.exp(-z) * readOf[j]!;
        if (th > lane) lane = th;
      }
      const rd = depthOf(att.idx, r.pos.x);
      const mk = nearest(def, r.pos);
      const open = clampN((mk.d - 0.8) / 5, 0, 1) * (rd > 70 ? Math.pow(0.88, cover(def, r.pos)) : 1);
      // receber com marcador colado é uma disputa (domínio e corpo de quem recebe × leitura e desarme de quem marca)
      const recv = mk.l && mk.d < 3 ? 1 - Math.exp(-(mk.d * mk.d) / 2.6) * (1 - duel(q.hold(r), q.tackle(mk.l), 0.55, 4)) * 1.2 : 1;
      const lenPen = 0.0018 * d + 0.006 * Math.max(0, d - 25);
      let pOK = (1 - lenPen) * (0.835 + 0.14 * passQ) * (1 - 0.9 * lane) * (0.9 + 0.1 * open) * clampN(recv, 0.2, 1) * (1 - 0.1 * press) + accAdj;
      pOK = clampN(pOK, 0.03, 0.985);
      const fwd = (depthOf(att.idx, r.pos.x) - cd) / L;
      // valor de receber ali: a ameaça da posição, menor se quem recebe estiver marcado (não chutaria livre)
      // (perto da área, quem tem função finalizadora vale mais como alvo)
      let u = pOK * (K2.val * threat(att.idx, r.pos) * (rd > 70 ? (0.45 + 0.55 * open) * (r.role.fx.shoot ?? 1) : 1) + prog * fwd + K2.keep) - (1 - pOK) * lossCost;
      // saída curta: aproxima e evita a bola longa; saída longa: procura a bola longa para frente e pula o meio
      if (tac.buildUp === 'short') u += d < 18 ? 0.007 : d > 24 ? -0.012 * (d - 24) / 4 : 0;
      if (tac.buildUp === 'long') u += d > 24 && fwd > 0.08 ? 0.02 : d < 15 ? -0.006 : 0;
      u += 0.003 * ((r.role.fx.pass ?? 1) - 1) + 0.002 * ((c.role.fx.pass ?? 1) - 1);
      opts2.push({ kind: 'pass', u, to: r, pOK });
    }
    // passe em profundidade: a bola no espaço às costas da linha para quem corre no limite do impedimento.
    // É uma corrida entre quem ataca e quem defende (cada um com a sua velocidade e distância); a linha alta deixa mais espaço.
    {
      let offLine = 0;
      for (const o of def.active) if (o.slot !== 'GK') offLine = Math.max(offLine, depthOf(att.idx, o.pos.x));
      const space = L - 5 - offLine;
      if (space > 9 && offLine > cd - 4) {
        let best: Option | null = null;
        for (const r of att.active) {
          if (r === c || r.slot === 'GK') continue;
          const rd = depthOf(att.idx, r.pos.x);
          if (rd < offLine - 7 || rd > offLine + 0.5) continue;
          const tdp = Math.min(offLine + Math.min(space * 0.55, 16), L - 7);
          if (tdp - offLine < 5) continue;
          const target = onPitch({ x: xOf(att.idx, tdp), y: r.pos.y + (MID_Y - r.pos.y) * 0.25 });
          const d = dist(c.pos, target);
          if (d < 8 || d > 48) continue;
          let lane = 0;
          for (const o of def.active) {
            const sg = segDist(o.pos, c.pos, target);
            if (sg.t < 0.08 || sg.t > 0.92) continue;
            const rad = 0.85 + 0.06 * d * sg.t;
            const th = Math.exp(-(sg.d * sg.d) / (rad * rad)) * readOf[dA.indexOf(o)]!;
            if (th > lane) lane = th;
          }
          const tRun = dist(r.pos, target) / q.speed(r);
          let tDef = Infinity;
          for (const o of def.active) {
            const t = o.slot === 'GK' ? dist(o.pos, target) / 6.5 + 0.35 * (1 - (o.role.fx.sweep ?? 0)) : dist(o.pos, target) / q.speed(o) + 0.3 * (1.2 - q.read(o));
            if (t < tDef) tDef = t;
          }
          const race = 1 / (1 + Math.exp(-1.8 * (tDef - tRun - K2.thruLag)));
          const acc = clampN((0.6 + 0.32 * passQ) * (1 - 0.85 * lane) - 0.004 * Math.max(0, d - 25) + accAdj, 0.05, 0.93);
          const pOK = acc * race;
          const fwd = (tdp - cd) / L;
          const u = pOK * (K2.val * threat(att.idx, target) * (0.5 + 0.5 * race) + prog * fwd) - (1 - pOK) * lossCost * 0.9 + 0.004 * ((r.role.fx.offside ?? 1) - 1) + 0.003 * ((c.role.fx.pass ?? 1) - 1);
          if (!best || u > best.u) best = { kind: 'through', u, to: r, target, pOK, race, acc } as Option;
        }
        if (best) opts2.push(best);
      }
    }
    // condução / drible
    if (c.slot !== 'GK') {
      const gx = (att.idx === 0 ? 1 : -1), toC = (MID_Y - c.pos.y) * (cd > 72 ? 0.35 : 0.08);
      let target = onPitch({ x: c.pos.x + gx * 7, y: c.pos.y + toC });
      if (depthOf(att.idx, target.x) > L - 5) target = { x: xOf(att.idx, L - 5), y: target.y };
      // quem está no caminho (goleiro incluído): cada um perto da trajetória é uma disputa; o mais perto decide, os outros dificultam
      let blocker: Live | null = null, bdist = Infinity, crowd = 0;
      for (const o of def.active) {
        const sd = segDist(o.pos, c.pos, target);
        if (sd.t < 0.05) continue;
        if (sd.d < bdist) { bdist = sd.d; blocker = o; }
        crowd += Math.exp(-(sd.d * sd.d) / 6);
      }
      const cv = cover(def, c.pos);
      const dribble = !!blocker && bdist < 3;
      const pOK = dribble && blocker ? duel(q.dribble(c), blocker.slot === 'GK' ? q.gk(blocker) : q.tackle(blocker), clampN(0.55 - 0.1 * (crowd - 1), 0.12, 0.55), 4)
        : clampN(0.97 - 0.1 * press - 0.08 * crowd, 0.6, 0.98);
      const pOKc = pOK * Math.pow(0.86, Math.max(0, cv - 1));
      const fwd = (depthOf(att.idx, target.x) - cd) / L;
      const tOpen = clampN((nearest(def, target).d - 0.8) / 5, 0, 1);
      const u = pOKc * (K2.val * threat(att.idx, target) * (depthOf(att.idx, target.x) > 70 ? 0.45 + 0.55 * tOpen : 1) + prog * fwd * 1.1 + K2.keep * 0.6) - (1 - pOKc) * lossCost + 0.004 * (a20(c.p.attributes.technical.dribbling) - 0.5);
      opts2.push({ kind: 'carry', u, target, pOK: pOKc });
    }
    // chute
    const goalD = dist(c.pos, oppGoal(att.idx));
    if (c.slot !== 'GK' && cd > 66 && goalAngle(att.idx, c.pos) > 0.08) {
      const longShot = goalD > 22;
      const xg0 = xgAt(att.idx, c.pos, false) * (1 - 0.35 * press);
      const fxs = Math.pow(longShot ? c.role.fx.long ?? 1 : c.role.fx.shoot ?? 1, 1.5);
      const urgency = clock.minute >= 75 && att.goals < def.goals ? 1.15 : 1;
      const mt = ment(att);
      const u = K2.shot * xg0 * fxs * (longShot ? 0.25 + 0.6 * a20(c.p.attributes.technical.longShots) : 1) * (1 + K2.mtShot * mt) * urgency * ease(att) - K2.shotCost;
      opts2.push({ kind: 'shot', u, pOK: 1 });
    }
    // cruzamento (pelo corredor, perto da área)
    if (Math.abs(c.pos.y - MID_Y) > 12 && cd > 74) {
      let best: Option | null = null;
      for (const r of att.active) {
        if (r === c || r.slot === 'GK' || depthOf(att.idx, r.pos.x) < L - 21 || Math.abs(r.pos.y - MID_Y) > 18) continue;
        const marker = nearest(def, r.pos);
        const win = duel(q.head(r), marker.l ? q.aerialDef(marker.l) : 0.2, 0.42, 4);
        const acc = clampN(0.38 + 0.45 * q.cross(c), 0.2, 0.85);
        const pOK = acc * win;
        const xh = xgAt(att.idx, r.pos, true);
        const u = pOK * K2.shot * xh * 1.15 * (c.role.fx.cross ?? 1) * (r.role.fx.head ?? 1) * (1 + 0.06 * (tac.width - 3)) - (1 - pOK) * lossCost * 0.6 - K2.shotCost * 0.5;
        if (!best || u > best.u) best = { kind: 'cross', u, to: r, pOK, header: true };
      }
      if (best) opts2.push(best);
    }
    // afastar (pressionado perto do próprio gol)
    if (cd < 32 && press > 0.4) opts2.push({ kind: 'clear', u: -lossCost * 0.5 + 0.004, pOK: 0.6 });
    if (!opts2.length) return 2;

    const beta = K2.beta * (0.7 + 0.6 * a20(c.p.attributes.mental.decisions));
    const umax = Math.max(...opts2.map((o) => o.u));
    const ws = opts2.map((o) => Math.exp(beta * (o.u - umax)));
    const choice = rng.weighted(opts2, ws);
    return resolve(att, def, c, choice, tc);
  };

  const resolve = (att: TeamState, def: TeamState, c: Live, o: Option, _tc: number): number => {
    const from = { ...c.pos };
    if (o.kind === 'shot') {
      const passer = lastPass && lastPass.to === c ? lastPass.from : null;
      shoot(att, c, from, chanceType(att, from, false, false), false, passer);
      return 2;
    }
    if (o.kind === 'pass' && o.to) {
      const r = o.to, d = dist(from, r.pos);
      c.rep.passes++; att.stats.passes++;
      const fwd = depthOf(att.idx, r.pos.x) - depthOf(att.idx, from.x);
      // impedimento: passe para frente a um atacante que joga no limite da linha
      if (fwd > 8 && (ATTACKERS.has(r.slot) || r.slot === 'AM') && depthOf(att.idx, r.pos.x) > 60) {
        const pOff = K2.offside * (r.role.fx.offside ?? 1) * (1 + 0.2 * (def.tac.defensiveLine - 3)) * (1.25 - 0.5 * a20(r.p.attributes.mental.decisions));
        if (rng.next() < pOff) {
          att.stats.offsides++;
          emit('offside', att.idx, { player: r.p.id, ...at(r.pos) });
          if (an) { an.pass(c.p.id, from, r.pos, longPass(d)); an.lost(c.p.id); }
          ball = { ...r.pos }; holder = null; frame('out');
          setRestart({ kind: 'freekick', team: def.idx, at: { ...r.pos } });
          return 2 + d / 15;
        }
      }
      if (rng.next() < o.pOK) {
        c.rep.passesCompleted++; att.stats.passesCompleted++;
        lastPass = { from: c, to: r, cross: false };
        an?.pass(c.p.id, from, r.pos, PASS_OK | longPass(d));
        holder = r; ball = { ...r.pos };
        moveAll(0.6 + d / 15);
        frame('pass');
        return K2.passT + d / 14;
      }
      // passe errado: interceptado no caminho ou para fora
      const wide = r.pos.y < 4 || r.pos.y > W - 4;
      if (wide || (d > 30 && rng.chance(0.3))) {
        ball = onPitch({ x: r.pos.x, y: r.pos.y < MID_Y ? 0.5 : W - 0.5 }); holder = null; frame('out');
        if (an) { an.pass(c.p.id, from, ball, longPass(d)); an.lost(c.p.id); }
        if (depthOf(att.idx, ball.x) > L - 1.5) setRestart({ kind: 'goalkick', team: def.idx, at: { x: xOf(def.idx, 5.5), y: MID_Y } });
        else setRestart({ kind: 'throw', team: def.idx, at: { ...ball } });
        return 1 + d / 15;
      }
      let best: Live | null = null, bt = -1, bp: P = r.pos;
      for (const x of def.active) {
        const s = segDist(x.pos, from, r.pos);
        const v = Math.exp(-(s.d * s.d) / 4) * (0.6 + 0.4 * q.read(x)) + (s.t > 0.9 ? 0.2 : 0);
        if (v > bt) { bt = v; best = x; bp = { x: from.x + (r.pos.x - from.x) * s.t, y: from.y + (r.pos.y - from.y) * s.t }; }
      }
      if (an) { an.pass(c.p.id, from, bp, longPass(d)); an.lost(c.p.id); if (best) an.def(best.p.id, 'interception', bp); }
      if (best) { best.rep.interceptions++; def.stats.interceptions++; giveBall(best, bp, true); }
      moveAll(0.5 + d / 18);
      frame('interception');
      return 0.5 + d / 18 + 0.5;
    }
    if (o.kind === 'through' && o.to && o.target) {
      const r = o.to, tg = o.target, d = dist(from, tg);
      c.rep.passes++; att.stats.passes++;
      // quem corre no limite da linha cai mais no impedimento
      const pOff = K2.offside * 2.2 * (r.role.fx.offside ?? 1) * (1 + 0.2 * (def.tac.defensiveLine - 3)) * (1.25 - 0.5 * a20(r.p.attributes.mental.decisions));
      if (rng.next() < pOff) {
        att.stats.offsides++;
        emit('offside', att.idx, { player: r.p.id, ...at(r.pos) });
        if (an) { an.pass(c.p.id, from, tg, longPass(d)); an.lost(c.p.id); }
        ball = { ...r.pos }; holder = null; frame('out');
        setRestart({ kind: 'freekick', team: def.idx, at: { ...r.pos } });
        return 2 + d / 15;
      }
      const t = dist(r.pos, tg) / q.speed(r);
      if (rng.next() < (o.acc ?? 1)) {
        if (rng.next() < (o.race ?? 1)) {
          c.rep.passesCompleted++; att.stats.passesCompleted++;
          lastPass = { from: c, to: r, cross: false };
          an?.pass(c.p.id, from, tg, PASS_OK | longPass(d));
          r.pos = { ...tg }; holder = r; ball = { ...tg };
          moveAll(t * 0.45);
          frame('pass');
          return 1.2 + t;
        }
        // perdeu a corrida: o defensor (ou o goleiro que sai) chega antes
        let w: Live | null = null, wt = Infinity;
        for (const x of def.active) { const tt = dist(x.pos, tg) / (x.slot === 'GK' ? 6.5 : q.speed(x)); if (tt < wt) { wt = tt; w = x; } }
        ball = { ...tg };
        if (an) { an.pass(c.p.id, from, tg, longPass(d)); an.lost(c.p.id); if (w) { if (w.slot !== 'GK') an.def(w.p.id, 'interception', tg); else an.recovery(w.p.id, tg); } }
        if (w) { if (w.slot !== 'GK') { w.rep.interceptions++; def.stats.interceptions++; } giveBall(w, tg, true); }
        moveAll(t * 0.6);
        frame('interception');
        return 1 + t;
      }
      // passe ruim: cortado no caminho ou longo demais
      if (depthOf(att.idx, tg.x) > L - 12 && rng.chance(0.35)) {
        ball = { ...tg }; holder = null; frame('out');
        if (an) { an.pass(c.p.id, from, tg, longPass(d)); an.lost(c.p.id); }
        setRestart({ kind: 'goalkick', team: def.idx, at: { x: xOf(def.idx, 5.5), y: MID_Y } });
        return 1.5 + d / 15;
      }
      const ic = nearest(def, { x: (from.x + tg.x) / 2, y: (from.y + tg.y) / 2 }).l;
      if (an) { const mid = { x: (from.x + tg.x) / 2, y: (from.y + tg.y) / 2 }; an.pass(c.p.id, from, mid, longPass(d)); an.lost(c.p.id); if (ic) an.def(ic.p.id, 'interception', mid); }
      if (ic) { ic.rep.interceptions++; def.stats.interceptions++; giveBall(ic, { x: (from.x + tg.x) / 2, y: (from.y + tg.y) / 2 }, true); }
      moveAll(0.5 + d / 18);
      frame('interception');
      return 1 + d / 18;
    }
    if (o.kind === 'carry' && o.target) {
      const d = dist(from, o.target), t = d / (q.speed(c) * 0.62) + 0.9;
      if (rng.next() < o.pOK) {
        if (an && o.pOK < 0.9) an.dribble(c.p.id, true);
        ball = { ...o.target }; c.pos = { ...ball };
        moveAll(t);
        frame(o.pOK < 0.9 ? 'dribble' : 'carry');
        return t;
      }
      let tk: Live | null = null, tkd = Infinity;
      for (const x of def.active) { const sd = segDist(x.pos, from, o.target).d; if (sd < tkd) { tkd = sd; tk = x; } }
      if (an) {
        if (o.pOK < 0.9) an.dribble(c.p.id, false);
        an.lost(c.p.id);
        if (tk) { an.def(tk.p.id, 'tackle', { x: (from.x + o.target.x) / 2, y: (from.y + o.target.y) / 2 }); an.duel(tk.p.id, c.p.id); }
      }
      if (tk) { tk.rep.tackles++; def.stats.tackles++; giveBall(tk, { x: (from.x + o.target.x) / 2, y: (from.y + o.target.y) / 2 }, true); }
      moveAll(t * 0.6);
      frame('tackle');
      return t * 0.6;
    }
    if (o.kind === 'cross' && o.to) {
      const r = o.to;
      c.rep.passes++; att.stats.passes++;
      if (rng.next() < o.pOK) {
        c.rep.passesCompleted++; att.stats.passesCompleted++;
        an?.pass(c.p.id, from, r.pos, PASS_OK | PASS_CROSS);
        ball = { ...r.pos }; holder = r;
        moveAll(1.4);
        frame('cross');
        shoot(att, r, { ...r.pos }, 'cross', true, c);
        return 3.2;
      }
      // cruzamento cortado: escanteio ou a defesa fica com a bola
      ball = { ...r.pos }; holder = null; frame('cross');
      if (an) { an.pass(c.p.id, from, r.pos, PASS_CROSS); an.lost(c.p.id); }
      if (rng.chance(0.34)) { setRestart({ kind: 'corner', team: att.idx, at: { x: xOf(att.idx, L - 0.5), y: c.pos.y < MID_Y ? 0.5 : W - 0.5 } }); return 2.5; }
      const cl = nearest(def, r.pos).l;
      if (cl && an) an.def(cl.p.id, 'clearance', r.pos);
      if (cl) giveBall(cl, { x: xOf(att.idx, L - 14 - rng.next() * 14), y: MID_Y + (rng.next() - 0.5) * 30 }, true);
      return 2.6;
    }
    // afastar: bola longa, disputa no meio
    const land = onPitch({ x: xOf(att.idx, depthOf(att.idx, from.x) + 35 + rng.next() * 20), y: MID_Y + (rng.next() - 0.5) * 50 });
    ball = land; holder = null; frame('clearance');
    an?.def(c.p.id, 'clearance', from);
    if (rng.chance(0.15)) { setRestart({ kind: 'throw', team: def.idx, at: { x: land.x, y: land.y < MID_Y ? 0.5 : W - 0.5 } }); return 3; }
    moveAll(2.2);
    const na = nearest(att, land), nd = nearest(def, land);
    const winner = na.l && nd.l ? (rng.next() < duel(q.aerialDef(na.l), q.aerialDef(nd.l), clampN(nd.d / (na.d + nd.d + 0.01), 0.15, 0.85), 3) ? na.l : nd.l) : na.l ?? nd.l;
    if (an && winner) {
      const loser = winner === na.l ? nd.l : na.l;
      if (loser) an.duel(winner.p.id, loser.p.id, true);
      if (sideOf(winner) !== poss) an.recovery(winner.p.id, land);
    }
    if (winner) giveBall(winner, land, sideOf(winner) !== poss);
    return 3;
  };

  // ---------- bola parada ----------
  const doRestart = (): number => {
    const r = restart!;
    restart = null;
    const t = T[r.team], d = opp(t);
    ball = onPitch(r.at); poss = r.team; holder = null;
    if (r.kind === 'kickoff') {
      for (const s of T) { shape(s, s.idx === poss); for (const l of s.active) { l.pos = { ...l.tgt }; const own = depthOf(s.idx, l.pos.x); if (own > L / 2 - 1) l.pos = { x: xOf(s.idx, L / 2 - 1 - (s.idx === poss ? 0 : 8)), y: l.pos.y }; } }
      const taker = [...t.active].filter((l) => l.slot !== 'GK').sort((a, b) => dist(a.pos, ball) - dist(b.pos, ball))[0];
      if (taker) giveBall(taker, ball, true);
      frame('restart');
      return 2;
    }
    if (r.kind === 'penalty') {
      emit('penalty_awarded', t.idx, { player2: r.fouled?.p.id });
      const taker = [...t.active].filter((l) => l.slot !== 'GK').sort((a, b) => (q.finish(b) + a20(b.p.attributes.mental.composure) * 0.3) - (q.finish(a) + a20(a.p.attributes.mental.composure) * 0.3))[0];
      if (!taker) return 30;
      placeAll();
      frame('restart');
      shoot(t, taker, { ...r.at }, 'penalty', false, null);
      return 60;
    }
    if (r.kind === 'corner') {
      t.stats.corners++;
      emit('corner', t.idx);
      placeAll();
      frame('restart');
      if (rng.next() < K2.cornerShot) {
        const cands = t.active.filter((l) => l.slot !== 'GK');
        const header = rng.weighted(cands, cands.map((l) => Math.max(0.01, CORNER_W[l.slot] * (l.role.fx.head ?? 1) * Math.pow(0.3 + q.head(l), 2))));
        const spot = { x: xOf(t.idx, L - 6 - rng.next() * 7), y: MID_Y + (rng.next() - 0.5) * 14 };
        const flagAt = { ...ball };
        header.pos = { ...spot }; ball = { ...spot }; holder = header;
        const taker = cands.filter((l) => l !== header).sort((a, b) => q.cross(b) - q.cross(a))[0] ?? null;
        if (taker) { taker.rep.passes++; taker.rep.passesCompleted++; t.stats.passes++; t.stats.passesCompleted++; an?.pass(taker.p.id, flagAt, spot, PASS_OK | PASS_CROSS); }
        shoot(t, header, spot, 'corner', true, taker);
        return 30;
      }
      const cl = nearest(d, { x: xOf(t.idx, L - 8), y: MID_Y });
      if (cl.l) giveBall(cl.l, { x: xOf(t.idx, L - 18 - rng.next() * 15), y: MID_Y + (rng.next() - 0.5) * 34 }, true);
      return 28;
    }
    if (r.kind === 'freekick') {
      const fd = depthOf(t.idx, ball.x);
      placeAll();
      if (fd > 75 && fd < L - 16 && Math.abs(ball.y - MID_Y) < 22 && rng.chance(0.4)) {
        const taker = [...t.active].filter((l) => l.slot !== 'GK').sort((a, b) => q.long(b) - q.long(a))[0];
        if (taker) { frame('restart'); shoot(t, taker, { ...ball }, 'freekick', false, null); return 30; }
      }
      const taker = nearest(t, ball).l;
      if (taker) giveBall(taker, ball, false);
      frame('restart');
      return 18 + rng.next() * 10;
    }
    if (r.kind === 'throw') {
      const taker = [...t.active].filter((l) => l.slot !== 'GK').sort((a, b) => dist(a.pos, ball) - dist(b.pos, ball))[0];
      if (taker) giveBall(taker, ball, false);
      frame('restart');
      return 10 + rng.next() * 8;
    }
    // tiro de meta
    const gk = goalkeeperOf(t) ?? t.active[0];
    placeAll();
    if (gk) giveBall(gk, ball, false);
    frame('restart');
    return 16 + rng.next() * 10;
  };

  /** joga `seconds` segundos de relógio (com a sobra do minuto anterior) */
  const play = (seconds: number): void => {
    let left = seconds + debt;
    secInTick = 0;
    while (left > 0) {
      const dt = playStep();
      sampleAll(dt);
      T[poss].held += dt;
      left -= dt; gameSec += dt; secInTick = Math.min(60, secInTick + dt);
    }
    debt = left;
  };

  // ---------- tempo, fadiga, IA ----------
  const addFatigue = (t: TeamState, intensity: number): void => {
    const tac = t.tac;
    const heat = conditions.weather === 'heat' ? 0.06 : conditions.weather === 'cold' ? -0.02 : 0;
    const load = (0.3 + 0.05 * (tac.tempo - 3) + 0.06 * (tac.pressing - 3) + heat) * intensity;
    for (const l of t.active) {
      const sta = 1.5 - a20(l.p.attributes.physical.stamina) * 0.9 - (a20(l.p.attributes.physical.naturalFitness) - 0.5) * 0.2;
      l.fatigue += Math.max(load * sta, 0.05) * (l.slot === 'LWB' || l.slot === 'RWB' ? 1.15 : l.slot === 'LM' || l.slot === 'RM' ? 1.05 : 1) * (l.role.fx.fatigue ?? 1);
    }
  };

  /** técnico da IA: muda a postura conforme o placar (o do usuário sob controle decide sozinho) */
  const AI_MINUTES = new Set([75, 82, 87]);
  const aiTactics = (t: TeamState, minute: number): void => {
    if (controlled(t) || !AI_MINUTES.has(minute)) return;
    const lead = t.goals - opp(t).goals, base = t.sheet.tactics;
    let next: TeamTactics = { ...base };
    // perdendo por 1–2: sobe a postura (nos minutos finais, também a pressão); vencendo por 1 no fim: segura o ritmo
    if (lead < 0 && lead >= -2) next = { ...base, mentality: 'attacking', pressing: minute >= 87 ? Math.min(5, base.pressing + 1) : base.pressing };
    else if (lead === 1 && minute >= 87) next = { ...base, tempo: Math.max(1, base.tempo - 1) };
    const same = (a: TeamTactics, b: TeamTactics) => a.mentality === b.mentality && a.tempo === b.tempo && a.width === b.width && a.defensiveLine === b.defensiveLine && a.pressing === b.pressing && a.buildUp === b.buildUp;
    if (same(next, t.tac)) return;
    t.tac = next;
    emit('tactics_change', t.idx, { detail: 'ai', tactics: { ...next } });
  };

  const aiSubs = (t: TeamState, minute: number): void => {
    if (controlled(t)) { suggestions.push(...suggestFor(t, minute)); return; }
    if (t.subsUsed >= subCap() || !t.bench.length) return;
    const lead = t.goals - opp(t).goals;
    let limit = minute <= 62 ? 1 : 2;
    const outfield = t.active.filter((l) => l.slot !== 'GK');
    if (minute >= 66 && lead < 0) {
      const out = [...outfield.filter((l) => DEFENSIVE_OUT.has(l.slot))].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const inP = t.bench.filter((b) => b.position === 'ST' || b.position === 'CF' || b.position === 'SS' || b.position === 'LW' || b.position === 'RW' || b.position === 'AM').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (out && inP) { doSub(t, out, inP, inP.position); limit--; }
    } else if (minute >= 74 && lead > 0) {
      const out = [...outfield.filter((l) => ATTACKERS.has(l.slot))].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const inP = t.bench.filter((b) => b.position === 'CB' || b.position === 'DM' || b.position === 'LB' || b.position === 'RB' || b.position === 'LWB' || b.position === 'RWB').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (out && inP) { doSub(t, out, inP, inP.position); limit--; }
    }
    while (limit > 0 && t.subsUsed < subCap() && t.bench.length) {
      const cands = t.active.filter((l) => l.slot !== 'GK')
        .map((l) => ({ l, cur: effective(l.p, l.slot) * fatigueMul(l), bench: bestBenchFor(t, l.slot) }))
        .filter((c) => c.bench && effective(c.bench, c.l.slot) > c.cur * 1.02)
        .sort((a, b) => a.cur / effective(a.bench!, a.l.slot) - b.cur / effective(b.bench!, b.l.slot));
      const pick = cands[0];
      if (!pick) break;
      doSub(t, pick.l, pick.bench!, pick.l.slot);
      limit--;
    }
  };

  /** Formação que melhor acomoda o time em campo (igual à v1; `forms` restringe às formações candidatas). */
  const planReshape = (players: Array<{ id: string; p: MatchPlayer; slot: Position; x: number }>, current: string, keepFirst: string, forms: Formation[] = FORMATIONS) => {
    const outfield = players.filter((x) => x.slot !== 'GK');
    if (outfield.length !== 10) return null;
    let best: { id: string; cost: number; moved: number; assign: Map<string, { slot: Position; x: number; y: number }> } | null = null;
    for (const f of forms) {
      const slots = f.slots.filter((s) => s.pos !== 'GK').map((s) => ({ ...s }));
      const order = [...outfield].sort((a, b) => (a.id === keepFirst ? -1 : b.id === keepFirst ? 1 : 0));
      const kept: Array<[typeof outfield[number], typeof slots[number]]> = [], left: typeof outfield = [];
      for (const pl of order) { const k = slots.findIndex((s) => s.pos === pl.slot); if (k >= 0) kept.push([pl, slots.splice(k, 1)[0]!]); else left.push(pl); }
      if (outfield.some((x) => x.id === keepFirst) && !kept.some(([pl]) => pl.id === keepFirst)) continue;
      let bestLeft: { cost: number; pairs: Array<[typeof outfield[number], typeof slots[number]]> } | null = null;
      const permute = (i: number, rest: typeof slots, acc: Array<[typeof outfield[number], typeof slots[number]]>, cost: number) => {
        if (bestLeft && cost >= bestLeft.cost) return;
        if (i === left.length) { bestLeft = { cost, pairs: [...acc] }; return; }
        rest.forEach((s, k) => { const pl = left[i]!; permute(i + 1, rest.filter((_, j) => j !== k), [...acc, [pl, s]], cost + effective(pl.p, pl.slot) - effective(pl.p, s.pos)); });
      };
      if (left.length > 6) continue;
      permute(0, slots, [], 0);
      if (!bestLeft) continue;
      const bl = bestLeft as { cost: number; pairs: Array<[typeof outfield[number], typeof slots[number]]> };
      const all = [...kept, ...bl.pairs];
      const assign = new Map<string, { slot: Position; x: number; y: number }>();
      for (const pos of new Set(all.map(([, s]) => s.pos))) {
        const ps = all.filter(([, s]) => s.pos === pos).map(([pl]) => pl).sort((a, b) => a.x - b.x);
        const ss = all.filter(([, s]) => s.pos === pos).map(([, s]) => s).sort((a, b) => a.x - b.x);
        ps.forEach((pl, k) => assign.set(pl.id, { slot: pos, x: ss[k]!.x, y: ss[k]!.y }));
      }
      const cost = bl.cost, moved = bl.pairs.length;
      const better = !best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) < 1e-9 && (f.id === current || (best.id !== current && moved < best.moved)));
      if (better) best = { id: f.id, cost, moved, assign };
    }
    return best;
  };

  const suggestFor = (t: TeamState, minute: number): SubSuggestion[] => {
    const out: SubSuggestion[] = [];
    if (t.subsUsed >= subCap() || !t.bench.length) return out;
    const lead = t.goals - opp(t).goals;
    let limit = minute <= 62 ? 1 : 2, used = t.subsUsed;
    const active = [...t.active], bench = [...t.bench];
    const take = (l: Live, b: MatchPlayer, slot: Position, kind: SubSuggestion['kind']) => {
      active.splice(active.indexOf(l), 1); bench.splice(bench.indexOf(b), 1); used++; limit--;
      out.push(suggestion(t, l, b, slot, kind));
    };
    const outfield = active.filter((l) => l.slot !== 'GK');
    if (minute >= 66 && lead < 0) {
      const o = [...outfield.filter((l) => DEFENSIVE_OUT.has(l.slot))].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const i = bench.filter((b) => b.position === 'ST' || b.position === 'CF' || b.position === 'SS' || b.position === 'LW' || b.position === 'RW' || b.position === 'AM').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (o && i) take(o, i, i.position, 'chase');
    } else if (minute >= 74 && lead > 0) {
      const o = [...outfield.filter((l) => ATTACKERS.has(l.slot))].sort((a, b) => effective(a.p, a.slot) - effective(b.p, b.slot))[0];
      const i = bench.filter((b) => b.position === 'CB' || b.position === 'DM' || b.position === 'LB' || b.position === 'RB' || b.position === 'LWB' || b.position === 'RWB').sort((a, b) => effective(b, b.position) - effective(a, a.position))[0];
      if (o && i) take(o, i, i.position, 'protect');
    }
    const best = (slot: Position) => [...bench.filter((b) => (slot === 'GK' ? b.position === 'GK' : b.position !== 'GK'))].sort((a, b) => effective(b, slot) - effective(a, slot))[0] ?? null;
    while (limit > 0 && used < 5 && bench.length) {
      const pick = active.filter((l) => l.slot !== 'GK')
        .map((l) => ({ l, cur: effective(l.p, l.slot) * fatigueMul(l), bench: best(l.slot) }))
        .filter((c) => c.bench && effective(c.bench, c.l.slot) > c.cur * 1.02)
        .sort((a, b) => a.cur / effective(a.bench!, a.l.slot) - b.cur / effective(b.bench!, b.l.slot))[0];
      if (!pick) break;
      take(pick.l, pick.bench!, pick.l.slot, 'fresh');
    }
    return out;
  };
  function suggestion(t: TeamState, l: Live, b: MatchPlayer, slot: Position, kind: SubSuggestion['kind'], injuryDays = 0): SubSuggestion {
    const o = opp(t), lead = t.goals - o.goals;
    const mins = clamp(clock.minute - (l.rep.subbedInAt ?? 0), 0, 120);
    const cond = Math.round(conditionAfter(l.p.condition, gained(l), mins));
    const rating = rateReport(l.rep, mins, t.goals, o.goals).toFixed(1).replace('.', ',');
    const pos = (p: Position) => POS_NAME[p].toLowerCase();
    const reason = kind === 'goalkeeper' ? `Ficamos sem goleiro e ${l.p.name} foi para o gol improvisado. Sugiro tirá-lo e colocar o goleiro ${b.name}.`
      : kind === 'injury' ? `${l.p.name} se lesionou (cerca de ${injuryDays} dia(s) fora) e não tem condição de continuar. ${b.name} é a melhor opção do banco para jogar como ${pos(slot)}.`
      : kind === 'chase' ? `Estamos perdendo por ${-lead}. Sugiro tirar ${l.p.name} (${pos(l.slot)}, nota ${rating}) e colocar ${b.name}, ${pos(b.position)}, para ter mais força no ataque e buscar o resultado.`
      : kind === 'protect' ? `Estamos vencendo por ${lead}. Para segurar o resultado, ${b.name} (${pos(b.position)}) pode entrar no lugar de ${l.p.name}, que é mais ofensivo.`
      : fatigueMul(l) < 0.93 ? `${l.p.name} está cansado (condição ${cond}%, nota ${rating}) e o rendimento caiu. ${b.name} entra descansado para jogar como ${pos(slot)}.`
      : `${b.name} deve render mais que ${l.p.name} (nota ${rating}, condição ${cond}%) como ${pos(slot)} neste momento do jogo.`;
    let reshape: SubSuggestion['reshape'] = null, extra = '';
    if (slot !== l.slot) {
      const after = [...t.active.filter((x) => x !== l).map((x) => ({ id: x.p.id, p: x.p, slot: x.slot, x: x.x })), { id: b.id, p: b, slot, x: l.x }];
      const plan = planReshape(after, t.formation, b.id);
      if (plan) {
        const changes = after.filter((x) => x.slot !== 'GK' && plan.assign.get(x.id)!.slot !== x.slot && x.id !== b.id).map((x) => ({ id: x.id, from: x.slot, to: plan.assign.get(x.id)!.slot }));
        reshape = { from: t.formation, to: plan.id, changes };
        const names = changes.map((c) => `${t.active.find((x) => x.p.id === c.id)!.p.name} passa a ${pos(c.to)}`);
        extra = plan.id !== t.formation ? ` Para encaixar ${b.name}, o time muda de ${t.formation} para ${plan.id}${names.length ? ` (${names.join('; ')})` : ''}.`
          : names.length ? ` Para encaixar ${b.name}, o time mantém o ${plan.id} com ajustes: ${names.join('; ')}.` : '';
      }
    }
    return { tick: tickNo, team: t.idx, out: l.p.id, in: b.id, slot, kind, reason: reason + extra, reshape };
  }

  // ---------- decisões do técnico (sem sorteio) ----------
  let tickNo = 0;
  const interventions: Intervention[] = opts.interventions ?? [];
  const moraleDelta: Record<string, number> = {};
  const suggestions: SubSuggestion[] = [];
  function controlled(t: TeamState): boolean { return !!opts.control && opts.control.team === t.idx && tickNo < opts.control.until; }
  function applyIntervention(iv: Intervention): void {
    const t = T[iv.team], o = opp(t);
    if (iv.kind === 'talk') {
      // vale para todos os relacionados: quem está em campo, quem já saiu (substituído, lesionado, expulso) e o banco
      for (const p of [...t.all.map((l) => l.p), ...t.bench]) {
        const d = talkWithMotivation(talkDelta(iv.tone, t.goals - o.goals, p.attributes.mental.composure), t.sheet.coach);
        p.morale = clamp(p.morale + d, 10, 100);
        moraleDelta[p.id] = (moraleDelta[p.id] ?? 0) + d;
      }
      emit('team_talk', iv.team, { detail: iv.tone });
      return;
    }
    if (iv.kind === 'tactics') {
      const s = iv.settings;
      if (![s.tempo, s.width, s.defensiveLine, s.pressing].every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) throw new MatchInterventionError('Tática inválida: ritmo, largura, linha e pressão vão de 1 a 5.');
      t.tac = { ...s };
      emit('tactics_change', t.idx, { detail: 'coach', tactics: { ...s } });
      return;
    }
    if (iv.kind === 'role') {
      const l = t.active.find((x) => x.p.id === iv.playerId);
      if (!l) throw new MatchInterventionError('O jogador escolhido não está em campo.');
      const role = roleById(iv.role);
      if (!role || !role.positions.includes(l.slot)) throw new MatchInterventionError(`A função escolhida não serve para ${POS_NAME[l.slot].toLowerCase()}.`);
      setRole(l, role.id);
      emit('role_change', t.idx, { player: l.p.id, detail: role.id });
      return;
    }
    if (iv.kind === 'formation') {
      let f: Formation;
      try { f = getFormation(iv.formation); } catch { throw new MatchInterventionError('Formação desconhecida.'); }
      if (!reorganize(t, '', [f])) throw new MatchInterventionError('Não dá para montar essa formação com quem está em campo (com expulsos, a formação não muda).');
      return;
    }
    const out = t.active.find((l) => l.p.id === iv.out);
    const inP = t.bench.find((b) => b.id === iv.in);
    if (!out) throw new MatchInterventionError('O jogador escolhido para sair não está mais em campo.');
    if (!inP) throw new MatchInterventionError('O jogador escolhido para entrar não está disponível no banco.');
    if (t.subsUsed >= subCap()) throw new MatchInterventionError(`O time já fez as ${subCap()} substituições permitidas.`);
    doSub(t, out, inP, iv.slot ?? out.slot, 'coach', iv.role);
    if (iv.reshape) reorganize(t, inP.id);
    const entered = t.active.find((l) => l.p.id === inP.id);
    if (entered) entered.roleK *= inGameMultiplier(t.sheet.coach);
  }
  function reorganize(t: TeamState, keepFirst: string, forms?: Formation[]): boolean {
    const plan = planReshape(t.active.map((l) => ({ id: l.p.id, p: l.p, slot: l.slot, x: l.x })), t.formation, keepFirst, forms);
    if (!plan) return false;
    const from = t.formation;
    for (const l of t.active) { const a = plan.assign.get(l.p.id); if (a) { const moved = l.slot !== a.slot; l.slot = a.slot; l.x = a.x; l.y = a.y; l.rep.slot = a.slot; if (moved) { setRole(l); if (l.p.id !== keepFirst) l.roleK *= inGameMultiplier(t.sheet.coach); } } }
    t.formation = formationLabel(plan.id);
    emit('formation_change', t.idx, { detail: `${from}>${t.formation}`, moves: t.active.map((l) => ({ id: l.p.id, slot: l.slot, x: l.x, y: l.y })) });
    refresh(t);
    return true;
  }

  // ---------- linha do tempo ----------
  const timeline: MatchTick[] | null = opts.timeline ? [] : null;
  const snapshot = (): void => {
    const side = (t: TeamState) => {
      const o = opp(t);
      const p: number[] = [];
      for (const l of t.all) {
        const from = l.rep.subbedInAt ?? 0, mins = clamp((l.rep.subbedOutAt ?? clock.minute) - from, 0, 120);
        p.push(Math.round(rateReport(l.rep, mins, t.goals, o.goals) * 10), Math.round(conditionAfter(l.p.condition, gained(l), mins) * 10));
      }
      return { s: TICK_STATS.map((k) => (k === 'xg' ? Math.round(t.stats.xg * 100) : t.stats[k])), p };
    };
    const a = side(T[0]), b = side(T[1]);
    timeline!.push({ minute: clock.minute, label: clock.label, ev: events.length, held: [Math.round(T[0].held), Math.round(T[1].held)], s: [a.s, b.s], p: [a.p, b.p] });
  };

  const SUB_MINUTES = new Set([58, 66, 74, 82]);
  const tick = (minute: number, label: string, etFactor: number, added: boolean): void => {
    clock.minute = minute; clock.label = label;
    for (const iv of interventions) if (iv.tick === tickNo) applyIntervention(iv);
    refreshAll();
    for (const t of T) addFatigue(t, etFactor > 1 ? 1.15 : 1);
    for (const t of T) {
      for (const l of [...t.active]) {
        const nf = a20(l.p.attributes.physical.naturalFitness);
        const p = K2.injury * (1 + (1 - nf) * 0.8) * (1 + l.fatigue / 60);
        if (rng.next() < p) handleInjury(t, l);
      }
    }
    const m90 = minute % 90 === 0 ? 90 : minute;
    if (!added && SUB_MINUTES.has(m90)) { aiSubs(T[0], minute); aiSubs(T[1], minute); }
    if (!added) { aiTactics(T[0], m90); aiTactics(T[1], m90); }
    refreshAll();
    play(60);
    if (timeline) snapshot();
    tickNo++;
  };

  const stoppage = (from: number): number => {
    let score = 0;
    for (const e of events.slice(from)) {
      if (e.type === 'goal') score += 0.5;
      else if (e.type === 'substitution') score += 0.3;
      else if (e.type === 'injury') score += 1.0;
      else if (e.type === 'yellow_card' || e.type === 'red_card') score += 0.2;
      else if (e.type === 'foul') score += 0.03;
      else if (e.type === 'penalty_awarded') score += 0.5;
    }
    return clamp(1 + Math.round(score + rng.float(-0.6, 0.6)), 1, 8);
  };

  let lastMinute = 0;
  const runPeriod = (from: number, to: number, tag: string, etFactor: number, kickoff: Side): void => {
    const start = events.length;
    debt = 0;
    restart = { kind: 'kickoff', team: kickoff, at: { x: L / 2, y: MID_Y } };
    for (let m = from; m <= to; m++) tick(m, `${m}'`, etFactor, false);
    const extra = etFactor > 1 ? clamp(Math.round(stoppage(start) / 2), 1, 3) : stoppage(start);
    for (let k = 1; k <= extra; k++) tick(to, `${to}+${k}'`, etFactor, true);
    clock.minute = to; clock.label = `${to}+${extra}'`;
    emit('period_end', 0, { detail: tag });
    if (timeline?.length) timeline.at(-1)!.ev = events.length;
    lastMinute = to + extra;
  };

  refreshAll();
  placeAll();
  runPeriod(1, 45, 'halftime', 1, 0);
  runPeriod(46, 90, 'fulltime', 1, 1);
  let decidedIn: MatchOutcome['decidedIn'] = 'regular';
  let shootout: MatchOutcome['shootout'] = null;
  const leader = (): 0 | 1 | null => { const h = T[0].goals + first[0], a = T[1].goals + first[1]; return h > a ? 0 : a > h ? 1 : null; };
  let winner: 0 | 1 | null = decider ? leader() : T[0].goals > T[1].goals ? 0 : T[1].goals > T[0].goals ? 1 : null;
  let endMinute = 90;

  if (winner === null && decider) {
    if (decider.extraTime) {
      decidedIn = 'extra_time';
      runPeriod(91, 105, 'extra1', 1.3, 0);
      runPeriod(106, 120, 'extra2', 1.3, 1);
      endMinute = 120;
      winner = leader();
    }
    if (winner === null && decider.penalties) {
      decidedIn = 'penalties';
      const res = { 0: 0, 1: 0 } as Record<Side, number>;
      const order = ([0, 1] as Side[]).map((s) => {
        const takers = T[s].active.filter((l) => l.slot !== 'GK').sort((a, b) => (q.finish(b) + a20(b.p.attributes.mental.composure)) - (q.finish(a) + a20(a.p.attributes.mental.composure)));
        return { takers: takers.length ? takers : T[s].active, gk: goalkeeperOf(T[s]) };
      });
      const kick = (s: Side, n: number): boolean => {
        const takers = order[s]!.takers;
        const taker = takers[n % takers.length]!;
        const gk = order[1 - s]!.gk;
        const skill = a20(taker.p.attributes.technical.finishing) * 0.5 + a20(taker.p.attributes.mental.composure) * 0.5;
        const gkSkill = gk ? effective(gk.p, 'GK') / 100 : 0.4;
        const pg = clamp(0.74 + 0.22 * (skill - 0.5) - 0.12 * (gkSkill - 0.6), 0.5, 0.92);
        const scored = rng.next() < pg;
        if (scored) res[s]++;
        emit('shootout_kick', s, { player: taker.p.id, scored });
        return scored;
      };
      series: for (let round = 0; round < 5; round++) {
        for (const s of [0, 1] as Side[]) {
          kick(s, round);
          const left0 = 5 - (round + 1), left1 = 5 - (s === 1 ? round + 1 : round);
          if (res[0] > res[1] + left1 || res[1] > res[0] + left0) break series;
        }
      }
      for (let n = 5; res[0] === res[1] && n < 60; n++) { kick(0, n); kick(1, n); }
      if (res[0] === res[1]) res[rng.chance(0.5) ? 0 : 1]++;
      shootout = { home: res[0], away: res[1] };
      winner = res[0] > res[1] ? 0 : 1;
    }
  }

  // ---------- fechamento ----------
  const totalHeld = T[0].held + T[1].held || 1;
  for (const t of T) t.stats.possession = Math.round((t.held / totalHeld) * 1000) / 10;
  for (const t of T) for (const l of t.all) {
    const from = l.rep.subbedInAt ?? 0, to = l.rep.subbedOutAt ?? endMinute;
    l.rep.minutes = clamp(to - from, 0, 120);
    l.rep.fatigue = gained(l);
  }
  const reports: PlayerReport[] = [];
  for (const t of T) {
    const o = opp(t);
    for (const l of t.all) { l.rep.rating = rateReport(l.rep, l.rep.minutes, t.goals, o.goals); reports.push(l.rep); }
  }
  const best = [...reports].filter((r) => r.minutes >= 45).sort((a, b) => b.rating - a.rating || b.goals - a.goals)[0];
  const track: MatchTrack | null = tracking ? { v: 1, ids: trackIds, frames: tframes, data: toBase64(tbuf, tlen) } : null;

  return {
    seed: opts.seed, homeGoals: T[0].goals, awayGoals: T[1].goals, decidedIn, shootout, winner, events,
    aggregate: decider?.firstLeg ? [T[0].goals + first[0], T[1].goals + first[1]] : null,
    stats: [T[0].stats, T[1].stats], players: reports,
    lineups: T.map((t) => ({
      clubId: t.sheet.clubId, name: t.sheet.name, formation: formationLabel(t.sheet.formation),
      slots: t.sheet.lineup.map((l) => ({ slot: l.slot, x: l.x, y: l.y, playerId: l.player.id })),
    })),
    conditions, duration: lastMinute, manOfTheMatch: best?.id ?? null, timeline, moraleDelta, suggestions, engine: 'v2', track, detail: an ? an.build() : null,
  };
}
