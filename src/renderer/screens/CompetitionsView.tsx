import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompetitionInfoDto, CompetitionLeadersDto, CompetitionTableDto, CupBracketDto, FixtureDto } from '../../shared/api.ts';
import { errMsg, fmtDate, TIEBREAKER_LABEL, unwrap } from '../util.ts';
import { HelpTip } from '../help.tsx';
import { useImages } from '../images.ts';
import { ClubCrest } from '../flags.tsx';
import { ClubSheet } from '../clubSheet.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onOpenPlayer?: (id: string) => void; onOpenMatch?: (fixtureId: string) => void; onOpenClub?: (clubId: string) => void }

export function CompetitionsView({ profileId, careerId, refreshKey, onOpenPlayer, onOpenMatch, onOpenClub }: Props) {
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
        <optgroup label="Copas nacionais">{comps.filter((c) => c.kind === 'cup' && !c.supercup).map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}</optgroup>
        {comps.some((c) => c.supercup) && <optgroup label="Supercopas">{comps.filter((c) => c.supercup).map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}</optgroup>}
      </select>
    </label>
  );
  if (isCup) {
    if (!cup || cup.id !== selected) return <p className="muted">Carregando copa…</p>;
    return (
      <div className="cp-root">
        <section className="card"><div className="cp-pick">{img.url('cups', cup.logoId) && <img className="cp-league-logo" src={img.url('cups', cup.logoId)!} alt={`Logo: ${cup.name}`} />}{picker}</div><CupHeader cup={cup} /></section>
        <section className="card cp-table-card"><div className="cp-scroll"><CupStages cup={cup} img={img} onClub={setClub} /></div></section>
        {club && <ClubSheet profileId={profileId} careerId={careerId} clubId={club} onClose={() => setClub(null)} onOpenPlayer={onOpenPlayer} onOpenFull={onOpenClub} />}
      </div>
    );
  }
  if (!comps || !table) return <p className="muted">Carregando competições…</p>;
  const logo = img.url('leagues', table.competition.leagueId);
  const zones = new Set(table.rows.map((r) => r.zone).filter(Boolean));

  return (
    <div className="cp-root">
      <section className="card cp-head">
        <div className="cp-pick">
          {logo && <img className="cp-league-logo" src={logo} alt={`Logo: ${table.competition.name}`} />}
          {picker}
        </div>
        <p className="muted small">
          Rodadas concluídas: {table.roundsPlayed} de {table.totalRounds} · Desempate: {table.tiebreakers.map((t) => TIEBREAKER_LABEL[t] ?? t).join(' → ')}
          {table.roundsPlayed === 0 && table.rows.every((r) => r.played === 0) && ' · Nenhuma partida disputada: a ordem é provisória (só o desempate por código do clube).'}
        </p>
      </section>
      <div className="cp-grid">
        <section className="card cp-table-card">
          <h2 className="cp-card-title">Classificação</h2>
          <div className="cp-scroll">
            <table className="cp-std">
              <thead><tr><th>#</th><th>Clube</th><th className="center">Pts</th><th className="center">J</th><th className="center">V</th><th className="center">E</th><th className="center">D</th>
                <th className="center">GP</th><th className="center">GC</th><th className="center">SG</th><th className="center">Forma</th></tr></thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.clubId} className={`${r.zone ?? ''} ${r.isUserClub ? 'mine' : ''}`}>
                    <td>{r.position}</td>
                    <td><button className="cp-club cp-club-btn" title="Ver a ficha do clube" onClick={() => setClub(r.clubId)}><ClubCrest id={r.clubId} name={r.clubName} size={16} src={img.url('clubs', r.clubId)} />{r.clubName}</button></td>
                    <td className="center"><strong>{r.points}</strong></td><td className="center">{r.played}</td><td className="center">{r.won}</td><td className="center">{r.drawn}</td><td className="center">{r.lost}</td>
                    <td className="center">{r.goalsFor}</td><td className="center">{r.goalsAgainst}</td><td className="center">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                    <td className="center"><span className="cp-form" aria-label={`Últimos jogos: ${r.form.join(', ') || 'nenhum'}`}>{r.form.map((f, k) => <i key={k} className={`cp-form-${f}`}>{f}</i>)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small legend cp-legend">
            {zones.has('promotion') && <span><span className="dot promotion" />Acesso{table.zoneTargets.promotion ? ` (${table.zoneTargets.promotion})` : ''}</span>}
            {zones.has('continental') && <span><span className="dot continental" />Vaga continental</span>}
            {zones.has('relegation') && <span><span className="dot relegation" />Rebaixamento{table.zoneTargets.relegation ? ` (${table.zoneTargets.relegation})` : ''}</span>}
            <span className="cp-legend-tip">Clique em um clube para ver a ficha dele.</span>
          </p>
        </section>
        <div className="cp-side">
          <LeadersCard profileId={profileId} careerId={careerId} competitionId={table.competition.id} refreshKey={refreshKey} img={img} onClub={setClub} onOpenPlayer={onOpenPlayer} />
          <RoundCard profileId={profileId} careerId={careerId} table={table} refreshKey={refreshKey} img={img} onOpenMatch={onOpenMatch} />
        </div>
      </div>
      {club && <ClubSheet profileId={profileId} careerId={careerId} clubId={club} onClose={() => setClub(null)} onOpenPlayer={onOpenPlayer} onOpenFull={onOpenClub} />}
    </div>
  );
}

