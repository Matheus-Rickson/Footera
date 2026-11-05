import { useEffect, useState } from 'react';
import { ArrowRight, BadgeCheck, Heart, Hash, MessageCircle, Repeat2, Stethoscope } from 'lucide-react';
import type { SocialAccountDto, SocialCard, SocialFeedDto, SocialFilter, SocialPostDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { daysBetween } from '../../shared/date.ts';
import { ClubCrest } from '../flags.tsx';
import { useImages } from '../images.ts';

interface Props { profileId: string; careerId: string; refreshKey: string; today: string }

const FILTERS: Array<[SocialFilter, string]> = [['all', 'Tudo'], ['mine', 'Meu clube'], ['match', 'Jogos'], ['transfer', 'Mercado'], ['injury', 'Lesões'], ['coach', 'Técnicos'], ['league', 'Ligas']];
const compact = (n: number) => (n >= 1_000_000 ? `${String(Math.round(n / 100_000) / 10).replace('.', ',')} mi` : n >= 1000 ? `${String(Math.round(n / 100) / 10).replace('.', ',')} mil` : String(n));
const when = (date: string, today: string) => { const d = daysBetween(date, today); return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : d < 7 ? `há ${d} dias` : fmtDate(date); };
const initialsOf = (name: string) => name.split(/\s+/).filter((w) => w.length > 1 && /^[A-ZÀ-Úa-zà-ú]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function SocialView({ profileId, careerId, refreshKey, today }: Props) {
  const [filter, setFilter] = useState<SocialFilter>('all');
  const [feed, setFeed] = useState<SocialFeedDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const img = useImages();

  useEffect(() => {
    let stale = false;
    unwrap(window.api.getSocialFeed(profileId, careerId, filter)).then((f) => { if (!stale) { setFeed(f); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey, filter]);

  return (
    <div className="so">
        <div className="so-body">
          <section className="so-feed" aria-label="Publicações">
            <div className="so-filters">{FILTERS.map(([k, label]) => <button key={k} className={`so-chip ${filter === k ? 'on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}</div>
            {error && <p className="error" role="alert">{error}</p>}
            {!feed ? <p className="muted">Carregando…</p> : feed.posts.length === 0 ? (
              <div className="card so-empty"><MessageCircle size={28} aria-hidden="true" />
                <p>{feed.total === 0 ? 'Ainda não há publicações. A imprensa começa a repercutir a partir do próximo dia: prévias, resultados, mercado, lesões e a tabela.' : 'Nada publicado com este filtro.'}</p></div>
            ) : feed.posts.map((p) => <Post key={p.id} p={p} today={today} img={img} />)}
          </section>
          <aside className="so-side">
            {feed && feed.trending.length > 0 && (
              <section className="card so-box"><h3>Em alta</h3>
                <ul className="so-trend">{feed.trending.map((t) => <li key={t.clubId}><ClubCrest id={t.clubId} name={t.name} size={20} src={img.url('clubs', t.clubId)} /><span><strong><Hash size={12} aria-hidden="true" />{t.name.replace(/\s+/g, '')}</strong><em className="muted small">{t.posts} publicação(ões) em 14 dias</em></span></li>)}</ul>
              </section>
            )}
            {feed && feed.profiles.length > 0 && (
              <section className="card so-box"><h3>Imprensa e perfis oficiais</h3>
                <ul className="so-profiles">{feed.profiles.map((a) => <li key={a.id}><Avatar a={a} img={img} size={34} /><span><Name a={a} /><em className="muted small">{a.bio}</em></span></li>)}</ul>
                <p className="muted small">Veículos, jornalistas e torcedores são fictícios. O selo azul marca a imprensa e os perfis oficiais de ligas e clubes do jogo.</p>
              </section>
            )}
          </aside>
        </div>
    </div>
  );
}

type Img = ReturnType<typeof useImages>;
function Avatar({ a, img, size }: { a: SocialAccountDto; img: Img; size: number }) {
  if (a.kind === 'club' && a.clubId) return <span className="so-av so-av-crest" style={{ width: size, height: size }}><ClubCrest id={a.clubId} name={a.name} size={size * 0.82} src={img.url('clubs', a.clubId)} /></span>;
  const logo = a.kind === 'league' && a.leagueId ? img.url('leagues', a.leagueId) : null;
  if (logo) return <img className="so-av so-av-img" src={logo} alt="" style={{ width: size, height: size }} />;
  return <span className={`so-av ${a.kind === 'fan' ? 'fan' : ''}`} aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${a.hue} 55% ${a.kind === 'fan' ? 34 : 40}%)` }}>{initialsOf(a.name)}</span>;
}
function Name({ a }: { a: SocialAccountDto }) {
  return <span className="so-name"><strong>{a.name}</strong>{a.verified && <BadgeCheck size={15} className="so-verified" aria-label="Perfil verificado" />}<span className="muted">@{a.handle}</span></span>;
}

function Post({ p, today, img }: { p: SocialPostDto; today: string; img: Img }) {
  const [open, setOpen] = useState(false);
  const shown = open ? p.comments : p.comments.slice(0, 2);
  return (
    <article className={`card so-post ${p.mine ? 'mine' : ''}`}>
      <Avatar a={p.author} img={img} size={42} />
      <div className="so-post-main">
        <header className="so-post-head"><Name a={p.author} /><span className="muted small">· {when(p.date, today)}</span></header>
        <p className="so-text">{p.text}</p>
        {p.card && <Card c={p.card} img={img} />}
        <div className="so-stats" aria-label="Engajamento">
          <span title="Comentários"><MessageCircle size={15} aria-hidden="true" />{p.comments.length}</span>
          <span title="Compartilhamentos"><Repeat2 size={15} aria-hidden="true" />{compact(p.reposts)}</span>
          <span title="Curtidas"><Heart size={15} aria-hidden="true" />{compact(p.likes)}</span>
        </div>
        {shown.length > 0 && (
          <ul className="so-comments">{shown.map((c) => (
            <li key={c.id}><Avatar a={c.author} img={img} size={28} />
              <div><span className="so-name small"><strong>{c.author.name}</strong>{c.author.verified && <BadgeCheck size={13} className="so-verified" aria-label="Perfil verificado" />}<span className="muted">@{c.author.handle}</span></span>
                <p>{c.text}</p><span className="muted small so-clikes"><Heart size={11} aria-hidden="true" />{compact(c.likes)}</span></div>
            </li>))}</ul>
        )}
        {p.comments.length > 2 && <button className="link so-more" onClick={() => setOpen(!open)}>{open ? 'Mostrar menos' : `Ver todos os ${p.comments.length} comentários`}</button>}
      </div>
    </article>
  );
}

function Card({ c, img }: { c: SocialCard; img: Img }) {
  const crest = (id: string, name: string, size = 30) => <ClubCrest id={id} name={name} size={size} src={img.url('clubs', id)} />;
  if (c.type === 'match' || c.type === 'fixture') return (
    <div className="so-card so-match">
      <span className="so-team">{crest(c.homeId, c.homeName)}<strong>{c.homeName}</strong></span>
      <span className="so-score">{c.type === 'match' ? `${c.hg} x ${c.ag}` : 'x'}<em className="muted small">{c.type === 'match' ? 'fim de jogo' : 'hoje'}</em></span>
      <span className="so-team away"><strong>{c.awayName}</strong>{crest(c.awayId, c.awayName)}</span>
      <span className="so-card-foot muted small">{c.competition}</span>
    </div>
  );
  if (c.type === 'transfer') return (
    <div className="so-card so-transfer">
      <strong>{c.player}</strong>
      <span className="so-move">{c.fromId ? <span className="so-team">{crest(c.fromId, c.fromName ?? '', 24)}{c.fromName}</span> : <span className="muted">sem clube</span>}
        <ArrowRight size={16} aria-hidden="true" /><span className="so-team">{crest(c.toId, c.toName, 24)}{c.toName}</span></span>
      <span className="so-fee">{c.fee > 0 ? fmtMoney(c.fee) : 'sem custo'}</span>
    </div>
  );
  if (c.type === 'injury') return (
    <div className="so-card so-injury"><Stethoscope size={18} aria-hidden="true" /><span><strong>{c.player}</strong> · {c.clubName}</span><span className="muted">≈ {Math.max(1, Math.round(c.days / 7))} semana(s) fora</span></div>
  );
  return (
    <div className="so-card so-table"><span className="small muted">{c.title}</span>
      <table><thead><tr><th>#</th><th>Clube</th><th className="right">J</th><th className="right">Pts</th></tr></thead>
        <tbody>{c.rows.map((r) => <tr key={r.clubId}><td>{r.rank}</td><td><span className="so-team">{crest(r.clubId, r.name, 18)}{r.name}</span></td><td className="right">{r.played}</td><td className="right"><strong>{r.points}</strong></td></tr>)}</tbody></table>
    </div>
  );
}
