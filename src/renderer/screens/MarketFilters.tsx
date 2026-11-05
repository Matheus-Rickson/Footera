import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { MarketFilter, MarketPageDto } from '../../shared/api.ts';
import type { Position } from '../../shared/types.ts';
import { POS_NAME, posLabel } from '../playerUi.tsx';

/** Filtros do mercado como a tela os edita (campos de texto ficam como texto até virar busca). */
export interface Filters {
  name: string; positions: Position[]; naturalOnly: boolean; nationalities: string[]; minAge: string; maxAge: string; foot: '' | 'right' | 'left' | 'both';
  maxValue: string; maxWage: string; contract: '' | 'season' | 'next'; status: 'all' | 'club' | 'free'; shortlistedOnly: boolean; knownOnly: boolean;
}
export const EMPTY_FILTERS: Filters = {
  name: '', positions: [], naturalOnly: false, nationalities: [], minAge: '', maxAge: '', foot: '', maxValue: '', maxWage: '', contract: '', status: 'all', shortlistedOnly: false, knownOnly: false,
};

export function toMarketFilter(f: Filters): MarketFilter {
  const m: MarketFilter = {};
  const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Math.round(Number(s)) : undefined);
  if (f.name.trim()) m.name = f.name.trim();
  if (f.positions.length) { m.positions = f.positions; if (f.naturalOnly) m.naturalOnly = true; }
  if (f.nationalities.length) m.nationalities = f.nationalities;
  const minAge = num(f.minAge), maxAge = num(f.maxAge), maxValue = num(f.maxValue), maxWage = num(f.maxWage);
  if (minAge !== undefined && minAge >= 14 && minAge <= 50) m.minAge = minAge;
  if (maxAge !== undefined && maxAge >= 14 && maxAge <= 50) m.maxAge = maxAge;
  if (maxValue !== undefined && maxValue >= 0) m.maxValue = maxValue;
  if (maxWage !== undefined && maxWage >= 0) m.maxWage = maxWage;
  if (f.foot) m.foot = f.foot;
  if (f.contract) m.contractEndsBy = f.contract;
  if (f.status === 'free') m.freeOnly = true;
  if (f.status === 'club') m.clubOnly = true;
  if (f.shortlistedOnly) m.shortlistedOnly = true;
  if (f.knownOnly) m.knownOnly = true;
  return m;
}

const POSITION_GROUPS: Array<[string, Position[]]> = [
  ['Goleiro', ['GK']], ['Defesa', ['CB', 'LB', 'RB', 'LWB', 'RWB']], ['Meio-campo', ['DM', 'CM', 'LM', 'RM', 'AM']], ['Ataque', ['LW', 'RW', 'SS', 'CF', 'ST']],
];
const FOOT_OPTS: Array<[Filters['foot'], string]> = [['', 'Qualquer'], ['right', 'Destro'], ['left', 'Canhoto'], ['both', 'Ambidestro']];
const CONTRACT_OPTS: Array<[Filters['contract'], string]> = [['', 'Qualquer'], ['season', 'Termina nesta temporada'], ['next', 'Termina até a próxima']];
const STATUS_OPTS: Array<[Filters['status'], string]> = [['all', 'Todos'], ['club', 'Com clube'], ['free', 'Sem clube']];
const money = (s: string) => Number(s).toLocaleString('pt-BR');

