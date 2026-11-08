import { useCallback, useEffect, useState } from 'react';
import { Binoculars, CheckCircle2, ListOrdered, Plus, Radar, Trash2, X } from 'lucide-react';
import type { MarketPlayerDto, ScoutingOverviewDto, ScoutTaskDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { fmtRange20, PosPill } from '../playerUi.tsx';
import { toStars } from '../../shared/scale.ts';
import { SCOPE_LABEL } from '../../game/scouting-engine/tasks.ts';
import { ScoutTaskModal } from './ScoutTaskModal.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void>; onOpenPlayer: (id: string) => void; onNegotiate: (p: MarketPlayerDto) => void }

/** Barra de conhecimento (0..100) da rede de olheiros sobre um jogador. */
export function KnowledgeBar({ value }: { value: number }) {
  return <span className="knowledge" title={`Conhecimento dos olheiros: ${value}%`}><i style={{ width: `${value}%` }} /><b>{value}%</b></span>;
}

const STATUS_TXT: Record<ScoutTaskDto['status'], string> = { active: 'Ativa', queued: 'Na fila', done: 'Concluída', cancelled: 'Cancelada' };
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
/** Andamento (0..100) de uma tarefa ativa com prazo. */
const progress = (t: ScoutTaskDto, today: string) => (t.startedOn && t.endsOn ? Math.max(0, Math.min(100, ((dayNum(today) - dayNum(t.startedOn)) / Math.max(1, dayNum(t.endsOn) - dayNum(t.startedOn))) * 100)) : null);
const stars = (rep: number) => { const s = toStars(rep); return '★'.repeat(Math.floor(s)) + (s % 1 ? '½' : ''); };

export function ScoutingView({ profileId, careerId, refreshKey, onChanged, onOpenPlayer, onNegotiate }: Props) {
  const [ov, setOv] = useState<ScoutingOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [sel, setSel] = useState<string>('shortlist');
  const [players, setPlayers] = useState<MarketPlayerDto[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => { setOv(await unwrap(window.api.getScouting(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  useEffect(() => {
    if (!ov) return;
    if (sel !== 'shortlist' && sel !== 'reports' && !ov.tasks.some((t) => t.id === sel)) { setSel('shortlist'); return; }
    let stale = false;
    setPlayers(null);
    unwrap(window.api.getScoutTaskPlayers(profileId, careerId, sel)).then((p) => { if (!stale) setPlayers(p); }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, sel, ov]);

  async function run(fn: () => Promise<string | null>, money = false) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); await load(); if (money) await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando olheiros…</p>;
  const openTasks = ov.tasks.filter((t) => t.status === 'active' || t.status === 'queued');
  const history = ov.tasks.filter((t) => t.status === 'done' || t.status === 'cancelled');
  const active = openTasks.filter((t) => t.status === 'active').length;
  const selTask = ov.tasks.find((t) => t.id === sel) ?? null;
  const title = sel === 'shortlist' ? 'Lista de observação' : sel === 'reports' ? 'Todos os relatórios (50% ou mais)' : selTask?.name ?? '';
  const freeScouts = ov.scouts.filter((s) => !s.taskId).length;

  const taskItem = (t: ScoutTaskDto) => {
    const pct = t.status === 'active' ? progress(t, ov.today) : null;
    return (
      <li key={t.id}>
        <button className={`sc-task ${sel === t.id ? 'on' : ''}`} onClick={() => setSel(t.id)}>
          <span className="sc-task-top"><b>{t.name}</b><span className={`sc-badge sc-${t.status}`}>{STATUS_TXT[t.status]}</span></span>
          <span className="muted small">{t.status === 'active' ? `Olheiro: ${t.scoutName ?? '—'}` : t.status === 'queued' ? 'Aguardando olheiro livre' : `Encerrada em ${fmtDate(t.finishedOn ?? t.createdOn)}`}
            {' · '}{t.found} {t.found === 1 ? 'encontrado' : 'encontrados'} · {t.complete} {t.complete === 1 ? 'completo' : 'completos'}</span>
          {t.status === 'active' && (pct === null ? <span className="muted small">Contínua (desde {fmtDate(t.startedOn!)})</span>
            : <span className="sc-progress" title={`Até ${fmtDate(t.endsOn!)}`}><i style={{ width: `${pct}%` }} /></span>)}
        </button>
      </li>
    );
  };

  return (
    <div className="grid1">
      <div className="sc-stats">
        <div className="sc-stat"><Binoculars size={18} aria-hidden="true" /><b>{ov.scouts.length} / {ov.maxScouts}</b><span>Olheiros · {fmtMoney(ov.monthlyCost)}/mês · contratar em Infraestrutura</span></div>
        <div className="sc-stat"><Radar size={18} aria-hidden="true" /><b>{active}</b><span>Tarefas ativas</span></div>
        <div className="sc-stat"><ListOrdered size={18} aria-hidden="true" /><b>{openTasks.length - active}</b><span>Na fila</span></div>
        <div className="sc-stat"><CheckCircle2 size={18} aria-hidden="true" /><b>{history.filter((t) => t.status === 'done').length}</b><span>Concluídas</span></div>
      </div>
      {notice && <p className="ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="sc-layout">
        <section className="card sc-tasks">
          <div className="sc-head"><h2>Tarefas de busca</h2>
            <button disabled={openTasks.length >= ov.maxOpenTasks} title={openTasks.length >= ov.maxOpenTasks ? `Limite de ${ov.maxOpenTasks} tarefas abertas` : ''} onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />Nova tarefa</button></div>
          <div className="sc-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Abertas ({openTasks.length})</button>
            <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Histórico ({history.length})</button>
          </div>
          <ul className="sc-list">
            {tab === 'open' && <>
              <li><button className={`sc-task ${sel === 'shortlist' ? 'on' : ''}`} onClick={() => setSel('shortlist')}>
                <span className="sc-task-top"><b>Lista de observação</b><span className="sc-badge sc-fixed">{ov.shortlist.length}</span></span>
                <span className="muted small">{freeScouts ? `${freeScouts} ${freeScouts === 1 ? 'olheiro livre observa' : 'olheiros livres observam'} os jogadores marcados com “Observar”` : 'Observada só pelos olheiros sem tarefa'}</span></button></li>
              <li><button className={`sc-task ${sel === 'reports' ? 'on' : ''}`} onClick={() => setSel('reports')}>
                <span className="sc-task-top"><b>Todos os relatórios</b><span className="sc-badge sc-fixed">{ov.reports.length}</span></span>
                <span className="muted small">Jogadores com 50% ou mais de conhecimento</span></button></li>
              {openTasks.map(taskItem)}
              {!openTasks.length && <li className="muted small sc-empty">Nenhuma tarefa aberta. Crie uma para os olheiros procurarem jogadores pelos seus critérios.</li>}
            </>}
            {tab === 'history' && (history.length ? history.map(taskItem) : <li className="muted small sc-empty">Nenhuma tarefa encerrada.</li>)}
          </ul>
        </section>

        <section className="card sc-results">
          <div className="sc-head">
            <div><h2>{title}</h2>
              {selTask && <p className="muted small">{SCOPE_LABEL[selTask.scope]}: {selTask.areaName} · {selTask.months === null ? 'contínua' : `${selTask.months} ${selTask.months === 1 ? 'mês' : 'meses'}`}
                {selTask.startedOn && ` · início ${fmtDate(selTask.startedOn)}`}{selTask.endsOn && ` · término ${fmtDate(selTask.endsOn)}`}</p>}</div>
            {selTask && <button className="secondary" disabled={busy} onClick={() => void run(async () => {
              await unwrap(window.api.removeScoutTask(profileId, careerId, selTask.id));
              return selTask.status === 'active' || selTask.status === 'queued' ? `Tarefa cancelada: ${selTask.name}. A lista fica no histórico.` : `Tarefa apagada: ${selTask.name}.`;
            })}>{selTask.status === 'active' || selTask.status === 'queued' ? <><X size={14} aria-hidden="true" />Cancelar tarefa</> : <><Trash2 size={14} aria-hidden="true" />Apagar</>}</button>}
          </div>
          {players === null ? <p className="muted">Carregando…</p> : players.length === 0
            ? <p className="muted">{sel === 'shortlist' ? 'Vazia. Use “Observar” em Transferências → Mercado ou nesta lista.' : selTask?.status === 'queued' ? 'A tarefa começa quando um olheiro ficar livre.' : 'Nenhum jogador encontrado ainda.'}</p> : (
            <div className="scroll"><table>
              <thead><tr><th>Jogador</th><th>Pos.</th><th>Idade</th><th>Clube</th><th>Força (est.)</th><th>Potencial (est.)</th><th>Reputação</th><th className="right">Valor</th><th>Conhecimento</th><th /></tr></thead>
              <tbody>{players.map((p) => (
                <tr key={p.id}>
                  <td><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button></td><td><PosPill pos={p.position} /></td><td>{p.age}</td>
                  <td>{p.clubName ?? <em className="muted">Sem clube</em>}</td><td>{fmtRange20(p.estOverall)}</td><td>{fmtRange20(p.estPotential)}</td>
                  <td className="sc-stars" title={`${toStars(p.reputation)} de 5`}>{stars(p.reputation)}</td><td className="right">{fmtMoney(p.marketValue)}</td><td><KnowledgeBar value={p.knowledge} /></td>
                  <td className="row"><button className="secondary" onClick={() => onNegotiate(p)}>Negociar</button>
                    <button className="secondary" disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.setShortlisted(profileId, careerId, p.id, !p.shortlisted)); return null; })}>{p.shortlisted ? 'Remover' : 'Observar'}</button></td>
                </tr>))}</tbody>
            </table></div>)}
        </section>
      </div>

      {creating && <ScoutTaskModal profileId={profileId} careerId={careerId} ov={ov} onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); setTab('open'); setSel(id); void run(async () => 'Tarefa criada.'); }} />}
    </div>
  );
}
