import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, CalendarClock, Check, ChevronDown, Coins, Search, Target, Users } from 'lucide-react';
import type { ClubList, ClubOption, PhotoPick } from '../../shared/api.ts';
import type { Methodology } from '../../shared/types.ts';
import { errMsg, fmtMoney, fmtNum, METHODOLOGY, unwrap } from '../util.ts';
import { PosPill, to20, tone } from '../playerUi.tsx';
import { ClubCrest, clubHues, Flag, StadiumArt } from '../flags.tsx';
import footeraMark from '../assets/footera-mark.png';
import { baseCoachAttributes, COACH_ATTR_BASE, COACH_ATTR_MAX_START, COACH_ATTR_POINTS, COACH_ATTRS, spentPoints, type CoachAttributes, type CoachAttrKey } from '../../shared/coachAttributes.ts';
import type { CSSProperties } from 'react';
import { useImages } from '../images.ts';
import { HelpTip } from '../help.tsx';
import { Stars } from '../stars.tsx';
import { CoachPhoto } from '../clubSheet.tsx';

interface Props { profileId: string; onBack: () => void; onCreated: (careerId: string) => void }

/** Clubes com simulação completa → ritmo estimado do avanço (as partidas lance a lance são o que mais pesa). */
function paceOf(fullClubs: number): { label: string; tone: string } {
  if (fullClubs <= 100) return { label: 'rápido', tone: 'ok' };
  if (fullClubs <= 240) return { label: 'moderado', tone: 'notice' };
  return { label: 'lento', tone: 'error' };
}
const divisionsLabel = (n: number) => `${n} ${n === 1 ? 'divisão' : 'divisões'}`;

