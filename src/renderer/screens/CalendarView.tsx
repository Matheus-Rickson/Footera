import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CalendarDto, FixtureDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtWeekday, unwrap } from '../util.ts';
import { daysBetween, monthGrid } from '../../shared/date.ts';
import { windowStatus } from '../../game/transfer-engine/transfer.ts';
import { ClubCrest } from '../flags.tsx';
import { useImages } from '../images.ts';

interface Props {
  profileId: string; careerId: string; refreshKey: string;
  club: { id: string; name: string; league: string } | null;
  /** abre o relatório da partida (só jogos disputados com relatório) */ onOpenMatch: (fixtureId: string) => void;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Resultado do ponto de vista do clube do usuário: V/E/D e o placar "nossos:deles". */
function outcome(f: FixtureDto, clubId: string): { o: 'V' | 'E' | 'D'; score: string } | null {
  if (f.status !== 'played' || f.homeGoals == null || f.awayGoals == null) return null;
  const home = f.homeId === clubId;
  const mine = home ? f.homeGoals : f.awayGoals, theirs = home ? f.awayGoals : f.homeGoals;
  return { o: mine > theirs ? 'V' : mine < theirs ? 'D' : 'E', score: `${mine}:${theirs}` };
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function CalendarView({ profileId, careerId, refreshKey, club, onOpenMatch }: Props) {
  const [cal, setCal] = useState<CalendarDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null); // 'AAAA-MM'
  const img = useImages();

  useEffect(() => {
    let stale = false;
    unwrap(window.api.getCalendar(profileId, careerId)).then((c) => { if (!stale) { setCal(c); setError(null); } })
      .catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey]);

  // meses da temporada do país do clube: do início até o mês anterior à virada (jul–jun, jan–dez, ou a transição jul–dez)
  const months = useMemo(() => {
    if (!cal) return [];
    const out: string[] = [];
    let [y, m] = cal.seasonStarts.split('-').map(Number) as [number, number];
    for (let guard = 0; guard < 24 && `${y}-${String(m).padStart(2, '0')}-01` < cal.turnover; guard++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }, [cal]);
  const byDate = useMemo(() => new Map((cal?.fixtures ?? []).map((f) => [f.date, f])), [cal]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!cal) return <p className="muted">Carregando calendário…</p>;
  const today = cal.gameDate;
  const current = month && months.includes(month) ? month : months.includes(today.slice(0, 7)) ? today.slice(0, 7) : months[0]!;
  const mi = months.indexOf(current);
  const [y, m] = current.split('-').map(Number) as [number, number];
  const grid = monthGrid(y, m);

  const next = cal.fixtures.find((f) => f.status === 'scheduled');
  const played = cal.fixtures.map((f) => outcome(f, cal.clubId)).filter((x) => x !== null);
  const rec = { V: played.filter((x) => x.o === 'V').length, E: played.filter((x) => x.o === 'E').length, D: played.filter((x) => x.o === 'D').length };
  const win = windowStatus(today);
  const winDays = daysBetween(today, (win.open ? win.closesOn : win.opensOn)!);
  const opp = (f: FixtureDto) => (f.homeId === cal.clubId ? { id: f.awayId, name: f.awayName } : { id: f.homeId, name: f.homeName });

  return (
    <div className="cl">
      <aside className="card cl-side">
        <div className="cl-today"><strong>{fmtWeekday(today)}, {fmtDate(today)}</strong><span className="muted">Temporada {cal.seasonLabel}</span></div>
        {club ? (
          <div className="cl-club"><ClubCrest id={club.id} name={club.name} size={84} src={img.url('clubs', club.id)} /><strong>{club.name}</strong><span className="muted small">{club.league}</span></div>
        ) : <p className="muted">Treinador sem clube.</p>}
        <div className="cl-record" aria-label="Campanha na temporada">
          <span><b className="cl-res V">V</b>{rec.V}</span><span><b className="cl-res E">E</b>{rec.E}</span><span><b className="cl-res D">D</b>{rec.D}</span>
          <em className="muted small">{played.length} de {cal.fixtures.length} jogos</em>
        </div>
        {next && (() => { const o = opp(next), d = daysBetween(today, next.date); return (
          <div className="cl-box">
            <span className="cl-box-label"><CalendarClock size={14} aria-hidden="true" />Próximo jogo</span>
            <div className="cl-next"><ClubCrest id={o.id} name={o.name} size={34} src={img.url('clubs', o.id)} />
              <div><strong>{o.name}</strong><span className="muted small">{next.cup?.neutral ? 'Campo neutro' : next.homeId === cal.clubId ? 'Casa' : 'Fora'} · {fmtWeekday(next.date)} {fmtDate(next.date)}</span>
                <span className={`small ${next.cup ? 'cl-next-cup' : 'muted'}`}>{next.cup ? `${next.cup.name} · ${next.cup.stage}${next.cup.leg ? ` (${next.cup.leg === 1 ? 'ida' : 'volta'})` : ''}` : next.competitionName}</span></div></div>
            <span className="cl-big">{d <= 0 ? 'hoje' : plural(d, 'dia', 'dias')}</span>
          </div>); })()}
        <div className="cl-box">
          <span className={`cl-box-label ${win.open ? 'pos' : ''}`}><ArrowLeftRight size={14} aria-hidden="true" />{win.open ? 'Janela de transferências aberta' : 'Janela de transferências fechada'}</span>
          <span className="cl-big">{plural(winDays, 'dia', 'dias')}</span>
          <span className="muted small">{win.open ? `até o fechamento (${fmtDate(win.closesOn!)})` : `até a abertura (${fmtDate(win.opensOn!)})`}</span>
        </div>
      </aside>

      <section className="card cl-main">
        <div className="cl-months" role="tablist" aria-label="Mês">
          <button className="nc-ghost" aria-label="Mês anterior" disabled={mi <= 0} onClick={() => setMonth(months[mi - 1]!)}><ChevronLeft size={16} aria-hidden="true" /></button>
          {months.map((k) => { const mm = Number(k.slice(5)); const has = cal.fixtures.some((f) => f.date.startsWith(k)); return (
            <button key={k} role="tab" aria-selected={k === current} className={`cl-month ${k === current ? 'on' : ''} ${has ? '' : 'empty'}`} onClick={() => setMonth(k)}>{MONTHS[mm - 1]}</button>); })}
          <button className="nc-ghost" aria-label="Próximo mês" disabled={mi >= months.length - 1} onClick={() => setMonth(months[mi + 1]!)}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
        <div className="cl-week">{WEEK.map((w) => <span key={w}>{w}</span>)}</div>
        <div className="cl-grid" style={{ gridTemplateRows: `repeat(${grid.length / 7}, minmax(0, 1fr))` }}>
          {grid.map((d) => {
            const f = byDate.get(d), out = f ? outcome(f, cal.clubId) : null, o = f ? opp(f) : null;
            const other = !d.startsWith(current), isToday = d === today;
            const cls = `cl-day ${other ? 'other' : ''} ${isToday ? 'today' : ''} ${out ? `res-${out.o}` : ''} ${f && !out ? 'upcoming' : ''} ${f?.cup ? 'cl-cup' : ''}`;
            const where = f ? (f.cup?.neutral ? 'Campo neutro' : f.homeId === cal.clubId ? 'Casa' : 'Fora') : '';
            const stage = f?.cup ? `${f.cup.stage}${f.cup.leg ? ` (${f.cup.leg === 1 ? 'ida' : 'volta'})` : ''}` : '';
            const label = f && o ? `${fmtDate(d)}: ${where} contra ${o.name}, ${f.competitionName}${stage ? `, ${stage}` : ''}${out ? `, ${out.o === 'V' ? 'vitória' : out.o === 'D' ? 'derrota' : 'empate'} por ${out.score}` : ''}` : fmtDate(d);
            const content = (
              <>
                <span className="cl-num">{Number(d.slice(8))}</span>
                {f && o && <>
                  <span className="cl-crest"><ClubCrest id={o.id} name={o.name} size={30} src={img.url('clubs', o.id)} /></span>
                  <span className="cl-info">
                    {out ? <span className="cl-score"><b className={`cl-res ${out.o}`}>{out.o}</b>{out.score}</span> : <span className="cl-vs">{o.name}</span>}
                    <span className="cl-meta">{where} · {f.cup ? f.cup.name : 'Liga'}</span>
                    {f.cup && <span className="cl-stage">{stage}</span>}
                  </span>
                </>}
              </>
            );
            return f && out && f.hasReport
              ? <button key={d} className={cls} title={`${label} — ver relatório`} aria-label={`${label}. Ver relatório`} onClick={() => onOpenMatch(f.id)}>{content}</button>
              : <div key={d} className={cls} title={label} aria-label={label}>{content}</div>;
          })}
        </div>
      </section>
    </div>
  );
}
