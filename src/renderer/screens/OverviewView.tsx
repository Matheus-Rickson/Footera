import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Landmark, MessageCircle, MessagesSquare, Newspaper, X } from 'lucide-react';
import type { BoardOverviewDto, BoardStatus, BoardTopicDto, CareerOverviewDto, CompetitionTableDto, ConversationsDto, PlayerTopicDto, PromiseDto, SocialPostDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, fmtWeekday, METHODOLOGY, unwrap } from '../util.ts';
import { Stars } from '../stars.tsx';
import { ClubCrest } from '../flags.tsx';
import { PosPill } from '../playerUi.tsx';
import { useImages } from '../images.ts';

type Go = 'competitions' | 'news' | 'board' | 'contracts' | 'inbox';
interface Props {
  overview: CareerOverviewDto; refreshKey: string; onGo: (v: Go) => void; onOpenPlayer: (id: string) => void; onChanged: () => Promise<void>;
}

const STATUS_LABEL: Record<BoardStatus, string> = { pending: 'a começar', on_track: 'no caminho', close: 'perto', off_track: 'fora da meta' };
const TOPICS: Array<{ id: PlayerTopicDto; label: string; help: string }> = [
  { id: 'praise', label: 'Elogiar o desempenho', help: 'Funciona com quem vive boa fase (forma alta); fora de hora, irrita.' },
  { id: 'demand', label: 'Cobrar mais empenho', help: 'Quem está mal de forma e de cabeça boa reage (forma sobe); desanimado ou jogando bem, a moral cai.' },
  { id: 'promise_minutes', label: 'Prometer mais minutos', help: 'Moral +8 agora. Cobrada depois de 5 jogos do clube: média de 45 min por jogo (+4) ou moral −15.' },
  { id: 'promise_renewal', label: 'Prometer renovação', help: 'Contrato terminando em até 18 meses. Moral +6 agora; renovar em 60 dias (+4) ou moral −15.' },
];
const meterClass = (v: number) => (v >= 55 ? '' : v >= 35 ? 'mid' : 'low');

/** Visão geral no esboço do usuário: treinador, notícias, conversas e promessas, tabela da liga, diretoria/torcida/objetivos. */
export function OverviewView({ overview, refreshKey, onGo, onOpenPlayer, onChanged }: Props) {
  const { profileId, id: careerId } = overview.summary;
  const club = overview.club;
  const [talks, setTalks] = useState<ConversationsDto | null>(null);
  const [boardDto, setBoard] = useState<BoardOverviewDto | null>(null);
  const [posts, setPosts] = useState<SocialPostDto[] | null>(null);
  const [table, setTable] = useState<CompetitionTableDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: 'player'; playerId: string | null } | { kind: 'board' } | null>(null);

  useEffect(() => {
    let stale = false;
    const fail = (e: unknown) => { if (!stale) setError(errMsg(e)); };
    unwrap(window.api.getConversations(profileId, careerId)).then((r) => { if (!stale) setTalks(r); }).catch(fail);
    unwrap(window.api.getBoard(profileId, careerId)).then((r) => { if (!stale) setBoard(r); }).catch(fail);
    unwrap(window.api.getSocialFeed(profileId, careerId, 'all')).then((r) => { if (!stale) setPosts(r.posts.slice(0, 6)); }).catch(fail);
    const comp = overview.leaguePosition?.competitionId;
    if (comp) unwrap(window.api.getCompetitionTable(profileId, careerId, comp)).then((r) => { if (!stale) setTable(r); }).catch(fail);
    else setTable(null);
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey, overview.leaguePosition?.competitionId]);

  const afterTalk = async (r: ConversationsDto) => { setTalks(r); await onChanged(); };

  return (
    <div className="ov">
      {error && <p className="error ov-error" role="alert">{error}</p>}
      <CoachCard overview={overview} />
      <NewsCard posts={posts} onMore={() => onGo('news')} />
      <section className="card ov-talk">
        <div className="ov-card-head">
          <h2><MessagesSquare size={17} aria-hidden="true" />Conversas e promessas</h2>
          {club && <div className="row">
            <button className="secondary" onClick={() => setModal({ kind: 'player', playerId: null })}><MessageCircle size={15} aria-hidden="true" />Conversar com jogador</button>
            <button className="secondary" onClick={() => setModal({ kind: 'board' })}><Landmark size={15} aria-hidden="true" />Falar com a diretoria</button>
          </div>}
        </div>
        {!club ? <p className="muted">Sem clube: não há elenco nem diretoria para conversar. <button className="link" onClick={() => onGo('board')}>Ver propostas de emprego</button></p>
          : !talks ? <p className="muted small">Carregando…</p> : <TalksBody talks={talks} onTalk={(id) => setModal({ kind: 'player', playerId: id })} onOpenPlayer={onOpenPlayer} />}
      </section>
      <MiniTable table={table} hasClub={!!club} onMore={() => onGo('competitions')} />
      <BoardCard board={boardDto} onMore={() => onGo('board')} />
      {modal?.kind === 'player' && talks && <PlayerTalkModal profileId={profileId} careerId={careerId} talks={talks} initial={modal.playerId} onDone={afterTalk} onClose={() => setModal(null)} />}
      {modal?.kind === 'board' && talks && <BoardTalkModal profileId={profileId} careerId={careerId} talks={talks} onDone={afterTalk} onClose={() => setModal(null)} />}
    </div>
  );
}

