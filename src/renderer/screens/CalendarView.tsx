import { useEffect, useState } from 'react';
import type { CalendarDto, FixtureDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtWeekday, unwrap } from '../util.ts';

interface Props { profileId: string; careerId: string; refreshKey: string }

function outcome(f: FixtureDto, clubId: string): 'V' | 'E' | 'D' | null {
  if (f.status !== 'played' || f.homeGoals == null || f.awayGoals == null) return null;
  const mine = f.homeId === clubId ? f.homeGoals : f.awayGoals;
  const theirs = f.homeId === clubId ? f.awayGoals : f.homeGoals;
  return mine > theirs ? 'V' : mine < theirs ? 'D' : 'E';
}

export function CalendarView({ profileId, careerId, refreshKey }: Props) {
  const [cal, setCal] = useState<CalendarDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    unwrap(window.api.getCalendar(profileId, careerId)).then((c) => { if (!stale) { setCal(c); setError(null); } })
      .catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!cal) return <p className="muted">Carregando calendário…</p>;
  const next = cal.fixtures.find((f) => f.status === 'scheduled');
  const played = cal.fixtures.filter((f) => f.status === 'played').length;

  return (
    <section className="card scroll tall">
      <p className="muted small">Temporada {cal.season} · {played} de {cal.fixtures.length} jogos disputados</p>
      <table>
        <thead><tr><th>Data</th><th>Rodada</th><th>Competição</th><th>Local</th><th>Adversário</th><th>Resultado</th></tr></thead>
        <tbody>
          {cal.fixtures.map((f) => {
            const home = f.homeId === cal.clubId;
            const o = outcome(f, cal.clubId);
            return (
              <tr key={f.id} className={f.id === next?.id ? 'selected' : ''}>
                <td>{fmtWeekday(f.date)} {fmtDate(f.date)}</td><td>{f.round}</td><td>{f.competitionName}</td>
                <td>{home ? 'Casa' : 'Fora'}</td><td>{home ? f.awayName : f.homeName}</td>
                <td>{o ? <><span className={`badge ${o}`}>{o}</span> {f.homeGoals} × {f.awayGoals}</> : <span className="muted">a disputar</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
