import { useCallback, useEffect, useState } from 'react';
import { Award, CheckCircle2, CircleX, GraduationCap, Lock, UserRound } from 'lucide-react';
import type { CoachCareerDto, CoachLicenseDto, CoachSeasonDto } from '../../shared/api.ts';
import type { CoachAttrKey } from '../../shared/coachAttributes.ts';
import { errMsg, fmtDate, unwrap } from '../util.ts';
import { Stars } from '../stars.tsx';
import { ClubCrest } from '../flags.tsx';
import { useImages } from '../images.ts';
import { BarChart, LineChart, VIZ } from '../charts.tsx';
import { HelpButton } from '../helpDialog.tsx';
import { CoachAttributesPanel } from './CoachAttributes.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }
type Tab = 'overview' | 'seasons' | 'licenses' | 'attributes';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Visão geral' }, { id: 'seasons', label: 'Temporadas' }, { id: 'licenses', label: 'Licenças' }, { id: 'attributes', label: 'Atributos' },
];
const END_LABEL: Record<CoachSeasonDto['endReason'], string> = { season: 'Temporada completa', sacked: 'Demitido', left: 'Saiu do clube', current: 'Em andamento' };
const STATUS_LABEL: Record<CoachLicenseDto['status'], string> = { held: 'Obtida', course: 'Em curso', available: 'Disponível', locked: 'Bloqueada' };
const SEASONS_PAGE = 9;

function LicenseCard({ l, busy, onEnroll }: { l: CoachLicenseDto; busy: boolean; onEnroll: () => void }) {
  return (
    <li className={`hc-lic hc-lic-${l.status}`}>
      <div className="hc-lic-top">
        <span className="hc-lic-badge">{l.id}</span>
        <div className="hc-lic-name"><strong>{l.name}</strong><span className="muted small">exigida por: {l.requiredBy}</span></div>
        <span className="hc-lic-st">{l.status === 'held' ? <CheckCircle2 size={14} aria-hidden="true" /> : l.status === 'locked' ? <Lock size={14} aria-hidden="true" /> : null}{STATUS_LABEL[l.status]}</span>
      </div>
      <dl className="hc-lic-facts">
        <div><dt>Curso</dt><dd>{l.courseDays} dias</dd></div>
        <div><dt>Bônus</dt><dd>+{l.reputationBonus} reputação</dd></div>
        <div><dt>Teto</dt><dd>{l.reputationCap}</dd></div>
      </dl>
      <p className="muted small hc-lic-req">Pré-requisito: {l.requirement}</p>
      {l.status === 'held' && <p className="small">{l.obtained ? (l.initial ? `Com você desde o início da carreira (${fmtDate(l.obtained)}).` : `Concluída em ${fmtDate(l.obtained)}.`) : 'Obtida.'}</p>}
      {l.course && (
        <div className="hc-lic-prog">
          <div className="hc-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(l.course.progress * 100)} aria-label={`Andamento do curso da ${l.name}`}><i style={{ width: `${Math.round(l.course.progress * 100)}%` }} /></div>
          <span className="small">{Math.round(l.course.progress * 100)}% · termina em {fmtDate(l.course.end)}{l.course.waived ? ' · carência' : ''}</span>
        </div>
      )}
      {l.status === 'available' && <button disabled={busy} onClick={onEnroll}><GraduationCap size={15} aria-hidden="true" /> Matricular</button>}
      {l.status === 'locked' && l.blocked && <p className="small hc-lic-blocked">{l.blocked}</p>}
    </li>
  );
}

