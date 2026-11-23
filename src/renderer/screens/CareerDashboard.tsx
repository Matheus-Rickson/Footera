import { useCallback, useState } from 'react';
import { ArrowLeftRight, Briefcase, CalendarRange, FastForward, LogOut, Mail, Moon, Play, PlayCircle, Shield, Sprout, Sun, Trophy, Users, type LucideIcon } from 'lucide-react';
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
import { clubVars, useClubPalette } from '../clubColors.ts';

type View = 'overview' | 'inbox' | 'squad' | 'tactics' | 'calendar' | 'competitions' | 'finance' | 'transfers' | 'season' | 'contracts' | 'news' | 'history' | 'trophies' | 'scouting' | 'youth' | 'staff' | 'training' | 'medical' | 'infrastructure' | 'board';
const TITLES: Record<View, string> = {
  overview: 'Visão geral', inbox: 'Caixa de entrada', squad: 'Elenco', tactics: 'Táticas', calendar: 'Calendário', competitions: 'Competições', finance: 'Finanças', transfers: 'Transferências',
  season: 'Temporada', contracts: 'Contratos', news: 'Notícias', history: 'Histórico da carreira', trophies: 'Sala de troféus', scouting: 'Olheiros', youth: 'Categorias de base', staff: 'Comissão técnica', training: 'Treinamento', medical: 'Departamento médico', infrastructure: 'Infraestrutura', board: 'Diretoria',
};
/** Sem clube (demitido) só fazem sentido as telas que não dependem de um elenco. */
const UNEMPLOYED_VIEWS: View[] = ['overview', 'inbox', 'season', 'competitions', 'board', 'trophies', 'news', 'history'];
/** Barra superior: 6 abas, cada uma com as suas subseções (docs/INTERFACE.md). */
type Tab = 'club' | 'squad' | 'comp' | 'market' | 'dev' | 'mgmt';
const TABS: Array<{ id: Tab; label: string; icon: LucideIcon; items: View[] }> = [
  { id: 'club', label: 'Clube', icon: Shield, items: ['overview', 'inbox', 'news', 'season', 'trophies', 'history'] },
  { id: 'squad', label: 'Elenco', icon: Users, items: ['squad', 'tactics', 'contracts', 'training', 'medical'] },
  { id: 'comp', label: 'Competições', icon: Trophy, items: ['calendar', 'competitions'] },
  { id: 'market', label: 'Mercado', icon: ArrowLeftRight, items: ['transfers', 'scouting'] },
  { id: 'dev', label: 'Desenvolvimento', icon: Sprout, items: ['youth', 'staff', 'infrastructure'] },
  { id: 'mgmt', label: 'Gestão', icon: Briefcase, items: ['finance', 'board'] },
];
const tabOf = (v: View): Tab => TABS.find((t) => t.items.includes(v))!.id;
/** Nome curto da subseção na barra (o título completo fica em TITLES). */
const SHORT: Partial<Record<View, string>> = { history: 'Histórico', medical: 'Médico', youth: 'Base' };

