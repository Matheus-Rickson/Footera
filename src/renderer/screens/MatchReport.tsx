import { useEffect, useMemo, useState } from 'react';
import type { MatchReportDto } from '../../shared/api.ts';
import type { PlayerReport, TeamStats } from '../../game/match-engine/types.ts';
import { BUILDUP_LABEL, MENTALITY_LABEL, errMsg, fmtDate, shortName, unwrap } from '../util.ts';
import { PitchView } from './PitchView.tsx';

interface Props { profileId: string; careerId: string; fixtureId: string; autoplay: boolean; onBack: () => void }
type Tab = 'live' | 'summary' | 'players' | 'lineups';
const WEATHER: Record<string, string> = { clear: 'tempo bom', rain: 'chuva', heat: 'calor intenso', cold: 'frio' };
const DECIDED: Record<string, string> = { regular: '', extra_time: ' · decidido na prorrogação', penalties: ' · decidido nos pênaltis' };

function StatRow({ label, a, b, fmt = (v: number) => String(v) }: { label: string; a: number; b: number; fmt?: (v: number) => string }) {
  const total = a + b || 1;
  return (
    <div className="stat">
      <span className="val">{fmt(a)}</span>
      <div className="bars"><div className="sbar left"><i style={{ width: `${(a / total) * 100}%` }} /></div><span className="muted small">{label}</span><div className="sbar right"><i style={{ width: `${(b / total) * 100}%` }} /></div></div>
      <span className="val">{fmt(b)}</span>
    </div>
  );
}

function Pitch({ lineup, players }: { lineup: MatchReportDto['lineups'][number]; players: Map<string, PlayerReport> }) {
  return (
    <PitchView ariaLabel={`Escalação do ${lineup.name} (${lineup.formation})`}
      slots={lineup.slots.map((s) => { const p = players.get(s.playerId); return { key: s.playerId + s.slot, pos: s.slot, x: s.x, y: s.y, label: shortName(p?.name ?? ''), warn: p?.position !== s.slot }; })} />
  );
}