const LEADERS = {
  goals: { label: 'Artilheiros', col: 'G', title: 'Gols' },
  assists: { label: 'Assistências', col: 'A', title: 'Assistências' },
  cleanSheets: { label: 'Jogos sem sofrer gols', col: 'JSG', title: 'Jogos sem sofrer gols (goleiro com 60 minutos ou mais no gol)' },
} as const;
type LeaderKind = keyof typeof LEADERS;

/** Estatísticas dos jogadores: artilheiros, assistências e jogos sem sofrer gols (10 primeiros). */
function LeadersCard({ profileId, careerId, competitionId, refreshKey, img, onClub, onOpenPlayer }: {
  profileId: string; careerId: string; competitionId: string; refreshKey: string; img: ReturnType<typeof useImages>; onClub: (id: string) => void; onOpenPlayer?: (id: string) => void;
}) {
  const [kind, setKind] = useState<LeaderKind>('goals');
  const [data, setData] = useState<CompetitionLeadersDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    unwrap(window.api.getCompetitionLeaders(profileId, careerId, competitionId)).then((d) => { if (!stale) { setData(d); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, competitionId, refreshKey]);
  const rows = data && data.competitionId === competitionId ? data[kind] : null;
  return (
    <section className="card cp-side-card">
      <div className="cp-card-head">
        <h2 className="cp-card-title">Estatísticas dos jogadores</h2>
        <select className="cp-card-select" value={kind} onChange={(e) => setKind(e.target.value as LeaderKind)} aria-label="Estatística">
          {(Object.keys(LEADERS) as LeaderKind[]).map((k) => <option key={k} value={k}>{LEADERS[k].label}</option>)}
        </select>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : !rows || !data ? <p className="muted small">Carregando…</p>
        : !data.hasStats ? <p className="muted small">Competição com simulação simplificada: só placares, sem estatísticas dos jogadores.</p>
          : rows.length === 0 ? <p className="muted small">Ninguém pontuou nesta estatística ainda.</p> : (
            <div className="cp-scroll">
              <table className="cp-mini">
                <thead><tr><th>#</th><th>Nome</th><th>Clube</th><th className="center">J</th><th className="center" title={LEADERS[kind].title}>{LEADERS[kind].col}</th></tr></thead>
                <tbody>{rows.map((r, k) => (
                  <tr key={r.playerId}>
                    <td className="muted">{k + 1}</td>
                    <td>{onOpenPlayer ? <button className="cp-club-btn" onClick={() => onOpenPlayer(r.playerId)}>{r.name}</button> : r.name}</td>
                    <td><button className="cp-club cp-club-btn" onClick={() => onClub(r.clubId)}><ClubCrest id={r.clubId} name={r.clubName} size={14} src={img.url('clubs', r.clubId)} />{r.clubName}</button></td>
                    <td className="center">{r.appearances}</td><td className="center"><strong>{r.value}</strong></td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
    </section>
  );
}

/** Jogos de uma rodada da liga (começa na rodada em andamento; setas para as outras). */
function RoundCard({ profileId, careerId, table, refreshKey, img, onOpenMatch }: {
  profileId: string; careerId: string; table: CompetitionTableDto; refreshKey: string; img: ReturnType<typeof useImages>; onOpenMatch?: (fixtureId: string) => void;
}) {
  const compId = table.competition.id;
  const [round, setRound] = useState({ compId, n: table.currentRound });
  const n = round.compId === compId ? round.n : table.currentRound;
  const [games, setGames] = useState<{ key: string; list: FixtureDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRound({ compId, n: table.currentRound }); }, [compId, table.currentRound]);
  useEffect(() => {
    if (n < 1 || table.totalRounds === 0) return;
    let stale = false;
    unwrap(window.api.listRound(profileId, careerId, compId, n)).then((l) => { if (!stale) { setGames({ key: `${compId}:${n}`, list: l }); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, compId, n, refreshKey, table.totalRounds]);
  const list = games?.key === `${compId}:${n}` ? games.list : null;
  const dates = list ? [...new Set(list.map((g) => g.date))].sort() : [];
  const go = (d: number) => setRound({ compId, n: Math.min(table.totalRounds, Math.max(1, n + d)) });
  const userClub = table.rows.find((r) => r.isUserClub)?.clubId ?? null;
  return (
    <section className="card cp-side-card">
      <div className="cp-card-head">
        <h2 className="cp-card-title">Jogos da rodada</h2>
        {table.totalRounds > 0 && <div className="cp-round-nav">
          <button className="secondary cp-round-arrow" disabled={n <= 1} onClick={() => go(-1)} aria-label="Rodada anterior"><ChevronLeft size={16} aria-hidden="true" /></button>
          <span><strong>Rodada {n}</strong>{dates.length > 0 && <span className="muted small"> · {dates.length === 1 ? fmtDate(dates[0]!) : `${fmtDate(dates[0]!)} a ${fmtDate(dates[dates.length - 1]!)}`}</span>}</span>
          <button className="secondary cp-round-arrow" disabled={n >= table.totalRounds} onClick={() => go(1)} aria-label="Próxima rodada"><ChevronRight size={16} aria-hidden="true" /></button>
        </div>}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : table.totalRounds === 0 ? <p className="muted small">Sem partidas nesta competição.</p> : !list ? <p className="muted small">Carregando…</p> : (
        <div className="cp-scroll">
          <table className="cp-mini cp-round">
            <tbody>{list.map((g) => {
              const open = g.status === 'played' && g.hasReport ? onOpenMatch : undefined;
              return (
                <tr key={g.id} className={userClub && (g.homeId === userClub || g.awayId === userClub) ? 'mine' : ''}>
                  <td className="right"><span className="cp-club cp-round-home">{g.homeName}<ClubCrest id={g.homeId} name={g.homeName} size={14} src={img.url('clubs', g.homeId)} /></span></td>
                  <td className="center cp-round-score">{g.status === 'played'
                    ? (open ? <button className="cp-club-btn" title="Ver o relatório da partida" onClick={() => open(g.id)}><strong>{g.homeGoals} x {g.awayGoals}</strong></button> : <strong>{g.homeGoals} x {g.awayGoals}</strong>)
                    : <span className="muted small">{dates.length > 1 ? fmtDate(g.date).slice(0, 5) : 'x'}</span>}</td>
                  <td><span className="cp-club"><ClubCrest id={g.awayId} name={g.awayName} size={14} src={img.url('clubs', g.awayId)} />{g.awayName}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
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
        {cup.supercup ? 'Cartões: expulsão suspende; as suspensões da supercopa valem só nela.'
          : <>Cartões: {cup.discipline.yellowLimit} amarelos suspendem por 1 jogo{cup.discipline.resetAfter ? ` (zeram ao fim da ${cup.discipline.resetAfter})` : ''}; expulsão suspende; as suspensões da copa valem só nela.</>}
        {' '}{cup.supercup ? 'Vale só o troféu (sem prêmio em dinheiro).' : `O campeão ganha: ${cup.reward} — as competições continentais ainda não existem no jogo.`}
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

