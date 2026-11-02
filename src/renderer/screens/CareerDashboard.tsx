import { useState } from 'react';
import type { CareerOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, fmtWeekday, METHODOLOGY, unwrap } from '../util.ts';
import type { AdvanceMode, MarketPlayerDto, SimulationSummaryDto } from '../../shared/api.ts';
import { MatchReport } from './MatchReport.tsx';
import { MatchesView } from './MatchesView.tsx';
import { TacticsView } from './TacticsView.tsx';
import { FinanceView } from './FinanceView.tsx';
import { TransfersView } from './TransfersView.tsx';
import { CalendarView } from './CalendarView.tsx';
import { CompetitionsView } from './CompetitionsView.tsx';
import { SeasonView } from './SeasonView.tsx';
import { ContractsView } from './ContractsView.tsx';
import { HistoryView, NewsView, TrophiesView } from './CareerRecordsView.tsx';
import { ScoutingView } from './ScoutingView.tsx';
import { YouthView } from './YouthView.tsx';
import { PlayerProfile } from './PlayerProfile.tsx';
import { TrainingView } from './TrainingView.tsx';
import { StaffView } from './StaffView.tsx';
import { MedicalView } from './MedicalView.tsx';
import { InfrastructureView } from './InfrastructureView.tsx';
import { BoardView } from './BoardView.tsx';

type View = 'overview' | 'squad' | 'tactics' | 'calendar' | 'matches' | 'competitions' | 'finance' | 'transfers' | 'season' | 'contracts' | 'news' | 'history' | 'trophies' | 'scouting' | 'youth' | 'staff' | 'training' | 'medical' | 'infrastructure' | 'board';
const TITLES: Record<View, string> = {
  overview: 'Visão geral', squad: 'Elenco', tactics: 'Táticas', calendar: 'Calendário', matches: 'Partidas', competitions: 'Competições', finance: 'Finanças', transfers: 'Transferências',
  season: 'Temporada', contracts: 'Contratos', news: 'Notícias', history: 'Histórico da carreira', trophies: 'Sala de troféus', scouting: 'Olheiros', youth: 'Categorias de base', staff: 'Comissão técnica', training: 'Treinamento', medical: 'Departamento médico', infrastructure: 'Infraestrutura', board: 'Diretoria',
};
/** Sem clube (demitido) só fazem sentido as telas que não dependem de um elenco. */
const UNEMPLOYED_VIEWS: View[] = ['overview', 'season', 'competitions', 'matches', 'board', 'trophies', 'news', 'history'];
const SECTIONS: Array<{ id: View | null; label: string }> = [
  { id: 'overview', label: 'Visão geral' }, { id: 'season', label: 'Temporada' }, { id: 'squad', label: 'Elenco' }, { id: 'contracts', label: 'Contratos' }, { id: 'tactics', label: 'Táticas' },
  { id: 'calendar', label: 'Calendário' }, { id: 'matches', label: 'Partidas' }, { id: 'competitions', label: 'Competições' },
  { id: 'transfers', label: 'Transferências' }, { id: 'scouting', label: 'Olheiros' }, { id: 'youth', label: 'Categorias de base' },
  { id: 'staff', label: 'Comissão técnica' }, { id: 'training', label: 'Treinamento' }, { id: 'medical', label: 'Departamento médico' },
  { id: 'finance', label: 'Finanças' }, { id: 'infrastructure', label: 'Infraestrutura' }, { id: 'board', label: 'Diretoria' },
  { id: 'trophies', label: 'Sala de troféus' }, { id: 'news', label: 'Notícias' }, { id: 'history', label: 'Histórico da carreira' },
  { id: null, label: 'Configurações e salvamento' },
];

