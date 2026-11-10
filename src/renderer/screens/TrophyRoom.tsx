import { useEffect, useId, useMemo, useState } from 'react';
import { Award, History, Medal, Trophy, UserRound } from 'lucide-react';
import type { TrophyCaseDto, TrophyKindDto, TrophyLogoDto, TrophyRoomDto } from '../../shared/api.ts';
import { errMsg, unwrap } from '../util.ts';
import { ClubCrest } from '../flags.tsx';
import { useImages } from '../images.ts';
import { Dialog, HelpButton } from '../helpDialog.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string }
type Tab = 'club' | 'coach' | 'champions';
const TABS: Array<{ id: Tab; label: string }> = [{ id: 'club', label: 'Clube' }, { id: 'coach', label: 'Treinador' }, { id: 'champions', label: 'Campeões' }];
export const TROPHY_SHELF: Record<TrophyKindDto, string> = {
  league: 'Ligas', cup: 'Copas nacionais', supercup: 'Supercopas', state: 'Estaduais', regional: 'Copas regionais', other: 'Outros títulos',
};
const KIND_ORDER: TrophyKindDto[] = ['league', 'cup', 'supercup', 'state', 'regional', 'other'];
const TIMELINE_PAGE = 7;
const CHAMPIONS_PAGE = 13;

