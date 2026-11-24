import { useEffect, useMemo, useState } from 'react';
import type { CommentaryLine } from '../../game/match-engine/commentary.ts';
import type { TrackKind } from '../../game/match-engine/types.ts';
import { sceneAt, type TrackFrame } from '../../game/match-engine/v2/track.ts';
import type { LivePlayer, LiveTick, Side } from '../matchLive.ts';
import { initials } from '../playerUi.tsx';

/**
 * Campo ao vivo. Com o trajeto do motor v2 (`track`), mostra as posições reais dos 22 jogadores e da bola, lance a lance
 * (interpolando entre as ações gravadas). Sem trajeto (motor v1), cai na representação ilustrativa abaixo.
 *
 * Modo ilustrativo: REPRESENTAÇÃO dos lances: o motor simula a partida por lances (quem ataca, finaliza, faz falta),
 * não por coordenadas. Aqui a bola e os jogadores se deslocam conforme os lances reais de cada minuto
 * (gol, finalização, escanteio, falta, impedimento) e a posse de bola registrada naquele minuto.
 * Mandante ataca para a direita. Coordenadas: x 0..100 (comprimento), y 0..64 (largura).
 */
interface Props {
  teams: [LivePlayer[], LivePlayer[]]; names: [string, string];
  tick: LiveTick | null; prevTick: LiveTick | null; tickLines: CommentaryLine[];
  /** duração de um minuto de jogo na tela (ms); null = parado */ tickMs: number | null; finished: boolean;
  /** trajeto do motor v2: quadros por minuto registrado e quem é cada índice */
  track?: { byTick: Map<number, TrackFrame[]>; ids: [string[], string[]]; last: number } | null;
  /** passo da tela (minutos já mostrados): anima o minuto `step - 1` */ step?: number;
  /** nome de cada jogador (inclusive quem já saiu) */ playerNames?: Map<string, string>;
  /** clique num jogador do seu time (troca de função); `side` = seu time */ onPick?: (id: string) => void; side?: Side;
}
interface Focus { team: Side; kind: 'goal' | 'shot' | 'corner' | 'offside' | 'foul' | 'play'; strength: number }
interface Pt { x: number; y: number }