function CoachCard({ overview }: { overview: CareerOverviewDto }) {
  const { coach, club, squad } = overview;
  const [imgOk, setImgOk] = useState(true);
  const img = useImages();
  const next = overview.nextFixture;
  return (
    <section className="card ov-coach">
      <div className="ov-coach-main">
        {overview.photoDataUrl && imgOk ? <img className="photo ov-photo" src={overview.photoDataUrl} alt="Foto do treinador" onError={() => setImgOk(false)} />
          : <div className="photo placeholder ov-photo">{coach.firstName[0]}{coach.lastName[0]}</div>}
        <div className="ov-coach-info">
          <strong>{coach.firstName} {coach.lastName}</strong>
          <span className="muted small">{coach.age} anos · {overview.nationalityName} · {METHODOLOGY[coach.methodology].label}</span>
          <Stars reputation={coach.reputation} label="Reputação do treinador" />
        </div>
      </div>
      {club ? (
        <div className="ov-coach-club">
          <span className="cp-club"><ClubCrest id={club.id} name={club.name} size={18} src={img.url('clubs', club.id)} /><strong>{club.name}</strong></span>
          <span className="muted small">{club.league} · caixa <span className={club.balance < 0 ? 'neg' : ''}>{fmtMoney(club.balance)}</span> · {squad.length} jogadores</span>
          {next && <span className="small ov-next"><CalendarDays size={13} aria-hidden="true" />Próximo jogo: {next.homeId === club.id ? `× ${next.awayName} (casa)` : `× ${next.homeName} (fora)`} · {fmtWeekday(next.date)} {fmtDate(next.date)}</span>}
        </div>
      ) : <p className="muted small">Sem clube no momento.</p>}
    </section>
  );
}

