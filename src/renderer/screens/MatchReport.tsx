import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Ban, Cross, FastForward, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { MatchReportDto } from '../../shared/api.ts';
import type { TeamStats } from '../../game/match-engine/types.ts';
import { BUILDUP_LABEL, MENTALITY_LABEL, errMsg, fmtDate, shortName, unwrap } from '../util.ts';
import { liveAt, ticksOf, type LivePlayer, type LiveState } from '../matchLive.ts';
import { initials, PosPill } from '../playerUi.tsx';
import { LivePitch } from './LivePitch.tsx';

interface Props { profileId: string; careerId: string; fixtureId: string; autoplay: boolean; onBack: () => void }
type Speed = 1 | 2 | 4;
const TICK_MS: Record<Speed, number> = { 1: 1000, 2: 500, 4: 220 };
const WEATHER: Record<string, string> = { clear: 'tempo bom', rain: 'chuva', heat: 'calor intenso', cold: 'frio' };
const DECIDED: Record<string, string> = { regular: '', extra_time: ' · decidido na prorrogação', penalties: ' · decidido nos pênaltis' };
const ratingTone = (r: number) => (r >= 7.5 ? 'great' : r >= 6.8 ? 'good' : r >= 6 ? 'avg' : 'poor');
const condTone = (c: number) => (c >= 75 ? 'great' : c >= 60 ? 'avg' : 'poor');

/** Ícones do jogador: gols, assistências, cartões, entrada/saída e lesão. */
function Marks({ p }: { p: LivePlayer }) {
  return (
    <span className="mc-marks">
      {Array.from({ length: p.goals }, (_, i) => <span key={`g${i}`} className="mc-goal-ico" title="Gol">⚽</span>)}
      {p.assists > 0 && <span className="mc-ast" title={`${p.assists} assistência(s)`}>A{p.assists > 1 ? p.assists : ''}</span>}
      {p.yellow > 0 && !p.red && <span className="tr-card tr-card-y" title="Cartão amarelo" />}
      {p.red && <span className="tr-card tr-card-r" title={p.yellow >= 2 ? 'Expulso (segundo amarelo)' : 'Expulso'} />}
      {p.subIn && <span className="mc-in" title="Entrou no jogo"><ArrowLeftRight size={11} aria-hidden="true" /></span>}
      {p.subOut && !p.injured && <span className="mc-out" title="Substituído"><ArrowLeftRight size={11} aria-hidden="true" /></span>}
      {p.injured && <span className="tr-flag tr-flag-injury" title="Lesionado"><Cross size={10} aria-hidden="true" /></span>}
    </span>
  );
}

/** Escalação no campo (mandante ataca para a direita; visitante, espelhado). */
function TeamPitch({ players, side }: { players: LivePlayer[]; side: 0 | 1 }) {
  return (
    <div className="mc-field">
      <div className="mc-field-lines" aria-hidden="true"><i /><b /><s /><u /></div>
      {players.map((p) => {
        const left = side === 0 ? 5 + p.y * 0.88 : 95 - p.y * 0.88, top = 9 + p.x * 0.82;
        return (
          <div key={p.id} className="mc-chip" style={{ left: `${left}%`, top: `${top}%` }} title={p.name}>
            <span className={`mc-face ${side === 0 ? 'mc-dot-home' : 'mc-dot-away'}`}>{initials(p.name)}</span>
            {p.rating !== null && <span className={`mc-rate ${ratingTone(p.rating)}`}>{p.rating.toFixed(1)}</span>}
            <span className="mc-chip-name">{shortName(p.name)}</span>
            <Marks p={p} />
          </div>
        );
      })}
    </div>
  );
}

