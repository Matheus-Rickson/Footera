import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, FileSpreadsheet, Flag as FlagIcon, Pencil, Plus, RotateCcw, Save, Search, Shield, Trash2, Trophy, Upload, UserRound, Users, X } from 'lucide-react';
import type { CsvImportReportDto, EditorEntityDto, EditorKind, EditorListDto, EditorOptionsDto, EditorStatus, EditorSummaryDto, PacksOverviewDto } from '../../shared/api.ts';
import type { Attributes, Position } from '../../shared/types.ts';
import { POS_ORDER } from '../../shared/positions.ts';
import { overallFor } from '../../game/world/overall.ts';
import { GK_ATTRS, gkComposite } from '../../game/world/goalkeeper.ts';
import { to20 } from '../../shared/scale.ts';
import { errMsg, fmtMoney, fmtNum, METHODOLOGY, unwrap } from '../util.ts';
import { useImages, type ImageKind } from '../images.ts';
import { POS_NAME, posLabel, tone } from '../playerUi.tsx';
import { attributeHelp } from '../../game/world/attributeInfo.ts';
import { HelpTip } from '../help.tsx';
import { Stars } from '../stars.tsx';
import { CSV_COLUMNS } from '../../game/data-pack/csv.ts';
import { COACH_ATTRS } from '../../shared/coachAttributes.ts';
import type { Methodology } from '../../shared/types.ts';

type Rec = Record<string, unknown>;
interface Props { onBack: () => void }

const STATUS_LABEL: Record<EditorStatus, string> = { base: '', edited: 'alterado', created: 'novo', removed: 'excluído' };
function StatusTag({ s }: { s: EditorStatus }) { return s === 'base' ? null : <span className={`ed-tag ed-tag-${s}`}>{STATUS_LABEL[s]}</span>; }

const KIND_META: Record<EditorKind, { label: string; one: string; icon: typeof Users; help: string }> = {
  countries: { label: 'Países', one: 'país', icon: FlagIcon, help: 'Nome, código de 3 letras e fator econômico (escala salários, valores e receitas do país).' },
  leagues: { label: 'Ligas', one: 'liga', icon: Trophy, help: 'Divisões de cada país: nome, nível (1 = primeira) e regras de acesso, rebaixamento e vagas continentais.' },
  clubs: { label: 'Clubes', one: 'clube', icon: Shield, help: 'Nome, liga, cidade, reputação, caixa, torcida, estrutura e estádio.' },
  players: { label: 'Jogadores', one: 'jogador', icon: Users, help: 'Dados pessoais, clube, posições, atributos (1 a 20), potencial e contrato. A força é calculada pelos atributos.' },
  coaches: { label: 'Técnicos', one: 'técnico', icon: UserRound, help: 'Técnicos dos clubes e os sem clube: dados pessoais, clube, reputação, metodologia, os 6 atributos (1 a 20) e foto. Um clube tem um técnico só: pôr um técnico num clube manda o técnico de lá para o mercado.' },
};

export function EditorView({ onBack }: Props) {
  const [packId, setPackId] = useState<string | null>(null);
  return packId ? <Workspace packId={packId} onClose={() => setPackId(null)} onBack={onBack} /> : <PackChooser onOpen={setPackId} onBack={onBack} />;
}

