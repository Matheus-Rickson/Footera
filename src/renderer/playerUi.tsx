import { Ban, Binoculars, Cross } from 'lucide-react';
import type { MarketPlayerDto, Range } from '../shared/api.ts';
import type { Position } from '../shared/types.ts';
import { fmtDate } from './util.ts';
import { POS_LABEL, POS_NAME } from '../shared/positions.ts';
export { POS_LABEL, POS_NAME, posLabel } from '../shared/positions.ts';
export const FOOT_LABEL: Record<string, string> = { right: 'Destro', left: 'Canhoto', both: 'Ambidestro' };
export const fmtRange = (r: Range) => (r.low === r.high ? `${r.low}` : `${r.low}–${r.high}`);
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
/** Faixa de cor por nível (escala 0–100). */
export const tone = (v: number) => (v >= 75 ? 'great' : v >= 60 ? 'good' : v >= 45 ? 'avg' : 'poor');

/** Sigla da posição com o nome completo no tooltip. */
export function PosPill({ pos, minor = false }: { pos: Position; minor?: boolean }) {
  return <span className={minor ? 'pf-pos tr-pos-minor' : 'pf-pos'} title={POS_NAME[pos]}>{POS_LABEL[pos]}</span>;
}

/** Sinalizações ao lado do nome: lista de observação, lesão, suspensão e cartões da temporada. Nada aparece se não houver o que sinalizar. */
export function PlayerFlags({ p }: { p: Pick<MarketPlayerDto, 'shortlisted' | 'status'> }) {
  const s = p.status;
  if (!p.shortlisted && !s.injuredUntil && !s.suspension && !s.yellows && !s.reds) return null;
  return (
    <span className="tr-flags">
      {p.shortlisted && <span className="tr-flag tr-flag-watch" title="Na lista de observação dos olheiros" aria-label="Observado"><Binoculars size={13} aria-hidden="true" /></span>}
      {s.injuredUntil && <span className="tr-flag tr-flag-injury" title={`Lesionado até ${fmtDate(s.injuredUntil)}`} aria-label="Lesionado"><Cross size={12} aria-hidden="true" /></span>}
      {s.suspension > 0 && <span className="tr-flag tr-flag-susp" title={`Suspenso por ${s.suspension} jogo(s)`} aria-label="Suspenso"><Ban size={12} aria-hidden="true" /></span>}
      {s.yellows > 0 && <span className="tr-card tr-card-y" title={`${s.yellows} cartão(ões) amarelo(s) na temporada`}>{s.yellows}</span>}
      {s.reds > 0 && <span className="tr-card tr-card-r" title={`${s.reds} cartão(ões) vermelho(s) na temporada`}>{s.reds}</span>}
    </span>
  );
}

/**
 * Bandeira desenhada em SVG (sem imagens externas). O universo atual tem Brasil e Inglaterra;
 * qualquer outro código aparece como selo neutro com a sigla, nunca com uma bandeira inventada.
 */
export function Flag({ code, name }: { code: string; name: string }) {
  const art = code === 'BRA' ? (
    <><rect width="30" height="20" fill="#009c3b" /><polygon points="15,2.5 27.5,10 15,17.5 2.5,10" fill="#ffdf00" /><circle cx="15" cy="10" r="4.6" fill="#002776" /><path d="M10.6 9.2 q4.4 -1.6 8.8 1.4" stroke="#fff" strokeWidth=".9" fill="none" /></>
  ) : code === 'ENG' ? (
    <><rect width="30" height="20" fill="#fff" /><rect x="12.5" width="5" height="20" fill="#ce1124" /><rect y="7.5" width="30" height="5" fill="#ce1124" /></>
  ) : null;
  return (
    <span className="flag-wrap" title={name}>
      {art ? <svg viewBox="0 0 30 20" className="flag-svg" role="img" aria-label={name}>{art}</svg> : <span className="flag-svg flag-none" aria-hidden="true" />}
      <span className="flag-code">{code}</span>
    </span>
  );
}