export function CareerDashboard({ overview, onExit, onRefresh }: { overview: CareerOverviewDto; onExit: () => void; onRefresh: () => Promise<void> }) {
  const [view, setView] = useState<View>('overview');
  // última subseção visitada em cada aba: voltar à aba reabre onde o treinador estava
  const [lastIn, setLastIn] = useState<Partial<Record<Tab, View>>>({});
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
  // um aviso (não erro) que chegou fora da Visão geral espera até ser visto lá; quem sai da Visão geral para outra tela já o viu
  const go = (v: View) => { setNote((n) => (n && n.kind !== 'error' && !(view === 'overview' && v !== 'overview') ? n : null)); setMatch(null); setPlayer(null); setClubPage(null); setPreselect(null); setView(v); setLastIn((m) => ({ ...m, [tabOf(v)]: v })); };
  const locked = (v: View) => !club && !UNEMPLOYED_VIEWS.includes(v);
  const openTab = (t: (typeof TABS)[number]) => {
    const remembered = lastIn[t.id];
    const target = remembered && !locked(remembered) ? remembered : t.items.find((v) => !locked(v));
    if (target) go(target);
  };
  const palette = useClubPalette(club?.id);
  const clearPreselect = useCallback(() => setPreselect(null), []);
  /** avisos da carreira (fim de temporada, resultado do avanço, foto do treinador) só aparecem na tela principal */
  const onMain = view === 'overview' && !match && !player && !clubPage;
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
  const tab = tabOf(view);
  const activeTab = TABS.find((t) => t.id === tab)!;
  return (
    <div className={`dash club-scope ${match ? 'focus' : ''}`} style={clubVars(palette)}>
      {/* durante a partida o acompanhamento é o foco: sem barra superior */}
      {!match && <header className="nv">
        <div className="nv-top">
          <div className="nv-club">
            {club ? <ClubCrest id={club.id} name={club.name} size={38} src={img.url('clubs', club.id)} /> : <span className="nv-noclub" aria-hidden="true">—</span>}
            <span className="nv-club-text">
              <b>{club ? club.name : 'Sem clube'}</b>
              <small>{club ? <>{club.league}{pos ? <> · <strong>{pos.position}º</strong> de {pos.total}</> : null}</> : 'Treinador desempregado'}</small>
            </span>
          </div>
          <nav className="nv-tabs" aria-label="Seções do jogo">
            {TABS.map((t) => {
              const all = t.items.every(locked);
              const Icon = t.icon;
              const unread = t.id === 'club' && overview.unreadInbox > 0;
              return (
                <button key={t.id} className={`nv-tab ${t.id === tab ? 'nv-tab-on' : ''}`} disabled={all} aria-current={t.id === tab ? 'true' : undefined}
                  title={all ? 'Sem clube: aceite uma proposta na Diretoria' : undefined} onClick={() => openTab(t)}>
                  <Icon size={17} strokeWidth={2} aria-hidden="true" /><span>{t.label}</span>
                  {unread && <span className="nv-dot" aria-label={`${overview.unreadInbox} mensagem(ns) não lida(s)`} />}
                </button>
              );
            })}
          </nav>
          <div className="nv-actions">
            <button className={`nv-icon ${view === 'inbox' ? 'nv-icon-on' : ''}`} onClick={() => go('inbox')} title="Caixa de entrada" aria-label={`Caixa de entrada${overview.unreadInbox ? `: ${overview.unreadInbox} não lida(s)` : ''}`}>
              <Mail size={18} aria-hidden="true" />{overview.unreadInbox > 0 && <span className="nav-badge">{overview.unreadInbox > 99 ? '99+' : overview.unreadInbox}</span>}
            </button>
            {season.canStart ? (
              <button className="nv-go" disabled={busy} onClick={() => go('season')}><CalendarRange size={18} aria-hidden="true" />Nova temporada</button>
            ) : userMatchToday ? (
              <>
                <button className="secondary nv-sim" disabled={busy} onClick={() => void simulate(false)} title="Simula a partida sem acompanhar"><Play size={16} aria-hidden="true" />Simular</button>
                <button className="nv-go nv-matchday" disabled={busy} onClick={() => void simulate(true)}><PlayCircle size={18} aria-hidden="true" />Jogo ao vivo</button>
              </>
            ) : (
              <button className="nv-go ct-continue" disabled={busy} onClick={startContinue} title="Avança o tempo dia a dia; para no jogo do seu time, numa decisão importante ou quando você quiser">
                <FastForward size={18} aria-hidden="true" />Continuar</button>
            )}
            <button className="nv-icon" onClick={toggleTheme} title={theme === 'dark' ? 'Tema claro (dia de jogo)' : 'Tema escuro (estádio noturno)'} aria-label="Alternar tema">
              {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
            <button className="nv-icon" onClick={onExit} title="Menu principal" aria-label="Menu principal"><LogOut size={18} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="nv-sub">
          <nav className="nv-subtabs" aria-label={`Subseções de ${activeTab.label}`}>
            {activeTab.items.map((v) => (
              <button key={v} className={`nv-subtab ${v === view ? 'nv-subtab-on' : ''}`} disabled={locked(v)} aria-current={v === view ? 'page' : undefined}
                title={locked(v) ? 'Sem clube: aceite uma proposta na Diretoria' : TITLES[v]} onClick={() => go(v)}>
                {SHORT[v] ?? TITLES[v]}{v === 'inbox' && overview.unreadInbox > 0 && <span className="nv-count">{overview.unreadInbox > 99 ? '99+' : overview.unreadInbox}</span>}
              </button>
            ))}
          </nav>
          <span className="nv-date" aria-label={`Hoje: ${fmtWeekday(summary.gameDate)}, ${fmtDate(summary.gameDate)}. Temporada ${summary.seasonLabel}`}>
            <span className="nv-weekday">{fmtWeekday(summary.gameDate)}</span><b>{fmtDate(summary.gameDate)}</b><span className="nv-season">Temporada {summary.seasonLabel}</span>
          </span>
        </div>
      </header>}

      <main className={!match && !player && !clubPage && (view === 'squad' || view === 'tactics' || view === 'contracts' || view === 'transfers' || view === 'calendar' || view === 'news' || view === 'inbox' || view === 'competitions' || view === 'overview' || view === 'board' || view === 'trophies' || view === 'history' || view === 'finance' || view === 'training' || view === 'medical') ? 'content content-fit' : 'content'}>
        {!match && <h1 className="ui-sr">{TITLES[view]}</h1>}
        {continuing && <ContinueBox profileId={profileId} careerId={careerId} startDate={summary.gameDate} onDone={(o) => void continueDone(o)} />}
        {note && (note.kind === 'error' || onMain) && <p className={note.kind === 'error' ? 'error' : note.kind === 'info' ? 'notice' : 'ok'} role={note.kind === 'error' ? 'alert' : 'status'}>{note.text}</p>}
        {onMain && overview.warnings.map((w) => <p key={w} className="error" role="alert">{w}</p>)}
        {season.complete && onMain && (
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