export function CareerDashboard({ overview, onExit, onRefresh }: { overview: CareerOverviewDto; onExit: () => void; onRefresh: () => Promise<void> }) {
  const [view, setView] = useState<View>('overview');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'info' | 'error'; text: string } | null>(null);
  const [match, setMatch] = useState<{ fixtureId: string; autoplay: boolean } | null>(null);
  const [player, setPlayer] = useState<string | null>(null);
  const [preselect, setPreselect] = useState<MarketPlayerDto | null>(null);
  const [lastSim, setLastSim] = useState<SimulationSummaryDto | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const { coach, club, squad, summary } = overview;
  const avg = squad.length ? Math.round((squad.reduce((s, p) => s + p.overall, 0) / squad.length) * 10) / 10 : 0;
  const payroll = squad.reduce((s, p) => s + p.salary, 0);
  const { profileId, id: careerId } = summary;
  const next = overview.nextFixture;
  const pos = overview.leaguePosition;
  const season = overview.seasonStatus;
  const refreshKey = `${summary.gameDate}|${summary.season}|${pos?.played ?? 0}`;
  const go = (v: View) => { setNote(null); setMatch(null); setPlayer(null); setPreselect(null); setView(v); };
  const negotiate = (p: MarketPlayerDto) => { setPlayer(null); setMatch(null); setNote(null); setPreselect({ ...p }); setView('transfers'); };

  async function simulate(live: boolean) {
    setBusy(true); setNote(null); setMatch(null);
    try {
      const r = await unwrap(window.api.simulateMatchday(profileId, careerId));
      setLastSim(r);
      await onRefresh();
      if (live && r.userMatch) { setMatch({ fixtureId: r.userMatch.fixtureId, autoplay: true }); if (r.notes.length) setNote({ kind: 'info', text: r.notes.join(' ') }); }
      else setNote({ kind: r.notes.length ? 'info' : 'ok', text: `${r.simulated} partida(s) simuladas.${r.userMatch ? ` Seu jogo: ${r.userMatch.homeName} ${r.userMatch.homeGoals} x ${r.userMatch.awayGoals} ${r.userMatch.awayName}.` : ''} ${r.notes.join(' ')}` });
    } catch (e) { setNote({ kind: 'error', text: errMsg(e) }); } finally { setBusy(false); }
  }

  async function advance(mode: AdvanceMode) {
    setBusy(true); setNote(null); setMatch(null);
    try {
      const r = await unwrap(window.api.advance(profileId, careerId, mode));
      if (r.advanced) { setNote({ kind: 'ok', text: `Avançou ${r.daysAdvanced} dia(s) até ${fmtDate(r.toDate)}. ${r.message}` }); await onRefresh(); }
      else setNote({ kind: 'info', text: r.message });
    } catch (e) { setNote({ kind: 'error', text: errMsg(e) }); } finally { setBusy(false); }
  }

  return (
    <div className="dash">
      <nav className="side" aria-label="Seções do jogo">
        <div className="brand">{club ? club.name : 'Sem clube'}</div>
        {SECTIONS.map((s) => s.id ? (
          <button key={s.label} className={`nav ${view === s.id ? 'active' : ''}`} disabled={!club && !UNEMPLOYED_VIEWS.includes(s.id)} title={!club && !UNEMPLOYED_VIEWS.includes(s.id) ? 'Sem clube: aceite uma proposta na Diretoria' : ''}
            onClick={() => { setNote(null); setPlayer(null); setView(s.id as View); }}>{s.label}</button>
        ) : (
          <button key={s.label} className="nav" disabled title="Ainda não implementado">{s.label}</button>
        ))}
        <button className="nav exit" onClick={onExit}>Menu principal</button>
      </nav>

      <main className="content">
        <header className="bar">
          <h1>{TITLES[view]}</h1>
          <div className="row">
            <span className="muted">Temporada {summary.season} · {fmtWeekday(summary.gameDate)} {fmtDate(summary.gameDate)}</span>
            {season.canStart ? (
              <button disabled={busy} onClick={() => go('season')}>Iniciar nova temporada</button>
            ) : overview.pendingMatches > 0 ? (
              <>
                <button className="secondary" disabled={busy} onClick={() => void simulate(false)}>Simular rodada ({overview.pendingMatches})</button>
                <button disabled={busy} onClick={() => void simulate(true)}>Acompanhar minuto a minuto</button>
              </>
            ) : (
              <>
                <button className="secondary" disabled={busy} onClick={() => void advance('day')}>Avançar 1 dia</button>
                <button disabled={busy} onClick={() => void advance('nextMatchday')}>{season.complete ? `Avançar até ${fmtDate(season.turnoverDate)} (nova temporada)` : 'Avançar até a próxima rodada'}</button>
              </>
            )}
          </div>
        </header>
        {note && <p className={note.kind === 'error' ? 'error' : note.kind === 'info' ? 'notice' : 'ok'} role={note.kind === 'error' ? 'alert' : 'status'}>{note.text}</p>}
        {overview.warnings.map((w) => <p key={w} className="error" role="alert">{w}</p>)}
        {season.complete && !match && view !== 'season' && (
          <p className="notice">A temporada {summary.season}/{String(summary.season + 1).slice(2)} terminou. {season.canStart ? 'Inicie a nova temporada' : `A virada acontece em ${fmtDate(season.turnoverDate)}`} na aba <button className="link" onClick={() => go('season')}>Temporada</button>; antes disso, renove os contratos que vencem.</p>
        )}

        {player && !match && <PlayerProfile profileId={profileId} careerId={careerId} playerId={player} onClose={() => setPlayer(null)} onNegotiate={negotiate} />}
        {match && <MatchReport profileId={profileId} careerId={careerId} fixtureId={match.fixtureId} autoplay={match.autoplay} onBack={() => setMatch(null)} />}

        {!match && !player && view === 'overview' && (
          <div className="grid2">
            <section className="card">
              <h2>Treinador</h2>
              <div className="row">
                {overview.photoDataUrl && imgOk
                  ? <img className="photo" src={overview.photoDataUrl} alt="Foto do treinador" onError={() => setImgOk(false)} />
                  : <div className="photo placeholder">{coach.firstName[0]}{coach.lastName[0]}</div>}
                <div>
                  <p><strong>{coach.firstName} {coach.lastName}</strong></p>
                  <p className="muted">{coach.age} anos · {overview.nationalityName}</p>
                  <p className="muted">Metodologia: {METHODOLOGY[coach.methodology].label}</p>
                  <p className="muted">Reputação: {coach.reputation}</p>
                </div>
              </div>
            </section>
            {club ? (
              <section className="card">
                <h2>Clube</h2>
                <p><strong>{club.name}</strong> — {club.city}</p>
                <p className="muted">{club.country} · {club.league}</p>
                <p className="muted">Estádio: {club.stadium} ({fmtNum(club.capacity)} lugares)</p>
                <p className="muted">Reputação {club.reputation} · Torcida {fmtNum(club.fans)}</p>
                <p className="muted">Saldo: {fmtNum(club.balance)}</p>
              </section>
            ) : (
              <section className="card">
                <h2>Sem clube</h2>
                <p>O treinador está desempregado. O calendário continua e clubes com vaga fazem propostas conforme a sua reputação.</p>
                <button onClick={() => go('board')}>Ver propostas de emprego</button>
              </section>
            )}
            <section className="card">
              <h2>Elenco</h2>
              <p>{squad.length} jogadores · força média {avg}</p>
              <p className="muted">Folha salarial mensal: {fmtNum(payroll)}</p>
            </section>
            <section className="card">
              <h2>Próxima partida</h2>
              {next ? (
                <>
                  <p><strong>{next.homeId === club?.id ? `${club?.name} × ${next.awayName}` : `${next.homeName} × ${club?.name}`}</strong></p>
                  <p className="muted">{fmtWeekday(next.date)} {fmtDate(next.date)} · rodada {next.round} · {next.homeId === club?.id ? 'em casa' : 'fora'}</p>
                  <p className="muted small">{next.competitionName}</p>
                </>
              ) : <p className="muted">Nenhuma partida agendada.</p>}
            </section>
            <section className="card">
              <h2>Classificação</h2>
              {pos ? (
                <>
                  <p><strong>{pos.position}º de {pos.total}</strong> · {pos.points} pts em {pos.played} jogo(s)</p>
                  {pos.played === 0 && <p className="muted small">Sem partidas disputadas: posição ainda sem significado.</p>}
                  <button className="secondary" onClick={() => { setNote(null); setView('competitions'); }}>Ver tabela</button>
                </>
              ) : <p className="muted">Clube sem competição nesta temporada.</p>}
            </section>
            {lastSim && lastSim.results.length > 0 && (
              <section className="card wide scroll">
                <h2>Resultados da rodada ({fmtDate(lastSim.date)})</h2>
                <table><tbody>{lastSim.results.map((m) => (
                  <tr key={m.fixtureId} className={m.involvesUser ? 'mine' : ''}>
                    <td className="muted small">{m.competitionName}</td><td className="right">{m.homeName}</td>
                    <td className="center"><strong>{m.homeGoals} x {m.awayGoals}</strong></td><td>{m.awayName}</td>
                    <td><button className="secondary" onClick={() => setMatch({ fixtureId: m.fixtureId, autoplay: false })}>Relatório</button></td>
                  </tr>))}</tbody></table>
              </section>
            )}
            <section className="card">
              <h2>Estado do desenvolvimento</h2>
              <p className="muted">A diretoria cobra objetivos e controla orçamentos (aba Diretoria). Os jogadores evoluem todo dia 1º do mês conforme o treino (aba Treinamento). Seu time joga com o esquema tático ativo (aba Táticas). Os dados desta tela vêm do banco do seu save.</p>
            </section>
          </div>
        )}

        {!match && !player && view === 'transfers' && <TransfersView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} preselect={preselect} onOpenPlayer={setPlayer} />}
        {!match && !player && view === 'finance' && <FinanceView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}
        {!match && !player && view === 'tactics' && <TacticsView profileId={profileId} careerId={careerId} />}
        {!match && !player && view === 'season' && <SeasonView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} onOpenContracts={() => go('contracts')} />}
        {!match && !player && view === 'contracts' && <ContractsView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && view === 'scouting' && <ScoutingView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} onOpenPlayer={setPlayer} onNegotiate={negotiate} />}
        {!match && !player && view === 'youth' && <YouthView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && view === 'staff' && <StaffView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && view === 'training' && <TrainingView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onOpenPlayer={setPlayer} />}
        {!match && !player && view === 'medical' && <MedicalView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onOpenPlayer={setPlayer} />}
        {!match && !player && view === 'infrastructure' && <InfrastructureView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && view === 'board' && <BoardView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && view === 'news' && <NewsView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}
        {!match && !player && view === 'history' && <HistoryView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}
        {!match && !player && view === 'trophies' && <TrophiesView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}
        {!match && !player && view === 'matches' && <MatchesView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onOpen={(id) => setMatch({ fixtureId: id, autoplay: false })} />}
        {!match && !player && view === 'calendar' && <CalendarView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}
        {!match && !player && view === 'competitions' && <CompetitionsView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}

        {!match && !player && view === 'squad' && (
          <section className="card scroll tall">
            <table>
              <thead><tr><th>Pos.</th><th>Jogador</th><th>Idade</th><th>Força</th><th>Pot. estimado</th><th>Condição</th><th>Moral</th><th>Salário</th><th>Contrato até</th></tr></thead>
              <tbody>
                {squad.map((p) => (
                  <tr key={p.id}><td>{p.position}</td><td>{p.name}</td><td>{p.age}</td><td>{p.overall}</td><td>{p.potentialEstimated}</td>
                    <td>{Math.round(p.condition)}%</td><td>{Math.round(p.morale)}</td><td>{fmtNum(p.salary)}</td><td>{fmtDate(p.contractEnd)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
