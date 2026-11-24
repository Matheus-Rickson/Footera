/**
 * Análise pós-jogo (estilo das transmissões/apps de estatística): momentum, estatísticas por grupo, mapa de finalizações e, por jogador,
 * mapa de calor, mapa de passes e ações defensivas. Tudo sai do que o motor gravou na partida (`MatchReportDto.analysis`, eventos com
 * posição e xG); partidas sem análise (antigas ou de outros clubes) mostram só o que existe, com aviso.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Activity, Crosshair, Info, Users, BarChart3 } from 'lucide-react';
import type { MatchReportDto } from '../../shared/api.ts';
import type { PlayerDetail, PlayerReport } from '../../game/match-engine/types.ts';
import { HEAT_H, HEAT_W } from '../../game/match-engine/types.ts';
import { attackRight, averagePosition, decodeDef, decodeHeat, decodePasses, heatAttackRight, momentumSeries, smoothHeat, type DefAction } from '../../game/match-engine/v2/detail.ts';
import type { CommentaryLine } from '../../game/match-engine/commentary.ts';
import { PlayerFace, PosPill } from '../playerUi.tsx';
import { useImages } from '../images.ts';
import { shortName } from '../util.ts';
import { SegFilter } from '../ui/index.tsx';

const PW = 105, PH = 68;
type Tab = 'summary' | 'stats' | 'shots' | 'players';
const ratingTone = (r: number) => (r >= 7.5 ? 'great' : r >= 6.8 ? 'good' : r >= 6 ? 'avg' : 'poor');
const OUTCOME: Record<string, string> = { goal: 'Gol', saved: 'Defendido', off_target: 'Para fora', blocked: 'Bloqueado', post: 'Na trave' };
const CHANCE: Record<string, string> = { buildup: 'jogada trabalhada', cross: 'cruzamento', long: 'chute de longe', counter: 'contra-ataque', corner: 'escanteio', freekick: 'falta', penalty: 'pênalti' };
const DEF_LABEL: Record<DefAction['kind'], string> = { tackle: 'Desarme', interception: 'Interceptação', clearance: 'Corte', recovery: 'Recuperação', foul: 'Falta cometida' };
/** finalização de grande chance: xG a partir de 0,3 (critério usual das casas de estatística) */
const BIG_CHANCE = 0.3;

/** Campo inteiro em SVG (105 × 68), mandante atacando para a direita. */
function Pitch({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  return (
    <svg viewBox={`-1.5 -1.5 ${PW + 3} ${PH + 3}`} className={`ma-pitch ${className}`} role="img" aria-label={label}>
      <rect x="0" y="0" width={PW} height={PH} className="mc-grass" />
      {Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * 10.5} y="0" width="5.25" height={PH} className="mc-stripe" />)}
      <g className="mc-lines">
        <rect x="0.3" y="0.3" width={PW - 0.6} height={PH - 0.6} /><line x1={PW / 2} y1="0.3" x2={PW / 2} y2={PH - 0.3} /><circle cx={PW / 2} cy={PH / 2} r="9.15" />
        <rect x="0.3" y={PH / 2 - 20.16} width="16.2" height="40.32" /><rect x={PW - 16.5} y={PH / 2 - 20.16} width="16.2" height="40.32" />
        <rect x="0.3" y={PH / 2 - 9.16} width="5.2" height="18.32" /><rect x={PW - 5.5} y={PH / 2 - 9.16} width="5.2" height="18.32" />
        <rect x="-1.2" y={PH / 2 - 3.66} width="1.5" height="7.32" className="mc-goal" /><rect x={PW - 0.3} y={PH / 2 - 3.66} width="1.5" height="7.32" className="mc-goal" />
      </g>
      {children}
    </svg>
  );
}

/** Dica flutuante que segue o ponteiro dentro de um contêiner relativo. */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: React.MouseEvent, body: ReactNode) => {
    const box = (e.currentTarget as Element).closest('.ma-tipbox')!.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, body });
  };
  const node = tip ? <div className="ma-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.body}</div> : null;
  return { show, hide: () => setTip(null), node };
}

/** Índice do minuto registrado de cada linha de comentário (o primeiro minuto cujo fim já inclui o evento). */
function tickOfLine(r: MatchReportDto, l: CommentaryLine): number {
  if (!r.timeline) return -1;
  const i = r.timeline.findIndex((t) => t.ev > l.i);
  return i < 0 ? r.timeline.length - 1 : i;
}