export function NewCareer({ profileId, onBack, onCreated }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [list, setList] = useState<ClubList | null>(null);
  const img = useImages();
  /** países marcados (= simulação completa); só neles há clubes para escolher e propostas de emprego */
  const [full, setFull] = useState<Set<string>>(() => new Set(['bra']));
  /** divisões desmarcadas dentro dos países marcados (ficam simplificadas) */
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [countryFilter, setCountryFilter] = useState('all');
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [clubId, setClubId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [nationality, setNationality] = useState('BRA');
  const [methodology, setMethodology] = useState<Methodology>('possession');
  const [photo, setPhoto] = useState<PhotoPick | null>(null);
  const [attrs, setAttrs] = useState<CoachAttributes>(baseCoachAttributes);
  const remaining = COACH_ATTR_POINTS - spentPoints(attrs);
  const bump = (k: CoachAttrKey, d: number) => setAttrs((a) => {
    const v = a[k] + d;
    if (v < COACH_ATTR_BASE || v > COACH_ATTR_MAX_START || (d > 0 && COACH_ATTR_POINTS - spentPoints(a) <= 0)) return a;
    return { ...a, [k]: v };
  });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<PhotoPick | null>(null);
  photoRef.current = photo;

  // Carrega o universo: base fixa + pacotes de dados ativos (o mesmo para todas as carreiras com os mesmos pacotes).
  const [activePacks, setActivePacks] = useState<string[]>([]);
  useEffect(() => {
    let stale = false;
    unwrap(window.api.listClubs()).then((r) => { if (!stale) { setList(r); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    unwrap(window.api.listPacks()).then((r) => { if (!stale) setActivePacks(r.packs.filter((p) => p.enabled).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => `${p.name} (v${p.version})`)); }).catch(() => { /* a lista de clubes já mostra o erro */ });
    return () => { stale = true; };
  }, []);
  // Descarta a foto pendente ao sair da tela sem criar a carreira.
  useEffect(() => () => { const p = photoRef.current; if (p) void window.api.discardPhoto(p.token); }, []);

  const countries = list?.countries ?? [];
  const fullCountries = countries.filter((c) => full.has(c.id));
  const allLeagues = countries.flatMap((c) => c.leagues.map((l) => ({ ...l, countryId: c.id })));
  /** divisões com simulação completa: as dos países marcados, menos as desmarcadas */
  const fullLeagues = useMemo(() => new Set(allLeagues.filter((l) => full.has(l.countryId) && !excluded.has(l.id)).map((l) => l.id)), [list, full, excluded]); // eslint-disable-line react-hooks/exhaustive-deps
  const fullLeagueRows = allLeagues.filter((l) => fullLeagues.has(l.id)), lightLeagueRows = allLeagues.filter((l) => !fullLeagues.has(l.id));
  const clubsOf = (ls: typeof allLeagues) => ls.reduce((s, l) => s + l.clubs, 0);
  const pace = paceOf(clubsOf(fullLeagueRows));
  const toggleCountry = (id: string) => setFull((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleLeague = (id: string) => setExcluded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const preset = (ids: string[]) => { setFull(new Set(ids)); setExcluded(new Set()); };

  // ---- passo 2: clubes só dos países completos
  // clubes das divisões simuladas e os "sem divisão" (estadual) dos países escolhidos
  const pickable = useMemo(() => (list?.clubs ?? []).filter((c) => fullLeagues.has(c.leagueId) || (full.has(c.countryId) && !allLeagues.some((l) => l.id === c.leagueId))), [list, fullLeagues, full]); // eslint-disable-line react-hooks/exhaustive-deps
  const leagues = useMemo(() => [...new Set(pickable.filter((c) => countryFilter === 'all' || c.countryId === countryFilter).sort((a, b) => a.leagueTier - b.leagueTier).map((c) => c.league))], [pickable, countryFilter]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pickable.filter((c) => (countryFilter === 'all' || c.countryId === countryFilter) && (leagueFilter === 'all' || c.league === leagueFilter) && (stateFilter === 'all' || c.state === stateFilter) && (!q || c.name.toLowerCase().includes(q)))
      .sort((a, b) => a.country.localeCompare(b.country) || a.leagueTier - b.leagueTier || b.reputation - a.reputation);
  }, [pickable, countryFilter, leagueFilter, stateFilter, query]);
  // estados do país escolhido no filtro (só aparecem quando o país tem estaduais)
  const states = useMemo(() => [...new Set(pickable.filter((c) => countryFilter !== 'all' && c.countryId === countryFilter && c.state).map((c) => c.state!))].sort(), [pickable, countryFilter]);
  const chosen = pickable.find((c) => c.id === clubId) ?? null;
  const civilYear = !!chosen && countries.find((x) => x.id === chosen.countryId)?.seasonStart === '01-01';
  const hasCivil = countries.some((x) => x.seasonStart === '01-01'), hasJuly = countries.some((x) => x.seasonStart !== '01-01');
  function goToClubs() {
    // abre destacando o clube de maior reputação do primeiro país completo (o atual, se ainda vale)
    if (!chosen) {
      const first = fullCountries[0];
      const best = pickable.filter((c) => c.countryId === first?.id).sort((a, b) => b.reputation - a.reputation)[0];
      setClubId(best?.id ?? null);
    }
    if (countryFilter !== 'all' && !full.has(countryFilter)) { setCountryFilter('all'); setLeagueFilter('all'); }
    setStep(2);
  }

  const startYear = list ? Number(list.startDate.slice(0, 4)) : 2026;
  const maxBirth = `${startYear - 18}-07-01`, minBirth = `${startYear - 90}-01-01`;
  const formOk = firstName.trim() && lastName.trim() && birthDate && birthDate >= minBirth && birthDate <= maxBirth && remaining === 0;

  async function pick() {
    setError(null);
    try {
      const p = await unwrap(window.api.pickPhoto());
      if (!p) return;
      if (photo) void window.api.discardPhoto(photo.token);
      setPhoto(p);
    } catch (e) { setError(errMsg(e)); }
  }
  async function removePhoto() {
    if (photo) await window.api.discardPhoto(photo.token);
    setPhoto(null);
  }
  async function create() {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      const c = await unwrap(window.api.createCareer({
        profileId, clubId: chosen.id, photoToken: photo?.token ?? null, fullLeagues: [...fullLeagues],
        coach: { firstName, lastName, birthDate, nationality, methodology, attributes: attrs },
      }));
      setPhoto(null); // token consumido pelo processo principal
      onCreated(c.id);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  // passo 2: a tela ganha um toque da cor do clube destacado (transição suave ao trocar de clube)
  const tint = step === 2 && chosen ? clubHues(chosen.id) : null;
  const tintStyle = tint ? ({ '--club-h': tint.hue, '--club-h2': tint.hue2 } as CSSProperties) : undefined;

  return (
    <main className={`shell nc-fit ${step === 2 ? 'nc-wide' : ''} ${tint ? 'nc-tinted' : ''}`} style={tintStyle}>
      {tint && <div className="nc-tint" aria-hidden="true" />}
      <header className="nc-top">
        <div className="nc-top-title">
          <div className="nc-brand">
            <span className="nc-logo" role="img" aria-label="Logo do FOOTERA" style={{ ['--mark' as string]: `url(${footeraMark})` } as CSSProperties} />
            <span className="nc-brand-word">FOOTERA</span>
          </div>
          <h1>Nova carreira</h1>
          <ol className="nc-steps" aria-label="Etapas">
            {(['Países', 'Clube', 'Treinador'] as const).map((label, i) => (
              <li key={label} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
                <span>{step > i + 1 ? <Check size={12} aria-hidden="true" /> : i + 1}</span>{label}
              </li>
            ))}
          </ol>
        </div>
        <button className="secondary" onClick={onBack}>Cancelar</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      {step === 1 && (
        <div className="nc-body nc-body-countries">
          <section className="nc-section">
            <div className="nc-section-head">
              <h2>Escolha os países <HelpTip text="Os países marcados têm simulação completa: partidas lance a lance, finanças, mercado, categorias de base, treino e diretoria — e só neles você pode treinar e ser contratado. Os desmarcados existem por inteiro (clubes, tabelas e jogadores contratáveis), com simulação simplificada: só o placar das partidas e a evolução dos jogadores uma vez por ano. A escolha vale para a carreira toda." /></h2>
              <div className="nc-presets">
                <span className="nc-packs-chip">{activePacks.length ? `Base + ${activePacks.length} pacote(s)` : 'Base do jogo'}
                  <HelpTip text={activePacks.length ? `Pacotes de dados ativos, na ordem: ${activePacks.join(' → ')}. Gerencie em "Pacotes de dados", no menu principal.` : 'Nenhum pacote de dados ativo: a carreira usa só a base do jogo. Gerencie em "Pacotes de dados", no menu principal.'} /></span>
                <button className="nc-ghost" onClick={() => preset(['bra'])}>Só o Brasil</button>
                <button className="nc-ghost" onClick={() => preset(countries.map((c) => c.id))}>Todos</button>
                <button className="nc-ghost" onClick={() => preset([])}>Limpar</button>
              </div>
            </div>
            {!list ? <p className="muted">Carregando a base de dados…</p> : (
              <div className="nc-countries">
                {countries.map((c) => {
                  const on = full.has(c.id);
                  return (
                    <div key={c.id} className={`nc-country ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} tabIndex={0} aria-label={c.name}
                      onClick={() => toggleCountry(c.id)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleCountry(c.id); } }}>
                      <span className="nc-check" aria-hidden="true">{on && <Check size={13} strokeWidth={3} />}</span>
                      <Flag code={c.code} size={22} title={`Bandeira: ${c.name}`} />
                      <span className="nc-country-name"><strong>{c.name}</strong><span>{divisionsLabel(c.divisions)}</span></span>
                      {on && c.divisions > 1 && (
                        <DivisionsMenu country={c.name} leagues={c.leagues} isFull={(id) => fullLeagues.has(id)} onToggle={toggleLeague} logo={(id) => img.url('leagues', id)} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {list && (
            <footer className="nc-footer">
              <div className="nc-stat">
                <span>Simulação completa</span>
                <strong>{fullCountries.length} {fullCountries.length === 1 ? 'país' : 'países'} · {fullLeagueRows.length} {fullLeagueRows.length === 1 ? 'liga' : 'ligas'} · {clubsOf(fullLeagueRows)} clubes</strong>
              </div>
              <div className="nc-stat">
                <span>Simplificada</span>
                <strong>{lightLeagueRows.length} {lightLeagueRows.length === 1 ? 'liga' : 'ligas'} · {clubsOf(lightLeagueRows)} clubes</strong>
              </div>
              <div className="nc-stat">
                <span>Ritmo <HelpTip up text="Estimativa da velocidade de avanço do calendário. O que pesa são os clubes com simulação completa (partidas lance a lance): até ~100 clubes, rápido; até ~240, moderado; acima disso, lento." /></span>
                <strong className={pace.tone}>{pace.label}</strong>
              </div>
              <button className="nc-cta" disabled={fullCountries.length === 0} onClick={goToClubs}>Escolher clube<ArrowRight size={16} aria-hidden="true" /></button>
            </footer>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="nc-body">
          <div className="nc-club-grid">
            <section className="card nc-club-list">
              <div className="nc-club-filters">
                <label className="tr-search"><Search size={15} aria-hidden="true" />
                  <input placeholder="Buscar clube…" aria-label="Buscar clube" value={query} maxLength={40} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <div className="row">
                  <select aria-label="País" value={countryFilter} onChange={(e) => { setCountryFilter(e.target.value); setLeagueFilter('all'); setStateFilter('all'); }}>
                    <option value="all">Todos os países completos</option>
                    {fullCountries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select aria-label="Liga" value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}>
                    <option value="all">Todas as ligas</option>
                    {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  {states.length > 0 && <select aria-label="Estado" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                    <option value="all">Todos os estados</option>
                    {states.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                  </select>}
                </div>
              </div>
              <div className="nc-club-scroll" role="listbox" aria-label="Clubes">
                {visible.map((c) => (
                  <button key={c.id} role="option" aria-selected={c.id === clubId} className={`nc-club-row ${c.id === clubId ? 'on' : ''}`} onClick={() => setClubId(c.id)}>
                    <ClubCrest id={c.id} name={c.name} size={26} src={img.url('clubs', c.id)} />
                    <span className="nc-club-row-name"><strong>{c.name}</strong><span className="muted small">{c.league}{c.state ? ` · ${c.state}` : ''}{c.origin.created && <span className="nc-new" title={`Criado pelo pacote "${c.origin.created}"`}>novo</span>}{!c.origin.created && c.origin.edited.length > 0 && <span className="nc-edited" title={`Alterado por: ${c.origin.edited.join(', ')}`}>alterado</span>}</span></span>
                    <span className={`sq-ovr ${tone(c.avgOverall)}`} title="Força média do elenco">{to20(c.avgOverall)}</span>
                  </button>
                ))}
                {visible.length === 0 && <p className="muted small">Nenhum clube com esses filtros.</p>}
              </div>
              <p className="muted small nc-count">{visible.length} clube(s) <HelpTip up text="Só aparecem clubes de divisões com simulação completa: é onde você pode treinar e ser contratado. Para ver outros, volte e marque mais países ou divisões." /></p>
            </section>
            {chosen ? <ClubPanel c={chosen} code={countries.find((x) => x.id === chosen.countryId)?.code ?? ''} crest={img.url('clubs', chosen.id)} photo={img.url('stadiums', chosen.stadiumId)} leagueLogo={img.url('leagues', chosen.leagueId)} coachPhoto={chosen.coach ? img.url('coaches', chosen.coach.id) : null} /> : <section className="card"><p className="muted">Escolha um clube na lista.</p></section>}
          </div>
          <div className="row end">
            <button className="secondary" onClick={() => setStep(1)}><ArrowLeft size={16} aria-hidden="true" />Países</button>
            <button disabled={!chosen} onClick={() => setStep(3)}>Continuar{chosen ? ` com ${chosen.name}` : ''}<ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        </div>
      )}

      {step === 3 && chosen && (
        <div className="nc-body">
          <div className="nc-coach-grid">
          <div className="nc-coach-col">
          <section className="card">
            <h2>Treinador — {chosen.name}</h2>
            <div className="grid2">
              <label>Nome<input value={firstName} maxLength={40} onChange={(e) => setFirstName(e.target.value)} /></label>
              <label>Sobrenome<input value={lastName} maxLength={40} onChange={(e) => setLastName(e.target.value)} /></label>
              <label><span>Data de nascimento <HelpTip text={`Idade na data de início da carreira (${list?.startDate.split('-').reverse().join('/') ?? ''}): mínimo 18 e máximo 90 anos.`} /></span>
                <input type="date" value={birthDate} min={minBirth} max={maxBirth} onChange={(e) => setBirthDate(e.target.value)} />
              </label>
              <label>Nacionalidade
                <select value={nationality} onChange={(e) => setNationality(e.target.value)}>
                  {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Metodologia <HelpTip text="A metodologia define as preferências táticas iniciais; você poderá usar qualquer estilo depois." /></h2>
            <div className="options">
              {(Object.keys(METHODOLOGY) as Methodology[]).map((m) => (
                <label key={m} className={`option ${methodology === m ? 'on' : ''}`}>
                  <input type="radio" name="meth" checked={methodology === m} onChange={() => setMethodology(m)} />
                  <strong>{METHODOLOGY[m].label}</strong><span className="muted small">{METHODOLOGY[m].description}</span>
                </label>
              ))}
            </div>
          </section>
          </div>

          <div className="nc-coach-col">
          <section className="card nc-attrs">
            <div className="nc-attrs-head">
              <h2>Atributos <HelpTip text={`Todos começam em ${COACH_ATTR_BASE}. Distribua os ${COACH_ATTR_POINTS} pontos iniciais (no máximo ${COACH_ATTR_MAX_START} em cada atributo, na escala de 1 a 20). Eles serão a base da reputação e da evolução do treinador, que chegam na próxima fase; por enquanto ainda não alteram a simulação.`} /></h2>
              <span className={`nc-points ${remaining === 0 ? 'done' : ''}`}>{remaining} {remaining === 1 ? 'ponto restante' : 'pontos restantes'}</span>
              <button className="nc-ghost" disabled={remaining === COACH_ATTR_POINTS} onClick={() => setAttrs(baseCoachAttributes())}>Redistribuir</button>
            </div>
            {COACH_ATTRS.map((a) => {
              const v = attrs[a.key];
              return (
                <div key={a.key} className="nc-attr">
                  <span className="nc-attr-label">{a.label} <HelpTip text={a.description} /></span>
                  <span className="pf-track"><i className={tone(v * 5)} style={{ width: `${v * 5}%` }} /></span>
                  <div className="nc-stepper">
                    <button aria-label={`Diminuir ${a.label}`} disabled={v <= COACH_ATTR_BASE} onClick={() => bump(a.key, -1)}>−</button>
                    <b>{v}</b>
                    <button aria-label={`Aumentar ${a.label}`} disabled={remaining <= 0 || v >= COACH_ATTR_MAX_START} onClick={() => bump(a.key, 1)}>+</button>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="card nc-photo-card">
            <h2>Fotografia <span className="muted small">(opcional)</span> <HelpTip text="PNG ou JPEG, até 5 MB, de 64×64 a 4096×4096 pixels. Uma cópia é guardada dentro do save." /></h2>
            <div className="row">
              {photo ? <img className="photo" src={photo.dataUrl} alt="Pré-visualização da foto do treinador" /> : <div className="photo placeholder">Sem foto</div>}
              <div>
                <div className="row">
                  <button className="secondary" onClick={() => void pick()}>{photo ? 'Substituir…' : 'Escolher imagem…'}</button>
                  {photo && <button className="secondary" onClick={() => void removePhoto()}>Remover</button>}
                </div>
                {photo && <p className="muted small">{photo.fileName} · {photo.format.toUpperCase()} · {photo.width}×{photo.height} · {fmtNum(Math.round(photo.bytes / 1024))} KB</p>}
              </div>
            </div>
          </section>
          </div>
          </div>

          {!!chosen && (civilYear ? hasJuly : hasCivil) && (
            <div className="nc-start" role="note">
              <CalendarClock size={22} aria-hidden="true" />
              <div>
                <strong>A carreira começa em {civilYear ? `01/01/${startYear}` : `01/07/${startYear}`}</strong>
                <span>{civilYear
                  ? `${countries.find((x) => x.id === chosen.countryId)?.name} joga a temporada no ano civil: você começa na pré-temporada, com as divisões como na base. Nos países de julho a junho, a temporada ${startYear - 1}/${String(startYear).slice(2)} já estará na metade.`
                  : `Você começa na pré-temporada, com as divisões como na base. Nos países de ano civil (Brasil, Argentina...), a temporada ${startYear} já estará na metade.`}</span>
                <span className="muted small">Os seis meses dos outros países são simulados ao criar a carreira, o que leva alguns segundos.</span>
              </div>
            </div>
          )}
          <div className="row end">
            {remaining > 0 && <span className="muted small">Distribua os pontos de atributo para iniciar ({remaining} restante{remaining === 1 ? '' : 's'}).</span>}
            <button className="secondary" onClick={() => setStep(2)} disabled={busy}><ArrowLeft size={16} aria-hidden="true" />Clube</button>
            <button disabled={!formOk || busy} onClick={() => void create()}>{busy ? (civilYear && hasJuly ? `Simulando jul–dez/${startYear - 1} nos outros países…` : !civilYear && hasCivil ? `Simulando jan–jun/${startYear} nos outros países…` : 'Criando carreira…') : 'Iniciar carreira'}</button>
          </div>
        </div>
      )}
    </main>
  );
}


/** Escolha opcional das divisões de um país marcado: fechada por padrão, abre num painel a partir do cartão do país. */
function DivisionsMenu({ country, leagues, isFull, onToggle, logo }: {
  country: string; leagues: Array<{ id: string; name: string; tier: number; clubs: number }>; isFull: (id: string) => boolean; onToggle: (id: string) => void; logo: (id: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /** posição na janela (fixa): o painel não é cortado pela lista rolável; abre para cima quando falta espaço embaixo */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) { setPos(null); return; }
    const r = btn.current.getBoundingClientRect(), h = pop.current?.offsetHeight ?? 200, w = pop.current?.offsetWidth ?? 270;
    const below = r.bottom + 8 + h <= window.innerHeight - 8;
    setPos({ top: below ? r.bottom + 8 : Math.max(8, r.top - 8 - h), left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false); // rolar a lista ou redimensionar fecha o painel (a posição ficaria errada)
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    window.addEventListener('resize', close); document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [open]);
  const on = leagues.filter((l) => isFull(l.id)).length;
  return (
    <div className="nc-divmenu" ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button ref={btn} className={`nc-divbtn ${on < leagues.length ? 'partial' : ''}`} aria-expanded={open} aria-label={`Divisões simuladas de ${country}: ${on} de ${leagues.length}`} onClick={() => setOpen((o) => !o)}>
        {on}/{leagues.length}<ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div ref={pop} className="nc-divpop" role="dialog" aria-label={`Divisões de ${country}`} style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}>
          <div className="nc-divpop-head"><strong>Divisões simuladas</strong>
            <HelpTip text="Opcional. Desmarque divisões para simulá-las de forma simplificada. Quem sobe para uma divisão completa passa a ser simulado por completo (e vice-versa); o seu clube é sempre completo, mesmo rebaixado." /></div>
          {leagues.map((l) => {
            const checked = isFull(l.id), last = checked && on === 1;
            return (
              <label key={l.id} className="nc-divopt" title={last ? 'Ao menos uma divisão fica completa (desmarque o país para simplificá-lo inteiro)' : undefined}>
                <input type="checkbox" checked={checked} disabled={last} onChange={() => onToggle(l.id)} />
                <span className="nc-divopt-name">{logo(l.id) && <img className="nc-league-logo" src={logo(l.id)!} alt="" />}{l.tier}ª · {l.name}</span><em>{l.clubs} clubes</em>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Painel do clube destacado: só dados reais da base (escudo gerado até a etapa de fotos e escudos). */
function ClubPanel({ c, code, crest, photo, leagueLogo, coachPhoto }: { c: ClubOption; code: string; crest: string | null; photo: string | null; leagueLogo: string | null; coachPhoto: string | null }) {
  const fac: Array<[string, number]> = [['Centro de treinamento', c.facilities.training], ['Categorias de base', c.facilities.youth], ['Departamento médico', c.facilities.medical], ['Estádio', c.facilities.stadium]];
  return (
    <section className="card nc-panel" aria-label={`Clube ${c.name}`}>
      <header className="nc-panel-head">
        <ClubCrest id={c.id} name={c.name} size={68} src={crest} />
        <div>
          <h2>{c.name}</h2>
          <span className="row muted"><Flag code={code} size={14} title={c.country} />{c.city} · {c.country}</span>
          <span className="row nc-chips"><span className="nc-chip">{leagueLogo && <img className="nc-league-logo" src={leagueLogo} alt="" />}{c.league === 'Sem divisão' ? c.league : `${c.league} · ${c.leagueTier}ª divisão`}</span>
            {c.state && <span className="nc-chip" title={c.estadual ? 'Estadual que o clube disputa nesta temporada' : 'Fora do estadual nesta temporada (reserva do estado): sobe quando alguém cai'}>{c.state} · {c.estadual ? `${c.estadual.name}${c.estadual.division === 2 ? ' (segunda divisão)' : ' (elite)'}` : 'fora do estadual'}</span>}
            {c.origin.created && <span className="nc-chip nc-chip-pack" title="Clube que não existe na base do jogo">Criado pelo pacote "{c.origin.created}"</span>}
            {c.origin.edited.length > 0 && <span className="nc-chip nc-chip-pack" title="Dados da base alterados por pacote de dados">Alterado por {c.origin.edited.map((x) => `"${x}"`).join(', ')}</span>}</span>
        </div>
      </header>
      <div className="nc-panel-main">
        <div className="nc-panel-side">
          <div className="nc-hero">
            {photo ? <img className="nc-stadium-photo" src={photo} alt={`Foto do ${c.stadium}`} /> : <StadiumArt id={c.id} title={c.stadium} />}
            {!photo && <span className="nc-hero-tag" title="Imagem gerada pelo jogo; adicione uma foto pelo Editor de dados (pacote)">Imagem ilustrativa</span>}
            <div className="nc-hero-caption"><Building2 size={22} aria-hidden="true" /><div><strong>{c.stadium}</strong><span>{fmtNum(c.capacity)} lugares</span></div></div>
          </div>
          <div className="nc-story">
            <h3>História e identidade <span className="nc-tag" title="Texto provisório gerado pelo jogo para testar a tela; a base de dados ainda não tem histórias dos clubes">Texto de exemplo</span></h3>
            {c.story.text.map((p, i) => <p key={i}>{p}</p>)}
            <div className="nc-story-meta"><span>Fundação <b>{c.story.founded}</b></span><span>Cores <b>{c.story.colors}</b></span><span>Apelido <b>{c.story.nickname}</b></span></div>
          </div>
        </div>
        <div className="nc-panel-side">
          <div className="nc-facts">
            <div className="nc-fact-wide"><span>Objetivo da diretoria</span><strong><Target size={14} aria-hidden="true" /> {c.objective}</strong><em>posição esperada: {c.expectedPosition}º de {c.teamCount}</em></div>
            <div><span>Força média do elenco</span><strong className={tone(c.avgOverall)}>{to20(c.avgOverall)}</strong><em>{c.squadSize} jogadores · idade média {String(c.avgAge).replace('.', ',')}</em></div>
            <div><span>Reputação</span><strong><Stars reputation={c.reputation} size={17} label="Reputação do clube" /></strong></div>
            <div><span>Torcida</span><strong><Users size={14} aria-hidden="true" /> {fmtNum(c.fans)}</strong></div>
            <div><span>Caixa inicial</span><strong><Coins size={14} aria-hidden="true" /> {fmtMoney(c.balance)}</strong></div>
            {c.coach && (
              <div className="nc-fact-wide"><span>Técnico atual</span>
                <strong className="nc-coach"><CoachPhoto id={c.coach.id} name={c.coach.name} size={30} src={coachPhoto} /> {c.coach.name} <Stars reputation={c.coach.reputation} size={14} label="Reputação do técnico" /></strong>
                <em>{c.coach.age} anos · {c.coach.nationality} · se você escolher este clube, assume o lugar dele</em></div>
            )}
          </div>
          <div>
            <h3 className="nc-h3">Destaques do elenco</h3>
            {c.stars.map((p) => (
              <div key={p.name} className="nc-star"><PosPill pos={p.position} /><span>{p.name}</span><b className={`sq-ovr ${tone(p.overall)}`}>{to20(p.overall)}</b></div>
            ))}
          </div>
          <div>
            <h3 className="nc-h3">Estrutura</h3>
            {fac.map(([label, v]) => (
              <div key={label} className="pf-bar nc-fac"><span className="muted">{label}</span><span className="pf-track"><i className={tone(v * 5)} style={{ width: `${v * 5}%` }} /></span><b>{v}</b></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