function NewsCard({ posts, onMore }: { posts: SocialPostDto[] | null; onMore: () => void }) {
  return (
    <section className="card ov-news">
      <div className="ov-card-head"><h2><Newspaper size={17} aria-hidden="true" />Notícias</h2><button className="link" onClick={onMore}>ver todas</button></div>
      {!posts ? <p className="muted small">Carregando…</p> : posts.length === 0 ? <p className="muted small">Nenhuma notícia ainda.</p> : (
        <ul className="ov-news-list">{posts.map((p) => (
          <li key={p.id} className={p.mine ? 'ov-news-mine' : ''}>
            <span className="muted small">{p.author.name} · {fmtDate(p.date).slice(0, 5)}</span>
            <p>{p.text}</p>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function PromiseRow({ p, onOpenPlayer }: { p: PromiseDto; onOpenPlayer: (id: string) => void }) {
  return (
    <li className={`tk-promise tk-${p.status}`}>
      <span className="tk-who">{p.playerId ? <button className="cp-club-btn" onClick={() => onOpenPlayer(p.playerId!)}>{p.playerName}</button> : 'Diretoria'}</span>
      <span>{p.label}</span>
      <span className="muted small">{p.status === 'open' ? `${p.progress} · prazo ${fmtDate(p.due)}` : `${p.progress} em ${fmtDate(p.resolvedOn ?? p.due)}`}</span>
    </li>
  );
}

function TalksBody({ talks, onTalk, onOpenPlayer }: { talks: ConversationsDto; onTalk: (playerId: string) => void; onOpenPlayer: (id: string) => void }) {
  return (
    <div className="tk-body">
      <h3 className="cs-h3 tk-h3">Pedem conversa</h3>
      {talks.requests.length === 0 ? <p className="muted small">Ninguém do elenco está insatisfeito.</p> : (
        <ul className="tk-list">{talks.requests.map((r) => (
          <li key={r.playerId} className="tk-request"><PosPill pos={r.position} /><button className="cp-club-btn" onClick={() => onOpenPlayer(r.playerId)}>{r.name}</button>
            <span className="muted small">{r.reason}</span><button className="secondary tk-btn" onClick={() => onTalk(r.playerId)}>Conversar</button></li>
        ))}</ul>
      )}
      <h3 className="cs-h3 tk-h3">Promessas em aberto</h3>
      {talks.open.length === 0 ? <p className="muted small">Nenhuma promessa em aberto.</p> : <ul className="tk-list">{talks.open.map((p) => <PromiseRow key={p.id} p={p} onOpenPlayer={onOpenPlayer} />)}</ul>}
      {talks.recent.length > 0 && <>
        <h3 className="cs-h3 tk-h3">Promessas encerradas</h3>
        <ul className="tk-list">{talks.recent.map((p) => <PromiseRow key={p.id} p={p} onOpenPlayer={onOpenPlayer} />)}</ul>
      </>}
      {talks.talks.length > 0 && <>
        <h3 className="cs-h3 tk-h3">Últimas conversas</h3>
        <ul className="tk-list">{talks.talks.map((t, i) => <li key={i} className="tk-talk"><span className="muted small">{fmtDate(t.date).slice(0, 5)} · {t.who} · {t.topic}</span><span className="small">{t.outcome}</span></li>)}</ul>
      </>}
    </div>
  );
}

function TalkModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal tk-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head"><h2>{title}</h2><button className="secondary icon" aria-label="Fechar" autoFocus onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function PlayerTalkModal({ profileId, careerId, talks, initial, onDone, onClose }: {
  profileId: string; careerId: string; talks: ConversationsDto; initial: string | null; onDone: (r: ConversationsDto) => Promise<void>; onClose: () => void;
}) {
  const [sel, setSel] = useState<string | null>(initial ?? talks.players[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const p = talks.players.find((x) => x.id === sel) ?? null;
  async function talk(topic: PlayerTopicDto) {
    if (!p) return;
    setBusy(true); setResult(null);
    try { const r = await unwrap(window.api.talkToPlayer(profileId, careerId, p.id, topic)); setResult({ ok: true, text: r.message }); await onDone(r.conversations); }
    catch (e) { setResult({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }
  return (
    <TalkModal title="Conversar com jogador" onClose={onClose}>
      <div className="tk-grid">
        <ul className="tk-players" aria-label="Elenco">{talks.players.map((x) => (
          <li key={x.id}><button className={`tk-player ${x.id === sel ? 'tk-player-on' : ''}`} onClick={() => { setSel(x.id); setResult(null); }}>
            <PosPill pos={x.position} /><span className="tk-player-name">{x.name}</span>
            <span className="tk-mini-meter" title={`Moral ${x.morale}/100`}><i className={meterClass(x.morale)} style={{ width: `${x.morale}%` }} /></span>
          </button></li>
        ))}</ul>
        <div className="tk-topics">
          {p ? <>
            <p><strong>{p.name}</strong> <span className="muted small">moral {p.morale}/100 · forma {p.form}/100 · contrato até {fmtDate(p.contractEnd)}</span></p>
            {TOPICS.map((t) => {
              const why = p.topics[t.id];
              return (
                <div key={t.id} className="tk-topic">
                  <button disabled={busy || !!why} onClick={() => void talk(t.id)}>{t.label}</button>
                  <span className="muted small">{why ?? t.help}</span>
                </div>
              );
            })}
            {result && <p className={result.ok ? 'ok' : 'error'} role="status">{result.text}</p>}
          </> : <p className="muted">Escolha um jogador.</p>}
        </div>
      </div>
    </TalkModal>
  );
}

function BoardTalkModal({ profileId, careerId, talks, onDone, onClose }: {
  profileId: string; careerId: string; talks: ConversationsDto; onDone: (r: ConversationsDto) => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  async function talk(topic: BoardTopicDto) {
    setBusy(true); setResult(null);
    try { const r = await unwrap(window.api.talkToBoard(profileId, careerId, topic)); setResult({ ok: true, text: r.message }); await onDone(r.conversations); }
    catch (e) { setResult({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }
  return (
    <TalkModal title="Falar com a diretoria" onClose={onClose}>
      <p className="muted small">Confiança da diretoria: {talks.board.confidence == null ? '—' : `${Math.round(talks.board.confidence)}/100`}. Uma promessa sobe a confiança agora; cumprida, sobe mais; quebrada, derruba. Uma conversa a cada 30 dias.</p>
      {(Object.keys(talks.board.topics) as BoardTopicDto[]).map((k) => {
        const t = talks.board.topics[k];
        return (
          <div key={k} className="tk-topic">
            <button disabled={busy || !!t.unavailable} onClick={() => void talk(k)}>{t.label}</button>
            <span className="muted small">{t.unavailable ?? t.detail}</span>
          </div>
        );
      })}
      {result && <p className={result.ok ? 'ok' : 'error'} role="status">{result.text}</p>}
    </TalkModal>
  );
}

function MiniTable({ table, hasClub, onMore }: { table: CompetitionTableDto | null; hasClub: boolean; onMore: () => void }) {
  const img = useImages();
  return (
    <section className="card ov-table">
      <div className="ov-card-head"><h2>{table ? table.competition.name : 'Tabela'}</h2><button className="link" onClick={onMore}>tabela completa</button></div>
      {!table ? <p className="muted small">{hasClub ? 'Carregando…' : 'Sem liga: o treinador está sem clube.'}</p> : (
        <div className="ov-table-scroll">
          <table className="cp-std ov-std">
            <thead><tr><th>#</th><th>Clube</th><th className="center">J</th><th className="center">SG</th><th className="center">Pts</th></tr></thead>
            <tbody>{table.rows.map((r) => (
              <tr key={r.clubId} className={`${r.zone ?? ''} ${r.isUserClub ? 'mine' : ''}`}>
                <td>{r.position}</td><td><span className="cp-club"><ClubCrest id={r.clubId} name={r.clubName} size={14} src={img.url('clubs', r.clubId)} />{r.clubName}</span></td>
                <td className="center">{r.played}</td><td className="center">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td><td className="center"><strong>{r.points}</strong></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BoardCard({ board, onMore }: { board: BoardOverviewDto | null; onMore: () => void }) {
  const c = board?.club ?? null;
  return (
    <section className="card ov-board">
      <div className="ov-card-head"><h2><Landmark size={17} aria-hidden="true" />Diretoria, torcida e objetivos</h2><button className="link" onClick={onMore}>ver a Diretoria</button></div>
      {!board ? <p className="muted small">Carregando…</p> : !c ? <p className="muted small">Sem clube: sem diretoria nem torcida.</p> : (
        <div className="ov-board-grid">
          <div>
            <span className="ov-label">Confiança da diretoria</span>
            <div className="meter ov-meter"><i className={meterClass(c.confidence)} style={{ width: `${c.confidence}%` }} /></div>
            <span className="small">{Math.round(c.confidence)}/100{c.warning && <span className="neg"> · cargo ameaçado</span>}</span>
          </div>
          <div title="Indicador derivado dos últimos 5 jogos e da posição na liga em relação ao esperado.">
            <span className="ov-label">Torcida: {c.fans.label}</span>
            <div className="meter ov-meter"><i className={meterClass(c.fans.mood)} style={{ width: `${c.fans.mood}%` }} /></div>
            <span className="muted small">{c.fans.detail}</span>
          </div>
          <div className="ov-objectives">
            <span className="ov-label">Objetivos</span>
            <ul>
              <li><span className={`ov-st ov-st-${c.objective.status}`}>{STATUS_LABEL[c.objective.status]}</span>{c.objective.label} (meta {c.objective.target}º{c.objective.position ? `; agora ${c.objective.position}º` : ''})</li>
              {c.secondary.map((s) => <li key={s.label}><span className={`ov-st ov-st-${s.status}`}>{STATUS_LABEL[s.status]}</span>{s.label} <span className="muted small">— {s.detail}</span></li>)}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
