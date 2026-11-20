import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompetitionInfoDto, CompetitionLeadersDto, CompetitionTableDto, ConmebolRankingDto, CupBracketDto, FixtureDto } from '../../shared/api.ts';
import { errMsg, fmtDate, TIEBREAKER_LABEL, unwrap } from '../util.ts';
import { HelpTip } from '../help.tsx';
import { useImages } from '../images.ts';
import { ClubCrest, Flag } from '../flags.tsx';
import { ClubSheet } from '../clubSheet.tsx';
import { StagedView } from './StagedView.tsx';
import { TieList } from './TieList.tsx';

/** opção do seletor que abre o ranking de clubes da CONMEBOL (não é uma competição) */
const RANKING = '__conmebol_ranking';

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
  const info = comps?.find((c) => c.id === selected);
  const isCup = info?.kind === 'cup';
  // campeonato em fases: estaduais sempre na visão por fases; Séries C/D na tabela da 1ª fase, com o botão "Ver fases"
  const [phases, setPhases] = useState(false);
  const staged = info?.kind === 'state' || info?.kind === 'continental' || (!!info?.staged && phases);
  useEffect(() => {
    if (!selected || !comps) return;
    let stale = false;
    if (info?.kind === 'state' || info?.kind === 'continental' || selected === RANKING) return;
    if (isCup) unwrap(window.api.getCupBracket(profileId, careerId, selected)).then((b) => { if (!stale) { setCup(b); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    else unwrap(window.api.getCompetitionTable(profileId, careerId, selected)).then((t) => { if (!stale) { setTable(t); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, selected, refreshKey, isCup, comps]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="error" role="alert">{error}</p>;
  const picker = comps && (
    <label>Competição
      <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
        {comps.some((c) => c.kind === 'continental') && <optgroup label="Continentais (CONMEBOL)">
          {comps.filter((c) => c.kind === 'continental').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={RANKING}>Ranking de clubes CONMEBOL</option>
        </optgroup>}
        <optgroup label="Ligas">{comps.filter((c) => c.kind === 'league').map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}</optgroup>
        <optgroup label="Copas nacionais">{comps.filter((c) => (c.kind === 'cup' && !c.supercup) || c.scope === 'nacional').map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}</optgroup>
        {comps.some((c) => c.supercup) && <optgroup label="Supercopas">{comps.filter((c) => c.supercup).map((c) => <option key={c.id} value={c.id}>{c.country} — {c.name}</option>)}</optgroup>}
        {comps.some((c) => c.scope === 'estadual') && <optgroup label="Estaduais">{comps.filter((c) => c.scope === 'estadual').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        {comps.some((c) => c.scope === 'regional') && <optgroup label="Copas regionais">{comps.filter((c) => c.scope === 'regional').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        {comps.some((c) => c.scope === 'copa') && <optgroup label="Copas estaduais">{comps.filter((c) => c.scope === 'copa').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
      </select>
    </label>
  );
  const phasesBtn = info?.staged && info.kind === 'league'
    ? <button className="secondary cp-phases-btn" onClick={() => setPhases((p) => !p)}>{phases ? 'Ver tabela' : 'Ver fases'}</button> : null;
  if (staged && selected) {
    return (
      <>
        <StagedView profileId={profileId} careerId={careerId} competitionId={selected} refreshKey={refreshKey} picker={picker} img={img} onClub={setClub} onOpenMatch={onOpenMatch} extra={phasesBtn} />
        {club && <ClubSheet profileId={profileId} careerId={careerId} clubId={club} onClose={() => setClub(null)} onOpenPlayer={onOpenPlayer} onOpenFull={onOpenClub} />}
      </>
    );
  }
  if (selected === RANKING) {
    return (
      <>
        <ConmebolRanking profileId={profileId} careerId={careerId} refreshKey={refreshKey} picker={picker} img={img} onClub={setClub} />
        {club && <ClubSheet profileId={profileId} careerId={careerId} clubId={club} onClose={() => setClub(null)} onOpenPlayer={onOpenPlayer} onOpenFull={onOpenClub} />}
      </>
    );
  }
  if (isCup) {
    if (!cup || cup.id !== selected) return <p className="muted">Carregando copa…</p>;
    return (
      <>
        <CupView cup={cup} picker={picker} img={img} onClub={setClub} onOpenMatch={onOpenMatch} />
        {club && <ClubSheet profileId={profileId} careerId={careerId} clubId={club} onClose={() => setClub(null)} onOpenPlayer={onOpenPlayer} onOpenFull={onOpenClub} />}
      </>
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
          {picker}{phasesBtn}
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
        {' '}{cup.supercup ? 'Vale só o troféu (sem prêmio em dinheiro).' : `O campeão ganha: ${cup.reward}.`}
      </p>
    </div>
  );
}

/** Fases da copa com os confrontos (placar de cada jogo, agregado, pênaltis, folgas). */
/**
 * Copa nacional no mesmo formato das competições em fases: cabeçalho com o regulamento e uma aba por fase (abre na fase em disputa ou na
 * última sorteada); cada fase mostra as datas, a regra e os confrontos (ida e volta, agregado, prorrogação, pênaltis, campo neutro, folgas).
 */
function CupView({ cup, picker, img, onClub, onOpenMatch }: {
  cup: CupBracketDto; picker: ReactNode; img: ReturnType<typeof useImages>; onClub: (id: string) => void; onOpenMatch?: (fixtureId: string) => void;
}) {
  const current = () => {
    const drawn = cup.stages.map((st, i) => ({ st, i })).filter((x) => x.st.drawn);
    const open = drawn.find((x) => x.st.ties.some((t) => t.b && !t.winnerId));
    return (open ?? drawn[drawn.length - 1])?.i ?? 0;
  };
  const [tab, setTab] = useState<{ cupId: string; i: number }>(() => ({ cupId: cup.id, i: current() }));
  const idx = tab.cupId === cup.id ? Math.min(tab.i, cup.stages.length - 1) : current();
  const st = cup.stages[idx];
  const logo = img.url('cups', cup.logoId);
  return (
    <div className="cp-root">
      <section className="card cp-head">
        <div className="cp-pick">{logo && <img className="cp-league-logo" src={logo} alt={`Logo: ${cup.name}`} />}{picker}</div>
        <CupHeader cup={cup} />
        <div className="sv-tabs" role="tablist" aria-label="Fases">
          {cup.stages.map((s, i) => (
            <button key={s.name} role="tab" aria-selected={i === idx} className={`sv-tab ${i === idx ? 'sv-tab-on' : ''}`}
              disabled={!s.drawn} title={s.drawn ? '' : 'Sorteio quando a fase anterior terminar'} onClick={() => setTab({ cupId: cup.id, i })}>{s.name}</button>
          ))}
        </div>
      </section>
      <section className="card cp-table-card">
        {st && <p className="muted small tl-stage"><strong>{st.dates.map(fmtDate).join(' e ')}</strong> · {st.rule}{st.drawn && (() => { const n = st.ties.filter((t) => t.b).length; return ` · ${n} ${n === 1 ? 'confronto' : 'confrontos'}`; })()}</p>}
        <div className="cp-scroll">
          {!st || !st.drawn ? <p className="muted small">Sorteio quando a fase anterior terminar.</p> : (
            <TieList img={img} onClub={onClub} onOpenMatch={onOpenMatch} ties={st.ties.map((t) => ({
              key: t.id, a: t.a, b: t.b, mine: t.mine, winner: t.winnerId, games: t.games,
              notes: [t.aggregate && st.legs > 1 ? `agregado ${t.aggregate[0]} x ${t.aggregate[1]}` : '', t.decidedIn === 'extra_time' ? 'na prorrogação' : '',
                t.shootout ? `pênaltis ${t.shootout[0]} x ${t.shootout[1]}` : '', t.games.some((g) => g.neutral) ? 'campo neutro' : ''].filter(Boolean),
            }))} />
          )}
        </div>
      </section>
    </div>
  );
}


/** Ranking de Clubes CONMEBOL vigente (o dos potes e do mando desta temporada): top 50 e a posição do clube do usuário. */
function ConmebolRanking({ profileId, careerId, refreshKey, picker, img, onClub }: {
  profileId: string; careerId: string; refreshKey: string; picker: ReactNode; img: ReturnType<typeof useImages>; onClub: (id: string) => void;
}) {
  const [r, setR] = useState<ConmebolRankingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    unwrap(window.api.getConmebolRanking(profileId, careerId)).then((x) => { if (!stale) { setR(x); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!r) return <p className="muted">Carregando ranking…</p>;
  const pts = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return (
    <div className="cp-root">
      <section className="card cp-head">
        <div className="cp-pick">{picker}</div>
        <p className="muted small">
          Ranking vigente na temporada {r.season} (posição ao fim de {r.asOf}): define os potes dos sorteios e quem decide em casa na fase 3 da Libertadores.
          {r.user ? <> · Seu clube: <strong>{r.user.position}º</strong> de {r.total} ({pts(r.user.points)} pts)</> : ' · Seu clube não é de um país da CONMEBOL.'}
          <HelpTip text="Pontos das últimas 10 temporadas na Libertadores e na Sul-Americana (a mais recente vale 100%, a 10ª vale 10%), mais 50 pontos por título nacional da 1ª divisão com a mesma depreciação. Como o universo do jogo é fictício, cada clube começa com um ano histórico pela reputação, que perde peso a cada temporada e some em 10 anos. Detalhes em docs/CONTINENTAIS.md." />
        </p>
      </section>
      <section className="card cp-table-card">
        <div className="cp-scroll">
          <table className="cp-std cn-rank">
            <thead><tr><th>#</th><th>Clube</th><th>País</th><th className="center">Pontos</th></tr></thead>
            <tbody>{r.rows.map((row) => (
              <tr key={row.clubId} className={row.isUserClub ? 'mine' : ''}>
                <td>{row.position}º</td>
                <td><button className="cp-club cp-club-btn" title="Ver a ficha do clube" onClick={() => onClub(row.clubId)}><ClubCrest id={row.clubId} name={row.clubName} size={16} src={img.url('clubs', row.clubId)} />{row.clubName}</button></td>
                <td><span className="cn-country"><Flag code={row.countryCode} size={16} title={row.country} />{row.country}</span></td>
                <td className="center"><strong>{pts(row.points)}</strong></td>
              </tr>))}</tbody>
          </table>
        </div>
        {r.user && r.user.position > r.rows.length && <p className="muted small cp-legend">Seu clube está fora do top {r.rows.length}: {r.user.position}º, com {pts(r.user.points)} pontos.</p>}
      </section>
    </div>
  );
}
