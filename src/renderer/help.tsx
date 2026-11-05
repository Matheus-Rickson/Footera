import { useLayoutEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';

/**
 * Ícone de interrogação: a explicação aparece ao passar o mouse ou ao focar com o teclado (Tab), sem ocupar a tela.
 * O balão é posicionado pela janela (position: fixed), então não é cortado por áreas com rolagem, mas fica DENTRO do quadro
 * (cartão/janela) em que o ícone está: alinha-se às bordas dele, abre embaixo ou em cima conforme o espaço e encolhe se o
 * quadro for estreito.
 */
export function HelpTip({ text, size = 14 }: { text: string; up?: boolean; size?: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxWidth: number } | null>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open || !icon.current) { setPos(null); return; }
    const r = icon.current.getBoundingClientRect(), m = 8;
    // limites: o quadro (cartão, janela modal) que contém o ícone, dentro da janela do jogo
    const box = icon.current.closest('.card, .modal, .nc-footer')?.getBoundingClientRect();
    const b = { left: Math.max(m, box?.left ?? 0), right: Math.min(window.innerWidth - m, box?.right ?? window.innerWidth), top: Math.max(m, box?.top ?? 0), bottom: Math.min(window.innerHeight - m, box?.bottom ?? window.innerHeight) };
    const maxWidth = Math.max(160, Math.min(300, b.right - b.left - 2 * m));
    const w = Math.min(pop.current?.offsetWidth ?? 300, maxWidth), h = pop.current?.offsetHeight ?? 80;
    const roomBelow = b.bottom - r.bottom, roomAbove = r.top - b.top;
    const top = roomBelow >= h + m || roomBelow >= roomAbove ? r.bottom + m : r.top - m - h;
    setPos({
      top: Math.max(m, Math.min(top, window.innerHeight - h - m)),
      left: Math.min(Math.max(b.left + m, r.left + r.width / 2 - w / 2), b.right - w - m),
      maxWidth,
    });
  }, [open, text]);
  if (!text) return null;
  return (
    <span ref={icon} className="nc-help" tabIndex={0} aria-label={`Ajuda: ${text}`}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <CircleHelp size={size} aria-hidden="true" />
      {open && <span ref={pop} className="nc-help-pop nc-help-float" role="tooltip" style={pos ? { top: pos.top, left: pos.left, maxWidth: pos.maxWidth } : { visibility: 'hidden' }}>{text}</span>}
    </span>
  );
}
