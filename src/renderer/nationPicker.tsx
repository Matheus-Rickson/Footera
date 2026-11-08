/**
 * Escolha da nacionalidade com a bandeira em cada opção (o <select> nativo não mostra imagens).
 * A lista abre num portal com posição fixa, para não ser cortada por painéis com rolagem; tem busca e teclado
 * (setas, Enter, Esc). Fecha ao clicar fora, rolar a página ou redimensionar a janela.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { Flag } from './flags.tsx';

type Opt = { code: string; name: string };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function NationPicker({ value, options, onChange }: { value: string; options: Opt[]; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.code === value);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return f ? options.filter((o) => fold(o.name).includes(f) || o.code.toLowerCase().startsWith(f)) : options;
  }, [options, q]);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const up = window.innerHeight - r.bottom < 300 && r.top > window.innerHeight - r.bottom;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 260), up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    setQ(''); setActive(Math.max(0, options.findIndex((o) => o.code === value)));
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    const close = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away); window.addEventListener('resize', close); document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [open]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, shown]);

  const pick = (code: string) => { onChange(code); setOpen(false); btn.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = shown[active]; if (o) pick(o.code); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
  };

  return (
    <>
      <button ref={btn} type="button" className="np-btn" aria-haspopup="listbox" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }} onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); setOpen(true); } }}>
        {current ? <><Flag code={current.code} size={14} title={current.name} /><span className="np-name">{current.name}</span></> : <span className="np-name muted">{value || 'Escolha…'}</span>}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div ref={pop} className="np-pop" style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
          <div className="np-search"><Search size={14} aria-hidden="true" />
            <input autoFocus placeholder="Buscar país ou código…" value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} aria-label="Buscar nacionalidade" /></div>
          <ul ref={list} className="np-list" role="listbox" aria-label="Nacionalidades">
            {shown.map((o, i) => (
              <li key={o.code} data-i={i} role="option" aria-selected={o.code === value} className={`np-opt${i === active ? ' on' : ''}${o.code === value ? ' sel' : ''}`}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.code)}>
                <Flag code={o.code} size={13} title={o.name} /><span className="np-name">{o.name}</span><span className="np-code">{o.code}</span>
              </li>
            ))}
            {shown.length === 0 && <li className="np-none muted">Nenhum país encontrado.</li>}
          </ul>
        </div>, document.body)}
    </>
  );
}
