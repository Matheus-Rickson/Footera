import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Binoculars, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { ScoutCriteria, ScoutingOverviewDto, ScoutScope, ScoutTaskInput, ScoutTaskPreviewDto } from '../../shared/api.ts';
import type { Position } from '../../shared/types.ts';
import { ATTR_GROUP, ATTR_LABEL } from '../../shared/attributeLabels.ts';
import { POS_LABEL, POS_NAME, POS_ORDER } from '../../shared/positions.ts';
import { criteriaCount, SCOPE_LABEL, STAT_LABEL, STATUS_LABEL, TASK_MONTHS, type ScoutStatKey, type ScoutStatus } from '../../game/scouting-engine/tasks.ts';
import { errMsg, fmtDate, unwrap } from '../util.ts';
import { FOOT_LABEL, PosPill } from '../playerUi.tsx';
import { HelpTip } from '../help.tsx';

type RangeKey = 'overall' | 'potential' | 'age' | 'value' | 'salary' | 'reputation' | 'condition' | 'morale';
/** Faixas: rótulo, unidade, fator para o motor (valor em milhões de euros, salário em milhares) e os limites do controle deslizante. */
const RANGES: Record<RangeKey, { label: string; unit?: string; factor: number; min: number; max: number; step: number }> = {
  overall: { label: 'Força', factor: 1, min: 1, max: 20, step: 1 },
  potential: { label: 'Potencial', factor: 1, min: 1, max: 20, step: 1 },
  age: { label: 'Idade', unit: 'anos', factor: 1, min: 15, max: 40, step: 1 },
  value: { label: 'Valor de mercado', unit: 'mi €', factor: 1e6, min: 0, max: 150, step: 0.5 },
  salary: { label: 'Salário', unit: 'mil €/mês', factor: 1e3, min: 0, max: 1000, step: 5 },
  reputation: { label: 'Reputação', unit: '★', factor: 1, min: 0, max: 5, step: 0.5 },
  condition: { label: 'Condição', unit: '%', factor: 1, min: 0, max: 100, step: 5 },
  morale: { label: 'Moral', unit: '%', factor: 1, min: 0, max: 100, step: 5 },
};
/** Mínimos de estatística: limites do controle deslizante e o padrão ao abrir. */
const STATS: Record<ScoutStatKey, { max: number; step: number; init: number }> = {
  appearances: { max: 60, step: 1, init: 5 }, minutes: { max: 5400, step: 90, init: 450 }, goals: { max: 40, step: 1, init: 3 },
  assists: { max: 30, step: 1, init: 3 }, avgRating: { max: 10, step: 0.1, init: 6.8 },
};
const OUTFIELD = Object.keys(ATTR_GROUP).filter((k) => ATTR_GROUP[k] !== 'goalkeeper' && k !== 'goalkeeping');
const KEEPER = Object.keys(ATTR_GROUP).filter((k) => ATTR_GROUP[k] === 'goalkeeper');

interface Props { profileId: string; careerId: string; ov: ScoutingOverviewDto; onClose: () => void; onCreated: (taskId: string) => void }

const bucketText = (c: ScoutTaskPreviewDto['compatible']) => (c.high === 0 ? 'nenhum' : c.high === null ? `mais de ${(c.low - 1).toLocaleString('pt-BR')}` : `${c.low}–${c.high}`);
const round = (v: number, step: number) => Math.round(v / step) * step;
const show = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));

/** Controle deslizante de duas pontas (mínimo e máximo), com os valores em destaque. */
function DualRange({ min, max, step, lo, hi, onChange }: { min: number; max: number; step: number; lo: number; hi: number; onChange: (lo: number, hi: number) => void }) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <div className="stm-dual">
      <div className="stm-dual-vals">
        <input aria-label="Mínimo" type="number" min={min} max={hi} step={step} value={lo} onChange={(e) => onChange(Math.min(Math.max(min, Number(e.target.value)), hi), hi)} />
        <input aria-label="Máximo" type="number" min={lo} max={max} step={step} value={hi} onChange={(e) => onChange(lo, Math.max(Math.min(max, Number(e.target.value)), lo))} />
      </div>
      <div className="stm-dual-track">
        <i style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
        <input aria-label="Mínimo (controle)" type="range" min={min} max={max} step={step} value={lo} onChange={(e) => onChange(Math.min(round(Number(e.target.value), step), hi), hi)} />
        <input aria-label="Máximo (controle)" type="range" min={min} max={max} step={step} value={hi} onChange={(e) => onChange(lo, Math.max(round(Number(e.target.value), step), lo))} />
      </div>
    </div>
  );
}