const W = 100, H = 64;
/** pseudoaleatório determinístico (mesmo minuto = mesma cena) */
const noise = (...k: number[]) => { let h = 2166136261; for (const v of k) { h ^= Math.floor(v * 1000) | 0; h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** x do campo no sentido de ataque do time (0 = próprio gol, 100 = gol adversário) */
const toPitchX = (team: Side, depth: number) => (team === 0 ? depth : W - depth);

function focusOf(lines: CommentaryLine[], tick: LiveTick | null, prev: LiveTick | null, minute: number): Focus {
  const pick = (types: string[]) => [...lines].reverse().find((l) => types.includes(l.type) && l.team !== null);
  const g = pick(['goal']); if (g) return { team: g.team as Side, kind: 'goal', strength: 1 };
  const s = pick(['shot', 'penalty_awarded']); if (s) return { team: s.team as Side, kind: 'shot', strength: 0.9 };
  const c = pick(['corner']); if (c) return { team: c.team as Side, kind: 'corner', strength: 0.85 };
  const o = pick(['offside']); if (o) return { team: o.team as Side, kind: 'offside', strength: 0.7 };
  const f = pick(['foul']); if (f) return { team: (1 - (f.team as number)) as Side, kind: 'foul', strength: 0.45 }; // quem sofreu a falta estava com a bola
  if (tick?.held && prev?.held) {
    const d0 = tick.held[0] - prev.held[0], d1 = tick.held[1] - prev.held[1];
    const team: Side = d0 === d1 ? (noise(minute) < 0.5 ? 0 : 1) : d0 > d1 ? 0 : 1;
    const share = Math.max(d0, d1) / Math.max(1, d0 + d1);
    return { team, kind: 'play', strength: 0.25 + 0.4 * share };
  }
  return { team: noise(minute, 7) < 0.5 ? 0 : 1, kind: 'play', strength: 0.3 };
}

/** três quadros por minuto: saída de bola, progressão e o lance que de fato aconteceu */
function ballPath(f: Focus, minute: number): Pt[] {
  const side = noise(minute, 3) < 0.5 ? 1 : -1;
  const ty = H / 2 + side * (6 + noise(minute, 4) * 18);
  const end: Pt = f.kind === 'goal' ? { x: 99.2, y: H / 2 + (noise(minute, 5) - 0.5) * 5 }
    : f.kind === 'shot' ? { x: 86 + noise(minute, 6) * 7, y: H / 2 + (noise(minute, 8) - 0.5) * 16 }
    : f.kind === 'corner' ? { x: 99, y: side > 0 ? H - 1 : 1 }
    : f.kind === 'offside' ? { x: 76 + noise(minute, 9) * 8, y: ty }
    : f.kind === 'foul' ? { x: 45 + noise(minute, 10) * 25, y: ty }
    : { x: 40 + f.strength * 45 * noise(minute, 11) + 10, y: ty };
  const a: Pt = { x: 30 + noise(minute, 12) * 15, y: H / 2 + (noise(minute, 13) - 0.5) * 30 };
  const b: Pt = { x: (a.x + end.x) / 2 + (noise(minute, 14) - 0.5) * 8, y: (a.y + end.y) / 2 + side * 6 };
  return [a, b, end].map((p) => ({ x: toPitchX(f.team, p.x), y: clampN(p.y, 1, H - 1) }));
}

/** posição de cada jogador: forma do time + deslocamento do bloco em direção à bola + quem disputa a bola */
function layout(players: LivePlayer[], team: Side, ball: Pt | null, attacking: boolean, seed: number): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const ballDepth = ball ? (team === 0 ? ball.x : W - ball.x) : 50;
  for (const p of players) {
    let depth = 4 + p.y * 0.44;
    if (ball) depth += (ballDepth - 50) * 0.42 + (attacking ? 9 : -3);
    if (p.slot === 'GK') depth = clampN(ball ? 3 + Math.max(0, (ballDepth - 30) * 0.12) : 4, 2, 16);
    else depth = clampN(depth, 8, 95);
    let y = 6 + (p.x / 100) * (H - 12);
    if (ball && p.slot !== 'GK') y += (ball.y - y) * 0.16;
    depth += (noise(seed, p.x, p.y) - 0.5) * 3; y += (noise(seed, p.y, p.x, 2) - 0.5) * 3;
    out.set(p.id, { x: toPitchX(team, depth), y: clampN(y, 2, H - 2) });
  }
  if (ball) {
    // os dois mais próximos (um de cada time) vão na bola: quem conduz e quem marca
    const near = [...out.entries()].filter(([id]) => players.find((p) => p.id === id)?.slot !== 'GK')
      .sort((a, b) => Math.hypot(a[1].x - ball.x, a[1].y - ball.y) - Math.hypot(b[1].x - ball.x, b[1].y - ball.y))[0];
    if (near) {
      const [id, pt] = near;
      const k = attacking ? 0.85 : 0.55, off = attacking ? 0 : (team === 0 ? -2.5 : 2.5);
      out.set(id, { x: pt.x + (ball.x + off - pt.x) * k, y: pt.y + (ball.y - pt.y) * k });
    }
  }
  return out;
}

export function LivePitch(props: Props) {
  return props.track ? <TrackPitch {...props} track={props.track} /> : <IllustrativePitch {...props} />;
}

const KIND_LABEL: Record<TrackKind, string> = {
  move: 'Movimentação', pass: 'Passe', carry: 'Condução', dribble: 'Drible', shot: 'Finalização', cross: 'Cruzamento', tackle: 'Desarme',
  foul: 'Falta', restart: 'Bola parada', goal: 'Gol', out: 'Bola fora', save: 'Defesa do goleiro', interception: 'Interceptação', clearance: 'Bola afastada',
};
const PW = 105, PH = 68;

/** Posições reais (motor v2): cada minuto toca as ações gravadas no ritmo da tela. */
function TrackPitch({ names, tickLines, tickMs, finished, track, step = 0, playerNames, onPick, side }: Props & { track: NonNullable<Props['track']> }) {
  const idx = finished ? track.last : Math.max(0, Math.min(step - 1, track.last));
  const frames = useMemo(() => track.byTick.get(idx) ?? [], [track, idx]);
  const prev = useMemo(() => { for (let k = idx - 1; k >= 0; k--) { const a = track.byTick.get(k); if (a?.length) return a[a.length - 1]!; } return null; }, [track, idx]);
  const span = Math.max(60, (frames.at(-1)?.sec ?? 0) + 1);
  // passo 0: o pontapé inicial parado; parado (pausa, janela aberta, fim): o fim do minuto
  const [sec, setSec] = useState(step === 0 ? 0 : span);
  useEffect(() => {
    if (step === 0) { setSec(0); return; }
    if (tickMs === null || finished) { setSec(span); return; }
    const t0 = performance.now();
    let raf = 0;
    const loop = (now: number) => { const s = Math.min(span, ((now - t0) / tickMs) * span); setSec(s); if (s < span) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [idx, tickMs, finished, step, span]);

  const scene = sceneAt(frames, step === 0 ? null : prev, sec);
  const cur = scene?.current ?? null;
  const goalLine = !finished && step > 0 ? [...tickLines].reverse().find((l) => l.type === 'goal' && l.team !== null) : undefined;
  const goalAt = frames.findIndex((f) => f.kind === 'goal');
  const showGoal = !!goalLine && (goalAt < 0 || (scene?.index ?? -1) >= goalAt);
  const holderId = cur && cur.poss !== null && cur.holder !== null ? track.ids[cur.poss][cur.holder] : undefined;
  const who = (id: string | undefined) => (id ? playerNames?.get(id) ?? '' : '');

  return (
    <div className="mc-live">
      <svg viewBox={`0 0 ${PW} ${PH}`} className="mc-live-svg" role="img" aria-label="Partida ao vivo: posições dos jogadores e da bola">
        <rect x="0" y="0" width={PW} height={PH} className="mc-grass" />
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * 10.5} y="0" width="5.25" height={PH} className="mc-stripe" />)}
        <g className="mc-lines">
          <rect x="0.3" y="0.3" width={PW - 0.6} height={PH - 0.6} /><line x1={PW / 2} y1="0.3" x2={PW / 2} y2={PH - 0.3} /><circle cx={PW / 2} cy={PH / 2} r="9.15" />
          <rect x="0.3" y={PH / 2 - 20.16} width="16.2" height="40.32" /><rect x={PW - 16.5} y={PH / 2 - 20.16} width="16.2" height="40.32" />
          <rect x="0.3" y={PH / 2 - 9.16} width="5.2" height="18.32" /><rect x={PW - 5.5} y={PH / 2 - 9.16} width="5.2" height="18.32" />
          <rect x="-1.2" y={PH / 2 - 3.66} width="1.5" height="7.32" className="mc-goal" /><rect x={PW - 0.3} y={PH / 2 - 3.66} width="1.5" height="7.32" className="mc-goal" />
        </g>
        {scene && ([0, 1] as const).map((t) => scene.pos[t].map((p, ti) => {
          const id = track.ids[t][ti];
          if (!p || !id) return null;
          const mine = onPick && t === side;
          return (
            <g key={id} transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`} className={mine ? 'mc-trk-pick' : undefined}
              onClick={mine ? () => onPick(id) : undefined} role={mine ? 'button' : undefined} aria-label={mine ? `Mudar a função de ${who(id)}` : undefined}>
              {id === holderId && <circle r="2.7" className="mc-trk-holder" />}
              <circle r="1.9" className={t === 0 ? 'mc-dot-home' : 'mc-dot-away'} />
              <text y="0.55" textAnchor="middle" className={`mc-trk-txt ${t === 0 ? 'mc-ink-home' : 'mc-ink-away'}`}>{initials(who(id))}</text>
              <title>{who(id)}{mine ? ' (clique para mudar a função)' : ''}</title>
            </g>
          );
        }))}
        {scene && <circle cx={scene.ball.x} cy={scene.ball.y} r="0.9" className="mc-ball" />}
      </svg>
      {cur && !finished && step > 0 && <div className="mc-trk-act">{KIND_LABEL[cur.kind]}{holderId ? ` · ${who(holderId)}` : ''}</div>}
      {showGoal && <div className="mc-flash">GOL! {names[goalLine!.team as Side]}</div>}
      {step === 0 && !finished && <div className="mc-flash mc-flash-soft">A partida vai começar</div>}
      {finished && <div className="mc-flash mc-flash-soft">Fim de jogo</div>}
    </div>
  );
}

function IllustrativePitch({ teams, names, tick, prevTick, tickLines, tickMs, finished }: Props) {
  const [frame, setFrame] = useState(2);
  const minute = tick ? tick.minute * 10 + (tick.label.includes('+') ? Number(tick.label.split('+')[1]!.replace("'", '')) : 0) : 0;
  const focus = useMemo(() => (tick && !finished ? focusOf(tickLines, tick, prevTick, minute) : null), [tick, prevTick, tickLines, minute, finished]);
  const path = useMemo(() => (focus ? ballPath(focus, minute) : null), [focus, minute]);

  useEffect(() => {
    if (!path || tickMs === null) { setFrame(2); return; }
    setFrame(0);
    const step = tickMs / 3;
    const t1 = setTimeout(() => setFrame(1), step), t2 = setTimeout(() => setFrame(2), step * 2);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [path, tickMs]);

  const ball = path ? path[frame]! : null;
  const pos = [layout(teams[0], 0, ball, focus?.team === 0, minute * 3 + frame), layout(teams[1], 1, ball, focus?.team === 1, minute * 3 + frame + 1)];
  const dur = tickMs === null ? 0 : Math.round(tickMs / 3);
  const goal = focus?.kind === 'goal' && frame === 2;

  return (
    <div className="mc-live" style={{ ['--mc-dur' as string]: `${dur}ms` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="mc-live-svg" role="img" aria-label="Representação animada da partida">
        <rect x="0" y="0" width={W} height={H} className="mc-grass" />
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * 10} y="0" width="5" height={H} className="mc-stripe" />)}
        <g className="mc-lines">
          <rect x="0.6" y="0.6" width={W - 1.2} height={H - 1.2} /><line x1={W / 2} y1="0.6" x2={W / 2} y2={H - 0.6} /><circle cx={W / 2} cy={H / 2} r="8" />
          <rect x="0.6" y={H / 2 - 16} width="15" height="32" /><rect x={W - 15.6} y={H / 2 - 16} width="15" height="32" />
          <rect x="0.6" y={H / 2 - 7} width="5" height="14" /><rect x={W - 5.6} y={H / 2 - 7} width="5" height="14" />
          <rect x="-1" y={H / 2 - 3.5} width="1.6" height="7" className="mc-goal" /><rect x={W - 0.6} y={H / 2 - 3.5} width="1.6" height="7" className="mc-goal" />
        </g>
        {([0, 1] as const).map((t) => teams[t].map((p) => {
          const pt = pos[t]!.get(p.id)!;
          return (
            <g key={p.id} className="mc-mover" style={{ transform: `translate(${pt.x}px, ${pt.y}px)` }}>
              <circle r="2.3" className={t === 0 ? 'mc-dot-home' : 'mc-dot-away'} />
              <text y="0.75" textAnchor="middle" className={`mc-dot-txt ${t === 0 ? 'mc-ink-home' : 'mc-ink-away'}`}>{initials(p.name)}</text>
              <title>{p.name}</title>
            </g>
          );
        }))}
        {ball && <g className="mc-mover" style={{ transform: `translate(${ball.x}px, ${ball.y}px)` }}><circle r="1.05" className="mc-ball" /></g>}
      </svg>
      {goal && <div className="mc-flash">GOL! {names[focus!.team]}</div>}
      {!tick && !finished && <div className="mc-flash mc-flash-soft">A partida vai começar</div>}
      {finished && <div className="mc-flash mc-flash-soft">Fim de jogo</div>}
    </div>
  );
}