/** Botão de categoria que abre um painel; fecha ao clicar fora ou com Esc. */
function FilterMenu({ label, count, children, wide }: { label: string; count: number; children: ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  /** painel alinhado pela direita do botão quando não cabe à direita da janela (menus do fim da barra) */
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) { setFlip(false); return; }
    const btn = ref.current?.getBoundingClientRect(), w = panel.current?.offsetWidth ?? 0;
    if (btn) setFlip(btn.left + w > window.innerWidth - 12);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="mf-menu" ref={ref}>
      <button className={`mf-trigger ${count ? 'on' : ''} ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}{count > 0 && <b>{count}</b>}<ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && <div ref={panel} className={`mf-panel ${wide ? 'mf-wide' : ''} ${flip ? 'mf-flip' : ''}`} role="dialog" aria-label={`Filtros: ${label}`}>{children}</div>}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="mf-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => <button key={v || 'any'} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

/** Barra de filtros do mercado: busca por nome + 4 categorias (Posição, Perfil, Contrato e valor, Olheiros) + etiquetas do que está ativo. */
export function MarketFilters({ filters, set, nationalities }: { filters: Filters; set: (patch: Partial<Filters>) => void; nationalities: MarketPageDto['nationalities'] }) {
  const [natQuery, setNatQuery] = useState('');
  const f = filters;
  const togglePos = (p: Position) => set({ positions: f.positions.includes(p) ? f.positions.filter((x) => x !== p) : [...f.positions, p] });
  const toggleGroup = (ps: Position[]) => {
    const all = ps.every((p) => f.positions.includes(p));
    set({ positions: all ? f.positions.filter((x) => !ps.includes(x)) : [...new Set([...f.positions, ...ps])] });
  };
  const toggleNat = (c: string) => set({ nationalities: f.nationalities.includes(c) ? f.nationalities.filter((x) => x !== c) : [...f.nationalities, c] });
  const natName = (c: string) => nationalities.find((n) => n.code === c)?.name ?? c;
  const natShown = nationalities.filter((n) => n.name.toLowerCase().includes(natQuery.trim().toLowerCase()));

  const profileCount = (f.nationalities.length ? 1 : 0) + (f.minAge || f.maxAge ? 1 : 0) + (f.foot ? 1 : 0);
  const contractCount = (f.maxValue ? 1 : 0) + (f.maxWage ? 1 : 0) + (f.contract ? 1 : 0) + (f.status !== 'all' ? 1 : 0);
  const scoutCount = (f.shortlistedOnly ? 1 : 0) + (f.knownOnly ? 1 : 0);

  // etiquetas do que está ativo (cada uma remove o próprio filtro)
  const chips: Array<[string, () => void]> = [];
  if (f.positions.length) chips.push([`Posição: ${f.positions.map(posLabel).join(', ')}${f.naturalOnly ? ' (só natural)' : ''}`, () => set({ positions: [], naturalOnly: false })]);
  if (f.nationalities.length) chips.push([`Nacionalidade: ${f.nationalities.map(natName).join(', ')}`, () => set({ nationalities: [] })]);
  if (f.minAge || f.maxAge) chips.push([`Idade: ${f.minAge || '…'}–${f.maxAge || '…'}`, () => set({ minAge: '', maxAge: '' })]);
  if (f.foot) chips.push([`Pé: ${FOOT_OPTS.find(([v]) => v === f.foot)![1]}`, () => set({ foot: '' })]);
  if (f.maxValue) chips.push([`Valor até ${money(f.maxValue)}`, () => set({ maxValue: '' })]);
  if (f.maxWage) chips.push([`Salário até ${money(f.maxWage)}`, () => set({ maxWage: '' })]);
  if (f.contract) chips.push([`Contrato: ${CONTRACT_OPTS.find(([v]) => v === f.contract)![1].toLowerCase()}`, () => set({ contract: '' })]);
  if (f.status !== 'all') chips.push([STATUS_OPTS.find(([v]) => v === f.status)![1], () => set({ status: 'all' })]);
  if (f.shortlistedOnly) chips.push(['Só observados', () => set({ shortlistedOnly: false })]);
  if (f.knownOnly) chips.push(['Só bem observados', () => set({ knownOnly: false })]);

  return (
    <div className="mf">
      <div className="mf-bar">
        <label className="tr-search"><Search size={15} aria-hidden="true" />
          <input placeholder="Buscar jogador pelo nome…" aria-label="Buscar jogador pelo nome" value={f.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
        </label>

        <FilterMenu label="Posição" count={f.positions.length} wide>
          {POSITION_GROUPS.map(([g, ps]) => (
            <div key={g} className="mf-posrow">
              <button className={`mf-group ${ps.every((p) => f.positions.includes(p)) ? 'on' : ''}`} onClick={() => toggleGroup(ps)}>{g}</button>
              <div className="mf-pills">{ps.map((p) => (
                <button key={p} className={`mf-pill ${f.positions.includes(p) ? 'on' : ''}`} aria-pressed={f.positions.includes(p)} title={POS_NAME[p]} onClick={() => togglePos(p)}>{posLabel(p)}</button>
              ))}</div>
            </div>
          ))}
          <label className="mf-check"><input type="checkbox" checked={!f.naturalOnly} onChange={(e) => set({ naturalOnly: !e.target.checked })} />Incluir quem joga ali como posição secundária</label>
          <p className="muted small mf-tip">Com várias posições, aparece quem joga em qualquer uma delas.</p>
        </FilterMenu>

        <FilterMenu label="Perfil" count={profileCount}>
          <div className="mf-field"><span>Idade</span>
            <div className="mf-range">
              <input type="number" min={14} max={50} placeholder="de" aria-label="Idade mínima" value={f.minAge} onChange={(e) => set({ minAge: e.target.value })} />
              <input type="number" min={14} max={50} placeholder="até" aria-label="Idade máxima" value={f.maxAge} onChange={(e) => set({ maxAge: e.target.value })} />
            </div>
          </div>
          <div className="mf-field"><span>Pé preferido</span><Segmented label="Pé preferido" value={f.foot} options={FOOT_OPTS} onChange={(v) => set({ foot: v })} /></div>
          <div className="mf-field"><span>Nacionalidade</span>
            {nationalities.length > 6 && <input className="mf-natq" placeholder="Filtrar países…" aria-label="Filtrar países" value={natQuery} onChange={(e) => setNatQuery(e.target.value)} />}
            <div className="mf-natlist">
              {natShown.map((n) => (
                <label key={n.code} className="mf-check"><input type="checkbox" checked={f.nationalities.includes(n.code)} onChange={() => toggleNat(n.code)} />{n.name}<span className="muted small">{n.count}</span></label>
              ))}
              {natShown.length === 0 && <span className="muted small">Nenhum país.</span>}
            </div>
          </div>
        </FilterMenu>

        <FilterMenu label="Contrato e valor" count={contractCount}>
          <div className="mf-field"><span>Situação</span><Segmented label="Situação" value={f.status} options={STATUS_OPTS} onChange={(v) => set({ status: v })} /></div>
          <div className="mf-field"><span>Valor de mercado até</span>
            <input type="number" min={0} step={100000} placeholder="sem limite" aria-label="Valor de mercado máximo" value={f.maxValue} onChange={(e) => set({ maxValue: e.target.value })} /></div>
          <div className="mf-field"><span>Salário mensal até</span>
            <input type="number" min={0} step={1000} placeholder="sem limite" aria-label="Salário máximo" value={f.maxWage} onChange={(e) => set({ maxWage: e.target.value })} /></div>
          <div className="mf-field"><span>Fim do contrato</span><Segmented label="Fim do contrato" value={f.contract} options={CONTRACT_OPTS} onChange={(v) => set({ contract: v })} /></div>
        </FilterMenu>

        <FilterMenu label="Olheiros" count={scoutCount}>
          <label className="mf-check"><input type="checkbox" checked={f.shortlistedOnly} onChange={(e) => set({ shortlistedOnly: e.target.checked })} />Só jogadores observados</label>
          <label className="mf-check"><input type="checkbox" checked={f.knownOnly} onChange={(e) => set({ knownOnly: e.target.checked })} />Só bem observados (50% de conhecimento ou mais)</label>
        </FilterMenu>
      </div>
      {chips.length > 0 && (
        <div className="mf-chips">
          {chips.map(([label, clear]) => <button key={label} className="mf-chip" title="Remover filtro" onClick={clear}>{label}<X size={12} aria-hidden="true" /></button>)}
          <button className="link" onClick={() => set(EMPTY_FILTERS)}>Limpar tudo</button>
        </div>
      )}
    </div>
  );
}
