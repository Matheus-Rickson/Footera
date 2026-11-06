import { useEffect, useState } from 'react';
import type { CompetitionInfoDto, CompetitionTableDto, CupBracketDto } from '../../shared/api.ts';
import { errMsg, fmtDate, TIEBREAKER_LABEL, unwrap } from '../util.ts';
import { HelpTip } from '../help.tsx';
import { useImages } from '../images.ts';
import { ClubCrest } from '../flags.tsx';
import { ClubSheet } from '../clubSheet.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onOpenPlayer?: (id: string) => void }

export function CompetitionsView({ profileId, careerId, refreshKey, onOpenPlayer }: Props) {
  const [club, setClub] = useState<string | null>(null);
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

  const [cup, setCup] = useState<CupBracketDto | null>(null);
  const isCup = comps?.find((c) => c.id === selected)?.kind === 'cup';
  useEffect(() => {
    if (!selected || !comps) return;
    let stale = false;
    if (isCup) unwrap(window.api.getCupBracket(profileId, careerId, selected)).then((b) => { if (!stale) { setCup(b); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    else unwrap(window.api.getCompetitionTable(profileId, careerId, selected)).then((t) => { if (!stale) { setTable(t); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, selected, refreshKey, isCup, comps]);

  if (error) return <p className="error" role="alert">{error}</p>;
  const picker = comps && (
    <label>Competição
      <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
        <optgroup label="Ligas">{comps.filter((c) => c.kind === 'league').map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}</optgroup>
        <optgroup label="Copas nacionais">{comps.filter((c) => c.kind === 'cup').map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}</optgroup>
      </select>
    </label>
  );
  if (isCup) {
    if (!cup || cup.id !== selected) return <p className="muted">Carregando copa…</p>;
    return (
      <div className="cp-root">
        <section className="card"><div className="cp-pick">{picker}</div><CupHeader cup={cup} /></section>
        <section className="card cp-table-card"><div className="cp-scroll"><CupStages cup={cup} img={img} onClub={setClub} /></div></section>
        {club && <ClubSheet profileId={profileId} careerId={careerId} clubId={club} onClose={() => setClub(null)} onOpenPlayer={onOpenPlayer} />}
      </div>
    );
  }
  if (!comps || !table) return <p className="muted">Carregando competições…</p>;
  const logo = img.url('leagues', table.competition.leagueId);

  return (
    <div className="cp-root">
      <section className="card">
        <div className="cp-pick">
          {logo && <img className="cp-league-logo" src={logo} alt={`Logo: ${table.competition.name}`} />}
          {picker}
        </div>
        <p className="muted small">
          Rodadas concluídas: {table.roundsPlayed} de {table.totalRounds} · Desempate: {table.tiebreakers.map((t) => TIEBREAKER_LABEL[t] ?? t).join(' → ')}
        </p>
        {table.roundsPlayed === 0 && table.rows.every((r) => r.played === 0) && (
          <p className="notice">Nenhuma partida foi disputada ainda. A ordem abaixo é provisória (apenas desempate por código do clube) e não representa uma classificação.</p>
        )}
      </section>
      <section className="card cp-table-card">
        <div className="cp-scroll">
        <table>
          <thead><tr><th>#</th><th>Clube</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Pts</th></tr></thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.clubId} className={`${r.zone ?? ''} ${r.isUserClub ? 'mine' : ''}`}>
                <td>{r.position}</td><td><button className="cp-club cp-club-btn" title="Ver a ficha do clube" onClick={() => setClub(r.clubId)}><ClubCrest id={r.clubId} name={r.clubName} size={18} src={img.url('clubs', r.clubId)} />{r.clubName}</button></td><td>{r.played}</td><td>{r.won}</td><td>{r.drawn}</td><td>{r.lost}</td>
                <td>{r.goalsFor}</td><td>{r.goalsAgainst}</td><td>{r.goalDiff}</td><td><strong>{r.points}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="muted small">Clique em um clube para ver a ficha dele, com o técnico e o elenco.</p>
        <p className="muted small legend">
          <span className="dot promotion" /> promoção <span className="dot continental" /> vaga continental <span className="dot relegation" /> rebaixamento
        </p>
      </section>
      {club && <ClubSheet profileId={profileId} careerId={careerId} clubId={club} onClose={() => setClub(null)} onOpenPlayer={onOpenPlayer} />}
    </div>
  );
}

const SRC: Record<string, string> = { REG: 'regulamento oficial', SEC: 'fonte secundária', ADAPT: 'adaptação do FOOTERA' };
const STATUS: Record<CupBracketDto['status'], string> = { scheduled: 'a começar', in_progress: 'em andamento', finished: 'encerrada' };

/** Cabeçalho da copa: situação, campeão, regulamento usado e de onde vem cada regra. */
function CupHeader({ cup }: { cup: CupBracketDto }) {
  return (
    <div className="cp-cup-head">
      <p className="row">
        <strong>{cup.name}</strong><span className="muted small">{STATUS[cup.status]}</span>
        {cup.champion && <span className="cp-cup-champ">Campeão: {cup.champion.name}</span>}
        <HelpTip text={`Regras: ${cup.regulation}. Formato e entradas: ${SRC[cup.source.structure]}; desempate: ${SRC[cup.source.tiebreak]}; mando: ${SRC[cup.source.host]}; cartões: ${SRC[cup.source.discipline]}; premiação: ${SRC[cup.source.prizes]}. Detalhes em docs/COPAS_NACIONAIS.md.`} />
      </p>
      <p className="muted small">
        Cartões: {cup.discipline.yellowLimit} amarelos suspendem por 1 jogo{cup.discipline.resetAfter ? ` (zeram ao fim da ${cup.discipline.resetAfter})` : ''}; expulsão suspende; as suspensões da copa valem só nela.
        {' '}O campeão ganha: {cup.reward} — as competições continentais ainda não existem no jogo.
      </p>
    </div>
  );
}

/** Fases da copa com os confrontos (placar de cada jogo, agregado, pênaltis, folgas). */
function CupStages({ cup, img, onClub }: { cup: CupBracketDto; img: ReturnType<typeof useImages>; onClub: (id: string) => void }) {
  const name = (c: { id: string; name: string }, win: boolean) => (
    <button className={`cp-club cp-club-btn ${win ? 'cp-cup-win' : ''}`} onClick={() => onClub(c.id)}><ClubCrest id={c.id} name={c.name} size={16} src={img.url('clubs', c.id)} />{c.name}</button>
  );
  return (
    <div className="cp-cup">
      {cup.stages.map((st) => (
        <div key={st.name} className="cp-cup-stage">
          <h3>{st.name} <span className="muted small">{st.dates.map(fmtDate).join(' e ')}</span></h3>
          <p className="muted small">{st.rule}</p>
          {!st.drawn ? <p className="muted small">Sorteio quando a fase anterior terminar.</p> : (
            <table className="cp-cup-ties"><tbody>
              {st.ties.map((t) => (
                <tr key={t.id} className={t.mine ? 'mine' : ''}>
                  <td>{name(t.a, t.winnerId === t.a.id && !!t.b)}</td>
                  {t.b ? <>
                    <td className="cp-cup-score">{t.games.map((g) => (g.homeGoals == null ? <span key={g.fixtureId} className="muted">{fmtDate(g.date)}</span>
                      : <span key={g.fixtureId}>{g.homeId === t.a.id ? `${g.homeGoals} x ${g.awayGoals}` : `${g.awayGoals} x ${g.homeGoals}`}</span>))}</td>
                    <td>{name(t.b, t.winnerId === t.b.id)}</td>
                    <td className="muted small">{[t.aggregate ? `agregado ${t.aggregate[0]} x ${t.aggregate[1]}` : '', t.decidedIn === 'extra_time' ? 'na prorrogação' : '', t.shootout ? `pênaltis ${t.shootout[0]} x ${t.shootout[1]}` : '', t.games.some((g) => g.neutral) ? 'campo neutro' : ''].filter(Boolean).join(' · ')}</td>
                  </> : <td colSpan={3} className="muted small">folga (avança direto)</td>}
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      ))}
    </div>
  );
}

