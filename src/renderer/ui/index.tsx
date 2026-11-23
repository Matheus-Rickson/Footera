/**
 * Componentes da interface "Estádio noturno" (docs/INTERFACE.md): painéis, indicadores e o cartaz de partida.
 * Só apresentação: os dados vêm das telas (motor via window.api), sem nada inventado (regra 9).
 */
import type { ReactNode } from 'react';
import type { FixtureDto } from '../../shared/api.ts';
import { ClubCrest } from '../flags.tsx';
import { useImages } from '../images.ts';
import { useClubPalette } from '../clubColors.ts';
import { fmtDate, fmtWeekday } from '../util.ts';

/** Painel com faixa de título (traço na cor do clube) e ações à direita. */
export function Panel({ title, icon, actions, className = '', children, labelledBy }: {
  title: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode; labelledBy?: string;
}) {
  return (
    <section className={`card ui-panel ${className}`} aria-labelledby={labelledBy}>
      <header className="ui-panel-head">
        <h2 className="ui-band" id={labelledBy}>{icon}{title}</h2>
        {actions && <div className="ui-panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Indicador numérico grande (rótulo em cima, valor, detalhe embaixo). */
export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'mid' | 'low' }) {
  return (
    <div className="ui-stat">
      <span className="ui-stat-label">{label}</span>
      <span className={`ui-stat-value ${tone ? `ui-tone-${tone}` : ''}`}>{value}</span>
      {sub && <span className="ui-stat-sub">{sub}</span>}
    </div>
  );
}

/** Faixa de 0–100 (verde ≥ 55, âmbar ≥ 35, vermelho abaixo): o número sempre aparece ao lado, a cor não é a única informação. */
export const toneOf = (v: number): 'good' | 'mid' | 'low' => (v >= 55 ? 'good' : v >= 35 ? 'mid' : 'low');
export function Meter({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="ui-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <i className={`ui-tone-bg-${toneOf(v)}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Filtro em segmentos (setor, situação), com a contagem de cada opção quando houver. */
export function SegFilter<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ id: T; label: string; count?: number; title?: string }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="ui-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} title={o.title} className={`ui-seg-btn ${value === o.id ? 'ui-seg-on' : ''}`} onClick={() => onChange(o.id)}>
          {o.label}{o.count !== undefined && <b>{o.count}</b>}
        </button>
      ))}
    </div>
  );
}

/** Forma recente (V/E/D), do jogo mais antigo ao mais recente. */
export function FormStrip({ form }: { form: Array<'V' | 'E' | 'D'> }) {
  const name = { V: 'vitória', E: 'empate', D: 'derrota' } as const;
  if (!form.length) return <span className="muted small">sem jogos</span>;
  return <span className="ui-form" aria-label={`Últimos jogos: ${form.map((f) => name[f]).join(', ')}`}>{form.map((f, i) => <span key={i} className={`badge ${f}`}>{f}</span>)}</span>;
}

/** Cartaz da partida: escudos e nomes nas cores dos dois clubes, competição, fase e mando. */
export function MatchBanner({ fixture, userClubId, kicker, actions }: { fixture: FixtureDto; userClubId: string | null; kicker?: ReactNode; actions?: ReactNode }) {
  const img = useImages();
  const home = useClubPalette(fixture.homeId), away = useClubPalette(fixture.awayId);
  const played = fixture.status === 'played' && fixture.homeGoals != null;
  const where = fixture.cup?.neutral ? 'Campo neutro' : userClubId == null ? null : fixture.homeId === userClubId ? 'Em casa' : fixture.awayId === userClubId ? 'Fora de casa' : null;
  const comp = fixture.cup ? `${fixture.cup.name} · ${fixture.cup.stage}${fixture.cup.leg ? ` · ${fixture.cup.leg === 1 ? 'ida' : 'volta'}` : ''}` : `${fixture.competitionName} · rodada ${fixture.round}`;
  return (
    <section className="ui-match" style={{ ['--mh' as string]: home?.primary, ['--ma' as string]: away?.primary }} aria-label={`${fixture.homeName} x ${fixture.awayName}`}>
      <div className="ui-match-meta">
        <span className="ui-match-kicker">{kicker ?? 'Próximo jogo'}</span>
        <span>{comp}</span>
        <span className="ui-match-date">{fmtWeekday(fixture.date)} · {fmtDate(fixture.date)}{where ? ` · ${where}` : ''}</span>
      </div>
      <div className="ui-match-teams">
        <span className={`ui-match-team ${fixture.homeId === userClubId ? 'ui-match-mine' : ''}`}>
          <ClubCrest id={fixture.homeId} name={fixture.homeName} size={46} src={img.url('clubs', fixture.homeId)} />
          <b>{fixture.homeName}</b>
        </span>
        <span className="ui-match-score">{played ? <>{fixture.homeGoals}<i>–</i>{fixture.awayGoals}</> : <i>x</i>}</span>
        <span className={`ui-match-team ui-match-away ${fixture.awayId === userClubId ? 'ui-match-mine' : ''}`}>
          <b>{fixture.awayName}</b>
          <ClubCrest id={fixture.awayId} name={fixture.awayName} size={46} src={img.url('clubs', fixture.awayId)} />
        </span>
      </div>
      {actions && <div className="ui-match-actions">{actions}</div>}
    </section>
  );
}
