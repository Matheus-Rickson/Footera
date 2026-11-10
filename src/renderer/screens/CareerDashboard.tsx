import { useCallback, useState } from 'react';
import {
  ArrowLeftRight, Award, Binoculars, Building2, CalendarDays, CalendarRange, Dumbbell, FastForward, FileSignature, HeartPulse, History, Landmark, LayoutDashboard,
  LogOut, Mail, Moon, Newspaper, Play, PlayCircle, Sprout, Sun, Swords, Trophy, UserCog, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { useTheme } from '../theme.ts';
import type { CareerOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtWeekday, unwrap } from '../util.ts';
import type { MarketPlayerDto } from '../../shared/api.ts';
import { ContinueBox, type ContinueOutcome } from './ContinueBox.tsx';
import { MatchReport } from './MatchReport.tsx';
import { ClubPage } from './ClubPage.tsx';
import { OverviewView } from './OverviewView.tsx';
import { TacticsView } from './TacticsView.tsx';
import { FinanceView } from './FinanceView.tsx';
import { TransfersView } from './TransfersView.tsx';
import { CalendarView } from './CalendarView.tsx';
import { CompetitionsView } from './CompetitionsView.tsx';
import { SeasonView } from './SeasonView.tsx';
import { ContractsView } from './ContractsView.tsx';
import { CoachCareerView } from './CoachCareer.tsx';
import { TrophiesView } from './TrophyRoom.tsx';
import { SocialView } from './SocialView.tsx';
import { InboxView } from './InboxView.tsx';
import { ScoutingView } from './ScoutingView.tsx';
import { YouthView } from './YouthView.tsx';
import { PlayerProfile } from './PlayerProfile.tsx';
import { SquadView } from './SquadView.tsx';
import { TrainingView } from './TrainingView.tsx';
import { StaffView } from './StaffView.tsx';
import { MedicalView } from './MedicalView.tsx';
import { InfrastructureView } from './InfrastructureView.tsx';
import { BoardView } from './BoardView.tsx';
import { ClubCrest } from '../flags.tsx';
import { useImages } from '../images.ts';

type View = 'overview' | 'inbox' | 'squad' | 'tactics' | 'calendar' | 'competitions' | 'finance' | 'transfers' | 'season' | 'contracts' | 'news' | 'history' | 'trophies' | 'scouting' | 'youth' | 'staff' | 'training' | 'medical' | 'infrastructure' | 'board';
const TITLES: Record<View, string> = {
  overview: 'Visão geral', inbox: 'Caixa de entrada', squad: 'Elenco', tactics: 'Táticas', calendar: 'Calendário', competitions: 'Competições', finance: 'Finanças', transfers: 'Transferências',
  season: 'Temporada', contracts: 'Contratos', news: 'Notícias', history: 'Histórico da carreira', trophies: 'Sala de troféus', scouting: 'Olheiros', youth: 'Categorias de base', staff: 'Comissão técnica', training: 'Treinamento', medical: 'Departamento médico', infrastructure: 'Infraestrutura', board: 'Diretoria',
};
/** Sem clube (demitido) só fazem sentido as telas que não dependem de um elenco. */
const UNEMPLOYED_VIEWS: View[] = ['overview', 'inbox', 'season', 'competitions', 'board', 'trophies', 'news', 'history'];
const NAV: Array<{ group: string; items: Array<{ id: View; label: string; icon: LucideIcon }> }> = [
  { group: 'Clube', items: [
    { id: 'overview', label: 'Visão geral', icon: LayoutDashboard }, { id: 'inbox', label: 'Caixa de entrada', icon: Mail }, { id: 'season', label: 'Temporada', icon: CalendarRange }, { id: 'squad', label: 'Elenco', icon: Users },
    { id: 'contracts', label: 'Contratos', icon: FileSignature }, { id: 'tactics', label: 'Táticas', icon: Swords },
  ] },
  { group: 'Competição', items: [
    { id: 'calendar', label: 'Calendário', icon: CalendarDays }, { id: 'competitions', label: 'Competições', icon: Trophy },
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
  const [clubPage, setClubPage] = useState<string | null>(null);
  const [preselect, setPreselect] = useState<MarketPlayerDto | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const { coach, club, squad, summary } = overview;
  const { profileId, id: careerId } = summary;
  const next = overview.nextFixture;
  const pos = overview.leaguePosition;
  const season = overview.seasonStatus;
  const refreshKey = `${summary.gameDate}|${summary.season}|${pos?.played ?? 0}`;
  const go = (v: View) => { setNote(null); setMatch(null); setPlayer(null); setClubPage(null); setPreselect(null); setView(v); };
  const clearPreselect = useCallback(() => setPreselect(null), []);
  const negotiate = (p: MarketPlayerDto) => { setPlayer(null); setMatch(null); setNote(null); setPreselect({ ...p }); setView('transfers'); };

  async function simulate(live: boolean) {
    // ao vivo: a partida do seu clube só é gravada no fim, com as suas decisões (substituições e vestiário)
    if (live && next && next.status === 'scheduled' && next.date <= summary.gameDate) { setNote(null); setPlayer(null); setMatch({ live: true }); return; }
    setBusy(true); setNote(null); setMatch(null);
    try {
      const r = await unwrap(window.api.simulateMatchday(profileId, careerId));
      await onRefresh();
      if (live && r.userMatch) { setMatch({ fixtureId: r.userMatch.fixtureId, autoplay: true }); if (r.notes.length) setNote({ kind: 'info', text: r.notes.join(' ') }); }
      else setNote({ kind: r.notes.length ? 'info' : 'ok', text: `${r.simulated} partida(s) simuladas.${r.userMatch ? ` Seu jogo: ${r.userMatch.homeName} ${r.userMatch.homeGoals} x ${r.userMatch.awayGoals} ${r.userMatch.awayName}.` : ''} ${r.notes.join(' ')}` });
    } catch (e) { setNote({ kind: 'error', text: errMsg(e) }); } finally { setBusy(false); }
  }

  /** Botão Continuar: abre a caixa de tempo, que avança dia a dia até parar (jogo do seu time, decisão, dia escolhido, "Parar aqui"). */
  function startContinue() { setNote(null); setMatch(null); setPlayer(null); setBusy(true); setContinuing(true); }
  async function continueDone(o: ContinueOutcome) {
    setContinuing(false);
    try { await onRefresh(); } finally { setBusy(false); }
    if (o.error) { setNote({ kind: 'error', text: o.error }); return; }
    const when = `${fmtWeekday(o.date)} ${fmtDate(o.date)}`;
    if (o.stop === 'user_match') setNote({ kind: 'info', text: `${when}: dia de jogo do seu time. Acompanhe ao vivo ou simule a partida.` });
    else if (o.stop === 'decision') { setNote({ kind: 'info', text: `${when}: decisão importante na Caixa de entrada — ${o.message}` }); }
    else setNote({ kind: 'ok', text: `${when}. ${o.message}` });
  }
  const userMatchToday = !!next && next.status === 'scheduled' && next.date <= summary.gameDate;

  const img = useImages();
  return (
    <div className={match ? 'dash focus' : 'dash'}>
      {/* durante a partida o acompanhamento é o foco: sem menu lateral nem barra de ações */}
      {!match && <nav className="side" aria-label="Seções do jogo">
        <div className="brand">
          {club ? <ClubCrest id={club.id} name={club.name} size={32} src={img.url('clubs', club.id)} /> : <span className="crest" aria-hidden="true">—</span>}
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
                  onClick={() => { setNote(null); setPlayer(null); setClubPage(null); setMatch(null); setView(s.id); }}><Icon size={17} strokeWidth={1.9} aria-hidden="true" />{s.label}
                  {s.id === 'inbox' && overview.unreadInbox > 0 && <span className="nav-badge" aria-label={`${overview.unreadInbox} não lida(s)`}>{overview.unreadInbox > 99 ? '99+' : overview.unreadInbox}</span>}</button>
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

      <main className={!match && !player && !clubPage && (view === 'squad' || view === 'transfers' || view === 'calendar' || view === 'news' || view === 'inbox' || view === 'competitions' || view === 'overview' || view === 'board' || view === 'trophies' || view === 'history' || view === 'finance') ? 'content content-fit' : 'content'}>
        {!match && <header className="topbar">
          <div className="row">
            <h1>{TITLES[view]}</h1>
            <span className="date-pill" aria-label={`Hoje: ${fmtWeekday(summary.gameDate)}, ${fmtDate(summary.gameDate)}. Temporada ${summary.seasonLabel}`}>
              <span className="dpill-icon"><CalendarDays size={18} aria-hidden="true" /></span>
              <span className="dpill-day"><small>{fmtWeekday(summary.gameDate)}</small><b>{fmtDate(summary.gameDate)}</b></span>
              <span className="dpill-season"><small>Temporada</small><b>{summary.seasonLabel}</b></span>
            </span>
          </div>
          <div className="row">
            {season.canStart ? (
              <button disabled={busy} onClick={() => go('season')}><CalendarRange size={16} aria-hidden="true" />Iniciar nova temporada</button>
            ) : userMatchToday ? (
              <>
                <button className="secondary" disabled={busy} onClick={() => void simulate(false)}><Play size={16} aria-hidden="true" />Simular partida</button>
                <button disabled={busy} onClick={() => void simulate(true)}><PlayCircle size={16} aria-hidden="true" />Acompanhar ao vivo</button>
              </>
            ) : (
              <button className="ct-continue" disabled={busy} onClick={startContinue} title="Avança o tempo dia a dia; para no jogo do seu time, numa decisão importante ou quando você quiser">
                <FastForward size={16} aria-hidden="true" />Continuar</button>
            )}
          </div>
        </header>}
        {continuing && <ContinueBox profileId={profileId} careerId={careerId} startDate={summary.gameDate} onDone={(o) => void continueDone(o)} />}
        {note && <p className={note.kind === 'error' ? 'error' : note.kind === 'info' ? 'notice' : 'ok'} role={note.kind === 'error' ? 'alert' : 'status'}>{note.text}</p>}
        {overview.warnings.map((w) => <p key={w} className="error" role="alert">{w}</p>)}
        {season.complete && !match && view !== 'season' && (
          <p className="notice">A temporada {summary.seasonLabel} terminou. {season.canStart ? 'Inicie a nova temporada' : `A virada acontece em ${fmtDate(season.turnoverDate)}`} na aba <button className="link" onClick={() => go('season')}>Temporada</button>; antes disso, renove os contratos que vencem.</p>
        )}

        {clubPage && !player && !match && <ClubPage profileId={profileId} careerId={careerId} clubId={clubPage} onClose={() => setClubPage(null)} onOpenPlayer={setPlayer} onOpenMatch={(id) => setMatch({ fixtureId: id, autoplay: false })} />}
        {player && !match && <PlayerProfile profileId={profileId} careerId={careerId} playerId={player} onClose={() => setPlayer(null)} onNegotiate={negotiate} />}
        {match && ('live' in match
          ? <MatchReport profileId={profileId} careerId={careerId} live autoplay onBack={() => setMatch(null)}
              onLiveFinished={async (r) => { await onRefresh(); if (r.notes.length) setNote({ kind: 'info', text: r.notes.join(' ') }); }} />
          : <MatchReport profileId={profileId} careerId={careerId} fixtureId={match.fixtureId} autoplay={match.autoplay} onBack={() => setMatch(null)} />)}

        {!match && !player && !clubPage && view === 'overview' && <OverviewView overview={overview} refreshKey={refreshKey} onGo={(v) => go(v)} onOpenPlayer={setPlayer} onChanged={onRefresh} />}

        {!match && !player && !clubPage && view === 'transfers' && <TransfersView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} preselect={preselect} onPreselectUsed={clearPreselect} onOpenPlayer={setPlayer} />}
        {!match && !player && !clubPage && view === 'finance' && <FinanceView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}
        {!match && !player && !clubPage && view === 'tactics' && <TacticsView profileId={profileId} careerId={careerId} onOpenPlayer={setPlayer} />}
        {!match && !player && !clubPage && view === 'season' && <SeasonView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} onOpenContracts={() => go('contracts')} />}
        {!match && !player && !clubPage && view === 'contracts' && <ContractsView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && !clubPage && view === 'scouting' && <ScoutingView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} onOpenPlayer={setPlayer} onNegotiate={negotiate} />}
        {!match && !player && !clubPage && view === 'youth' && <YouthView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && !clubPage && view === 'staff' && <StaffView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && !clubPage && view === 'training' && <TrainingView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onOpenPlayer={setPlayer} />}
        {!match && !player && !clubPage && view === 'medical' && <MedicalView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onOpenPlayer={setPlayer} />}
        {!match && !player && !clubPage && view === 'infrastructure' && <InfrastructureView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} onOpenScouting={() => go('scouting')} />}
        {!match && !player && !clubPage && view === 'board' && <BoardView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && !clubPage && view === 'inbox' && <InboxView profileId={profileId} careerId={careerId} refreshKey={refreshKey} today={summary.gameDate} coachFirstName={coach.firstName} clubName={club?.name ?? null} onGo={(v) => go(v)} onChanged={() => void onRefresh()} onOpenPlayer={setPlayer} />}
        {!match && !player && !clubPage && view === 'news' && <SocialView profileId={profileId} careerId={careerId} refreshKey={refreshKey} today={summary.gameDate} />}
        {!match && !player && !clubPage && view === 'history' && <CoachCareerView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onChanged={onRefresh} />}
        {!match && !player && !clubPage && view === 'trophies' && <TrophiesView profileId={profileId} careerId={careerId} refreshKey={refreshKey} />}
        {!match && !player && !clubPage && view === 'calendar' && <CalendarView profileId={profileId} careerId={careerId} refreshKey={refreshKey} club={club} onOpenMatch={(id) => setMatch({ fixtureId: id, autoplay: false })} />}
        {!match && !player && !clubPage && view === 'competitions' && <CompetitionsView profileId={profileId} careerId={careerId} refreshKey={refreshKey} onOpenPlayer={setPlayer} onOpenMatch={(id) => setMatch({ fixtureId: id, autoplay: false })} onOpenClub={setClubPage} />}

        {!match && !player && !clubPage && view === 'squad' && <SquadView squad={squad} onOpenPlayer={setPlayer} />}
      </main>
    </div>
  );
}
