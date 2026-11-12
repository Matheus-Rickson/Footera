import { useCallback, useEffect, useState } from 'react';
import type { GkSessionDto, Intensity, TrainingFocus, TrainingOverviewDto, TrainingSession, TrainingTemplate } from '../../shared/api.ts';
import { errMsg, fmtDate, unwrap } from '../util.ts';
import { PosPill, to20 } from '../playerUi.tsx';
import { HelpButton } from '../helpDialog.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onOpenPlayer: (id: string) => void }
export const FOCUS_LABEL: Record<TrainingFocus, string> = {
  balanced: 'Equilibrado', finishing: 'Finalização', creation: 'Criação', defense: 'Defesa', physical: 'Físico', technical: 'Técnica', goalkeeping: 'Goleiro',
};
const INTENSITY_LABEL: Record<Intensity, string> = { light: 'Leve', normal: 'Normal', hard: 'Forte' };
export const SESSION_LABEL: Record<TrainingSession, string> = {
  physical: 'Físico', technical: 'Técnico', tactical: 'Tático', prematch: 'Pré-jogo', recovery: 'Recuperação', rest: 'Folga', match: 'Jogo',
};
const SESSION_HINT: Record<TrainingSession, string> = {
  physical: 'Mais evolução física; cansa mais (carga 6) e recupera menos.',
  technical: 'Mais evolução técnica; carga 3.',
  tactical: 'Mais evolução mental e domínio da função treinada; ritmo +1; carga 3.',
  prematch: 'Véspera de jogo: carga mínima (1) e ritmo +1.',
  recovery: 'Sem carga e recuperação acelerada.',
  rest: 'Descanso: recupera, sem carga, moral +0,5.',
  match: 'Dia de jogo (automático).',
};
const GK_LABEL: Record<GkSessionDto, string> = { reflexes: 'Reflexos', aerial: 'Saídas e jogo aéreo', distribution: 'Jogo com os pés' };
const GK_ATTR: Array<[string, string]> = [['reflexes', 'Reflexos'], ['oneOnOne', 'Um contra um'], ['handling', 'Mãos'], ['aerial', 'Jogo aéreo'], ['rushingOut', 'Saídas'], ['kicking', 'Chute']];
const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const pct = (x: number) => `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`;
/** carga máxima possível numa semana (pré-temporada forte), para a barra */
const MAX_WEEK_LOAD = 6 * 4 * 1.4 + 3 * 2 * 1.4;
type Tab = 'week' | 'players' | 'gk';
const PAGE = 14;

function Meter({ value, low = 75, mid = 88 }: { value: number; low?: number; mid?: number }) {
  return <span className="tn-meter"><span className="tn-track"><i className={value < low ? 'low' : value < mid ? 'mid' : ''} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span><b>{value}</b></span>;
}

