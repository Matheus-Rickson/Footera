import { useState } from 'react';
import {
  Activity, ArrowLeftRight, Award, Binoculars, Building2, CalendarDays, CalendarRange, Dumbbell, FastForward, FileSignature, HeartPulse, History, Landmark, LayoutDashboard,
  LogOut, Moon, Newspaper, Play, PlayCircle, SkipForward, Sprout, Sun, Swords, Trophy, UserCog, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { useTheme } from '../theme.ts';
import type { CareerOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, fmtNum, fmtWeekday, METHODOLOGY, unwrap } from '../util.ts';
import { PosPill, to20 } from '../playerUi.tsx';
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
import { SquadView } from './SquadView.tsx';
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
const NAV: Array<{ group: string; items: Array<{ id: View; label: string; icon: LucideIcon }> }> = [
  { group: 'Clube', items: [
    { id: 'overview', label: 'Visão geral', icon: LayoutDashboard }, { id: 'season', label: 'Temporada', icon: CalendarRange }, { id: 'squad', label: 'Elenco', icon: Users },
    { id: 'contracts', label: 'Contratos', icon: FileSignature }, { id: 'tactics', label: 'Táticas', icon: Swords },
  ] },
  { group: 'Competição', items: [
    { id: 'calendar', label: 'Calendário', icon: CalendarDays }, { id: 'matches', label: 'Partidas', icon: Activity }, { id: 'competitions', label: 'Competições', icon: Trophy },
  ] },
  { group: 'Mercado', items: [{ id: 'transfers', label: 'Transferências', icon: ArrowLeftRight }, { id: 'scouting', label: 'Olheiros', icon: Binoculars }] },
  { group: 'Desenvolvimento', items: [
    { id: 'youth', label: 'Categorias de base', icon: Sprout }, { id: 'training', label: 'Treinamento', icon: Dumbbell },
    { id: 'staff', label: 'Comissão técnica', icon: UserCog }, { id: 'medical', label: 'Departamento médico', icon: HeartPulse },
  ] },
  { group: 'Gestão', items: [{ id: 'finance', label: 'Finanças', icon: Wallet }, { id: 'infrastructure', label: 'Infraestrutura', icon: Building2 }, { id: 'board', label: 'Diretoria', icon: Landmark }] },
  { group: 'Carreira', items: [{ id: 'trophies', label: 'Sala de troféus', icon: Award }, { id: 'news', label: 'Notícias', icon: Newspaper }, { id: 'history', label: 'Histórico da carreira', icon: History }] },
];
const initials = (name: string) => name.replace(/[^A-Za-zÀ-ú ]/g, '').split(' ').filter((w) => w.length > 2 || /^[A-ZÀ-Ú]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'FC';

export function CareerDashboard({ overview, onExit, onRefresh }: { overview: CareerOverviewDto; onExit: () => void; onRefresh: () => Promise<void> }) {
  const [view, setView] = useState<View>('overview');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'info' | 'error'; text: string } | null>(null);
  const [match, setMatch] = useState<{ fixtureId: string; autoplay: boolean } | { live: true } | null>(null);
  const [player, setPlayer] = useState<string | null>(null);
  const [preselect, setPreselect] = useState<MarketPlayerDto | null>(null);
  const [lastSim, setLastSim] = useState<SimulationSummaryDto | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const [theme, toggleTheme] = useTheme();
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
    // ao vivo: a partida do seu clube só é gravada no fim, com as suas decisões (substituições e vestiário)
    if (live && next && next.status === 'scheduled' && next.date <= summary.gameDate) { setNote(null); setPlayer(null); setMatch({ live: true }); return; }
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
    <div className={match ? 'dash focus' : 'dash'}>
      {/* durante a partida o acompanhamento é o foco: sem menu lateral nem barra de ações */}
      {!match && <nav className="side" aria-label="Seções do jogo">
        <div className="brand">
          <span className="crest" aria-hidden="true">{club ? initials(club.name) : '—'}</span>
          <span>{club ? club.name : 'Sem clube'}<span className="brand-sub">{club ? club.league : 'Treinador desempregado'}</span></span>
        </div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((s) => {
              const locked = !club && !UNEMPLOYED_VIEWS.includes(s.id);
              const Icon = s.icon;
              return (
                <button key={s.id} className={`nav ${view === s.id ? 'active' : ''}`} disabled={locked} title={locked ? 'Sem clube: aceite uma proposta na Diretoria' : ''} aria-current={view === s.id ? 'page' : undefined}
                  onClick={() => { setNote(null); setPlayer(null); setMatch(null); setView(s.id); }}><Icon size={17} strokeWidth={1.9} aria-hidden="true" />{s.label}</button>
              );
            })}
          </div>
        ))}
        <div className="side-foot">
          <button className="nav" onClick={toggleTheme} title="Alternar entre tema escuro e claro">
            {theme === 'dark' ? <Sun size={17} strokeWidth={1.9} aria-hidden="true" /> : <Moon size={17} strokeWidth={1.9} aria-hidden="true" />}{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          </button>
          <button className="nav exit" onClick={onExit}><LogOut size={17} strokeWidth={1.9} aria-hidden="true" />Menu principal</button>
        </div>
      </nav>}

      <main className={!match && !player && (view === 'squad' || view === 'transfers') ? 'content content-fit' : 'content'}>
        {!match && <header className="topbar">
          <div className="row">
            <h1>{TITLES[view]}</h1>
            <span className="date-pill"><CalendarDays size={14} aria-hidden="true" />Temporada {summary.season}/{String(summary.season + 1).slice(2)} · {fmtWeekday(summary.gameDate)} {fmtDate(summary.gameDate)}</span>
          </div>
          <div className="row">
            {season.canStart ? (
              <button disabled={busy} onClick={() => go('season')}><CalendarRange size={16} aria-hidden="true" />Iniciar nova temporada</button>
            ) : overview.pendingMatches > 0 ? (
              <>
                <button className="secondary" disabled={busy} onClick={() => void simulate(false)}><Play size={16} aria-hidden="true" />Simular rodada ({overview.pendingMatches})</button>
                <button disabled={busy} onClick={() => void simulate(true)}><PlayCircle size={16} aria-hidden="true" />Acompanhar ao vivo</button>
              </>
            ) : (
              <>
                <button className="secondary" disabled={busy} onClick={() => void advance('day')}><SkipForward size={16} aria-hidden="true" />Avançar 1 dia</button>
                <button disabled={busy} onClick={() => void advance('nextMatchday')}><FastForward size={16} aria-hidden="true" />{season.complete ? `Avançar até ${fmtDate(season.turnoverDate)}` : 'Próxima rodada'}</button>
              </>
            )}
          </div>
        </header>}
        {note && <p className={note.kind === 'error' ? 'error' : note.kind === 'info' ? 'notice' : 'ok'} role={note.kind === 'error' ? 'alert' : 'status'}>{note.text}</p>}
        {overview.warnings.map((w) => <p key={w} className="error" role="alert">{w}</p>)}
        {season.complete && !match && view !== 'season' && (
          <p className="notice">A temporada {summary.season}/{String(summary.season + 1).slice(2)} terminou. {season.canStart ? 'Inicie a nova temporada' : `A virada acontece em ${fmtDate(season.turnoverDate)}`} na aba <button className="link" onClick={() => go('season')}>Temporada</button>; antes disso, renove os contratos que vencem.</p>
        )}

        {player && !match && <PlayerProfile profileId={profileId} careerId={careerId} playerId={player} onClose={() => setPlayer(null)} onNegotiate={negotiate} />}
        {match && ('live' in match
          ? <MatchReport profileId={profileId} careerId={careerId} live autoplay onBack={() => setMatch(null)}
              onLiveFinished={async (r) => { setLastSim(r); await onRefresh(); if (r.notes.length) setNote({ kind: 'info', text: r.notes.join(' ') }); }} />
          : <MatchReport profileId={profileId} careerId={careerId} fixtureId={match.fixtureId} autoplay={match.autoplay} onBack={() => setMatch(null)} />)}

        {!match && !player && view === 'overview' && club && (
          <div className="stats">
            <div className="stat-tile"><span className="stat-label">Classificação</span><span className="stat-value">{pos && pos.played > 0 ? `${pos.position}º de ${pos.total}` : '—'}</span>
              <span className="muted small">{pos ? (pos.played > 0 ? `${pos.points} pts em ${pos.played} jogo(s) · ` : 'liga ainda não começou · ') : 'sem competição'}{pos && <button className="link" onClick={() => go('competitions')}>ver tabela</button>}</span></div>
            <div className="stat-tile"><span className="stat-label">Caixa</span><span className={`stat-value ${club.balance < 0 ? 'neg' : ''}`}>{fmtMoney(club.balance)}</span><span className="muted small">saldo atual do clube</span></div>
            <div className="stat-tile"><span className="stat-label">Elenco</span><span className="stat-value">{squad.length}</span><span className="muted small">força média {to20(avg)}</span></div>
            <div className="stat-tile"><span className="stat-label">Folha mensal</span><span className="stat-value">{fmtMoney(payroll)}</span><span className="muted small">salários dos jogadores</span></div>
          </div>
        )}
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
              </section>
            ) : (
              <section className="card">
                <h2>Sem clube</h2>
                <p>O treinador está desempregado. O calendário continua e clubes com vaga fazem propostas conforme a sua reputação.</p>
                <button onClick={() => go('board')}>Ver propostas de emprego</button>
              </section>
            )}
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
            {lastSim && lastSim.results.some((m) => m.hasReport) && (
              <section className="card wide scroll">
                <h2>Resultados da rodada ({fmtDate(lastSim.date)})</h2>
                {lastSim.results.some((m) => !m.hasReport) && <p className="muted small">Só os países com simulação completa. Os placares dos demais estão em Competições.</p>}
                <table><tbody>{lastSim.results.filter((m) => m.hasReport).map((m) => (
                  <tr key={m.fixtureId} className={m.involvesUser ? 'mine' : ''}>
                    <td className="muted small">{m.competitionName}</td><td className="right">{m.homeName}</td>
                    <td className="center"><strong>{m.homeGoals} x {m.awayGoals}</strong></td><td>{m.awayName}</td>
                    <td><button className="secondary" onClick={() => setMatch({ fixtureId: m.fixtureId, autoplay: false })}>Relatório</button></td>
                  </tr>))}</tbody></table>
              </section>
            )}
          </div>
        )}

        {!match && !player && view === 'transfers' && <TransfersView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} preselect={preselect} onOpenPlayer={setPlayer} />}
        {!match && !player && view === 'finance' && <FinanceView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}
        {!match && !player && view === 'tactics' && <TacticsView profileId={profileId} careerId={careerId} onOpenPlayer={setPlayer} />}
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

        {!match && !player && view === 'squad' && <SquadView squad={squad} onOpenPlayer={setPlayer} />}
      </main>
    </div>
  );
}