export function MatchReport({ profileId, careerId, fixtureId, autoplay, onBack }: Props) {
  const [r, setR] = useState<MatchReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(autoplay ? 'live' : 'summary');
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState<'1x' | '4x'>('1x');
  const [minor, setMinor] = useState(false);

  useEffect(() => {
    let stale = false;
    unwrap(window.api.getMatchReport(profileId, careerId, fixtureId)).then((d) => {
      if (stale) return;
      setR(d); setShown(autoplay ? 0 : d.commentary.length);
    }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, fixtureId, autoplay]);

  const total = r?.commentary.length ?? 0;
  const finished = shown >= total;
  useEffect(() => {
    if (!playing || !r || shown >= total) { if (shown >= total) setPlaying(false); return; }
    const major = r.commentary[shown]?.major ?? true;
    const t = setTimeout(() => setShown((n) => n + 1), (speed === '1x' ? (major ? 1100 : 420) : (major ? 280 : 100)));
    return () => clearTimeout(t);
  }, [playing, shown, speed, r, total]);

  const view = useMemo(() => {
    if (!r) return null;
    const lines = r.commentary.slice(0, shown);
    const score: [number, number] = [0, 0];
    for (const l of lines) {
      if (l.kind === 'goal' && l.team === 0) score[0]++;
      else if (l.kind === 'goal' && l.team === 1) score[1]++;
    }
    const players = new Map(r.players.map((p) => [p.id, p]));
    return { lines, score, minute: lines.at(-1)?.label ?? "0'", players };
  }, [r, shown]);

  if (error) return <section className="card"><p className="error" role="alert">{error}</p><button className="secondary" onClick={onBack}>Voltar</button></section>;
  if (!r || !view) return <p className="muted">Carregando relatório…</p>;
  const [sh, sa] = finished ? [r.homeGoals, r.awayGoals] : view.score;
  const st = r.stats;
  const pct = (s: TeamStats) => (s.passes ? Math.round((s.passesCompleted / s.passes) * 100) : 0);
  const visibleTabs: Array<[Tab, string]> = finished ? [['summary', 'Resumo'], ['live', 'Comentários'], ['players', 'Jogadores'], ['lineups', 'Escalações']] : [['live', 'Comentários']];
  const shownLines = view.lines.filter((l) => minor || l.major).slice().reverse();

  return (
    <div className="grid1">
      <section className="card">
        <div className="bar"><span className="muted small">{r.competitionName} · rodada {r.round} · {fmtDate(r.date)} · {WEATHER[r.conditions.weather]}{r.conditions.pitch === 'poor' ? ', gramado ruim' : ''}</span>
          <button className="secondary" onClick={onBack}>Voltar</button></div>
        <div className="scoreboard">
          <div className="team">{r.home.name}<small className="muted">{r.home.formation}</small></div>
          <div className="score">{sh} <span className="muted">x</span> {sa}</div>
          <div className="team">{r.away.name}<small className="muted">{r.away.formation}</small></div>
        </div>
        <p className="muted center small">
          {finished ? `Encerrado${DECIDED[r.decidedIn]}${r.shootout ? ` (${r.shootout.home} x ${r.shootout.away} nos pênaltis)` : ''}` : `Em andamento · ${view.minute}`}
          {finished && r.manOfTheMatch ? ` · Craque do jogo: ${r.manOfTheMatch.name}` : ''}
        </p>
        {r.detail === 'compact' && <p className="notice small">Relatório resumido: só eventos-chave (gols, cartões, substituições, lesões) foram guardados para jogos de outros clubes. Estatísticas e notas estão completas.</p>}
        <div className="row">
          {visibleTabs.map(([t, label]) => <button key={t} className={tab === t ? '' : 'secondary'} onClick={() => setTab(t)}>{label}</button>)}
          {!finished && (
            <>
              <button className="secondary" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pausar' : 'Continuar'}</button>
              <button className="secondary" onClick={() => setSpeed((s) => (s === '1x' ? '4x' : '1x'))}>Velocidade {speed === '1x' ? '1×' : '4×'}</button>
              <button className="secondary" onClick={() => { setShown(total); setPlaying(false); }}>Ir para o fim</button>
            </>
          )}
        </div>
      </section>

      {(tab === 'live' || !finished) && (
        <section className="card scroll tall">
          <label className="inline"><input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} /> Mostrar lances menores (faltas, impedimentos, chutes para fora)</label>
          {shownLines.length === 0 && <p className="muted">A partida vai começar…</p>}
          <ul className="comm">{shownLines.map((l) => <li key={l.i} className={`k-${l.kind}`}><b>{l.label}</b> {l.text}</li>)}</ul>
        </section>
      )}

      {tab === 'summary' && finished && (
        <section className="card">
          {r.attendance && <p className="muted">Público: <strong>{r.attendance.attendance.toLocaleString('pt-BR')}</strong> ({Math.round((r.attendance.attendance / r.attendance.capacity) * 100)}% do estádio) · Renda: <strong>{r.attendance.revenue.toLocaleString('pt-BR')}</strong> para o mandante</p>}
          <h2>Estatísticas</h2>
          <StatRow label="Posse de bola" a={st[0].possession} b={st[1].possession} fmt={(v) => `${v.toFixed(0)}%`} />
          <StatRow label="Finalizações" a={st[0].shots} b={st[1].shots} />
          <StatRow label="No alvo" a={st[0].shotsOnTarget} b={st[1].shotsOnTarget} />
          <StatRow label="Gols esperados (xG)" a={st[0].xg} b={st[1].xg} fmt={(v) => v.toFixed(2)} />
          <StatRow label="Chances criadas" a={st[0].chancesCreated} b={st[1].chancesCreated} />
          <StatRow label="Escanteios" a={st[0].corners} b={st[1].corners} />
          <StatRow label="Faltas" a={st[0].fouls} b={st[1].fouls} />
          <StatRow label="Cartões amarelos" a={st[0].yellowCards} b={st[1].yellowCards} />
          <StatRow label="Cartões vermelhos" a={st[0].redCards} b={st[1].redCards} />
          <StatRow label="Impedimentos" a={st[0].offsides} b={st[1].offsides} />
          <StatRow label="Passes" a={st[0].passes} b={st[1].passes} />
          <StatRow label="Aproveitamento de passes" a={pct(st[0])} b={pct(st[1])} fmt={(v) => `${v}%`} />
          <StatRow label="Desarmes" a={st[0].tackles} b={st[1].tackles} />
          <StatRow label="Interceptações" a={st[0].interceptions} b={st[1].interceptions} />
          <StatRow label="Defesas do goleiro" a={st[0].saves} b={st[1].saves} />
          {r.tactics && (
            <>
              <h2>Táticas</h2>
              <div className="grid2">{r.tactics.map((t, i) => (
                <p key={i} className="muted small"><strong>{i === 0 ? r.home.name : r.away.name}:</strong> mentalidade {MENTALITY_LABEL[t.mentality]?.toLowerCase()}, saída {BUILDUP_LABEL[t.buildUp]?.toLowerCase()},
                  ritmo {t.tempo}, amplitude {t.width}, linha defensiva {t.defensiveLine}, pressão {t.pressing}.</p>
              ))}</div>
            </>
          )}
          <h2>Gols</h2>
          {r.commentary.filter((c) => c.kind === 'goal').length === 0 ? <p className="muted">Sem gols.</p>
            : <ul className="comm">{r.commentary.filter((c) => c.kind === 'goal').map((l) => <li key={l.i} className="k-goal"><b>{l.label}</b> {l.text}</li>)}</ul>}
        </section>
      )}

      {tab === 'players' && finished && (
        <div className="grid2">
          {([0, 1] as const).map((t) => (
            <section className="card scroll" key={t}>
              <h2>{t === 0 ? r.home.name : r.away.name}</h2>
              <table><thead><tr><th>Pos.</th><th>Jogador</th><th>Min</th><th>Nota</th><th>G</th><th>A</th><th>Fin.</th></tr></thead>
                <tbody>{r.players.filter((p) => p.team === t).sort((a, b) => Number(b.starter) - Number(a.starter)).map((p) => (
                  <tr key={p.id} className={p.id === r.manOfTheMatch?.id ? 'mine' : ''}>
                    <td>{p.slot}</td><td>{p.name}{p.yellow ? ' 🟨' : ''}{p.red ? ' 🟥' : ''}{p.injuredDays ? ' 🩹' : ''}</td><td>{p.minutes}</td>
                    <td><strong>{p.rating.toFixed(1)}</strong></td><td>{p.goals || ''}</td><td>{p.assists || ''}</td><td>{p.shots || ''}</td></tr>
                ))}</tbody></table>
            </section>
          ))}
        </div>
      )}

      {tab === 'lineups' && finished && (
        <div className="grid2">
          {r.lineups.map((l) => <section className="card" key={l.clubId}><h2>{l.name} · {l.formation}</h2><Pitch lineup={l} players={view.players} />
            <p className="muted small">Círculos laranja indicam jogador fora da posição natural.</p></section>)}
        </div>
      )}
    </div>
  );
}
