import { Ban, Binoculars, Cross } from 'lucide-react';
import type { MarketPlayerDto, Range } from '../shared/api.ts';
import type { Position } from '../shared/types.ts';
import { fmtDate } from './util.ts';
import { Flag as CountryFlag } from './flags.tsx';
import { POS_LABEL, POS_NAME } from '../shared/positions.ts';
import { range20, to20 } from '../shared/scale.ts';
export { POS_LABEL, POS_NAME, posLabel } from '../shared/positions.ts';
export const FOOT_LABEL: Record<string, string> = { right: 'Destro', left: 'Canhoto', both: 'Ambidestro' };
export const fmtRange = (r: Range) => (r.low === r.high ? `${r.low}` : `${r.low}–${r.high}`);
/** Faixa na escala de exibição 1–20 (ver `shared/scale.ts`); as cores (`tone`) continuam recebendo 0–100. */
export const fmtRange20 = (r: Range) => fmtRange(range20(r));
export { to20 };
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** Miniatura do jogador: a foto do pacote de dados, se houver (`useImages`); senão, as iniciais. `className` dá o tamanho e o formato. */
export function PlayerFace({ img, id, name, className }: { img: { url: (kind: 'players', id: string) => string | null }; id: string; name: string; className: string }) {
  const src = img.url('players', id);
  return src ? <img className={`${className} pf-photo`} src={src} alt="" aria-hidden="true" /> : <span className={className} aria-hidden="true">{initials(name)}</span>;
}
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
  return (
    <span className="flag-wrap" title={name}>
      <CountryFlag code={code} size={15} title={name} />
      <span className="flag-code">{code}</span>
    </span>
  );
}
