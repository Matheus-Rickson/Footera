import { useEffect, useState } from 'react';
import type { CompetitionInfoDto, CompetitionTableDto } from '../../shared/api.ts';
import { errMsg, TIEBREAKER_LABEL, unwrap } from '../util.ts';
import { useImages } from '../images.ts';
import { ClubCrest } from '../flags.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string }

export function CompetitionsView({ profileId, careerId, refreshKey }: Props) {
  const [comps, setComps] = useState<CompetitionInfoDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [table, setTable] = useState<CompetitionTableDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const img = useImages();

  useEffect(() => {
    let stale = false;
    unwrap(window.api.listCompetitions(profileId, careerId)).then((r) => {
      if (stale) return;
      setComps(r.competitions);
      setSelected((cur) => cur ?? r.userCompetitionId ?? r.competitions[0]?.id ?? null);
    }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId]);

  useEffect(() => {
    if (!selected) return;
    let stale = false;
    unwrap(window.api.getCompetitionTable(profileId, careerId, selected)).then((t) => { if (!stale) { setTable(t); setError(null); } })
      .catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, selected, refreshKey]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!comps || !table) return <p className="muted">Carregando competições…</p>;
  const logo = img.url('leagues', table.competition.leagueId);

  return (
    <>
      <section className="card">
        <div className="cp-pick">
          {logo && <img className="cp-league-logo" src={logo} alt={`Logo: ${table.competition.name}`} />}
          <label>Competição
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {comps.map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}
            </select>
          </label>
        </div>
        <p className="muted small">
          Rodadas concluídas: {table.roundsPlayed} de {table.totalRounds} · Desempate: {table.tiebreakers.map((t) => TIEBREAKER_LABEL[t] ?? t).join(' → ')}
        </p>
        {table.roundsPlayed === 0 && table.rows.every((r) => r.played === 0) && (
          <p className="notice">Nenhuma partida foi disputada ainda. A ordem abaixo é provisória (apenas desempate por código do clube) e não representa uma classificação.</p>
        )}
      </section>
      <section className="card scroll tall">
        <table>
          <thead><tr><th>#</th><th>Clube</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Pts</th></tr></thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.clubId} className={`${r.zone ?? ''} ${r.isUserClub ? 'mine' : ''}`}>
                <td>{r.position}</td><td><span className="cp-club"><ClubCrest id={r.clubId} name={r.clubName} size={18} src={img.url('clubs', r.clubId)} />{r.clubName}</span></td><td>{r.played}</td><td>{r.won}</td><td>{r.drawn}</td><td>{r.lost}</td>
                <td>{r.goalsFor}</td><td>{r.goalsAgainst}</td><td>{r.goalDiff}</td><td><strong>{r.points}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small legend">
          <span className="dot promotion" /> promoção <span className="dot continental" /> vaga continental <span className="dot relegation" /> rebaixamento
        </p>
      </section>
    </>
  );
}