export function CoachCareerView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [data, setData] = useState<CoachCareerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [page, setPage] = useState(0);
  const img = useImages();
  const load = useCallback(async () => { setData(await unwrap(window.api.getCoachCareer(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  async function run(fn: () => Promise<string | null>) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); await load(); await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando histórico…</p>;
  const c = data.coach, t = data.totals;
  const chrono = [...data.seasons].reverse();
  const pages = Math.max(1, Math.ceil(data.seasons.length / SEASONS_PAGE));
  const p = Math.min(page, pages - 1);
  const course = data.licenses.find((l) => l.course);

  return (
    <div className="hc">
      <section className="card hc-top">
        <span className="hc-avatar" aria-hidden="true"><UserRound size={30} /></span>
        <div className="hc-top-name">
          <h2>{c.name}</h2>
          <div className="hc-chips">
            <Stars reputation={c.reputation} size={15} label="Reputação do treinador" />
            <span className="hc-chip"><GraduationCap size={13} aria-hidden="true" /> {c.licenseName}</span>
            <span className="muted small">{c.nationality} · {c.age} anos · {c.clubName ? c.clubName : 'sem clube'}</span>
          </div>
          {c.requiredHere && !c.compliant && <p className="small hc-warn">O clube exige a licença {c.requiredHere}: matricule-se quando cumprir os pré-requisitos (aba Licenças).</p>}
        </div>
        <div className="hc-kpis">
          <div className="hc-kpi"><span className="hc-kpi-val">{t.played}</span><span className="hc-kpi-lbl">jogos</span></div>
          <div className="hc-kpi"><span className="hc-kpi-val">{String(t.pointsPct).replace('.', ',')}%</span><span className="hc-kpi-lbl">aproveitamento</span></div>
          <div className="hc-kpi"><span className="hc-kpi-val">{t.titles}</span><span className="hc-kpi-lbl">títulos</span></div>
          <div className="hc-kpi"><span className="hc-kpi-val">{t.clubs}</span><span className="hc-kpi-lbl">clubes</span></div>
          <div className="hc-kpi"><span className="hc-kpi-val">{c.reputation}<small>/{c.reputationCap}</small></span><span className="hc-kpi-lbl">reputação / teto</span></div>
        </div>
        <HelpButton title="Histórico da carreira">
          <p>Cada linha é uma temporada (ou parte dela) no comando de um clube. Jogos, vitórias e gols são contados das partidas disputadas no período,
            em todas as competições.</p>
          <p>A <strong>reputação</strong> (1–100, mostrada em estrelas) sobe e desce com a avaliação da diretoria, títulos e demissões, mas nunca passa do
            <strong> teto da sua licença</strong>. Concluir um curso dá um bônus de reputação e libera um teto maior.</p>
          <p>Os <strong>pontos de atributo</strong> ganhos nas avaliações de temporada são distribuídos na aba Atributos.</p>
        </HelpButton>
      </section>

      <div className="pf-tabs hc-tabs" role="tablist" aria-label="Seções do histórico da carreira">
        {TABS.map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={`pf-tab ${tab === x.id ? 'on' : ''}`} onClick={() => setTab(x.id)}>{x.label}{x.id === 'attributes' && data.points > 0 ? ` (${data.points})` : ''}</button>)}
      </div>
      {notice && <p className="notice small" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {tab === 'overview' && (
        <div className="hc-charts">
          <section className="card hc-chart">
            <div className="hc-head"><h2>Reputação por temporada</h2><span className="muted small">faixa = acima do teto atual ({c.reputationCap})</span></div>
            {chrono.some((s) => s.reputationEnd != null) ? (
              <div className="hc-plot"><LineChart ariaLabel="Reputação do treinador ao fim de cada temporada" format={(v) => String(Math.round(v))} domain={[0, 100]}
                band={c.reputationCap < 100 ? { from: c.reputationCap, to: 100, label: `acima do teto da ${c.licenseName}` } : undefined}
                points={chrono.map((s) => ({ label: s.label, value: s.reputationEnd, detail: <>{s.clubName}{s.reputationStart != null && s.reputationEnd != null ? ` · ${s.reputationEnd - s.reputationStart >= 0 ? '+' : ''}${s.reputationEnd - s.reputationStart}` : ''}</> }))} /></div>
            ) : <p className="muted small">A reputação de cada temporada aparece a partir da primeira avaliação da diretoria.</p>}
          </section>
          <section className="card hc-chart">
            <div className="hc-head"><h2>Posição final na liga</h2><span className="muted small">1º no alto</span></div>
            {chrono.some((s) => s.position != null) ? (
              <div className="hc-plot"><LineChart ariaLabel="Posição final na liga por temporada" invert format={(v) => `${Math.round(v)}º`} color={VIZ[1]}
                points={chrono.map((s) => ({ label: s.label, value: s.position, detail: <>{s.clubName}{s.competition ? ` · ${s.competition}` : ''}</> }))} /></div>
            ) : <p className="muted small">As posições aparecem quando as temporadas terminarem.</p>}
          </section>
          <section className="card hc-chart hc-chart-wide">
            <div className="hc-head"><h2>Vitórias, empates e derrotas</h2>
              <span className="muted small">{t.won}V {t.drawn}E {t.lost}D · gols {t.goalsFor}:{t.goalsAgainst}</span></div>
            {chrono.some((s) => s.played > 0) ? (
              <div className="hc-plot"><BarChart ariaLabel="Vitórias, empates e derrotas por temporada" format={(v) => String(Math.round(v))}
                labels={chrono.map((s) => s.label)} series={[{ name: 'Vitórias', color: VIZ[0]! }, { name: 'Empates', color: VIZ[2]! }, { name: 'Derrotas', color: VIZ[3]! }]}
                values={chrono.map((s) => [s.won, s.drawn, s.lost])} detail={(g) => <>{chrono[g]!.clubName} · {chrono[g]!.played} jogos</>} /></div>
            ) : <p className="muted small">Nenhum jogo disputado ainda.</p>}
            <div className="hc-legend small"><span><i style={{ background: VIZ[0] }} />Vitórias</span><span><i style={{ background: VIZ[2] }} />Empates</span><span><i style={{ background: VIZ[3] }} />Derrotas</span></div>
          </section>
        </div>
      )}

      {tab === 'seasons' && (
        <section className="card hc-seasons">
          {data.seasons.length === 0 ? <p className="muted">Nenhuma temporada registrada.</p> : (
            <table className="hc-table">
              <thead><tr><th>Temporada</th><th>Clube</th><th>Competição</th><th>Pos.</th><th>J</th><th>V</th><th>E</th><th>D</th><th>Gols</th><th>Objetivo</th><th>Títulos</th><th className="right">Reputação</th></tr></thead>
              <tbody>{data.seasons.slice(p * SEASONS_PAGE, (p + 1) * SEASONS_PAGE).map((s) => (
                <tr key={`${s.clubId}-${s.season}`} className={s.endReason === 'current' ? 'mine' : ''}>
                  <td>{s.label}<span className="muted small hc-end"> {END_LABEL[s.endReason]}</span></td>
                  <td><span className="hc-club"><ClubCrest id={s.clubId} name={s.clubName} size={20} src={img.url('clubs', s.clubId)} />{s.clubName}</span></td>
                  <td className="muted">{s.competition ?? '—'}</td>
                  <td>{s.position != null ? `${s.position}º` : '—'}</td>
                  <td>{s.played}</td><td>{s.won}</td><td>{s.drawn}</td><td>{s.lost}</td><td>{s.goalsFor}:{s.goalsAgainst}</td>
                  <td>{s.met == null ? <span className="muted">{s.objective ?? '—'}</span> : <span className={s.met ? 'pos' : 'neg'}>{s.met ? <CheckCircle2 size={13} aria-hidden="true" /> : <CircleX size={13} aria-hidden="true" />} {s.objective ?? (s.met ? 'Cumprido' : 'Não cumprido')}</span>}</td>
                  <td>{s.titles > 0 ? <span className="hc-titles"><Award size={13} aria-hidden="true" />{s.titles}</span> : '—'}</td>
                  <td className="right">{s.reputationEnd == null ? '—' : <>{s.reputationEnd}{s.reputationStart != null && <span className={`small ${s.reputationEnd >= s.reputationStart ? 'pos' : 'neg'}`}> ({s.reputationEnd - s.reputationStart >= 0 ? '+' : ''}{s.reputationEnd - s.reputationStart})</span>}</>}</td>
                </tr>))}</tbody>
            </table>
          )}
          {pages > 1 && (
            <div className="row hc-pager">
              <button className="secondary" disabled={p === 0} onClick={() => setPage(p - 1)}>Anterior</button>
              <span className="muted small">Página {p + 1} de {pages} · {data.seasons.length} temporada(s)</span>
              <button className="secondary" disabled={p + 1 >= pages} onClick={() => setPage(p + 1)}>Próxima</button>
            </div>
          )}
        </section>
      )}

      {tab === 'licenses' && (
        <section className="card hc-licenses">
          <div className="hc-head"><h2><GraduationCap size={16} aria-hidden="true" /> Formação de treinadores</h2>
            <span className="muted small">{data.careerDays} dias de carreira · {data.employedSeasons} temporada(s) completa(s){course ? ` · em curso: ${course.name}` : ''}</span>
            <HelpButton title="Licenças de treinador">
              <p>As licenças seguem a formação real de treinadores (C → B → A → PRO). Cada curso exige a licença anterior e experiência, dura um tempo e
                não tem custo. Um curso por vez.</p>
              <p><strong>Exigência dos clubes:</strong> 1ª divisão pede a PRO, 2ª divisão a A, as demais a B e clubes só de estadual a C. Clubes que exigem
                uma licença que você não tem não fazem propostas, a não ser que você esteja matriculado no curso dela (carência).</p>
              <p><strong>Reputação:</strong> concluir um curso dá um bônus e libera um teto maior (sem licença 35, C 45, B 60, A 80, PRO 100). Se o seu clube
                subir para uma divisão mais exigente, a diretoria avisa, mas não demite.</p>
              <p>Valores aproximados dos cursos da CBF Academy e da UEFA.</p>
            </HelpButton>
          </div>
          <ol className="hc-track">{data.licenses.map((l) => <LicenseCard key={l.id} l={l} busy={busy}
            onEnroll={() => void run(async () => (await unwrap(window.api.enrollLicense(profileId, careerId, l.id))).message)} />)}</ol>
        </section>
      )}

      {tab === 'attributes' && (
        <section className="card hc-attrs">
          <div className="hc-head"><h2>Atributos do treinador</h2><span className="muted small">pontos ganhos nas avaliações de temporada</span></div>
          <CoachAttributesPanel attributes={data.attributes} points={data.points} busy={busy}
            onSpend={(key: CoachAttrKey) => void run(async () => { await unwrap(window.api.spendCoachPoint(profileId, careerId, key)); return null; })} />
        </section>
      )}
    </div>
  );
}