function TeamTable({ name, team, levels }: { name: string; team: LiveState['teams'][number]; levels: Record<string, number> }) {
  const row = (p: LivePlayer) => (
    <tr key={p.id} className={p.onPitch ? '' : 'mc-gone'}>
      <td><PosPill pos={p.slot} /></td>
      <td><span className="mc-name">{p.name}</span><Marks p={p} /></td>
      <td className="center">{levels[p.id] !== undefined ? <span className="mc-lvl">{levels[p.id]}</span> : <span className="muted" title="De outros clubes você só vê estimativas (ficha do jogador)">—</span>}</td>
      <td>{p.condition === null ? <span className="muted">—</span> : <span className="mc-cond"><span className="pf-track"><i className={condTone(p.condition)} style={{ width: `${p.condition}%` }} /></span><b className={condTone(p.condition)}>{Math.round(p.condition)}%</b></span>}</td>
      <td className="center">{p.rating === null ? <span className="muted">—</span> : <span className={`pf-rating ${ratingTone(p.rating)}`}>{p.rating.toFixed(1)}</span>}</td>
      <td className="right">{p.minutes}</td>
      <td className="right">{p.goals}</td>
    </tr>
  );
  return (
    <section className="card mc-table">
      <h2>{name}</h2>
      <table>
        <thead><tr><th>Pos</th><th>Nome</th><th className="center" title="Força atual (só do seu clube)">Lvl</th><th>Condição</th><th className="center">Nota</th><th className="right">Min</th><th className="right">G</th></tr></thead>
        <tbody>
          {team.onPitch.map(row)}
          {team.gone.length > 0 && <tr className="mc-sep"><td colSpan={7}>Saíram</td></tr>}
          {team.gone.map(row)}
        </tbody>
      </table>
    </section>
  );
}

function Stat({ label, a, b, fmt = (v: number) => String(v) }: { label: string; a: number; b: number; fmt?: (v: number) => string }) {
  const total = a + b || 1;
  return (
    <div className="mc-stat">
      <div className="mc-stat-top"><b>{fmt(a)}</b><span>{label}</span><b>{fmt(b)}</b></div>
      <div className="mc-stat-bars"><span><i className="mc-bar-home" style={{ width: `${(a / total) * 100}%` }} /></span><span><i className="mc-bar-away" style={{ width: `${(b / total) * 100}%` }} /></span></div>
    </div>
  );
}

function StatsCard({ stats }: { stats: [TeamStats, TeamStats] | null }) {
  if (!stats) return <section className="card"><h2>Estatísticas</h2><p className="muted small">Esta partida foi gravada antes do acompanhamento minuto a minuto: as estatísticas aparecem no fim do jogo.</p></section>;
  const [h, a] = stats;
  const pct = (s: TeamStats) => (s.passes ? Math.round((s.passesCompleted / s.passes) * 100) : 0);
  return (
    <section className="card">
      <h2>Estatísticas</h2>
      <div className="mc-poss">
        <div className="mc-stat-top"><span className="mc-pill mc-bar-home">{Math.round(h.possession)}%</span><span>Posse de bola</span><span className="mc-pill mc-bar-away">{Math.round(a.possession)}%</span></div>
        <div className="mc-poss-bar"><i className="mc-bar-home" style={{ width: `${h.possession}%` }} /><i className="mc-bar-away" style={{ width: `${a.possession}%` }} /></div>
      </div>
      <Stat label="Gols esperados (xG)" a={h.xg} b={a.xg} fmt={(v) => v.toFixed(2)} />
      <Stat label="Finalizações" a={h.shots} b={a.shots} />
      <Stat label="No alvo" a={h.shotsOnTarget} b={a.shotsOnTarget} />
      <Stat label="Escanteios" a={h.corners} b={a.corners} />
      <Stat label="Faltas" a={h.fouls} b={a.fouls} />
      <Stat label="Impedimentos" a={h.offsides} b={a.offsides} />
      <Stat label="Cartões amarelos" a={h.yellowCards} b={a.yellowCards} />
      <Stat label="Cartões vermelhos" a={h.redCards} b={a.redCards} />
      <Stat label="Passes" a={h.passes} b={a.passes} />
      <Stat label="Precisão de passes" a={pct(h)} b={pct(a)} fmt={(v) => `${v}%`} />
      <Stat label="Desarmes" a={h.tackles} b={a.tackles} />
      <Stat label="Defesas do goleiro" a={h.saves} b={a.saves} />
    </section>
  );
}

