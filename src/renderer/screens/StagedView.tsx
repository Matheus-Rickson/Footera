import { useEffect, useState, type ReactNode } from 'react';
import { Trophy } from 'lucide-react';
import type { StagedViewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, unwrap } from '../util.ts';
import { ClubCrest } from '../flags.tsx';
import type { useImages } from '../images.ts';

interface Props {
  profileId: string; careerId: string; competitionId: string; refreshKey: string; picker: ReactNode; img: ReturnType<typeof useImages>;
  onClub: (id: string) => void; onOpenMatch?: (fixtureId: string) => void; extra?: ReactNode;
}

/** Campeonato em fases (Séries C/D e estaduais): abas por fase, com as tabelas dos grupos ou os confrontos de mata-mata. */
export function StagedView({ profileId, careerId, competitionId, refreshKey, picker, img, onClub, onOpenMatch, extra }: Props) {
  const [v, setV] = useState<StagedViewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    unwrap(window.api.getStagedView(profileId, careerId, competitionId)).then((r) => {
      if (stale) return;
      setV(r); setError(null);
      // abre na última fase principal já montada (a que está em disputa)
      setTab((cur) => (cur && r.stages.some((s) => s.id === cur && s.built) ? cur : [...r.stages].reverse().find((s) => s.built && !s.side)?.id ?? r.stages[0]!.id));
    }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, competitionId, refreshKey]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!v || v.id !== competitionId) return <p className="muted">Carregando fases…</p>;
  const stage = v.stages.find((s) => s.id === tab) ?? v.stages[0]!;
  const crest = (c: { id: string; name: string }, size = 16) => <ClubCrest id={c.id} name={c.name} size={size} src={img.url('clubs', c.id)} />;
  const clubBtn = (c: { id: string; name: string }) => <button className="cp-club cp-club-btn" title="Ver a ficha do clube" onClick={() => onClub(c.id)}>{crest(c)}{c.name}</button>;

  return (
    <div className="cp-root">
      <section className="card cp-head">
        <div className="cp-pick">{picker}{extra}</div>
        <p className="muted small">
          {v.regulation}
          {v.champion && <> · <Trophy size={13} aria-hidden="true" className="sv-gold" /> Campeão: <strong>{v.champion.name}</strong></>}
          {v.titles.filter((t) => t.club).map((t) => <span key={t.name}> · {t.name}: <strong>{t.club!.name}</strong></span>)}
          {v.promoted.length > 0 && <> · Acesso: {v.promoted.map((c) => c.name).join(', ')}</>}
          {v.relegated.length > 0 && <> · Rebaixados: {v.relegated.map((c) => c.name).join(', ')}</>}
        </p>
        <div className="sv-tabs" role="tablist" aria-label="Fases">
          {v.stages.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === stage.id} className={`sv-tab ${s.id === stage.id ? 'sv-tab-on' : ''} ${s.side ? 'sv-tab-side' : ''}`}
              disabled={!s.built} title={s.built ? '' : 'Fase ainda não definida'} onClick={() => setTab(s.id)}>{s.name}</button>
          ))}
        </div>
      </section>
      <section className="card cp-table-card">
        <div className="cp-scroll">
          {stage.kind === 'league' ? (
            <div className={`sv-groups ${stage.groups.length > 1 ? 'sv-groups-many' : ''}`}>
              {stage.groups.map((g) => (
                <div key={g.name} className="sv-group">
                  {stage.groups.length > 1 && <h3 className="sv-group-title">{g.name}</h3>}
                  <table className="cp-std sv-table">
                    <thead><tr><th>#</th><th>Clube</th><th className="center">Pts</th><th className="center">J</th><th className="center">V</th><th className="center">E</th><th className="center">D</th><th className="center">SG</th></tr></thead>
                    <tbody>{g.rows.map((r) => (
                      <tr key={r.clubId} className={r.isUserClub ? 'mine' : ''}>
                        <td>{r.position}</td><td>{clubBtn({ id: r.clubId, name: r.clubName })}</td><td className="center"><strong>{r.points}</strong></td>
                        <td className="center">{r.played}</td><td className="center">{r.won}</td><td className="center">{r.drawn}</td><td className="center">{r.lost}</td>
                        <td className="center">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <ul className="sv-ties">
              {stage.ties.map((t, i) => (
                <li key={i} className={`sv-tie ${t.involvesUser ? 'mine' : ''}`}>
                  <span className={`sv-side ${t.winner === t.a.id ? 'sv-win' : ''}`}>{clubBtn(t.a)}</span>
                  <span className="sv-score">
                    {t.games.map((g) => {
                      const aHome = g.homeId === t.a.id;
                      const sa = aHome ? g.homeGoals : g.awayGoals, sb = aHome ? g.awayGoals : g.homeGoals;
                      const label = sa == null ? fmtDate(g.date).slice(0, 5) : `${sa} x ${sb}`;
                      return g.hasReport && onOpenMatch ? <button key={g.fixtureId} className="cp-club-btn sv-game" title="Ver o relatório" onClick={() => onOpenMatch(g.fixtureId)}>{label}</button> : <span key={g.fixtureId} className="sv-game">{label}</span>;
                    })}
                    {t.aggregate && stage.legs > 1 && <em className="muted small">agregado {t.aggregate[0]} x {t.aggregate[1]}</em>}
                    {t.pens && <em className="muted small">pênaltis: {t.pens === t.a.id ? t.a.name : t.b.name}</em>}
                  </span>
                  <span className={`sv-side sv-side-b ${t.winner === t.b.id ? 'sv-win' : ''}`}>{clubBtn(t.b)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