// ---------------------------------------------------------------- escolha do pacote
function PackChooser({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [ov, setOv] = useState<PacksOverviewDto | null>(null);
  const [name, setName] = useState(''); const [author, setAuthor] = useState(''); const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { unwrap(window.api.listPacks()).then(setOv).catch((e) => setError(errMsg(e))); }, []);
  async function create() {
    setBusy(true); setError(null);
    try { const s = await unwrap(window.api.editorCreatePack({ name, author, description })); onOpen(s.pack.id); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <main className="shell nc-fit ed-choose">
      <header className="nc-top">
        <div className="nc-top-title">
          <h1>Editor de dados <HelpTip text="Crie ou edite um pacote de dados: altere países, ligas, clubes, jogadores e técnicos da base, crie novos ou exclua. O pacote guarda só as diferenças e vale para as próximas carreiras quando estiver ativo em Pacotes de dados." /></h1>
          <span className="muted small">Escolha um pacote para editar ou crie um novo.</span>
        </div>
        <button className="secondary" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Menu principal</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="ed-choose-grid">
        <section className="card ed-new">
          <h2><Plus size={18} aria-hidden="true" /> Novo pacote</h2>
          <label>Nome do pacote<input value={name} maxLength={80} placeholder="Ex.: Atualização de elencos 2026" onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label>Autor <span className="muted small">(opcional)</span><input value={author} maxLength={80} onChange={(e) => setAuthor(e.target.value)} /></label>
          <label>Descrição <span className="muted small">(opcional)</span><textarea value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)} /></label>
          <button disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? 'Criando…' : 'Criar e editar'}</button>
          <p className="muted small">O pacote novo já fica ativo nas próximas carreiras (dá para desativar em Pacotes de dados).</p>
        </section>
        <section className="ed-pack-list">
          <h2>Seus pacotes</h2>
          {!ov ? <p className="muted">Carregando…</p> : ov.packs.length === 0 ? <p className="muted">Nenhum pacote ainda. Crie o primeiro ao lado.</p> : ov.packs.map((p) => (
            <div key={p.folder} className={`pk-row ${p.enabled ? 'on' : ''} ${p.issues.length ? 'broken' : ''}`}>
              <span className="ed-pack-dot" aria-hidden="true" />
              <div className="pk-main">
                <strong>{p.name} <span className="muted small">v{p.version}{p.author ? ` · ${p.author}` : ''}{p.enabled ? ' · ativo' : ''}</span></strong>
                {p.description && <span className="muted small">{p.description}</span>}
                {p.issues.length > 0 && <span className="error small">Tem erros: corrija os arquivos (veja em Pacotes de dados).</span>}
              </div>
              <button disabled={p.issues.length > 0 || p.fullBase} title={p.fullBase ? 'Bases completas não são editadas aqui' : undefined} onClick={() => onOpen(p.id)}><Pencil size={15} aria-hidden="true" />Editar</button>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- área de trabalho
interface Filters { search: string; countryId: string; leagueId: string; clubId: string; position: string; onlyChanged: boolean }
const NO_FILTERS: Filters = { search: '', countryId: '', leagueId: '', clubId: '', position: '', onlyChanged: false };

function Workspace({ packId, onClose, onBack }: { packId: string; onClose: () => void; onBack: () => void }) {
  const [summary, setSummary] = useState<EditorSummaryDto | null>(null);
  const [opts, setOpts] = useState<EditorOptionsDto | null>(null);
  const [kind, setKind] = useState<EditorKind>('players');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [list, setList] = useState<EditorListDto | null>(null);
  const [limit, setLimit] = useState(100);
  /** id selecionado; '' = criando um novo */
  const [selected, setSelected] = useState<string | null>(null);
  const [entity, setEntity] = useState<EditorEntityDto | null>(null);
  const [draft, setDraft] = useState<Rec | null>(null);
  const [stadium, setStadium] = useState<Rec | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showManifest, setShowManifest] = useState(false);
  const [csv, setCsv] = useState<CsvImportReportDto | null>(null);
  const img = useImages(packId);

  const refreshSummary = useCallback(async () => { setSummary(await unwrap(window.api.editorSummary(packId))); }, [packId]);
  const refreshOpts = useCallback(async () => { setOpts(await unwrap(window.api.editorOptions(packId))); }, [packId]);
  useEffect(() => { refreshSummary().catch((e) => setError(errMsg(e))); refreshOpts().catch((e) => setError(errMsg(e))); }, [refreshSummary, refreshOpts]);
  const loadList = useCallback(async () => {
    const f = filters;
    setList(await unwrap(window.api.editorList(packId, { kind, search: f.search || undefined, countryId: f.countryId || undefined, leagueId: f.leagueId || undefined, clubId: f.clubId || undefined, position: (f.position || undefined) as Position | undefined, onlyChanged: f.onlyChanged || undefined, limit })));
  }, [packId, kind, filters, limit]);
  useEffect(() => { const t = setTimeout(() => { loadList().catch((e) => setError(errMsg(e))); }, 200); return () => clearTimeout(t); }, [loadList]);

  const dirty = useMemo(() => !!entity && !!draft && (JSON.stringify(draft) !== JSON.stringify(entity.record) || JSON.stringify(stadium) !== JSON.stringify(entity.stadium)), [entity, draft, stadium])
    || (selected === '' && !!draft);
  /** troca de seleção protegida: com alterações não salvas, pergunta antes */
  const guard = (action: () => void) => { if (dirty) setPending(() => action); else action(); };
  const open = (id: string) => guard(async () => {
    setError(null); setNotice(null); setConfirmDelete(false); setSelected(id);
    try { const e = await unwrap(window.api.editorGet(packId, kind, id)); setEntity(e); setDraft(structuredClone(e.record)); setStadium(e.stadium ? structuredClone(e.stadium) : null); } catch (e) { setError(errMsg(e)); }
  });
  const startNew = () => guard(() => {
    setError(null); setNotice(null); setConfirmDelete(false); setSelected(''); setEntity(null);
    setDraft(newRecord(kind, filters, opts)); setStadium(kind === 'clubs' ? { name: '', capacity: 15000 } : null);
  });
  const switchKind = (k: EditorKind) => guard(() => { setKind(k); setFilters(NO_FILTERS); setLimit(100); setSelected(null); setEntity(null); setDraft(null); setStadium(null); });
  const discard = () => { if (entity) { setDraft(structuredClone(entity.record)); setStadium(entity.stadium ? structuredClone(entity.stadium) : null); } else { setSelected(null); setDraft(null); setStadium(null); } };

  const errors = draft ? validate(kind, draft, stadium, selected === '') : {};
  const valid = Object.keys(errors).length === 0;
  /** devolve true se deu certo (o 'salvar e continuar' só continua assim) */
  async function run(fn: () => Promise<void>): Promise<boolean> { setBusy(true); setError(null); setNotice(null); try { await fn(); return true; } catch (e) { setError(errMsg(e)); return false; } finally { setBusy(false); } }
  const save = () => run(async () => {
    const e = await unwrap(window.api.editorSave(packId, kind, draft!, kind === 'clubs' ? stadium : null));
    setEntity(e); setDraft(structuredClone(e.record)); setStadium(e.stadium ? structuredClone(e.stadium) : null); setSelected(e.id);
    setNotice(e.status === 'base' ? 'Igual ao original: nada fica guardado no pacote.' : 'Salvo no pacote.');
    await Promise.all([refreshSummary(), loadList(), kind === 'players' ? Promise.resolve() : refreshOpts()]);
  });
  const remove = () => run(async () => {
    await unwrap(window.api.editorRemove(packId, kind, selected!));
    setConfirmDelete(false); setNotice(entity?.inBase ? 'Excluído: o pacote remove este registro da base (dá para restaurar).' : 'Excluído do pacote.');
    if (entity?.inBase) { const e = await unwrap(window.api.editorGet(packId, kind, selected!)); setEntity(e); setDraft(structuredClone(e.record)); }
    else { setSelected(null); setEntity(null); setDraft(null); }
    await Promise.all([refreshSummary(), loadList(), refreshOpts()]);
  });
  const revert = () => run(async () => {
    const e = await unwrap(window.api.editorRevert(packId, kind, selected!));
    setEntity(e); setDraft(structuredClone(e.record)); setStadium(e.stadium ? structuredClone(e.stadium) : null); setNotice('Restaurado como na base.');
    await Promise.all([refreshSummary(), loadList(), refreshOpts()]);
  });
  const exportZip = () => run(async () => { const r = await unwrap(window.api.editorExport(packId)); if (r.saved) setNotice(`Pacote exportado em ${r.path}.`); });

  const totalChanges = summary ? Object.values(summary.changes).reduce((s, c) => s + c.created + c.edited + c.removed, 0) : 0;
  const set = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); setLimit(100); };

  return (
    <main className="shell nc-fit nc-wide ed">
      <header className="nc-top">
        <div className="nc-top-title">
          <h1>{summary?.pack.name ?? 'Editor de dados'} <span className="ed-version">v{summary?.pack.version}</span></h1>
          <span className="row muted small">{totalChanges} alteração(ões) no pacote · {summary?.enabled ? 'ativo nas próximas carreiras' : 'inativo (ative em Pacotes de dados)'}
            <button className="link small" onClick={() => setShowManifest(true)}>Detalhes do pacote</button></span>
        </div>
        <div className="row">
          <button className="secondary" disabled={busy} onClick={() => void exportZip()}><Download size={16} aria-hidden="true" />Exportar .zip</button>
          <button className="secondary" onClick={() => guard(onClose)}>Trocar de pacote</button>
          <button onClick={() => guard(onBack)}>Concluir</button>
        </div>
      </header>

      <div className="ed-grid">
        <nav className="ed-nav" aria-label="Categorias">
          {(Object.keys(KIND_META) as EditorKind[]).map((k) => {
            const M = KIND_META[k], c = summary?.changes[k], n = c ? c.created + c.edited + c.removed : 0;
            return (
              <button key={k} className={`ed-nav-item ${kind === k ? 'on' : ''}`} aria-current={kind === k ? 'page' : undefined} onClick={() => switchKind(k)} title={M.help}>
                <M.icon size={17} aria-hidden="true" /><span>{M.label}</span>{n > 0 && <b>{n}</b>}
              </button>
            );
          })}
        </nav>

        <section className="card ed-list">
          <div className="ed-list-head">
            <label className="tr-search"><Search size={15} aria-hidden="true" /><input placeholder={`Buscar ${KIND_META[kind].one}…`} aria-label="Buscar" value={filters.search} maxLength={60} onChange={(e) => set({ search: e.target.value })} /></label>
            <button title={`Criar ${KIND_META[kind].one}`} aria-label={`Criar ${KIND_META[kind].one}`} onClick={startNew}><Plus size={16} aria-hidden="true" /></button>
          </div>
          {kind !== 'countries' && opts && (
            <div className="ed-filters">
              <select aria-label="País" value={filters.countryId} onChange={(e) => set({ countryId: e.target.value, leagueId: '', clubId: '' })}>
                <option value="">Todos os países</option>{opts.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {(kind === 'clubs') && <select aria-label="Liga" value={filters.leagueId} onChange={(e) => set({ leagueId: e.target.value })}>
                <option value="">Todas as ligas</option>{opts.leagues.filter((l) => !filters.countryId || l.countryId === filters.countryId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>}
              {(kind === 'players' || kind === 'coaches') && <select aria-label="Clube" value={filters.clubId} onChange={(e) => set({ clubId: e.target.value })}>
                <option value="">Todos os clubes</option>{opts.clubs.filter((c) => !filters.countryId || c.countryId === filters.countryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>}
              {kind === 'players' && <select aria-label="Posição" value={filters.position} onChange={(e) => set({ position: e.target.value })}>
                <option value="">Todas as posições</option>{POS_ORDER.filter((p) => p !== 'ST').map((p) => <option key={p} value={p}>{POS_NAME[p]}</option>)}
              </select>}
            </div>
          )}
          <label className="mf-check ed-only"><input type="checkbox" checked={filters.onlyChanged} onChange={(e) => set({ onlyChanged: e.target.checked })} />Só o que este pacote mudou</label>
          {(kind === 'players' || kind === 'clubs') && (
            <div className="ed-csv">
              <span className="ed-csv-label"><FileSpreadsheet size={14} aria-hidden="true" />Planilha<HelpTip text={`CSV com separador ; (Excel em português) ou vírgula. Linha com id existente altera o registro (só as colunas preenchidas; célula vazia não apaga nada); sem id, cria um novo. Tudo ou nada: com qualquer erro, nada é gravado e o relatório mostra a linha. Colunas: ${CSV_COLUMNS[kind].filter((c) => !c.key.startsWith('attr.')).map((c) => `${c.label}${c.help ? ` (${c.help})` : ''}`).join('; ')}${kind === 'players' ? '; e cada atributo pelo nome (Finalização, Passe, Reflexos… 1–20).' : '.'}`} /></span>
              <button className="secondary" disabled={busy} onClick={() => void run(async () => {
                const r = await unwrap(window.api.editorImportCsv(packId, kind));
                if (!r) return;
                setCsv(r);
                if (!r.errors.length) { await refreshSummary(); await refreshOpts(); await loadList(); }
              })}><Upload size={14} aria-hidden="true" />Importar</button>
              <button className="nc-ghost" disabled={busy} onClick={() => void run(async () => { const p = await unwrap(window.api.editorExportCsv(packId, kind, false)); if (p) setNotice(`Planilha salva em ${p}.`); })}><Download size={14} aria-hidden="true" />Exportar</button>
              <button className="nc-ghost" disabled={busy} onClick={() => void run(async () => { const p = await unwrap(window.api.editorExportCsv(packId, kind, true)); if (p) setNotice(`Modelo salvo em ${p}.`); })}>Modelo</button>
            </div>
          )}
          <div className="ed-rows" role="listbox" aria-label={KIND_META[kind].label}>
            {selected === '' && <div className="ed-row on" role="option" aria-selected="true"><span className="ed-row-main"><strong>Novo {KIND_META[kind].one}</strong><span className="muted small">ainda não salvo</span></span><span className="ed-tag ed-tag-created">novo</span></div>}
            {list?.rows.map((r) => (
              <button key={r.id} role="option" aria-selected={selected === r.id} className={`ed-row ${selected === r.id ? 'on' : ''}`} onClick={() => void open(r.id)}>
                <span className="ed-row-main"><strong>{r.title}</strong><span className="muted small">{r.subtitle}</span></span>
                <StatusTag s={r.status} />{r.extra && <span className={`sq-ovr ${tone(Number(r.extra) * 5)}`}>{r.extra}</span>}
              </button>
            ))}
            {list && list.rows.length < list.total && <button className="nc-ghost ed-more" onClick={() => setLimit((l) => l + 100)}>Mostrar mais ({fmtNum(list.total - list.rows.length)} restantes)</button>}
            {list?.total === 0 && <p className="muted small ed-empty">Nada encontrado.</p>}
          </div>
          <p className="muted small">{fmtNum(list?.total ?? 0)} {KIND_META[kind].label.toLowerCase()}</p>
        </section>

        <section className="card ed-form">
          {error && <p className="error" role="alert">{error}</p>}
          {notice && !error && <p className="ok" role="status">{notice}</p>}
          {pending && (
            <div className="notice ed-pending" role="alert">Há alterações não salvas.
              <button disabled={!valid || busy} onClick={() => { const go = pending; setPending(null); void save().then((ok) => { if (ok) go(); }); }}>Salvar e continuar</button>
              <button className="secondary" onClick={() => { const go = pending; setPending(null); discard(); setTimeout(go, 0); }}>Descartar</button>
              <button className="nc-ghost" onClick={() => setPending(null)}>Continuar editando</button>
            </div>
          )}
          {!draft ? (
            <div className="ed-placeholder"><Pencil size={30} aria-hidden="true" /><p>Escolha um item na lista para editar, ou use <b>+</b> para criar.</p><p className="muted small">{KIND_META[kind].help}</p></div>
          ) : (
            <>
              <header className="ed-form-head">
                <div>
                  <h2>{titleOf(kind, draft, selected === '')}</h2>
                  <span className="row muted small">{selected === '' ? `Novo ${KIND_META[kind].one}` : <>id <code>{selected}</code></>}{entity && <StatusTag s={entity.status} />}{dirty && <span className="ed-dirty">● alterações não salvas</span>}</span>
                </div>
                {entity?.derived.overall != null && kind === 'players' && <div className="ed-ovr"><span>Força</span><strong className={tone(Number(liveOverall(draft) ?? entity.derived.overall) * 5)}>{liveOverall(draft) ?? entity.derived.overall}</strong></div>}
                {kind === 'clubs' && entity?.derived.squad != null && <div className="ed-ovr"><span>Elenco</span><strong>{entity.derived.squad}</strong></div>}
              </header>
              {entity?.status === 'removed' ? (
                <p className="notice">Este registro foi excluído por este pacote e não existe nas próximas carreiras. Use <b>Restaurar original</b> para trazê-lo de volta.</p>
              ) : (
                <div className="ed-form-body">
                  {kind === 'countries' && <CountryForm r={draft} set={setDraft} errors={errors} isNew={selected === ''} />}
                  {kind === 'leagues' && opts && <LeagueForm r={draft} set={setDraft} errors={errors} opts={opts} isNew={selected === ''}
                    logo={<ImageField label="Logo da liga" help="Aparece na escolha das divisões e do clube (nova carreira) e na tela de Competições. Ideal: fundo transparente (PNG), formato quadrado." kind="leagues" id={selected || null} img={img} packId={packId} onError={setError} />} />}
                  {kind === 'clubs' && opts && <ClubForm r={draft} set={setDraft} stadium={stadium} setStadium={setStadium} errors={errors} opts={opts}
                    images={<><ImageField label="Escudo" help="Aparece na escolha de clube e nas telas do clube. Ideal: fundo transparente (PNG), formato quadrado." kind="clubs" id={selected || null} img={img} packId={packId} onError={setError} />
                      <ImageField label="Foto do estádio" help="Aparece no painel do clube, no lugar da ilustração. Ideal: horizontal (ex.: 1600×640)." kind="stadiums" id={selected ? String(stadium?.id ?? draft.stadium ?? '') || null : null} img={img} packId={packId} onError={setError} /></>} />}
                  {kind === 'players' && opts && <PlayerForm r={draft} set={setDraft} errors={errors} opts={opts} isNew={selected === ''} derived={entity?.derived ?? null}
                    photo={<ImageField label="Foto do jogador" help="Aparece na ficha do jogador. Ideal: quadrada, rosto centralizado." kind="players" id={selected || null} img={img} packId={packId} onError={setError} />} />}
                  {kind === 'coaches' && opts && <CoachForm r={draft} set={setDraft} errors={errors} opts={opts} derived={entity?.derived ?? null}
                    photo={<ImageField label="Foto do técnico" help="Aparece na tela de nova carreira, na ficha do clube e na ficha do técnico. Ideal: quadrada, rosto centralizado." kind="coaches" id={selected || null} img={img} packId={packId} onError={setError} />} />}
                </div>
              )}
              <footer className="ed-form-foot">
                {entity && entity.inBase && entity.status !== 'base' && <button className="secondary" disabled={busy} onClick={() => void revert()}><RotateCcw size={15} aria-hidden="true" />Restaurar original</button>}
                {entity && entity.status !== 'removed' && (confirmDelete
                  ? <span className="row ed-confirm">Excluir {entity.inBase ? 'da base (nas próximas carreiras)' : 'do pacote'}? <button className="danger" disabled={busy} onClick={() => void remove()}>Excluir</button><button className="nc-ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button></span>
                  : <button className="nc-ghost ed-del" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} aria-hidden="true" />Excluir</button>)}
                <span className="grow" />
                {!valid && <span className="error small">{Object.values(errors)[0]}</span>}
                {entity?.status !== 'removed' && <>
                  <button className="secondary" disabled={busy || !dirty} onClick={discard}><X size={15} aria-hidden="true" />Descartar</button>
                  <button disabled={busy || !dirty || !valid} onClick={() => void save()}><Save size={15} aria-hidden="true" />{busy ? 'Salvando…' : 'Salvar'}</button>
                </>}
              </footer>
            </>
          )}
        </section>
      </div>
      {csv && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setCsv(null); }}>
          <div className="modal ed-csv-modal" role="dialog" aria-modal="true" aria-label="Resultado da importação">
            <header className="modal-head"><FileSpreadsheet size={18} aria-hidden="true" /><h2>{csv.errors.length ? 'Importação não realizada' : 'Importação concluída'}</h2>
              <button className="secondary icon" aria-label="Fechar" autoFocus onClick={() => setCsv(null)}><X size={16} aria-hidden="true" /></button></header>
            <div className="modal-body">
              {csv.errors.length ? <p className="error">Nada foi gravado. Corrija a planilha e importe de novo:</p>
                : <p className="ok">{csv.created} registro(s) criado(s) e {csv.updated} alterado(s) no pacote.{csv.unchanged > 0 ? ` ${csv.unchanged} linha(s) sem mudança foram ignoradas.` : ''}</p>}
              {csv.errors.length > 0 && <ul className="ed-csv-list">{csv.errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {csv.warnings.length > 0 && <><p className="muted small">Avisos:</p><ul className="ed-csv-list muted">{csv.warnings.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
            </div>
            <footer className="modal-foot"><button onClick={() => setCsv(null)}>Fechar</button></footer>
          </div>
        </div>
      )}
      {showManifest && summary && <ManifestModal summary={summary} packId={packId} onClose={() => setShowManifest(false)} onSaved={(s) => { setSummary(s); setShowManifest(false); }} />}
    </main>
  );
}

// ---------------------------------------------------------------- formulários
type Errors = Record<string, string>;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
function getIn(r: Rec, path: string): unknown { return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Rec)[k] : undefined), r); }
function setIn(r: Rec, path: string, v: unknown): Rec {
  const [k, ...rest] = path.split('.');
  return { ...r, [k!]: rest.length ? setIn(((r[k!] as Rec) ?? {}), rest.join('.'), v) : v };
}

function Field({ label, help, error, children, wide }: { label: string; help?: string; error?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`ed-field ${error ? 'bad' : ''} ${wide ? 'wide' : ''}`}>
      <span className="ed-label">{label}{help && <HelpTip text={help} />}</span>
      {children}
      {error && <span className="ed-err">{error}</span>}
    </label>
  );
}
function TextIn({ r, set, path, max = 60, placeholder }: { r: Rec; set: (r: Rec) => void; path: string; max?: number; placeholder?: string }) {
  return <input value={String(getIn(r, path) ?? '')} maxLength={max} placeholder={placeholder} onChange={(e) => set(setIn(r, path, e.target.value))} />;
}
function NumIn({ r, set, path, min, max, step = 1 }: { r: Rec; set: (r: Rec) => void; path: string; min: number; max: number; step?: number }) {
  const v = getIn(r, path);
  return <input type="number" min={min} max={max} step={step} value={v === undefined || v === null ? '' : String(v)} onChange={(e) => set(setIn(r, path, e.target.value === '' ? undefined : Number(e.target.value)))} />;
}

function CountryForm({ r, set, errors, isNew }: { r: Rec; set: (r: Rec) => void; errors: Errors; isNew: boolean }) {
  return (
    <>
      <fieldset className="ed-section"><legend>Identificação</legend>
        <Field label="Nome" error={errors.name}><TextIn r={r} set={set} path="name" /></Field>
        <Field label="Código" help="3 letras maiúsculas (ex.: BRA). É o que liga os jogadores à nacionalidade; mude com cuidado." error={errors.code}>
          <input value={String(r.code ?? '')} maxLength={3} disabled={!isNew} onChange={(e) => set({ ...r, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Fator econômico" help="1 = referência (Brasil 0,6; Inglaterra 1,6). Escala salários, valores de mercado e receitas dos clubes do país." error={errors.economy}><NumIn r={r} set={set} path="economy" min={0.1} max={5} step={0.1} /></Field>
      </fieldset>
    </>
  );
}

function LeagueForm({ r, set, errors, opts, isNew, logo }: { r: Rec; set: (r: Rec) => void; errors: Errors; opts: EditorOptionsDto; isNew: boolean; logo: ReactNode }) {
  return (
    <>
      <fieldset className="ed-section"><legend>Identificação</legend>
        <Field label="Nome" error={errors.name}><TextIn r={r} set={set} path="name" /></Field>
        <Field label="País" error={errors.country}>
          <select value={String(r.country ?? '')} disabled={!isNew} onChange={(e) => set({ ...r, country: e.target.value })}><option value="">Escolha…</option>{opts.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Divisão" help="1 = primeira divisão. As divisões de um país precisam ser 1, 2, 3… sem pular." error={errors.tier}><NumIn r={r} set={set} path="tier" min={1} max={10} /></Field>
      </fieldset>
      <fieldset className="ed-section"><legend>Regras</legend>
        <Field label="Sobem para a divisão de cima" help="Precisa ser igual ao número de rebaixados da divisão de cima."><NumIn r={r} set={set} path="rules.promotionSlots" min={0} max={10} /></Field>
        <Field label="Caem para a divisão de baixo"><NumIn r={r} set={set} path="rules.relegationSlots" min={0} max={10} /></Field>
        <Field label="Vagas continentais"><NumIn r={r} set={set} path="rules.continentalSlots" min={0} max={10} /></Field>
        <Field label="Turnos" help="2 = turno e returno."><NumIn r={r} set={set} path="rules.rounds" min={1} max={4} /></Field>
        <Field label="Pontos por vitória"><NumIn r={r} set={set} path="rules.pointsWin" min={1} max={5} /></Field>
        <Field label="Pontos por empate"><NumIn r={r} set={set} path="rules.pointsDraw" min={0} max={3} /></Field>
      </fieldset>
      <fieldset className="ed-section ed-images"><legend>Imagem</legend>{logo}</fieldset>
    </>
  );
}

function ClubForm({ r, set, stadium, setStadium, errors, opts, images }: { r: Rec; set: (r: Rec) => void; stadium: Rec | null; setStadium: (s: Rec) => void; errors: Errors; opts: EditorOptionsDto; images: ReactNode }) {
  const leagues = opts.leagues.filter((l) => l.countryId === r.country).sort((a, b) => a.tier - b.tier);
  return (
    <>
      <fieldset className="ed-section"><legend>Identificação</legend>
        <Field label="Nome" error={errors.name} wide><TextIn r={r} set={set} path="name" /></Field>
        <Field label="Sigla" help="2 a 5 letras (aparece em placares)." error={errors.shortName}><input value={String(r.shortName ?? '')} maxLength={5} onChange={(e) => set({ ...r, shortName: e.target.value.toUpperCase() })} /></Field>
        <Field label="Cidade"><TextIn r={r} set={set} path="city" /></Field>
        <Field label="País" error={errors.country}>
          <select value={String(r.country ?? '')} onChange={(e) => set({ ...r, country: e.target.value, league: '' })}><option value="">Escolha…</option>{opts.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Liga" error={errors.league}>
          <select value={String(r.league ?? '')} onChange={(e) => set({ ...r, league: e.target.value })}><option value="">Escolha…</option>{leagues.map((l) => <option key={l.id} value={l.id}>{l.tier}ª · {l.name}</option>)}</select></Field>
      </fieldset>
      <fieldset className="ed-section"><legend>Porte</legend>
        <Field label="Reputação" help="1 a 100 (valor do motor; no jogo aparece em estrelas, de 0 a 5, de meia em meia: 10 pontos = meia estrela). Define a expectativa da diretoria e o nível dos jogadores gerados para completar o elenco." error={errors.reputation}>
          <span className="ed-rep"><NumIn r={r} set={set} path="reputation" min={1} max={100} />{Number.isFinite(Number(r.reputation)) && <Stars reputation={Number(r.reputation)} label="No jogo" />}</span></Field>
        <Field label="Caixa (€)" help="Em branco: calculado pelo jogo (reputação, economia e valor do elenco)." error={errors.balance}><NumIn r={r} set={set} path="balance" min={-1e10} max={1e11} step={100000} /></Field>
        <Field label="Torcida" error={errors.fans}><NumIn r={r} set={set} path="fans" min={0} max={1e8} step={1000} /></Field>
      </fieldset>
      <fieldset className="ed-section"><legend>Estrutura <span className="muted small">(1 a 20)</span></legend>
        {([['training', 'Centro de treinamento'], ['youth', 'Categorias de base'], ['medical', 'Departamento médico'], ['stadium', 'Estádio']] as const).map(([k, label]) => (
          <Field key={k} label={label} error={errors[`facilities.${k}`]}><NumIn r={r} set={set} path={`facilities.${k}`} min={1} max={20} /></Field>
        ))}
      </fieldset>
      <fieldset className="ed-section ed-images"><legend>Imagens</legend>{images}</fieldset>
      {stadium && (
        <fieldset className="ed-section"><legend>Estádio</legend>
          <Field label="Nome do estádio" error={errors['stadium.name']} wide><input value={String(stadium.name ?? '')} maxLength={80} placeholder={`Estádio ${String(r.city ?? '')}`} onChange={(e) => setStadium({ ...stadium, name: e.target.value })} /></Field>
          <Field label="Capacidade" error={errors['stadium.capacity']}><input type="number" min={500} max={250000} step={500} value={String(stadium.capacity ?? '')} onChange={(e) => setStadium({ ...stadium, capacity: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        </fieldset>
      )}
    </>
  );
}

const ATTR_GROUPS: Array<[keyof Attributes, string, Array<[string, string]>]> = [
  ['technical', 'Técnicos', [['finishing', 'Finalização'], ['passing', 'Passe'], ['dribbling', 'Drible'], ['tackling', 'Desarme'], ['marking', 'Marcação'], ['firstTouch', 'Primeiro toque'], ['crossing', 'Cruzamento'], ['heading', 'Cabeceio'], ['longShots', 'Chute de longe'], ['goalkeeping', 'Goleiro']]],
  ['mental', 'Mentais', [['vision', 'Visão de jogo'], ['composure', 'Compostura'], ['decisions', 'Decisões'], ['positioning', 'Posicionamento'], ['workRate', 'Empenho'], ['leadership', 'Liderança'], ['aggression', 'Agressividade']]],
  ['physical', 'Físicos', [['pace', 'Velocidade'], ['stamina', 'Resistência'], ['strength', 'Força física'], ['agility', 'Agilidade'], ['jumping', 'Impulsão'], ['naturalFitness', 'Preparo natural']]],
];

function PlayerForm({ r, set, errors, opts, isNew, derived, photo }: { r: Rec; set: (r: Rec) => void; errors: Errors; opts: EditorOptionsDto; isNew: boolean; derived: EditorEntityDto['derived'] | null; photo: ReactNode }) {
  const secs = (r.secondaryPositions as Position[] | undefined) ?? [];
  const toggleSec = (p: Position) => set({ ...r, secondaryPositions: secs.includes(p) ? secs.filter((x) => x !== p) : [...secs, p].slice(0, 3) });
  return (
    <>
      <fieldset className="ed-section"><legend>Dados pessoais</legend>
        <Field label="Nome" error={errors.firstName}><TextIn r={r} set={set} path="firstName" max={40} /></Field>
        <Field label="Sobrenome" error={errors.lastName}><TextIn r={r} set={set} path="lastName" max={40} /></Field>
        <Field label="Nascimento" help={`Idade de 15 a 45 anos no início da carreira (01/07/2026).${derived?.age != null ? ` Hoje: ${derived.age} anos.` : ''}`} error={errors.birthDate}><input type="date" value={String(r.birthDate ?? '')} onChange={(e) => set({ ...r, birthDate: e.target.value })} /></Field>
        <Field label="Nacionalidade" error={errors.nationality}>
          <select value={String(r.nationality ?? '')} onChange={(e) => set({ ...r, nationality: e.target.value })}><option value="">Escolha…</option>{opts.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
        <Field label="Pé"><select value={String(r.foot ?? 'right')} onChange={(e) => set({ ...r, foot: e.target.value })}><option value="right">Destro</option><option value="left">Canhoto</option><option value="both">Ambidestro</option></select></Field>
        <Field label="Altura (cm)" error={errors.heightCm}><NumIn r={r} set={set} path="heightCm" min={140} max={220} /></Field>
        <Field label="Peso (kg)" error={errors.weightKg}><NumIn r={r} set={set} path="weightKg" min={40} max={130} /></Field>
      </fieldset>
      <fieldset className="ed-section ed-images"><legend>Foto</legend>{photo}</fieldset>
      <fieldset className="ed-section"><legend>Clube e posições</legend>
        <Field label="Clube" help="Sem clube = jogador livre no mercado." wide>
          <select value={String(r.club ?? '')} onChange={(e) => set({ ...r, club: e.target.value || null })}><option value="">Sem clube</option>{opts.clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Posição" error={errors.position}>
          <select value={String(r.position ?? '')} onChange={(e) => set({ ...r, position: e.target.value, secondaryPositions: secs.filter((x) => x !== e.target.value) })}><option value="">Escolha…</option>{POS_ORDER.filter((p) => p !== 'ST').map((p) => <option key={p} value={p}>{posLabel(p)} — {POS_NAME[p]}</option>)}</select></Field>
        <div className="ed-field wide"><span className="ed-label">Posições secundárias <HelpTip text="Até 3. Fora das posições vizinhas no campo o jogo aceita, mas avisa." /></span>
          <div className="mf-pills">{POS_ORDER.filter((p) => p !== 'ST' && p !== r.position).map((p) => <button key={p} type="button" className={`mf-pill ${secs.includes(p) ? 'on' : ''}`} aria-pressed={secs.includes(p)} title={POS_NAME[p]} onClick={() => toggleSec(p)}>{posLabel(p)}</button>)}</div></div>
      </fieldset>
      {isNew ? (
        <fieldset className="ed-section"><legend>Nível</legend>
          <Field label="Força (1–20)" help="O jogo gera atributos com o perfil da posição para chegar nessa força. Depois de salvar, dá para ajustar atributo por atributo." error={errors.ability}><NumIn r={r} set={set} path="ability" min={1} max={20} /></Field>
          <Field label="Potencial (1–20)" help="Até onde o jogador pode evoluir. Em branco: o jogo define pela idade." error={errors.potential}><NumIn r={r} set={set} path="potential" min={1} max={20} /></Field>
        </fieldset>
      ) : (
        <fieldset className="ed-section ed-attrs"><legend>Atributos <span className="muted small">(1 a 20 · a força acompanha)</span></legend>
          {r.position === 'GK' && (
            <div className="ed-attr-group ed-gk"><h4>Goleiro <HelpTip text="O 'Goleiro (geral)', usado pelo motor nas defesas, é a média ponderada destes seis (reflexos pesam mais). As funções de goleiro usam os específicos." /></h4>
              {GK_ATTRS.map((a) => {
                const v = num(getIn(r, `attributes.goalkeeper.${a.key}`));
                return <label key={a.key} className={`ed-attr ${errors[`attributes.goalkeeper.${a.key}`] ? 'bad' : ''}`}><span className="ed-attr-name">{a.label}<HelpTip text={attributeHelp(a.key)} /></span><input type="number" min={1} max={20} value={Number.isFinite(v) ? v : ''} onChange={(e) => set(setIn(r, `attributes.goalkeeper.${a.key}`, e.target.value === '' ? undefined : Number(e.target.value)))} className={tone(v * 5)} /></label>;
              })}
            </div>
          )}
          {ATTR_GROUPS.map(([g, label, keys]) => (
            <div key={g} className="ed-attr-group"><h4>{label}</h4>
              {keys.filter(([k]) => !(k === 'goalkeeping' && r.position === 'GK')).map(([k, name]) => {
                const v = num(getIn(r, `attributes.${g}.${k}`));
                return <label key={k} className={`ed-attr ${errors[`attributes.${g}.${k}`] ? 'bad' : ''}`}><span className="ed-attr-name">{name}<HelpTip text={attributeHelp(k)} /></span><input type="number" min={1} max={20} value={Number.isFinite(v) ? v : ''} onChange={(e) => set(setIn(r, `attributes.${g}.${k}`, e.target.value === '' ? undefined : Number(e.target.value)))} className={tone(v * 5)} /></label>;
              })}
            </div>
          ))}
        </fieldset>
      )}
      {!isNew && (
        <fieldset className="ed-section"><legend>Evolução</legend>
          <Field label="Potencial (1–20)" help="Até onde o jogador pode evoluir (nunca abaixo da força atual)." error={errors.potential}><NumIn r={r} set={set} path="potential" min={1} max={20} /></Field>
        </fieldset>
      )}
      <fieldset className="ed-section"><legend>Contrato</legend>
        <Field label="Salário mensal (€)" help="Em branco num jogador novo: calculado pelo valor de mercado." error={errors['contract.salary']}><NumIn r={r} set={set} path="contract.salary" min={0} max={1e8} step={500} /></Field>
        <Field label="Fim do contrato" error={errors['contract.end']}><input type="date" value={String(getIn(r, 'contract.end') ?? '')} onChange={(e) => set(setIn(r, 'contract.end', e.target.value || undefined))} /></Field>
        {derived?.marketValue != null && <div className="ed-field"><span className="ed-label">Valor de mercado <HelpTip text="Calculado pelo jogo (força, idade, potencial e economia do país)." /></span><strong className="ed-derived">{fmtMoney(derived.marketValue)}</strong></div>}
      </fieldset>
    </>
  );
}

function CoachForm({ r, set, errors, opts, derived, photo }: { r: Rec; set: (r: Rec) => void; errors: Errors; opts: EditorOptionsDto; derived: EditorEntityDto['derived'] | null; photo: ReactNode }) {
  return (
    <>
      <fieldset className="ed-section"><legend>Dados pessoais</legend>
        <Field label="Nome" error={errors.firstName}><TextIn r={r} set={set} path="firstName" max={40} /></Field>
        <Field label="Sobrenome" error={errors.lastName}><TextIn r={r} set={set} path="lastName" max={40} /></Field>
        <Field label="Nascimento" help={`Idade de 25 a 85 anos no início da carreira (01/07/2026). Os técnicos da IA se aposentam aos 70.${derived?.age != null ? ` Hoje: ${derived.age} anos.` : ''}`} error={errors.birthDate}><input type="date" value={String(r.birthDate ?? '')} onChange={(e) => set({ ...r, birthDate: e.target.value })} /></Field>
        <Field label="Nacionalidade" error={errors.nationality}>
          <select value={String(r.nationality ?? '')} onChange={(e) => set({ ...r, nationality: e.target.value })}><option value="">Escolha…</option>{opts.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
      </fieldset>
      <fieldset className="ed-section ed-images"><legend>Foto</legend>{photo}</fieldset>
      <fieldset className="ed-section"><legend>Clube e perfil</legend>
        <Field label="Clube" help="Sem clube = técnico no mercado (os clubes que demitem contratam daqui). Pôr este técnico num clube manda o técnico atual de lá para o mercado." wide>
          <select value={String(r.club ?? '')} onChange={(e) => set({ ...r, club: e.target.value || null })}><option value="">Sem clube</option>{opts.clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Reputação" help="1 a 100 (valor do motor; no jogo aparece em estrelas, de 0 a 5, de meia em meia). Clubes que demitem procuram técnicos de reputação parecida com a deles." error={errors.reputation}>
          <span className="ed-rep"><NumIn r={r} set={set} path="reputation" min={1} max={100} />{Number.isFinite(Number(r.reputation)) && <Stars reputation={Number(r.reputation)} label="No jogo" />}</span></Field>
        <Field label="Metodologia">
          <select value={String(r.methodology ?? 'possession')} onChange={(e) => set({ ...r, methodology: e.target.value })}>{(Object.keys(METHODOLOGY) as Methodology[]).map((m) => <option key={m} value={m}>{METHODOLOGY[m].label}</option>)}</select></Field>
      </fieldset>
      <fieldset className="ed-section ed-attrs"><legend>Atributos <span className="muted small">(1 a 20 · os efeitos começam acima de 5)</span></legend>
        <div className="ed-attr-group">
          {COACH_ATTRS.map((a) => {
            const v = num(getIn(r, `attributes.${a.key}`));
            return <label key={a.key} className={`ed-attr ${errors[`attributes.${a.key}`] ? 'bad' : ''}`}><span className="ed-attr-name">{a.label}<HelpTip text={a.description} /></span><input type="number" min={1} max={20} value={Number.isFinite(v) ? v : ''} onChange={(e) => set(setIn(r, `attributes.${a.key}`, e.target.value === '' ? undefined : Number(e.target.value)))} className={tone(v * 5)} /></label>;
          })}
        </div>
      </fieldset>
    </>
  );
}

/** Imagem do pacote para uma entidade: gravada na hora (não depende do Salvar). Entidade nova: salvar primeiro. */
function ImageField({ label, help, kind, id, img, packId, onError }: { label: string; help: string; kind: ImageKind; id: string | null; img: ReturnType<typeof useImages>; packId: string; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const url = id ? img.url(kind, id) : null;
  async function act(fn: () => Promise<{ ok: true; data: { version: number; keys: string[] } | null } | { ok: false; error: string }>) {
    setBusy(true); onError(null);
    try { const r = await fn(); if (!r.ok) onError(r.error); else if (r.data) img.apply(r.data); } finally { setBusy(false); }
  }
  return (
    <div className="ed-field ed-image">
      <span className="ed-label">{label}<HelpTip text={`${help} PNG ou JPEG, até 5 MB, de 64 a 4096 px. A imagem é gravada no pacote na hora.`} /></span>
      {!id ? <span className="muted small">Salve o registro primeiro para adicionar a imagem.</span> : (
        <div className="ed-image-row">
          {url ? <img className={`ed-thumb ed-thumb-${kind}`} src={url} alt={label} /> : <div className={`ed-thumb ed-thumb-${kind} empty`}>sem imagem</div>}
          <div className="ed-image-actions">
            <button className="secondary" disabled={busy} onClick={() => void act(() => window.api.editorSetImage(packId, kind, id))}>{url ? 'Trocar…' : 'Escolher…'}</button>
            {url && <button className="nc-ghost" disabled={busy} onClick={() => void act(() => window.api.editorRemoveImage(packId, kind, id))}>Remover</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function ManifestModal({ summary, packId, onClose, onSaved }: { summary: EditorSummaryDto; packId: string; onClose: () => void; onSaved: (s: EditorSummaryDto) => void }) {
  const [m, setM] = useState({ name: summary.pack.name, version: summary.pack.version, author: summary.pack.author ?? '', description: summary.pack.description ?? '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Detalhes do pacote" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <header className="modal-head"><h2>Detalhes do pacote</h2><button className="secondary icon" aria-label="Fechar" autoFocus onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
        <div className="modal-body ed-manifest">
          {error && <p className="error" role="alert">{error}</p>}
          <label>Nome<input value={m.name} maxLength={80} onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
          <label>Versão <span className="muted small">(ex.: 1.1.0 — aumente ao publicar mudanças)</span><input value={m.version} maxLength={20} onChange={(e) => setM({ ...m, version: e.target.value })} /></label>
          <label>Autor<input value={m.author} maxLength={80} onChange={(e) => setM({ ...m, author: e.target.value })} /></label>
          <label>Descrição<textarea rows={3} value={m.description} maxLength={1000} onChange={(e) => setM({ ...m, description: e.target.value })} /></label>
          <p className="muted small">Id do pacote: <code>{packId}</code> (fixo).</p>
        </div>
        <footer className="modal-foot"><button className="secondary" onClick={onClose}>Cancelar</button>
          <button disabled={!m.name.trim() || !m.version.trim()} onClick={() => void unwrap(window.api.editorUpdateManifest(packId, m)).then(onSaved).catch((e) => setError(errMsg(e)))}>Salvar</button></footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- regras da tela
function titleOf(kind: EditorKind, r: Rec, isNew: boolean): string {
  const t = kind === 'players' || kind === 'coaches' ? `${String(r.firstName ?? '')} ${String(r.lastName ?? '')}`.trim() : String(r.name ?? '');
  return t || (isNew ? `Novo ${KIND_META[kind].one}` : '—');
}
/** força ao vivo pelos atributos do formulário (a mesma fórmula do jogo) */
function liveOverall(r: Rec): number | null {
  const a = r.attributes as Attributes | undefined, pos = r.position as Position | undefined;
  if (!a || !pos) return null;
  const all = [...Object.values(a.technical ?? {}), ...Object.values(a.mental ?? {}), ...Object.values(a.physical ?? {}), ...Object.values(a.goalkeeper ?? {})];
  if (all.some((v) => typeof v !== 'number' || v < 1 || v > 20)) return null;
  // goleiro: o "goalkeeping" é calculado dos seis específicos (como no jogo)
  const live = pos === 'GK' && a.goalkeeper ? { ...a, technical: { ...a.technical, goalkeeping: gkComposite(a.goalkeeper) } } : a;
  return to20(overallFor(live, pos));
}
function newRecord(kind: EditorKind, f: Filters, opts: EditorOptionsDto | null): Rec {
  if (kind === 'countries') return { name: '', code: '', economy: 1 };
  if (kind === 'leagues') return { name: '', country: f.countryId, tier: 1, rules: { promotionSlots: 0, relegationSlots: 0, continentalSlots: 0, rounds: 2, pointsWin: 3, pointsDraw: 1 } };
  if (kind === 'clubs') return { name: '', country: f.countryId, league: f.leagueId, city: '', reputation: 50 };
  const club = f.clubId ? opts?.clubs.find((c) => c.id === f.clubId) : undefined;
  const code = opts?.countries.find((c) => c.id === (club?.countryId ?? f.countryId))?.code ?? 'BRA';
  if (kind === 'coaches') return { firstName: '', lastName: '', birthDate: '1975-01-01', nationality: code, club: club?.id ?? null, reputation: 40, methodology: 'possession', attributes: Object.fromEntries(COACH_ATTRS.map((a) => [a.key, 8])) };
  return { firstName: '', lastName: '', birthDate: '2000-01-01', nationality: code, club: club?.id ?? null, position: f.position || 'CM', foot: 'right', ability: 10 };
}
/** validação imediata (o jogo valida tudo de novo ao salvar) */
function validate(kind: EditorKind, r: Rec, stadium: Rec | null, isNew: boolean): Errors {
  const e: Errors = {};
  const req = (k: string, label: string) => { if (!String(getIn(r, k) ?? '').trim()) e[k] = `${label}: obrigatório.`; };
  const range = (k: string, label: string, min: number, max: number, optional = true) => {
    const v = getIn(r, k);
    if (v === undefined || v === null || v === '') { if (!optional) e[k] = `${label}: obrigatório.`; return; }
    if (!Number.isFinite(Number(v)) || Number(v) < min || Number(v) > max) e[k] = `${label}: de ${fmtNum(min)} a ${fmtNum(max)}.`;
  };
  if (kind === 'countries') { req('name', 'Nome'); if (!/^[A-Z]{3}$/.test(String(r.code ?? ''))) e.code = 'Código: 3 letras maiúsculas.'; range('economy', 'Fator econômico', 0.1, 5); }
  if (kind === 'leagues') { req('name', 'Nome'); req('country', 'País'); range('tier', 'Divisão', 1, 10, false); }
  if (kind === 'clubs') {
    req('name', 'Nome'); req('country', 'País'); req('league', 'Liga'); range('reputation', 'Reputação', 1, 100);
    const sn = String(r.shortName ?? ''); if (sn && (sn.length < 2 || sn.length > 5)) e.shortName = 'Sigla: 2 a 5 letras.';
    for (const k of ['training', 'youth', 'medical', 'stadium']) range(`facilities.${k}`, 'Estrutura', 1, 20);
    if (stadium) { if (!String(stadium.name ?? '').trim()) e['stadium.name'] = 'Nome do estádio: obrigatório.'; const c = Number(stadium.capacity); if (!Number.isFinite(c) || c < 500 || c > 250000) e['stadium.capacity'] = 'Capacidade: de 500 a 250.000.'; }
  }
  if (kind === 'coaches') {
    req('firstName', 'Nome'); req('lastName', 'Sobrenome'); req('nationality', 'Nacionalidade'); range('reputation', 'Reputação', 1, 100, false);
    const b = String(r.birthDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) e.birthDate = 'Nascimento: data obrigatória.';
    else { const age = 2026 - Number(b.slice(0, 4)) - (b.slice(5) > '07-01' ? 1 : 0); if (age < 25 || age > 85) e.birthDate = 'Nascimento: idade de 25 a 85 anos em 01/07/2026.'; }
    for (const a of COACH_ATTRS) range(`attributes.${a.key}`, a.label, 1, 20, false);
  }
  if (kind === 'players') {
    req('firstName', 'Nome'); req('lastName', 'Sobrenome'); req('nationality', 'Nacionalidade'); req('position', 'Posição');
    const b = String(r.birthDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) e.birthDate = 'Nascimento: data obrigatória.';
    else { const age = 2026 - Number(b.slice(0, 4)) - (b.slice(5) > '07-01' ? 1 : 0); if (age < 15 || age > 45) e.birthDate = 'Nascimento: idade de 15 a 45 anos em 01/07/2026.'; }
    range('heightCm', 'Altura', 140, 220); range('weightKg', 'Peso', 40, 130); range('potential', 'Potencial', 1, 20);
    range('contract.salary', 'Salário', 0, 1e8);
    if (isNew) range('ability', 'Força', 1, 20, false);
    else {
      for (const [g, , keys] of ATTR_GROUPS) for (const [k, name] of keys) if (!(k === 'goalkeeping' && r.position === 'GK')) range(`attributes.${g}.${k}`, name, 1, 20, false);
      if (r.position === 'GK') for (const a of GK_ATTRS) range(`attributes.goalkeeper.${a.key}`, a.label, 1, 20, false);
    }
  }
  return e;
}