export function TrainingView({ profileId, careerId, refreshKey, onOpenPlayer }: Props) {
  const [ov, setOv] = useState<TrainingOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('week');
  const [page, setPage] = useState(0);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getTraining(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  async function run(fn: () => Promise<unknown>) { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando treinamento…</p>;
  const locked = ov.delegated;
  const gks = ov.players.filter((p) => p.position === 'GK');
  const pages = Math.max(1, Math.ceil(ov.players.length / PAGE));
  const cur = Math.min(page, pages - 1);

  return (
    <div className="tn">
      <div className="pf-tabs tn-tabs" role="tablist" aria-label="Seções do treinamento">
        {([['week', 'Semana'], ['players', 'Jogadores'], ['gk', `Goleiros (${gks.length})`]] as Array<[Tab, string]>).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`pf-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {tab === 'week' && (
        <div className="tn-week">
          <section className="card tn-plan">
            <div className="tn-head">
              <h2>Próximos 7 dias<HelpButton title="Sessões de treino">
                <p>Cada dia tem uma sessão. A grade vale para todas as semanas; com o <strong>ajuste aos jogos</strong> ligado, o dia seguinte a um jogo vira
                  Recuperação e a véspera vira Pré-jogo, sem mudar a grade.</p>
                <ul>{ov.sessions.map((s) => <li key={s.id}><strong>{s.label}</strong>: {SESSION_HINT[s.id]}</li>)}</ul>
                <p>A condição volta a cada dia uma fração do que falta para 100% (mais rápido com recuperação, folga, preparador físico, departamento
                  médico, jogador jovem e boa recuperação física) e cai com a carga da sessão. Quem joga 90 minutos termina perto de 70%; cerca de 3 dias
                  leves devolvem ~95%.</p>
                <p>A evolução mensal de cada grupo de atributos segue a mistura de sessões do mês, comparada com a semana Equilibrada (que rende o mesmo
                  que antes). Jogos não contam contra: a comparação usa os mesmos dias de jogo.</p>
              </HelpButton></h2>
              <span className="muted small">Carga da semana {ov.weekLoad.toLocaleString('pt-BR')}</span>
            </div>
            <div className="tn-days">
              {ov.week.map((d) => (
                <div key={d.date} className={`tn-day tn-s-${d.session}`}>
                  <span className="tn-day-name">{DOW[d.dow]} <span className="muted">{fmtDate(d.date).slice(0, 5)}</span></span>
                  <strong className="tn-day-session">{SESSION_LABEL[d.session]}</strong>
                  {d.opponent ? <span className="small">{d.home ? 'x' : '@'} {d.opponent}</span>
                    : d.session !== d.planned ? <span className="muted small">ajustada (grade: {SESSION_LABEL[d.planned]})</span>
                    : <span className="muted small">carga {d.load.toLocaleString('pt-BR')}</span>}
                  {d.session !== 'match' && (
                    <select aria-label={`Sessão de ${DOW[d.dow]}`} value={d.planned} disabled={busy || locked}
                      onChange={(e) => void run(() => unwrap(window.api.setWeekSession(profileId, careerId, d.dow, e.target.value as Exclude<TrainingSession, 'match'>)))}>
                      {ov.sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
            <div className="tn-load"><span className="muted small">Carga</span><span className="tn-load-bar"><i style={{ width: `${Math.min(100, (ov.weekLoad / MAX_WEEK_LOAD) * 100)}%` }} /></span></div>
            {locked && <p className="notice">Montada por {ov.fitnessCoach ?? 'preparador físico'} (treino delegado): ele revê modelo, intensidade e focos toda segunda-feira. Clique em “Eu (técnico)” para retomar o controle.</p>}
          </section>

          <section className="card tn-side">
            <div className="tn-row">
              <strong>Quem decide</strong>
              <div className="tn-btns">
                <button className={locked ? 'secondary' : ''} disabled={busy} onClick={() => void run(() => unwrap(window.api.setDelegated(profileId, careerId, false)))}>Eu (técnico)</button>
                <button className={locked ? '' : 'secondary'} disabled={busy || !ov.hasFitnessCoach} title={ov.hasFitnessCoach ? '' : 'Contrate um preparador físico na aba Comissão técnica'}
                  onClick={() => void run(() => unwrap(window.api.setDelegated(profileId, careerId, true)))}>Preparador físico</button>
              </div>
              {!ov.hasFitnessCoach && <span className="muted small">Sem preparador físico contratado.</span>}
            </div>
            <div className="tn-row">
              <strong>Modelo da semana{ov.template === 'custom' && <span className="muted small"> · personalizada</span>}</strong>
              <div className="tn-btns">
                {ov.templates.map((t) => (
                  <button key={t.id} className={ov.template === t.id ? '' : 'secondary'} disabled={busy || locked}
                    onClick={() => void run(() => unwrap(window.api.applyTrainingTemplate(profileId, careerId, t.id as TrainingTemplate)))}>{t.label}</button>
                ))}
              </div>
            </div>
            <div className="tn-row">
              <strong>Intensidade</strong>
              <div className="tn-btns">
                {(['light', 'normal', 'hard'] as Intensity[]).map((i) => (
                  <button key={i} className={ov.intensity === i ? '' : 'secondary'} disabled={busy || locked} onClick={() => void run(() => unwrap(window.api.setIntensity(profileId, careerId, i)))}>{INTENSITY_LABEL[i]}</button>
                ))}
              </div>
              <span className="muted small">Evolução {pct(ov.intensityEffects[ov.intensity].growth)} · carga das sessões ×{ov.intensityEffects[ov.intensity].load.toLocaleString('pt-BR')} · risco de lesão no treino ×{ov.intensityEffects[ov.intensity].injury.toLocaleString('pt-BR')}</span>
            </div>
            <label className="tn-check">
              <input type="checkbox" checked={ov.autoAdjust} disabled={busy || locked} onChange={(e) => void run(() => unwrap(window.api.setTrainingAutoAdjust(profileId, careerId, e.target.checked)))} />
              Ajustar aos jogos (recuperação no dia seguinte, pré-jogo na véspera)
            </label>
          </section>
        </div>
      )}

      {tab === 'players' && (
        <section className="card tn-table">
          <div className="tn-scroll">
            <table>
              <thead><tr><th>Pos.</th><th>Jogador</th><th>Idade</th><th>Força</th><th>Pot. est.</th><th>Na temporada</th><th>Condição</th>
                <th>Ritmo <HelpButton title="Ritmo de jogo"><p>De 0 a 100. Sobe jogando (+12 por 90 minutos) e um pouco nas sessões tática e pré-jogo; cai depois de 4 dias sem jogar
                  (o preparador físico freia a queda) até 60, que o treino mantém; só cai abaixo disso durante lesões. Sem ritmo nenhum, o jogador rende 8% menos.</p></HelpButton></th>
                <th>Carga <HelpButton title="Carga de jogos dos últimos dias"><p>Média móvel de 7 dias dos minutos em jogo (90 minutos = 10; dois jogos na semana chegam a ~25). Acima de 20 o risco de lesão no treino aumenta; os
                  jogadores em risco aparecem no Departamento médico.</p></HelpButton></th>
                <th>Foco</th><th>Sugestão</th></tr></thead>
              <tbody>{ov.players.slice(cur * PAGE, cur * PAGE + PAGE).map((p) => (
                <tr key={p.id}>
                  <td><PosPill pos={p.position} /></td><td><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button></td><td>{p.age}</td><td>{to20(p.overall)}</td><td>{to20(p.potentialEstimated)}</td>
                  {(() => { const d = to20(p.overall) - to20(p.overall - p.seasonChange); return <td className={d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}>{d > 0 ? `+${d}` : d}</td>; })()}
                  <td>{p.injuredUntil ? <span className="neg">lesionado até {fmtDate(p.injuredUntil)}</span> : <Meter value={p.condition} />}</td>
                  <td><Meter value={p.sharpness} low={50} mid={75} /></td>
                  <td className={p.acuteLoad > 20 ? 'neg' : ''}>{p.acuteLoad.toLocaleString('pt-BR')}</td>
                  <td><select value={p.focus} disabled={busy || locked} onChange={(e) => void run(() => unwrap(window.api.setFocus(profileId, careerId, p.id, e.target.value as TrainingFocus)))}>
                    {ov.focuses.map((f) => <option key={f} value={f}>{FOCUS_LABEL[f]}</option>)}</select></td>
                  <td className="muted">{FOCUS_LABEL[p.suggestedFocus]}</td>
                </tr>))}</tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="tn-pager">
              <button className="secondary" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Anterior</button>
              <span className="muted small">Página {cur + 1} de {pages}</span>
              <button className="secondary" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Próxima</button>
            </div>
          )}
        </section>
      )}

      {tab === 'gk' && (
        <div className="tn-gk">
          <section className="card tn-gk-coach">
            <h2>Treinador de goleiros<HelpButton title="Treino de goleiros">
              <p>Nos dias de físico, técnico e tático, os goleiros fazem a sessão específica da semana. Os atributos dela evoluem mais (×1,35) e os demais
                um pouco menos (×0,9).</p>
              <ul>{ov.gkSessions.map((s) => <li key={s.id}><strong>{s.label}</strong></li>)}</ul>
              <p>O treinador de goleiros escolhe a sessão de cada goleiro (a do ponto mais fraco), a menos que você escolha. A qualidade dele multiplica o ganho
                dos goleiros de 0,80 a 1,10; sem ninguém contratado, rende como qualidade 5 (0,875). Ele manda um relatório toda segunda-feira.</p>
            </HelpButton></h2>
            <p>{ov.gkCoach ? <>{ov.gkCoach.name} · qualidade {ov.gkCoach.ability}/20</> : <span className="notice-text">Sem treinador de goleiros: os goleiros treinam a {Math.round(ov.gkFactor * 100)}%.</span>}
              <span className="muted"> · ganho dos goleiros ×{ov.gkFactor.toLocaleString('pt-BR')}</span></p>
          </section>
          <div className="tn-gk-grid">
            {gks.map((g) => (
              <section key={g.id} className="card tn-gk-card">
                <div className="tn-head">
                  <button className="link" onClick={() => onOpenPlayer(g.id)}><strong>{g.name}</strong></button>
                  <span className="muted small">{g.age} anos · força {to20(g.overall)}</span>
                </div>
                <label className="small">Sessão de goleiros
                  <select value={g.gkSession ?? ''} disabled={busy} onChange={(e) => void run(() => unwrap(window.api.setGkSession(profileId, careerId, g.id, (e.target.value || null) as GkSessionDto | null)))}>
                    <option value="">{ov.gkCoach ? `Treinador decide (${GK_LABEL[g.suggestedGkSession ?? 'reflexes']})` : 'Todas as áreas (sem treinador)'}</option>
                    {ov.gkSessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                {g.gkAttributes && (
                  <ul className="tn-gk-attrs">
                    {GK_ATTR.map(([k, label]) => {
                      const ch = g.gkMonthChange?.[k] ?? 0;
                      return <li key={k}><span>{label}</span><b>{g.gkAttributes![k]}</b>{ch !== 0 && <span className={ch > 0 ? 'pos' : 'neg'}>{ch > 0 ? `+${ch}` : ch}</span>}</li>;
                    })}
                  </ul>
                )}
                <span className="muted small">Variação desde o dia 1º{g.gkMonthChange ? '' : ' (referência a partir do próximo dia 1º)'} · condição {g.condition}% · ritmo {g.sharpness}</span>
              </section>
            ))}
            {!gks.length && <p className="muted">Nenhum goleiro no elenco.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