// ---------------------------------------------------------------- resumo

function Momentum({ r }: { r: MatchReportDto }) {
  const tip = useTip();
  const a = r.analysis!, tl = r.timeline;
  const series = useMemo(() => momentumSeries(a.momentum), [a]);
  const n = series.length;
  if (!n || !tl) return null;
  const H = 40, mid = H / 2, bw = 100 / n;
  const goals = r.commentary.filter((l) => l.kind === 'goal' && l.team !== null);
  // intervalo: o primeiro minuto registrado depois do fim do 1º tempo
  const ht = r.commentary.find((l) => l.type === 'period_end' && l.detail === 'halftime');
  const htIdx = ht ? tickOfLine(r, ht) + 1 : -1;
  const marks = [0, 15, 30, 45, 60, 75, 90].map((m) => ({ m, i: tl.findIndex((t) => t.minute >= m && !t.label.includes('+')) })).filter((x) => x.i >= 0);
  return (
    <div className="ma-mom ma-tipbox" onMouseLeave={tip.hide}>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="ma-mom-svg" role="img" aria-label={`Momentum: ${r.home.name} acima, ${r.away.name} abaixo`}>
        <line x1="0" x2="100" y1={mid} y2={mid} className="ma-mom-axis" />
        {htIdx > 0 && <line x1={htIdx * bw} x2={htIdx * bw} y1="0" y2={H} className="ma-mom-ht" />}
        {series.map((v, i) => {
          const h = Math.abs(v) * (mid - 1);
          const label = tl[i]?.label ?? '';
          return (
            <g key={i} onMouseMove={(e) => tip.show(e, <><b>{label}</b><span>{Math.abs(v) < 0.08 ? 'Jogo equilibrado' : `${v > 0 ? r.home.name : r.away.name} por cima`}</span></>)}>
              <rect x={i * bw} y="0" width={bw} height={H} className="ma-hit" />
              {h > 0.05 && <rect x={i * bw + bw * 0.12} y={v > 0 ? mid - h : mid} width={bw * 0.76} height={h} className={v > 0 ? 'ma-mom-home' : 'ma-mom-away'} />}
            </g>
          );
        })}
      </svg>
      <div className="ma-mom-goals" aria-hidden="true">
        {goals.map((g) => { const i = tickOfLine(r, g); return <span key={g.i} className={g.team === 0 ? 'ma-mom-g ma-mom-g-home' : 'ma-mom-g ma-mom-g-away'} style={{ left: `${(i + 0.5) * bw}%` }} title={`${g.label} gol`}>⚽</span>; })}
      </div>
      <div className="ma-mom-ticks" aria-hidden="true">{marks.map(({ m, i }) => <span key={m} style={{ left: `${i * bw}%` }}>{m}'</span>)}</div>
      {tip.node}
    </div>
  );
}

function Territory({ r }: { r: MatchReportDto }) {
  const t = r.analysis!.territory;
  const zones = ['Defesa', 'Meio', 'Ataque'];
  return (
    <div className="ma-terr">
      {([0, 1] as const).map((s) => {
        const tot = t[s].reduce((x, y) => x + y, 0) || 1;
        return (
          <div key={s} className="ma-terr-row">
            <span className="ma-terr-name"><i className={s === 0 ? 'mc-key mc-dot-home' : 'mc-key mc-dot-away'} />{shortName(s === 0 ? r.home.name : r.away.name)}</span>
            <div className="ma-terr-bar">
              {t[s].map((v, z) => <span key={z} className={`ma-terr-z ma-terr-z${z}`} style={{ flexGrow: Math.max(v, 0.001) }} title={`${zones[z]}: ${Math.round((v / tot) * 100)}% do tempo com a bola`}>{v / tot >= 0.12 ? `${Math.round((v / tot) * 100)}%` : ''}</span>)}
            </div>
          </div>
        );
      })}
      <p className="muted small">Onde cada time teve a bola: terço defensivo, meio-campo e terço de ataque (do ponto de vista de cada um).</p>
    </div>
  );
}

function Summary({ r, onPick }: { r: MatchReportDto; onPick: (id: string) => void }) {
  const img = useImages();
  const top = [...r.players].filter((p) => p.minutes >= 20).sort((a, b) => b.rating - a.rating).slice(0, 5);
  return (
    <div className="ma-grid2">
      <section className="card ma-card ma-wide">
        <div className="bar"><h2><Activity size={15} aria-hidden="true" />Momentum</h2><span className="row small muted"><span className="mc-key mc-dot-home" />{shortName(r.home.name)}<span className="mc-key mc-dot-away" />{shortName(r.away.name)}</span></div>
        {r.analysis && r.timeline ? <Momentum r={r} /> : <p className="muted small">Momentum disponível só nas partidas do seu clube jogadas a partir da v0.11.</p>}
        <p className="muted small">Pressão ofensiva minuto a minuto: tempo com a bola no campo de ataque (mais no terço final) somado ao xG das finalizações. Barras para cima: {r.home.name}; para baixo: {r.away.name}.</p>
      </section>
      <section className="card ma-card">
        <h2>Território</h2>
        {r.analysis ? <Territory r={r} /> : <p className="muted small">Sem dados de posição nesta partida.</p>}
      </section>
      <section className="card ma-card">
        <h2>Destaques</h2>
        <ol className="ma-top">
          {top.map((p) => (
            <li key={p.id}><button type="button" className="ma-top-btn" onClick={() => onPick(p.id)} title="Ver a partida do jogador">
              <PlayerFace img={img} id={p.id} name={p.name} className={`ma-face ${p.team === 0 ? 'mc-dot-home' : 'mc-dot-away'}`} />
              <span className="ma-top-name">{p.name}<small className="muted">{p.team === 0 ? r.home.name : r.away.name}{p.goals ? ` · ${p.goals} gol${p.goals > 1 ? 's' : ''}` : ''}{p.assists ? ` · ${p.assists} assist.` : ''}</small></span>
              <span className={`pf-rating ${ratingTone(p.rating)}`}>{p.rating.toFixed(1)}</span>
            </button></li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- estatísticas

function Row({ label, a, b, fmt = String, hint }: { label: string; a: number; b: number; fmt?: (v: number) => string; hint?: string }) {
  const tot = a + b || 1;
  return (
    <div className="ma-row" title={hint}>
      <div className="ma-row-top"><b className={a > b ? 'ma-lead' : ''}>{fmt(a)}</b><span>{label}</span><b className={b > a ? 'ma-lead' : ''}>{fmt(b)}</b></div>
      <div className="ma-row-bars"><span><i className="mc-bar-home" style={{ width: `${(a / tot) * 100}%` }} /></span><span><i className="mc-bar-away" style={{ width: `${(b / tot) * 100}%` }} /></span></div>
    </div>
  );
}

interface TeamAgg { touches: number; dribbles: number; dribblesWon: number; duelsWon: number; aerialWon: number; aerialLost: number; lost: number; recoveries: number; clearances: number; crosses: number; crossesOk: number; longs: number; longsOk: number; keyPasses: number }
function aggregate(r: MatchReportDto): [TeamAgg, TeamAgg] | null {
  const a = r.analysis;
  if (!a) return null;
  const z = (): TeamAgg => ({ touches: 0, dribbles: 0, dribblesWon: 0, duelsWon: 0, aerialWon: 0, aerialLost: 0, lost: 0, recoveries: 0, clearances: 0, crosses: 0, crossesOk: 0, longs: 0, longsOk: 0, keyPasses: 0 });
  const out: [TeamAgg, TeamAgg] = [z(), z()];
  for (const p of r.players) {
    const d = a.players[p.id], t = out[p.team];
    t.keyPasses += p.keyPasses;
    if (!d) continue;
    t.touches += d.touches; t.dribbles += d.dribbles; t.dribblesWon += d.dribblesWon; t.duelsWon += d.duelsWon;
    t.aerialWon += d.aerialWon; t.aerialLost += d.aerialLost; t.lost += d.lost; t.recoveries += d.recoveries;
    for (const x of decodeDef(d)) if (x.kind === 'clearance') t.clearances++;
    for (const x of decodePasses(d)) {
      if (x.cross) { t.crosses++; if (x.ok) t.crossesOk++; }
      else if (x.long) { t.longs++; if (x.ok) t.longsOk++; }
    }
  }
  return out;
}

const shotsOf = (r: MatchReportDto) => r.commentary.filter((l) => (l.type === 'shot' || l.type === 'goal') && l.player);
const inBoxOf = (l: CommentaryLine) => l.x !== undefined && l.y !== undefined && (l.team === 0 ? l.x > PW - 16.5 : l.x < 16.5) && Math.abs(l.y - PH / 2) < 20.16;

function Stats({ r }: { r: MatchReportDto }) {
  const [h, a] = r.stats;
  const agg = useMemo(() => aggregate(r), [r]);
  const shots = shotsOf(r);
  const by = (t: 0 | 1, f: (l: CommentaryLine) => boolean) => shots.filter((l) => l.team === t && f(l)).length;
  const hasPos = shots.some((l) => l.x !== undefined);
  const pct = (ok: number, n: number) => (n ? Math.round((ok / n) * 100) : 0);
  const p = (v: number) => `${v}%`;
  const ratio = (ok: number, n: number) => `${ok}/${n}`;
  return (
    <div className="ma-stats">
      <section className="card ma-card">
        <h2>Visão geral</h2>
        <Row label="Posse de bola" a={Math.round(h.possession)} b={Math.round(a.possession)} fmt={p} />
        <Row label="Gols esperados (xG)" a={h.xg} b={a.xg} fmt={(v) => v.toFixed(2)} />
        <Row label="Grandes chances" a={by(0, (l) => (l.xg ?? 0) >= BIG_CHANCE)} b={by(1, (l) => (l.xg ?? 0) >= BIG_CHANCE)} hint={`Finalizações com xG a partir de ${BIG_CHANCE.toFixed(1).replace('.', ',')}`} />
        <Row label="Finalizações" a={h.shots} b={a.shots} />
        <Row label="Escanteios" a={h.corners} b={a.corners} />
        <Row label="Faltas" a={h.fouls} b={a.fouls} />
        <Row label="Cartões amarelos" a={h.yellowCards} b={a.yellowCards} />
        <Row label="Cartões vermelhos" a={h.redCards} b={a.redCards} />
      </section>
      <section className="card ma-card">
        <h2>Finalizações</h2>
        <Row label="Total" a={h.shots} b={a.shots} />
        <Row label="No alvo" a={h.shotsOnTarget} b={a.shotsOnTarget} />
        <Row label="Para fora" a={by(0, (l) => l.outcome === 'off_target' || l.outcome === 'post')} b={by(1, (l) => l.outcome === 'off_target' || l.outcome === 'post')} />
        <Row label="Bloqueadas" a={h.shotsBlocked} b={a.shotsBlocked} />
        <Row label="Na trave" a={by(0, (l) => l.outcome === 'post')} b={by(1, (l) => l.outcome === 'post')} />
        {hasPos && <Row label="Dentro da área" a={by(0, inBoxOf)} b={by(1, inBoxOf)} />}
        {hasPos && <Row label="Fora da área" a={by(0, (l) => l.x !== undefined && !inBoxOf(l))} b={by(1, (l) => l.x !== undefined && !inBoxOf(l))} />}
        <Row label="Defesas do goleiro" a={h.saves} b={a.saves} />
      </section>
      <section className="card ma-card">
        <h2>Passes</h2>
        <Row label="Passes" a={h.passes} b={a.passes} />
        <Row label="Passes certos" a={h.passesCompleted} b={a.passesCompleted} />
        <Row label="Precisão" a={pct(h.passesCompleted, h.passes)} b={pct(a.passesCompleted, a.passes)} fmt={p} />
        {agg && <Row label="Passes decisivos" a={agg[0].keyPasses} b={agg[1].keyPasses} hint="Passes que terminaram em finalização" />}
        {agg && <Row label="Cruzamentos certos" a={agg[0].crossesOk} b={agg[1].crossesOk} hint={`${ratio(agg[0].crossesOk, agg[0].crosses)} × ${ratio(agg[1].crossesOk, agg[1].crosses)}`} />}
        {agg && <Row label="Lançamentos certos" a={agg[0].longsOk} b={agg[1].longsOk} hint={`Passes de mais de 30 m: ${ratio(agg[0].longsOk, agg[0].longs)} × ${ratio(agg[1].longsOk, agg[1].longs)}`} />}
      </section>
      <section className="card ma-card">
        <h2>Duelos e posse</h2>
        {agg ? <>
          <Row label="Toques na bola" a={agg[0].touches} b={agg[1].touches} />
          <Row label="Duelos ganhos" a={agg[0].duelsWon} b={agg[1].duelsWon} />
          <Row label="Dribles certos" a={agg[0].dribblesWon} b={agg[1].dribblesWon} hint={`${ratio(agg[0].dribblesWon, agg[0].dribbles)} × ${ratio(agg[1].dribblesWon, agg[1].dribbles)}`} />
          {agg[0].aerialWon + agg[1].aerialWon > 0 && <Row label="Disputas aéreas ganhas" a={agg[0].aerialWon} b={agg[1].aerialWon} />}
          <Row label="Posses perdidas" a={agg[0].lost} b={agg[1].lost} />
        </> : <p className="muted small">Sem a análise detalhada nesta partida.</p>}
        <Row label="Impedimentos" a={h.offsides} b={a.offsides} />
      </section>
      <section className="card ma-card">
        <h2>Defesa</h2>
        <Row label="Desarmes" a={h.tackles} b={a.tackles} />
        <Row label="Interceptações" a={h.interceptions} b={a.interceptions} />
        {agg && <Row label="Cortes" a={agg[0].clearances} b={agg[1].clearances} />}
        {agg && <Row label="Recuperações de bola" a={agg[0].recoveries} b={agg[1].recoveries} />}
        <Row label="Defesas do goleiro" a={h.saves} b={a.saves} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- finalizações

function Shots({ r, names }: { r: MatchReportDto; names: Map<string, string> }) {
  const [team, setTeam] = useState<'all' | '0' | '1'>('all');
  const [sel, setSel] = useState<number | null>(null);
  const tip = useTip();
  const all = shotsOf(r).filter((l) => l.x !== undefined && l.y !== undefined);
  if (!all.length) return <section className="card ma-card"><p className="muted small"><Info size={13} aria-hidden="true" /> {shotsOf(r).length ? 'Esta partida foi jogada pelo motor antigo: as finalizações não têm posição no campo.' : 'Nenhuma finalização na partida.'}</p></section>;
  const list = all.filter((l) => team === 'all' || String(l.team) === team);
  const radius = (xg: number) => 0.9 + 3.2 * Math.sqrt(Math.max(0.01, xg));
  const desc = (l: CommentaryLine) => `${l.label} · ${names.get(l.player!) ?? 'Jogador'} · ${OUTCOME[l.outcome ?? 'goal']} · xG ${(l.xg ?? 0).toFixed(2)}${l.chance ? ` · ${CHANCE[l.chance]}` : ''}`;
  const xgOf = (t: 0 | 1) => list.filter((l) => l.team === t).reduce((s, l) => s + (l.xg ?? 0), 0);
  return (
    <div className="ma-grid2">
      <section className="card ma-card ma-wide">
        <div className="bar"><h2><Crosshair size={15} aria-hidden="true" />Mapa de finalizações</h2>
          <SegFilter label="Time" value={team} onChange={(v) => { setTeam(v); setSel(null); }} options={[{ id: 'all', label: 'Os dois' }, { id: '0', label: shortName(r.home.name) }, { id: '1', label: shortName(r.away.name) }]} />
        </div>
        <div className="ma-tipbox" onMouseLeave={tip.hide}>
          <Pitch label={`Finalizações: ${r.home.name} ataca para a direita, ${r.away.name} para a esquerda`}>
            {[...list].sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0)).map((l) => (
              <g key={l.i} className="ma-shot" onMouseMove={(e) => tip.show(e, desc(l))} onClick={() => setSel(l.i)}>
                <circle cx={l.x} cy={l.y} r={radius(l.xg ?? 0) + 1.6} className="ma-hit" />
                <circle cx={l.x} cy={l.y} r={radius(l.xg ?? 0)} className={`ma-shot-dot ${l.team === 0 ? 'ma-shot-home' : 'ma-shot-away'} ma-shot-${l.outcome === 'goal' || l.type === 'goal' ? 'goal' : l.outcome === 'saved' ? 'saved' : 'miss'} ${sel === l.i ? 'ma-shot-sel' : ''}`} />
              </g>
            ))}
          </Pitch>
          {tip.node}
        </div>
        <div className="ma-legend small muted">
          <span><i className="ma-lg ma-lg-goal" />Gol</span><span><i className="ma-lg ma-lg-saved" />No alvo (defendido)</span><span><i className="ma-lg ma-lg-miss" />Fora ou bloqueado</span>
          <span>Tamanho = xG</span>
          <span><span className="mc-key mc-dot-home" />{shortName(r.home.name)} ataca →</span><span><span className="mc-key mc-dot-away" />← {shortName(r.away.name)}</span>
        </div>
      </section>
      <section className="card ma-card ma-wide">
        <div className="bar"><h2>Lista</h2><span className="small muted">xG: {shortName(r.home.name)} {xgOf(0).toFixed(2)} · {shortName(r.away.name)} {xgOf(1).toFixed(2)}</span></div>
        <table className="ma-shot-table">
          <thead><tr><th>Min</th><th>Jogador</th><th>Time</th><th>Origem</th><th>Resultado</th><th className="right">xG</th></tr></thead>
          <tbody>{list.map((l) => (
            <tr key={l.i} className={sel === l.i ? 'ma-row-sel' : ''} onClick={() => setSel(l.i)}>
              <td>{l.label}</td><td>{names.get(l.player!) ?? '—'}</td><td><span className={l.team === 0 ? 'mc-key mc-dot-home' : 'mc-key mc-dot-away'} />{shortName(l.team === 0 ? r.home.name : r.away.name)}</td>
              <td>{l.chance ? CHANCE[l.chance] : '—'}</td><td>{OUTCOME[l.type === 'goal' ? 'goal' : l.outcome ?? 'goal']}</td><td className="right">{(l.xg ?? 0).toFixed(2)}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- jogadores

type Layer = 'heat' | 'passes' | 'def';

function HeatLayer({ d, team }: { d: PlayerDetail; team: 0 | 1 }) {
  const fid = useId().replace(/:/g, '');
  const grid = useMemo(() => smoothHeat(heatAttackRight(decodeHeat(d), team), 1), [d, team]);
  const avg = useMemo(() => averagePosition(grid), [grid]);
  const cw = PW / HEAT_W, ch = PH / HEAT_H;
  return (
    <>
      <defs><filter id={`hb${fid}`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.4" /></filter></defs>
      <g filter={`url(#hb${fid})`}>
        {grid.map((v, i) => v > 0.04 && <rect key={i} x={(i % HEAT_W) * cw - 0.6} y={Math.floor(i / HEAT_W) * ch - 0.6} width={cw + 1.2} height={ch + 1.2} className="ma-heat" style={{ opacity: Math.min(0.92, 0.15 + 0.85 * Math.pow(v, 0.9)) }} />)}
      </g>
      {avg && <circle cx={avg.x} cy={avg.y} r="1.5" className="ma-avg"><title>Posição média</title></circle>}
    </>
  );
}

function PassLayer({ d, team, show }: { d: PlayerDetail; team: 0 | 1; show: 'all' | 'ok' | 'miss' | 'key' }) {
  const passes = useMemo(() => decodePasses(d).map((p) => ({ ...p, from: attackRight(p.from, team), to: attackRight(p.to, team) })), [d, team]);
  const mid = useId().replace(/:/g, '');
  const vis = passes.filter((p) => show === 'all' || (show === 'ok' ? p.ok : show === 'miss' ? !p.ok : p.key));
  return (
    <>
      <defs>
        {(['ok', 'miss', 'key'] as const).map((k) => <marker key={k} id={`pa${k}${mid}`} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 z" className={`ma-pass-head-${k}`} /></marker>)}
      </defs>
      {vis.map((p, i) => {
        const k = p.key ? 'key' : p.ok ? 'ok' : 'miss';
        return <line key={i} x1={p.from.x} y1={p.from.y} x2={p.to.x} y2={p.to.y} className={`ma-pass ma-pass-${k}`} markerEnd={`url(#pa${k}${mid})`} />;
      })}
    </>
  );
}

function DefShape({ a }: { a: DefAction }) {
  const { x, y } = a.at;
  const t = <title>{DEF_LABEL[a.kind]}</title>;
  if (a.kind === 'tackle') return <circle cx={x} cy={y} r="1.3" className="ma-def">{t}</circle>;
  if (a.kind === 'interception') return <path d={`M${x},${y - 1.6} L${x + 1.6},${y} L${x},${y + 1.6} L${x - 1.6},${y} z`} className="ma-def">{t}</path>;
  if (a.kind === 'clearance') return <path d={`M${x},${y - 1.6} L${x + 1.5},${y + 1.2} L${x - 1.5},${y + 1.2} z`} className="ma-def">{t}</path>;
  if (a.kind === 'recovery') return <rect x={x - 1.15} y={y - 1.15} width="2.3" height="2.3" className="ma-def">{t}</rect>;
  return <path d={`M${x - 1.2},${y - 1.2} L${x + 1.2},${y + 1.2} M${x + 1.2},${y - 1.2} L${x - 1.2},${y + 1.2}`} className="ma-def-foul">{t}</path>;
}

function PlayerPanel({ r, p }: { r: MatchReportDto; p: PlayerReport }) {
  const img = useImages();
  const [layer, setLayer] = useState<Layer>('heat');
  const [show, setShow] = useState<'all' | 'ok' | 'miss' | 'key'>('all');
  const d = r.analysis?.players[p.id] ?? null;
  const passes = useMemo(() => (d ? decodePasses(d) : []), [d]);
  const defs = useMemo(() => (d ? decodeDef(d).map((x) => ({ ...x, at: attackRight(x.at, p.team) })) : []), [d, p.team]);
  const crosses = passes.filter((x) => x.cross), longs = passes.filter((x) => x.long && !x.cross);
  const count = (k: DefAction['kind']) => defs.filter((x) => x.kind === k).length;
  const pct = (ok: number, n: number) => (n ? ` (${Math.round((ok / n) * 100)}%)` : '');
  const gk = p.slot === 'GK';
  const items: Array<[string, string]> = [
    ['Minutos', `${p.minutes}'`],
    ['Gols', String(p.goals)], ['Assistências', String(p.assists)], ['xG', p.xg.toFixed(2)],
    ['Finalizações (no alvo)', `${p.shots} (${p.shotsOnTarget})`],
    ['Passes certos', `${p.passesCompleted}/${p.passes}${pct(p.passesCompleted, p.passes)}`],
    ['Passes decisivos', String(p.keyPasses)],
    ...(d ? [
      ['Cruzamentos certos', `${crosses.filter((x) => x.ok).length}/${crosses.length}`],
      ['Lançamentos certos', `${longs.filter((x) => x.ok).length}/${longs.length}`],
      ['Toques na bola', String(d.touches)],
      ['Dribles certos', `${d.dribblesWon}/${d.dribbles}`],
      ['Duelos ganhos', `${d.duelsWon}/${d.duelsWon + d.duelsLost}`],
      ['Posses perdidas', String(d.lost)],
    ] as Array<[string, string]> : []),
    ['Desarmes', String(p.tackles)], ['Interceptações', String(p.interceptions)],
    ...(d ? [['Cortes', String(count('clearance'))], ['Recuperações', String(d.recoveries)]] as Array<[string, string]> : []),
    ['Faltas cometidas', String(p.fouls)],
    ...(gk ? [['Defesas', String(p.saves)], ['Gols sofridos', String(p.goalsConceded)]] as Array<[string, string]> : []),
  ];
  return (
    <section className="card ma-card ma-player">
      <div className="ma-player-head">
        <PlayerFace img={img} id={p.id} name={p.name} className={`ma-face-lg ${p.team === 0 ? 'mc-dot-home' : 'mc-dot-away'}`} />
        <div className="ma-player-id"><strong>{p.name}</strong><span className="small muted"><PosPill pos={p.slot} /> {p.team === 0 ? r.home.name : r.away.name}{r.manOfTheMatch?.id === p.id ? ' · craque do jogo' : ''}</span></div>
        <span className={`pf-rating ${ratingTone(p.rating)} ma-rating`} title="Nota da partida">{p.rating.toFixed(1)}</span>
      </div>
      {d ? <>
        <div className="bar">
          <SegFilter label="Camada" value={layer} onChange={setLayer} options={[{ id: 'heat', label: 'Mapa de calor' }, { id: 'passes', label: 'Passes', count: passes.length }, { id: 'def', label: 'Ações defensivas', count: defs.length }]} />
          {layer === 'passes' && <SegFilter label="Passes" value={show} onChange={setShow} options={[{ id: 'all', label: 'Todos' }, { id: 'ok', label: 'Certos' }, { id: 'miss', label: 'Errados' }, { id: 'key', label: 'Decisivos' }]} />}
        </div>
        <Pitch label={`${layer === 'heat' ? 'Mapa de calor' : layer === 'passes' ? 'Passes' : 'Ações defensivas'} de ${p.name}; o time dele ataca para a direita`} className="ma-pitch-player">
          {layer === 'heat' && <HeatLayer d={d} team={p.team} />}
          {layer === 'passes' && <PassLayer d={d} team={p.team} show={show} />}
          {layer === 'def' && defs.map((x, i) => <DefShape key={i} a={x} />)}
        </Pitch>
        <div className="ma-legend small muted">
          <span>Ataca →</span>
          {layer === 'heat' && <span>Onde o jogador passou o tempo em campo (mais forte = mais tempo); o círculo é a posição média.</span>}
          {layer === 'passes' && <><span><i className="ma-lgl" />Certo</span><span><i className="ma-lgl ma-lgl-miss" />Errado</span><span><i className="ma-lgl ma-lgl-key" />Decisivo (gerou finalização)</span></>}
          {layer === 'def' && <><span>● Desarme {count('tackle')}</span><span>◆ Interceptação {count('interception')}</span><span>▲ Corte {count('clearance')}</span><span>■ Recuperação {count('recovery')}</span><span>✕ Falta {count('foul')}</span></>}
        </div>
      </> : <p className="muted small"><Info size={13} aria-hidden="true" /> Sem mapa de calor nesta partida (jogada antes da v0.11 ou de outros clubes).</p>}
      <dl className="ma-pstats">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

function Players({ r, sel, setSel }: { r: MatchReportDto; sel: string | null; setSel: (id: string) => void }) {
  const img = useImages();
  const chosen = r.players.find((p) => p.id === sel) ?? r.players.find((p) => p.id === r.manOfTheMatch?.id) ?? r.players[0];
  const order = (t: 0 | 1) => r.players.filter((p) => p.team === t && p.minutes > 0).sort((a, b) => Number(b.starter) - Number(a.starter) || (a.subbedInAt ?? 0) - (b.subbedInAt ?? 0));
  return (
    <div className="ma-players">
      <section className="card ma-card ma-plist">
        {([0, 1] as const).map((t) => (
          <div key={t}>
            <h2 className={t === 0 ? 'ma-plist-home' : 'ma-plist-away'}>{t === 0 ? r.home.name : r.away.name}</h2>
            <ul>{order(t).map((p) => (
              <li key={p.id}><button type="button" className={`ma-pbtn ${chosen?.id === p.id ? 'on' : ''}`} onClick={() => setSel(p.id)} aria-pressed={chosen?.id === p.id}>
                <PlayerFace img={img} id={p.id} name={p.name} className={`ma-face ${t === 0 ? 'mc-dot-home' : 'mc-dot-away'}`} />
                <PosPill pos={p.slot} />
                <span className="ma-pbtn-name">{p.name}{!p.starter && <small className="muted"> entrou {p.subbedInAt}'</small>}</span>
                {p.goals > 0 && <span title={`${p.goals} gol(s)`}>⚽{p.goals > 1 ? p.goals : ''}</span>}
                <span className={`pf-rating ${ratingTone(p.rating)}`}>{p.rating.toFixed(1)}</span>
              </button></li>
            ))}</ul>
          </div>
        ))}
      </section>
      {chosen && <PlayerPanel key={chosen.id} r={r} p={chosen} />}
    </div>
  );
}

// ---------------------------------------------------------------- tela

export function MatchAnalysis({ r }: { r: MatchReportDto }) {
  const [tab, setTab] = useState<Tab>('summary');
  const [sel, setSel] = useState<string | null>(null);
  const names = useMemo(() => new Map(r.players.map((p) => [p.id, p.name] as const)), [r]);
  const pick = (id: string) => { setSel(id); setTab('players'); };
  const TABS: Array<[Tab, string, ReactNode]> = [
    ['summary', 'Resumo', <Activity key="a" size={14} aria-hidden="true" />], ['stats', 'Estatísticas', <BarChart3 key="b" size={14} aria-hidden="true" />],
    ['shots', 'Finalizações', <Crosshair key="c" size={14} aria-hidden="true" />], ['players', 'Jogadores', <Users key="d" size={14} aria-hidden="true" />],
  ];
  return (
    <div className="ma">
      <div className="pf-tabs ma-tabs" role="tablist" aria-label="Análise da partida">
        {TABS.map(([id, label, icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pf-tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{icon}{label}</button>)}
      </div>
      {!r.analysis && r.detail === 'full' && <p className="mc-compact"><Info size={12} aria-hidden="true" />Partida sem a análise detalhada (jogada antes da v0.11): momentum, mapa de calor e passes não estão disponíveis.</p>}
      {r.detail === 'compact' && <p className="mc-compact"><Info size={12} aria-hidden="true" />Jogo de outros clubes: só o resumo e as estatísticas gerais.</p>}
      {tab === 'summary' && <Summary r={r} onPick={pick} />}
      {tab === 'stats' && <Stats r={r} />}
      {tab === 'shots' && <Shots r={r} names={names} />}
      {tab === 'players' && <Players r={r} sel={sel} setSel={setSel} />}
    </div>
  );
}
