import { ClubCrest } from '../flags.tsx';
import { fmtDate } from '../util.ts';
import type { useImages } from '../images.ts';

type Club = { id: string; name: string };
export interface TieView {
  key: string; a: Club; b: Club | null; mine: boolean; winner: string | null;
  games: Array<{ fixtureId: string; date: string; homeId: string; homeGoals: number | null; awayGoals: number | null; hasReport: boolean }>;
  /** observações abaixo do placar: agregado, prorrogação, pênaltis, campo neutro */ notes: string[];
}

/**
 * Confrontos de mata-mata (copas nacionais, continentais, estaduais): clube A | jogos (data e placar do ponto de vista de A) | clube B,
 * com o vencedor em negrito e as observações embaixo. Muitos confrontos (fases iniciais da Copa do Brasil): duas colunas.
 */
export function TieList({ ties, img, onClub, onOpenMatch }: { ties: TieView[]; img: ReturnType<typeof useImages>; onClub: (id: string) => void; onOpenMatch?: (fixtureId: string) => void }) {
  const club = (c: Club) => (
    <button className="cp-club cp-club-btn" title="Ver a ficha do clube" onClick={() => onClub(c.id)}><ClubCrest id={c.id} name={c.name} size={16} src={img.url('clubs', c.id)} />{c.name}</button>
  );
  return (
    <ul className={`sv-ties ${ties.length > 8 ? 'tl-two' : ''}`}>
      {ties.map((t) => (
        <li key={t.key} className={`sv-tie ${t.mine ? 'mine' : ''}`}>
          <span className={`sv-side ${t.b && t.winner === t.a.id ? 'sv-win' : ''}`}>{club(t.a)}</span>
          {t.b ? (
            <span className="sv-score">
              {t.games.map((g) => {
                const aHome = g.homeId === t.a.id;
                const sa = aHome ? g.homeGoals : g.awayGoals, sb = aHome ? g.awayGoals : g.homeGoals;
                const score = sa == null ? 'x' : `${sa} x ${sb}`;
                const body = <><em className="tl-date">{fmtDate(g.date).slice(0, 5)}</em><span className={sa == null ? 'muted' : ''}>{score}</span></>;
                return g.hasReport && onOpenMatch
                  ? <button key={g.fixtureId} className="cp-club-btn sv-game tl-game" title="Ver o relatório" onClick={() => onOpenMatch(g.fixtureId)}>{body}</button>
                  : <span key={g.fixtureId} className="sv-game tl-game">{body}</span>;
              })}
              {t.notes.length > 0 && <em className="muted small tl-notes">{t.notes.join(' · ')}</em>}
            </span>
          ) : <span className="muted small tl-notes">folga (avança direto)</span>}
          {t.b ? <span className={`sv-side sv-side-b ${t.winner === t.b.id ? 'sv-win' : ''}`}>{club(t.b)}</span> : <span />}
        </li>
      ))}
    </ul>
  );
}
