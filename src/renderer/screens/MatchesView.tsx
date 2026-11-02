import { useEffect, useState } from 'react';
import type { CalendarDto, CompetitionInfoDto, FixtureDto } from '../../shared/api.ts';
import { errMsg, fmtDate, unwrap } from '../util.ts';

interface Props { profileId: string; careerId: string; refreshKey: string; onOpen: (fixtureId: string) => void }

function Row({ f, onOpen, mine }: { f: FixtureDto; onOpen: (id: string) => void; mine?: string }) {
  const played = f.status === 'played';
  return (
    <tr className={mine && (f.homeId === mine || f.awayId === mine) ? 'mine' : ''}>
      <td>{fmtDate(f.date)}</td><td className="right">{f.homeName}</td>
      <td className="center"><strong>{played ? `${f.homeGoals} x ${f.awayGoals}` : 'x'}</strong></td><td>{f.awayName}</td>
      <td>{played ? <button className="secondary" onClick={() => onOpen(f.id)}>Relatório</button> : <span className="muted small">a disputar</span>}</td>
    </tr>
  );
}

export function MatchesView({ profileId, careerId, refreshKey, onOpen }: Props) {
  const [cal, setCal] = useState<CalendarDto | null>(null);
  const [comps, setComps] = useState<CompetitionInfoDto[]>([]);
  const [comp, setComp] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(0);
  const [fixtures, setFixtures] = useState<FixtureDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    Promise.all([unwrap(window.api.getCalendar(profileId, careerId)), unwrap(window.api.listCompetitions(profileId, careerId))])
      .then(([c, l]) => { if (stale) return; setCal(c); setComps(l.competitions); setComp((cur) => cur ?? l.userCompetitionId ?? l.competitions[0]?.id ?? null); })
      .catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey]);

  useEffect(() => {
    if (!comp) return;
    let stale = false;
    unwrap(window.api.getCompetitionTable(profileId, careerId, comp)).then((t) => {
      if (stale) return;
      setTotalRounds(t.totalRounds); setRound((r) => (r > t.totalRounds || r < 1 ? Math.max(t.roundsPlayed, 1) : r));
    }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, comp, refreshKey]);

  useEffect(() => {
    if (!comp || totalRounds < 1) return;
    let stale = false;
    unwrap(window.api.listRound(profileId, careerId, comp, Math.min(round, totalRounds))).then((f) => { if (!stale) setFixtures(f); })
      .catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, comp, round, totalRounds, refreshKey]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!cal) return <p className="muted">Carregando partidas…</p>;
  const mine = cal.fixtures.filter((f) => f.status === 'played').reverse();

  return (
    <div className="grid1">
      <section className="card">
        <h2>Meus jogos</h2>
        {mine.length === 0 ? <p className="muted">Nenhuma partida disputada ainda.</p> : (
          <table><tbody>{mine.map((f) => <Row key={f.id} f={f} onOpen={onOpen} mine={cal.clubId} />)}</tbody></table>
        )}
      </section>
      <section className="card">
        <h2>Resultados por rodada</h2>
        <div className="row">
          <select value={comp ?? ''} onChange={(e) => setComp(e.target.value)}>{comps.map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}</select>
          <button className="secondary" disabled={round <= 1} onClick={() => setRound((r) => r - 1)}>◀</button>
          <span>Rodada {Math.min(round, totalRounds)} de {totalRounds}</span>
          <button className="secondary" disabled={round >= totalRounds} onClick={() => setRound((r) => r + 1)}>▶</button>
        </div>
        <table><tbody>{fixtures.map((f) => <Row key={f.id} f={f} onOpen={onOpen} mine={cal.clubId} />)}</tbody></table>
      </section>
    </div>
  );
}