function EventsCard({ st, minor, setMinor }: { st: LiveState; minor: boolean; setMinor: (v: boolean) => void }) {
  const running: [number, number] = [0, 0];
  const items = st.lines.map((l) => {
    if (l.kind === 'goal' && l.team !== null) running[l.team]++;
    return { l, score: l.kind === 'goal' ? `${running[0]} - ${running[1]}` : null };
  }).filter(({ l }) => minor || l.major).reverse();
  return (
    <section className="card mc-events">
      <div className="bar"><h2>Eventos</h2><label className="inline small"><input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} />Lances menores</label></div>
      <div className="mc-events-list">
        {items.length === 0 && <p className="muted small">{st.started ? 'Nenhum lance importante ainda.' : 'A partida vai começar…'}</p>}
        {items.map(({ l, score }) => l.kind === 'period' ? (
          <div key={l.i} className="mc-period"><span>{l.text.split('.')[0]}</span><b>{l.text.match(/(\d+) x (\d+)/)?.slice(1).join(' - ')}</b></div>
        ) : (
          <div key={l.i} className={`mc-ev ${l.team === 1 ? 'mc-ev-away' : ''} ${l.kind === 'goal' ? 'mc-ev-goal' : ''}`}>
            <span className="mc-ev-min">{l.label}</span>
            <div className="mc-ev-body">
              <div className="mc-ev-head">
                {l.kind === 'goal' && <span className="mc-score-badge">⚽ {score}</span>}
                {l.type === 'yellow_card' && <span className="tr-card tr-card-y" />}
                {l.type === 'red_card' && <span className="tr-card tr-card-r" />}
                {l.type === 'substitution' && <ArrowLeftRight size={14} aria-hidden="true" />}
                {l.type === 'injury' && <Cross size={14} aria-hidden="true" />}
                {l.type === 'penalty_awarded' && <Ban size={14} aria-hidden="true" />}
              </div>
              <p>{l.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MatchReport({ profileId, careerId, fixtureId, autoplay, onBack }: Props) {
  const [r, setR] = useState<MatchReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState<Speed>(1);
  const [minor, setMinor] = useState(false);

  useEffect(() => {
    let stale = false;
    unwrap(window.api.getMatchReport(profileId, careerId, fixtureId)).then((d) => {
      if (stale) return;
      setR(d); setStep(autoplay ? 0 : ticksOf(d).length);
    }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, fixtureId, autoplay]);

  const ticks = useMemo(() => (r ? ticksOf(r) : []), [r]);
  const finished = r !== null && step >= ticks.length;
  useEffect(() => {
    if (!playing || !r) return;
    if (finished) { setPlaying(false); return; }
    const t = setTimeout(() => setStep((n) => n + 1), TICK_MS[speed]);
    return () => clearTimeout(t);
  }, [playing, step, speed, r, finished]);
  const st = useMemo(() => (r ? liveAt(r, ticks, step) : null), [r, ticks, step]);

  if (error) return <section className="card"><p className="error" role="alert">{error}</p><button className="secondary" onClick={onBack}>Voltar</button></section>;
  if (!r || !st) return <p className="muted">Carregando partida…</p>;
  const tick = step > 0 ? ticks[Math.min(step, ticks.length) - 1]! : null;
  const prevTick = step > 1 ? ticks[Math.min(step, ticks.length) - 2]! : null;
  const status = finished ? 'Encerrado' : !st.started ? 'Pré-jogo' : playing ? 'Ao vivo' : 'Pausado';
  const progress = Math.min(100, (st.minute / (r.decidedIn === 'regular' ? 90 : 120)) * 100);

  return (
    <div className="mc">
      <section className="card mc-head">
        <div className="mc-meta muted small">
          <span>{r.competitionName} · rodada {r.round} · {fmtDate(r.date)} · {WEATHER[r.conditions.weather]}{r.conditions.pitch === 'poor' ? ', gramado ruim' : ''}</span>
          <div className="row">
            {!finished && <button className="secondary" onClick={() => setPlaying((p) => !p)}>{playing ? <><Pause size={15} aria-hidden="true" />Pausar</> : <><Play size={15} aria-hidden="true" />{st.started ? 'Continuar' : 'Iniciar'}</>}</button>}
            {!finished && <div className="mc-speed" role="radiogroup" aria-label="Velocidade">{([1, 2, 4] as Speed[]).map((s) => <button key={s} role="radio" aria-checked={speed === s} className={speed === s ? '' : 'secondary'} onClick={() => setSpeed(s)}>{s}×</button>)}</div>}
            {!finished && <button className="secondary" onClick={() => { setStep(ticks.length); setPlaying(false); }}><SkipForward size={15} aria-hidden="true" />Ir para o fim</button>}
            {finished && <button className="secondary" onClick={() => { setStep(0); setPlaying(true); }}><RotateCcw size={15} aria-hidden="true" />Assistir do início</button>}
            <button className="secondary" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />Voltar</button>
          </div>
        </div>
        <div className="mc-board">
          <div className="mc-team"><span className="mc-team-name">{r.home.name}</span><small className="muted">{r.home.formation}</small></div>
          <div className="mc-score"><b>{st.score[0]}</b>
            <div className="mc-clock"><span className={`mc-status ${status === 'Ao vivo' ? 'on' : ''}`}>{status}</span><strong>{finished ? 'Fim' : st.minuteLabel}</strong>
              {st.shootout && <span className="small muted">pênaltis {st.shootout[0]} x {st.shootout[1]}</span>}</div>
            <b>{st.score[1]}</b></div>
          <div className="mc-team mc-team-away"><span className="mc-team-name">{r.away.name}</span><small className="muted">{r.away.formation}</small></div>
        </div>
        <div className="mc-progress"><i style={{ width: `${progress}%` }} /></div>
        {finished && (
          <p className="muted small center">Encerrado{DECIDED[r.decidedIn]}{r.shootout ? ` (${r.shootout.home} x ${r.shootout.away} nos pênaltis)` : ''}
            {r.manOfTheMatch ? ` · Craque do jogo: ${r.manOfTheMatch.name}` : ''}
            {r.attendance ? ` · Público: ${r.attendance.attendance.toLocaleString('pt-BR')} (${Math.round((r.attendance.attendance / r.attendance.capacity) * 100)}% do estádio), renda de ${r.attendance.revenue.toLocaleString('pt-BR')}` : ''}</p>
        )}
        {r.detail === 'compact' && <p className="notice small">Relatório resumido: para jogos de outros clubes só os eventos-chave (gols, cartões, substituições, lesões) foram guardados. Estatísticas e notas finais estão completas.</p>}
        {!r.timeline && r.detail === 'full' && <p className="muted small center">Partida gravada antes do acompanhamento minuto a minuto: notas, condição e estatísticas aparecem no fim do jogo.</p>}
      </section>

      <div className="mc-grid">
        <div className="mc-col">
          <section className="card mc-pitch-card"><TeamPitch players={st.teams[0].onPitch} side={0} /></section>
          <TeamTable name={r.home.name} team={st.teams[0]} levels={r.levels} />
        </div>
        <div className="mc-col">
          <EventsCard st={st} minor={minor} setMinor={setMinor} />
          <section className="card">
            <div className="bar"><h2>Ao vivo</h2><span className="row small muted"><span className="mc-key mc-dot-home" />{shortName(r.home.name)}<span className="mc-key mc-dot-away" />{shortName(r.away.name)}</span></div>
            <LivePitch teams={[st.teams[0].onPitch, st.teams[1].onPitch]} names={[r.home.name, r.away.name]} tick={tick} prevTick={prevTick} tickLines={st.tickLines}
              tickMs={playing && !finished ? TICK_MS[speed] : null} finished={finished} />
            <p className="muted small"><FastForward size={12} aria-hidden="true" /> Representação dos lances: a bola e os jogadores se movem conforme os lances reais de cada minuto (gols, finalizações, escanteios, faltas) e a posse registrada; as posições exatas são ilustrativas, pois o motor simula por lances, não por coordenadas.</p>
          </section>
          <StatsCard stats={st.stats} />
          {finished && r.tactics && (
            <section className="card">
              <h2>Táticas</h2>
              {r.tactics.map((t, i) => (
                <p key={i} className="muted small"><strong>{i === 0 ? r.home.name : r.away.name}:</strong> mentalidade {MENTALITY_LABEL[t.mentality]?.toLowerCase()}, saída {BUILDUP_LABEL[t.buildUp]?.toLowerCase()},
                  ritmo {t.tempo}, amplitude {t.width}, linha defensiva {t.defensiveLine}, pressão {t.pressing}.</p>
              ))}
            </section>
          )}
        </div>
        <div className="mc-col">
          <section className="card mc-pitch-card"><TeamPitch players={st.teams[1].onPitch} side={1} /></section>
          <TeamTable name={r.away.name} team={st.teams[1]} levels={r.levels} />
        </div>
      </div>
    </div>
  );
}