/** Controle deslizante de uma ponta (mínimo). */
function MinRange({ min, max, step, value, onChange }: { min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="stm-dual">
      <div className="stm-dual-vals"><span className="muted small">Mínimo</span><input aria-label="Mínimo" type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))} /></div>
      <div className="stm-dual-track stm-single"><i style={{ left: `${pct}%`, right: 0 }} />
        <input aria-label="Mínimo (controle)" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(round(Number(e.target.value), step))} /></div>
    </div>
  );
}

/** Caixa de escolha de um filtro (fecha com Cancelar, Esc ou clique fora). */
function Popover({ title, onCancel, onApply, onReset, resetLabel = 'Redefinir', children, wide }: {
  title: string; onCancel: () => void; onApply: () => void; onReset?: () => void; resetLabel?: string; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onCancel(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true); };
  }, [onCancel]);
  return (
    <div ref={ref} className={`stm-pop ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
      <div className="stm-pop-head"><b>{title}</b>{onReset && <button type="button" className="stm-link" onClick={onReset}>{resetLabel}</button>}</div>
      <div className="stm-pop-body">{children}</div>
      <div className="stm-pop-foot"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="button" onClick={onApply}>Aplicar</button></div>
    </div>
  );
}

export function ScoutTaskModal({ profileId, careerId, ov, onClose, onCreated }: Props) {
  const [scope, setScope] = useState<ScoutScope>('country');
  const [country, setCountry] = useState(ov.homeCountryCode || ov.countries[0]?.code || '');
  const [league, setLeague] = useState(ov.leagues[0]?.id ?? '');
  const [name, setName] = useState('');
  const [crit, setCrit] = useState<ScoutCriteria>({});
  const [pop, setPop] = useState<string | null>(null); // filtro com a caixa de escolha aberta
  const [draft, setDraft] = useState<unknown>(null);
  const [months, setMonths] = useState<number | null>(6);
  const [preview, setPreview] = useState<ScoutTaskPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const area = scope === 'country' ? country : scope === 'league' ? league : '';
  const input: ScoutTaskInput = useMemo(() => ({ scope, area, criteria: crit, months, ...(name.trim() ? { name: name.trim() } : {}) }), [scope, area, crit, months, name]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pop) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, pop]);
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      unwrap(window.api.previewScoutTask(profileId, careerId, input)).then((p) => { if (!stale) { setPreview(p); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [profileId, careerId, input]);

  async function create() {
    setBusy(true); setError(null);
    try { onCreated(await unwrap(window.api.createScoutTask(profileId, careerId, input))); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  const close = () => { setPop(null); setDraft(null); };
  const openPop = (id: string, d: unknown) => { setPop(id); setDraft(d); };
  const setKey = <K extends keyof ScoutCriteria>(k: K, v: ScoutCriteria[K] | undefined) => setCrit((c) => { const { [k]: _old, ...rest } = c; return v === undefined ? rest : { ...rest, [k]: v }; });
  const setIn = (group: 'attributes' | 'stats', k: string, v: number | undefined) => setCrit((c) => {
    const cur = { ...((c[group] as Record<string, number> | undefined) ?? {}) };
    if (v === undefined) delete cur[k]; else cur[k] = v;
    const { [group]: _old, ...rest } = c;
    return Object.keys(cur).length ? { ...rest, [group]: cur } : rest;
  });

  /** Filtro: inativo = "+ rótulo"; ativo = "× rótulo valor" (clicar reabre a caixa). */
  const chip = (id: string, label: string, summary: string | null, onOpen: () => void, onRemove: () => void, popover: ReactNode) => (
    <span key={id} className="stm-chipwrap">
      {summary === null
        ? <button type="button" className={`stm-chip-add ${pop === id ? 'on' : ''}`} onClick={onOpen}><Plus size={12} aria-hidden="true" />{label}</button>
        : <span className="stm-chip"><button type="button" className="stm-chip-x" aria-label={`Remover ${label}`} onClick={onRemove}><X size={12} aria-hidden="true" /></button>
          <button type="button" className="stm-chip-body" onClick={onOpen}><b>{label}</b><span>{summary}</span></button></span>}
      {pop === id && popover}
    </span>
  );

  const rangeChip = (k: RangeKey) => {
    const d = RANGES[k], r = crit[k];
    const lo = r?.min === undefined ? d.min : r.min / d.factor, hi = r?.max === undefined ? d.max : r.max / d.factor;
    const summary = !r ? null : r.min !== undefined && r.max !== undefined ? `${show(lo)}–${show(hi)}` : r.min !== undefined ? `${show(lo)}+` : `≤${show(hi)}`;
    const dr: [number, number] = pop === k && draft ? (draft as [number, number]) : [lo, hi];
    return chip(k, d.label, summary && d.unit && d.unit !== 'anos' ? `${summary} ${d.unit}` : summary, () => openPop(k, [lo, hi]), () => setKey(k, undefined),
      <Popover title={`${d.label}${d.unit ? ` (${d.unit})` : ''}`} onCancel={close} onReset={() => setDraft([d.min, d.max])}
        onApply={() => { const [a, b] = dr; const v = { ...(a > d.min ? { min: Math.round(a * d.factor) } : {}), ...(b < d.max ? { max: Math.round(b * d.factor) } : {}) }; setKey(k, Object.keys(v).length ? v : undefined); close(); }}>
        <DualRange min={d.min} max={d.max} step={d.step} lo={dr[0]} hi={dr[1]} onChange={(a, b) => setDraft([a, b])} />
        <p className="muted small">Nas pontas (mínimo {show(d.min)} ou máximo {show(d.max)}), o lado fica sem limite.</p>
      </Popover>);
  };

  const posChip = (k: 'positions' | 'secondary', label: string) => {
    const cur = crit[k] ?? [];
    const dr = pop === k && draft ? (draft as Position[]) : cur;
    const toggle = (p: Position) => setDraft(dr.includes(p) ? dr.filter((x) => x !== p) : [...dr, p]);
    return chip(k, label, cur.length ? cur.map((p) => POS_LABEL[p]).join(', ') : null, () => openPop(k, cur), () => setKey(k, undefined),
      <Popover title={label} wide onCancel={close} onApply={() => { setKey(k, dr.length ? POS_ORDER.filter((p) => dr.includes(p)) : undefined); close(); }}>
        <div className="stm-pop-tools"><button type="button" className="stm-link" onClick={() => setDraft([...POS_ORDER])}>Selecionar todas</button><button type="button" className="stm-link" onClick={() => setDraft([])}>Limpar</button></div>
        <ul className="stm-checks">{POS_ORDER.map((p) => (
          <li key={p}><label><input type="checkbox" checked={dr.includes(p)} onChange={() => toggle(p)} /><PosPill pos={p} /><span>{POS_NAME[p]}</span></label></li>))}</ul>
      </Popover>);
  };

  const minChip = (group: 'attributes' | 'stats', k: string, label: string, max: number, step: number, init: number) => {
    const id = `${group}.${k}`, v = (crit[group] as Record<string, number> | undefined)?.[k];
    const dr = pop === id && draft !== null ? (draft as number) : v ?? init;
    return chip(id, label, v === undefined ? null : `≥ ${show(v)}`, () => openPop(id, v ?? init), () => setIn(group, k, undefined),
      <Popover title={label} onCancel={close} onReset={() => setDraft(init)} onApply={() => { setIn(group, k, dr); close(); }}>
        <MinRange min={group === 'attributes' ? 1 : 0} max={max} step={step} value={dr} onChange={(x) => setDraft(x)} />
      </Popover>);
  };

  const selectChip = <T extends string>(k: 'foot' | 'status', label: string, opts: Record<T, string>, init: T) => {
    const v = crit[k] as T | undefined;
    const dr = pop === k && draft !== null ? (draft as T) : v ?? init;
    return chip(k, label, v === undefined ? null : opts[v], () => openPop(k, v ?? init), () => setKey(k, undefined),
      <Popover title={label} onCancel={close} onApply={() => { setKey(k, dr as never); close(); }}>
        <ul className="stm-checks">{(Object.keys(opts) as T[]).map((o) => (
          <li key={o}><label><input type="radio" name={`stm-${k}`} checked={dr === o} onChange={() => setDraft(o)} /><span>{opts[o]}</span></label></li>))}</ul>
      </Popover>);
  };

  const count = criteriaCount(crit);
  const areaName = scope === 'world' ? 'Mundo' : scope === 'country' ? ov.countries.find((c) => c.code === country)?.name ?? '—' : ov.leagues.find((l) => l.id === league)?.name ?? '—';
  const byCountry = ov.leagues.reduce<Record<string, typeof ov.leagues>>((m, l) => { (m[l.countryName] ??= []).push(l); return m; }, {});
  const days = preview?.reportDays;

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !pop) onClose(); }}>
      <div className="modal stm-modal" role="dialog" aria-modal="true" aria-label="Nova tarefa de busca">
        <header className="modal-head"><h2>Nova tarefa de busca</h2><button className="secondary icon" aria-label="Fechar" onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
        <div className="stm-body">
          <aside className="stm-side">
            <div className="stm-art" aria-hidden="true"><Binoculars size={44} strokeWidth={1.4} /></div>
            <p className="muted small">Defina uma área obrigatória e critérios opcionais. Todo jogador identificado atende a <strong>todos</strong> os filtros; você vê as
              estimativas, que estreitam a cada dia de observação.</p>
            <dl className="stm-summary">
              <div><dt>Escopo</dt><dd>{SCOPE_LABEL[scope]}</dd></div>
              <div><dt>Área de busca</dt><dd>{areaName}</dd></div>
              <div><dt>Jogadores compatíveis <HelpTip text="Faixa aproximada: o olheiro não revela o número exato antes de trabalhar." size={12} /></dt><dd>{preview ? bucketText(preview.compatible) : '…'}</dd></div>
              <div><dt>Previsão por relatório <HelpTip text="Dias de observação para um relatório completo (100%) de cada jogador. Depende da qualidade do olheiro; no mundo todo é mais lento." size={12} /></dt>
                <dd>{!days ? 'sem olheiros' : days.min === days.max ? `${days.min} dias` : `${days.min}–${days.max} dias`}</dd></div>
              <div><dt>Data de início</dt><dd>{preview?.startDate ? fmtDate(preview.startDate) : 'na fila'}</dd></div>
              <div><dt>Data de término</dt><dd>{months === null ? 'contínua' : preview?.endDate ? fmtDate(preview.endDate) : `${months} meses após o início`}</dd></div>
            </dl>
          </aside>

          <div className="stm-main">
            <div className="stm-row2">
              <label>Escopo
                <select value={scope} onChange={(e) => setScope(e.target.value as ScoutScope)}>
                  {(Object.keys(SCOPE_LABEL) as ScoutScope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                </select>
              </label>
              <label>Área de busca
                {scope === 'country' && <select value={country} onChange={(e) => setCountry(e.target.value)}>{ov.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>}
                {scope === 'league' && <select value={league} onChange={(e) => setLeague(e.target.value)}>
                  {Object.entries(byCountry).map(([cn, ls]) => <optgroup key={cn} label={cn}>{ls.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>)}</select>}
                {scope === 'world' && <select disabled value=""><option value="">Todos os países</option></select>}
              </label>
            </div>
            <label>Nome da tarefa<input value={name} maxLength={80} placeholder={preview?.name ?? 'Nome personalizado opcional'} onChange={(e) => setName(e.target.value)} /></label>

            <div className="stm-crit-head">
              <h3>Critérios de jogadores</h3>
              <button type="button" className="secondary" disabled={!count} onClick={() => { setCrit({}); close(); }}><RotateCcw size={13} aria-hidden="true" />Limpar</button>
              <span className="stm-count" title="Filtros preenchidos"><SlidersHorizontal size={13} aria-hidden="true" />{count}</span>
            </div>
            <div className="stm-groups">
              <div className="stm-group"><span className="stm-glabel">Filtros básicos</span><div className="stm-chips">{posChip('positions', 'Posição')}{rangeChip('overall')}{rangeChip('potential')}{rangeChip('age')}</div></div>
              <div className="stm-group"><span className="stm-glabel">Informações do jogador</span><div className="stm-chips">
                {selectChip<ScoutStatus>('status', 'Situação', STATUS_LABEL, 'free')}{rangeChip('value')}{rangeChip('salary')}{rangeChip('reputation')}{rangeChip('condition')}{rangeChip('morale')}
                {selectChip<'left' | 'right' | 'both'>('foot', 'Pé', FOOT_LABEL as Record<'left' | 'right' | 'both', string>, 'left')}{posChip('secondary', 'Joga também de')}</div></div>
              <div className="stm-group"><span className="stm-glabel">Atributos de linha</span><div className="stm-chips">{OUTFIELD.map((k) => minChip('attributes', k, ATTR_LABEL[k] ?? k, 20, 1, 12))}</div></div>
              <div className="stm-group"><span className="stm-glabel">Atributos de goleiro</span><div className="stm-chips">{KEEPER.map((k) => minChip('attributes', k, ATTR_LABEL[k] ?? k, 20, 1, 12))}</div></div>
              <div className="stm-group"><span className="stm-glabel">Estatísticas da temporada</span><div className="stm-chips">
                {(Object.keys(STAT_LABEL) as ScoutStatKey[]).map((k) => minChip('stats', k, STAT_LABEL[k], STATS[k].max, STATS[k].step, STATS[k].init))}</div></div>
            </div>

            <div className="stm-row2">
              <div><span className="stm-flabel">Duração</span>
                <div className="stm-seg" role="group" aria-label="Duração">
                  <button type="button" className={months !== null ? 'on' : ''} aria-pressed={months !== null} onClick={() => setMonths((m) => m ?? 6)}>Com término</button>
                  <button type="button" className={months === null ? 'on' : ''} aria-pressed={months === null} onClick={() => setMonths(null)}>Contínua</button>
                </div>
              </div>
              <label>Encerrar após
                <select disabled={months === null} value={months ?? ''} onChange={(e) => setMonths(Number(e.target.value))}>
                  {months === null && <option value="">—</option>}
                  {TASK_MONTHS.map((m) => <option key={m} value={m}>{m} {m === 1 ? 'mês' : 'meses'}</option>)}
                </select>
                <small className="muted">{months === null ? 'Até você cancelar.' : preview?.endDate ? `Data calculada: ${fmtDate(preview.endDate)}` : 'Conta a partir do início (a tarefa está na fila).'}</small>
              </label>
            </div>
            {(error || preview?.problems.length) ? <p className="error" role="alert">{error ?? preview!.problems[0]}</p> : null}
            {preview?.queued && <p className="muted small">Todos os olheiros estão ocupados{ov.scouts.length ? '' : ' (o clube não tem olheiros)'}: a tarefa entra na fila e começa quando um ficar livre.</p>}
          </div>
        </div>
        <footer className="stm-foot">
          <button className="secondary" onClick={onClose}>Cancelar</button>
          <button disabled={busy || !preview || preview.problems.length > 0} onClick={() => void create()}>Criar tarefa</button>
        </footer>
      </div>
    </div>
  );
}