/** Taça em SVG: a forma muda com o tipo de competição; títulos só históricos ficam em tom de bronze. */
function Cup({ kind, historicOnly, size = 64 }: { kind: TrophyKindDto; historicOnly: boolean; size?: number }) {
  const gid = useId().replace(/:/g, '');
  const [a, b, c] = historicOnly ? ['#e8c7a0', '#b9824f', '#7a5230'] : ['#fff3b0', '#f2c230', '#a8740c'];
  const fill = `url(#g${gid})`;
  const stroke = c;
  let body;
  if (kind === 'league') body = (<>
    <path d="M18 8h28v14c0 10-6 17-14 17s-14-7-14-17z" fill={fill} stroke={stroke} strokeWidth="1.5" />
    <path d="M18 12h-6c0 8 3 12 8 13M46 12h6c0 8-3 12-8 13" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
    <path d="M28 39h8v8h-8z" fill={fill} stroke={stroke} strokeWidth="1.2" /><path d="M20 47h24v5H20zM17 52h30v5H17z" fill={fill} stroke={stroke} strokeWidth="1.2" />
  </>);
  else if (kind === 'cup') body = (<>
    <path d="M22 6h20l-2 20c-1 7-4 11-8 11s-7-4-8-11z" fill={fill} stroke={stroke} strokeWidth="1.5" />
    <path d="M22 9c-7 0-9 4-8 8s5 6 9 6M42 9c7 0 9 4 8 8s-5 6-9 6" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
    <path d="M29 37h6l2 10h-10z" fill={fill} stroke={stroke} strokeWidth="1.2" /><path d="M21 47h22v10H21z" fill={fill} stroke={stroke} strokeWidth="1.2" />
  </>);
  else if (kind === 'supercup') body = (<>
    <circle cx="32" cy="24" r="17" fill={fill} stroke={stroke} strokeWidth="1.5" /><circle cx="32" cy="24" r="11" fill="none" stroke={stroke} strokeWidth="1" opacity=".6" />
    <path d="M28 41h8v6h-8z" fill={fill} stroke={stroke} strokeWidth="1.2" /><path d="M19 47h26v10H19z" fill={fill} stroke={stroke} strokeWidth="1.2" />
  </>);
  else if (kind === 'other') body = (<>
    <path d="M24 4h6l4 14h-6zM40 4h-6l-4 14h6z" fill="var(--surface-3)" stroke={stroke} strokeWidth="1" />
    <circle cx="32" cy="36" r="17" fill={fill} stroke={stroke} strokeWidth="1.5" /><circle cx="32" cy="36" r="11" fill="none" stroke={stroke} strokeWidth="1" opacity=".6" />
  </>);
  else body = (<>
    <path d="M32 4l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill={fill} stroke={stroke} strokeWidth="1" />
    <path d="M21 20h22l-1.5 12c-1 6-4.5 9-9.5 9s-8.5-3-9.5-9z" fill={fill} stroke={stroke} strokeWidth="1.5" />
    <path d="M29 41h6v6h-6z" fill={fill} stroke={stroke} strokeWidth="1.2" /><path d="M22 47h20v10H22z" fill={fill} stroke={stroke} strokeWidth="1.2" />
  </>);
  return (
    <svg className="tf-cup-svg" viewBox="0 0 64 60" width={size} height={size * 0.94} aria-hidden="true">
      <defs><linearGradient id={`g${gid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset=".55" stopColor={b} /><stop offset="1" stopColor={c} /></linearGradient></defs>
      {body}
    </svg>
  );
}

function CompLogo({ logo, name }: { logo: TrophyLogoDto | null; name: string }) {
  const img = useImages();
  const src = logo ? img.url(logo.kind, logo.id) : null;
  return src ? <img className="tf-logo" src={src} alt={`Logo: ${name}`} /> : null;
}

function TrophyCard({ c, onOpen }: { c: TrophyCaseDto; onOpen: () => void }) {
  const historicOnly = c.wins.length === 0;
  const last = c.wins[0]?.label;
  return (
    <button type="button" className="tf-card" onClick={onOpen} title={c.wins.map((w) => w.label).join(', ') || 'Títulos anteriores à carreira'}>
      <span className="tf-cup-wrap"><Cup kind={c.kind} historicOnly={historicOnly} /><CompLogo logo={c.logo} name={c.name} /></span>
      <span className="tf-count">×{c.total}</span>
      <strong className="tf-name">{c.name}</strong>
      <span className="muted small">{last ? `último: ${last}` : 'antes da carreira'}{c.historical > 0 && c.wins.length > 0 ? ` · ${c.historical} antes` : ''}</span>
    </button>
  );
}

function CaseDialog({ c, onClose }: { c: TrophyCaseDto; onClose: () => void }) {
  return (
    <Dialog title={c.name} onClose={onClose}>
      <div className="tf-dlg-head"><span className="tf-cup-wrap"><Cup kind={c.kind} historicOnly={c.wins.length === 0} size={84} /><CompLogo logo={c.logo} name={c.name} /></span>
        <div><p className="tf-dlg-total">{c.total} título{c.total === 1 ? '' : 's'}</p><p className="muted small">{TROPHY_SHELF[c.kind]}</p></div></div>
      {c.wins.length > 0 && (<>
        <h3 className="tf-h3">Nesta carreira ({c.wins.length})</h3>
        <ul className="tf-seasons">{c.wins.map((w) => <li key={w.season} className={w.byUser ? 'tf-by-user' : ''}>{w.label}{w.byUser && <span className="tf-badge">com você</span>}</li>)}</ul>
      </>)}
      {c.historical > 0 && (<>
        <h3 className="tf-h3">Antes da carreira ({c.historical})</h3>
        <p className="small">{c.historicalYears ?? 'Anos não informados no pacote de dados.'}</p>
      </>)}
    </Dialog>
  );
}

function Pager({ page, pages, onPage, label }: { page: number; pages: number; onPage: (p: number) => void; label: string }) {
  if (pages <= 1) return null;
  return (
    <div className="row tf-pager">
      <button className="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Anterior</button>
      <span className="muted small">Página {page + 1} de {pages} · {label}</span>
      <button className="secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Próxima</button>
    </div>
  );
}

function Shelves({ cases, onOpen, empty }: { cases: TrophyCaseDto[]; onOpen: (c: TrophyCaseDto) => void; empty: string }) {
  if (cases.length === 0) return <div className="tf-empty"><Trophy size={40} aria-hidden="true" /><p className="muted">{empty}</p></div>;
  return (
    <div className="tf-shelves">
      {KIND_ORDER.filter((k) => cases.some((c) => c.kind === k)).map((k) => (
        <section key={k} className="tf-shelf">
          <h3 className="tf-h3">{TROPHY_SHELF[k]} <span className="muted">({cases.filter((c) => c.kind === k).reduce((s, c) => s + c.total, 0)})</span></h3>
          <div className="tf-shelf-row">{cases.filter((c) => c.kind === k).map((c) => <TrophyCard key={c.key} c={c} onOpen={() => onOpen(c)} />)}</div>
        </section>
      ))}
    </div>
  );
}

export function TrophiesView({ profileId, careerId, refreshKey }: Props) {
  const [room, setRoom] = useState<TrophyRoomDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clubId, setClubId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('club');
  const [open, setOpen] = useState<TrophyCaseDto | null>(null);
  const [tlPage, setTlPage] = useState(0);
  const [chPage, setChPage] = useState(0);
  const [chSeason, setChSeason] = useState<string>('');
  const [chCountry, setChCountry] = useState<string>('');
  const img = useImages();
  useEffect(() => { unwrap(window.api.getTrophies(profileId, careerId, clubId)).then((r) => { setRoom(r); setError(null); setTlPage(0); }, (e) => setError(errMsg(e))); }, [profileId, careerId, clubId, refreshKey]);

  const timeline = useMemo(() => {
    if (!room) return [];
    const by = new Map<string, { season: number; label: string; items: Array<{ name: string; kind: TrophyKindDto; byUser: boolean }> }>();
    for (const c of room.cases) for (const w of c.wins) {
      const g = by.get(w.label) ?? { season: w.season, label: w.label, items: [] };
      g.items.push({ name: c.name, kind: c.kind, byUser: w.byUser }); by.set(w.label, g);
    }
    return [...by.values()].sort((a, b) => b.season - a.season || b.label.localeCompare(a.label));
  }, [room]);
  const coachCases = useMemo<TrophyCaseDto[]>(() => {
    if (!room) return [];
    const by = new Map<string, TrophyCaseDto>();
    for (const t of room.coachTitles) {
      const c = by.get(t.key) ?? { key: t.key, name: t.competition, kind: t.kind, tier: null, logo: t.logo, total: 0, historical: 0, historicalYears: null, wins: [] };
      c.wins.push({ season: t.season, label: `${t.label} · ${t.clubName}`, byUser: true }); c.total++; by.set(t.key, c);
    }
    return [...by.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.total - a.total);
  }, [room]);

  if (!room) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando troféus…</p>;
  const seasons = [...new Set(room.champions.map((c) => c.label))];
  const season = chSeason && seasons.includes(chSeason) ? chSeason : seasons[0] ?? '';
  const countries = [...new Set(room.champions.map((c) => c.country))];
  const champs = room.champions.filter((c) => c.label === season && (!chCountry || c.country === chCountry));
  const chPages = Math.max(1, Math.ceil(champs.length / CHAMPIONS_PAGE));
  const chP = Math.min(chPage, chPages - 1);
  const tlPages = Math.max(1, Math.ceil(timeline.length / TIMELINE_PAGE));
  const tlP = Math.min(tlPage, tlPages - 1);
  const coachClubs = new Set(room.coachTitles.map((t) => t.clubId)).size;

  return (
    <div className="tf">
      <section className="card tf-top">
        {room.club ? <ClubCrest id={room.club.id} name={room.club.name} size={54} src={img.url('clubs', room.club.id)} /> : <span className="tf-top-ico"><Award size={30} aria-hidden="true" /></span>}
        <div className="tf-top-name">
          <h2>Sala de troféus{room.club ? ` · ${room.club.name}` : ''}</h2>
          {room.clubs.length > 1 && (
            <label className="tf-pick small">Clube <select value={room.club?.id ?? ''} onChange={(e) => setClubId(e.target.value)}>
              {room.clubs.map((c) => <option key={c.id} value={c.id}>{c.name}{c.current ? ' (atual)' : ''}</option>)}</select></label>
          )}
        </div>
        <div className="tf-kpis">
          <div className="tf-kpi"><span className="tf-kpi-val">{room.totals.all}</span><span className="tf-kpi-lbl">títulos</span></div>
          <div className="tf-kpi"><span className="tf-kpi-val">{room.totals.inGame}</span><span className="tf-kpi-lbl">nesta carreira</span></div>
          <div className="tf-kpi"><span className="tf-kpi-val">{room.totals.byUser}</span><span className="tf-kpi-lbl">com você</span></div>
          <div className="tf-kpi"><span className="tf-kpi-val">{room.totals.historical}</span><span className="tf-kpi-lbl">antes da carreira</span></div>
        </div>
        <HelpButton title="Sala de troféus">
          <p>Cada taça reúne os títulos de uma competição: os conquistados no jogo (liga, copa nacional, supercopa, estaduais e copas regionais) e os
            <strong> títulos históricos</strong> do clube, anteriores ao início da carreira.</p>
          <p>Os títulos históricos vêm dos pacotes de dados (editor de dados → clube → "Títulos históricos", ou a coluna da planilha). A base do jogo
            vem sem eles. Taças em tom de bronze só têm títulos históricos.</p>
          <p>Clique numa taça para ver as temporadas. A aba <strong>Treinador</strong> mostra os seus títulos em todos os clubes; a aba <strong>Campeões</strong>,
            os vencedores de cada competição do universo.</p>
        </HelpButton>
      </section>

      <div className="pf-tabs tf-tabs" role="tablist" aria-label="Seções da sala de troféus">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`pf-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === 'club' && (
        <div className="tf-body">
          <section className="card tf-cabinet">
            <div className="tf-head"><h2><Trophy size={16} aria-hidden="true" /> Galeria</h2></div>
            <Shelves cases={room.cases} onOpen={setOpen} empty={room.club ? 'Nenhum título ainda. As taças aparecem aqui quando o clube for campeão.' : 'Você ainda não treinou nenhum clube.'} />
          </section>
          <section className="card tf-timeline">
            <div className="tf-head"><h2><History size={16} aria-hidden="true" /> Linha do tempo</h2></div>
            {timeline.length === 0 ? <p className="muted small">Os títulos conquistados nesta carreira aparecem aqui, temporada a temporada.</p> : (
              <ol className="tf-tl">{timeline.slice(tlP * TIMELINE_PAGE, (tlP + 1) * TIMELINE_PAGE).map((g) => (
                <li key={g.label}><span className="tf-tl-season">{g.label}</span>
                  <ul className="tf-tl-items">{g.items.map((i) => <li key={i.name}><Trophy size={13} aria-hidden="true" className="tf-tl-ico" />{i.name}{i.byUser && <span className="tf-badge">com você</span>}</li>)}</ul></li>
              ))}</ol>
            )}
            <Pager page={tlP} pages={tlPages} onPage={setTlPage} label={`${timeline.length} temporada(s)`} />
          </section>
        </div>
      )}

      {tab === 'coach' && (
        <div className="tf-body">
          <section className="card tf-cabinet">
            <div className="tf-head"><h2><UserRound size={16} aria-hidden="true" /> Seus títulos</h2>
              <span className="muted small">{room.coachTitles.length} título(s) em {coachClubs} clube(s)</span></div>
            <Shelves cases={coachCases} onOpen={setOpen} empty="Você ainda não conquistou títulos como treinador." />
          </section>
          <section className="card tf-timeline">
            <div className="tf-head"><h2><Medal size={16} aria-hidden="true" /> Conquistas</h2></div>
            {room.coachTitles.length === 0 ? <p className="muted small">Cada título aparece aqui com a temporada e o clube.</p> : (
              <ol className="tf-tl">{room.coachTitles.slice(tlP * TIMELINE_PAGE, (tlP + 1) * TIMELINE_PAGE).map((t, i) => (
                <li key={`${t.season}-${t.key}-${i}`}><span className="tf-tl-season">{t.label}</span>
                  <span className="tf-tl-club"><ClubCrest id={t.clubId} name={t.clubName} size={20} src={img.url('clubs', t.clubId)} /> {t.competition} <span className="muted small">· {t.clubName}</span></span></li>
              ))}</ol>
            )}
            <Pager page={tlP} pages={Math.max(1, Math.ceil(room.coachTitles.length / TIMELINE_PAGE))} onPage={setTlPage} label={`${room.coachTitles.length} título(s)`} />
          </section>
        </div>
      )}

      {tab === 'champions' && (
        <section className="card tf-champions">
          <div className="tf-head"><h2><Award size={16} aria-hidden="true" /> Campeões do universo</h2>
            {seasons.length > 0 && <div className="row tf-filters">
              <label className="small">Temporada <select value={season} onChange={(e) => { setChSeason(e.target.value); setChPage(0); }}>{seasons.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="small">País <select value={chCountry} onChange={(e) => { setChCountry(e.target.value); setChPage(0); }}><option value="">Todos</option>{countries.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            </div>}</div>
          {champs.length === 0 ? <p className="muted">Os campeões aparecem quando as competições terminam.</p> : (
            <table className="tf-champ-table"><thead><tr><th>Competição</th><th>Tipo</th><th>País</th><th>Campeão</th></tr></thead>
              <tbody>{champs.slice(chP * CHAMPIONS_PAGE, (chP + 1) * CHAMPIONS_PAGE).map((c, i) => (
                <tr key={`${c.competition}-${i}`} className={c.wonByUser ? 'mine' : ''}><td>{c.competition}</td><td className="muted">{TROPHY_SHELF[c.kind]}</td><td className="muted">{c.country}</td><td><strong>{c.clubName}</strong></td></tr>))}</tbody></table>
          )}
          <Pager page={chP} pages={chPages} onPage={setChPage} label={`${champs.length} campeão(ões)`} />
        </section>
      )}

      {open && <CaseDialog c={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
