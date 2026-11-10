/**
 * Caixa de diálogo de ajuda (v0.8.10): botão "?" que abre um modal com a explicação de um bloco da tela (Finanças, Diretoria,
 * Histórico). Para dicas de uma linha continua o `HelpTip` (help.tsx). Fecha com Esc, clique fora ou no X.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { CircleHelp, X } from 'lucide-react';

export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'hd-wide' : 'hd-modal'}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head"><h2>{title}</h2><button className="secondary icon" aria-label="Fechar" autoFocus onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
        <div className="modal-body hd-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Botão "?" que abre a explicação. */
export function HelpButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="hd-btn" aria-label={`Ajuda: ${title}`} title="O que é isto?" onClick={() => setOpen(true)}><CircleHelp size={15} aria-hidden="true" /></button>
      {open && <Dialog title={title} onClose={() => setOpen(false)}>{children}</Dialog>}
    </>
  );
}
