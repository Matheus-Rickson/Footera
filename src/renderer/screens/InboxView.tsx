import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, ArrowLeftRight, Binoculars, Building2, CheckCheck, FileSignature, Gavel, HeartPulse, Inbox, Landmark, Mail, Sprout, Trophy, UserCog, Users } from 'lucide-react';
import type { InboxAction, MarketPlayerDto, NewsDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { fmtRange20, PosPill } from '../playerUi.tsx';
import { KnowledgeBar } from './ScoutingView.tsx';

interface Props {
  profileId: string; careerId: string; refreshKey: string; today: string;
  coachFirstName: string; clubName: string | null;
  /** abre a tela da ação sugerida */ onGo: (view: InboxAction) => void;
  /** a contagem de não lidas mudou (atualiza o menu) */ onChanged: () => void;
  /** abre a ficha de um jogador citado na mensagem */ onOpenPlayer?: (id: string) => void;
}

const KIND: Record<NewsDto['kind'], { label: string; icon: LucideIcon; tone: string }> = {
  medical: { label: 'Médico', icon: HeartPulse, tone: 'bad' }, squad: { label: 'Elenco', icon: Gavel, tone: 'warn' }, market: { label: 'Mercado', icon: ArrowLeftRight, tone: 'info' },
  transfer: { label: 'Transferência', icon: ArrowLeftRight, tone: 'info' }, contract: { label: 'Contrato', icon: FileSignature, tone: 'info' }, offer: { label: 'Proposta', icon: Landmark, tone: 'good' },
  board: { label: 'Diretoria', icon: Landmark, tone: 'warn' }, season: { label: 'Temporada', icon: Trophy, tone: 'info' }, trophy: { label: 'Título', icon: Trophy, tone: 'good' },
  youth: { label: 'Base', icon: Sprout, tone: 'good' }, staff: { label: 'Comissão', icon: UserCog, tone: 'info' }, retirement: { label: 'Elenco', icon: Users, tone: 'info' },
};
const ICON_OF: Partial<Record<string, LucideIcon>> = { 'Departamento de infraestrutura': Building2, 'Departamento de scouting': Binoculars };
/** etiqueta pelo remetente (mensagens dos olheiros saem como 'Scouting', não 'Comissão') */
const TAG_OF: Partial<Record<string, string>> = { 'Departamento de scouting': 'Scouting', 'Departamento de infraestrutura': 'Infraestrutura' };
type Filter = 'all' | 'unread' | 'action';

export function InboxView({ profileId, careerId, refreshKey, today, coachFirstName, clubName, onGo, onChanged, onOpenPlayer }: Props) {
  const [list, setList] = useState<NewsDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = () => unwrap(window.api.getNews(profileId, careerId)).then((l) => { setList(l); setError(null); }).catch((e) => setError(errMsg(e)));
  useEffect(() => { void load(); }, [profileId, careerId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (list ?? []).filter((m) => filter === 'all' || (filter === 'unread' ? !m.read : m.action !== null)), [list, filter]);
  const open = (list ?? []).find((m) => m.id === sel) ?? null;
  const unread = (list ?? []).filter((m) => !m.read).length;

  async function read(id: number | null) {
    try {
      await unwrap(window.api.markInboxRead(profileId, careerId, id));
      setList((l) => l?.map((m) => (id === null || m.id === id ? { ...m, read: true } : m)) ?? null);
      onChanged();
    } catch (e) { setError(errMsg(e)); }
  }
  function pick(m: NewsDto) { setSel(m.id); if (!m.read) void read(m.id); }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!list) return <p className="muted">Carregando caixa de entrada…</p>;
  return (
    <div className="ib">
      <section className="card ib-list">
        <div className="ib-toolbar">
          <div className="ib-filters">{([['all', 'Todas'], ['unread', `Não lidas${unread ? ` (${unread})` : ''}`], ['action', 'Pedem ação']] as Array<[Filter, string]>).map(([k, l]) => (
            <button key={k} className={`so-chip ${filter === k ? 'on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>))}</div>
          <button className="nc-ghost" disabled={unread === 0} onClick={() => void read(null)}><CheckCheck size={15} aria-hidden="true" />Marcar todas como lidas</button>
        </div>
        {shown.length === 0 ? <div className="ib-empty"><Inbox size={28} aria-hidden="true" /><p className="muted">{list.length === 0 ? 'Nenhuma mensagem ainda.' : 'Nada com este filtro.'}</p></div> : (
          <ul className="ib-items" role="listbox" aria-label="Mensagens">
            {shown.map((m) => { const k = KIND[m.kind], Icon = ICON_OF[m.sender] ?? k.icon; return (
              <li key={m.id}>
                <button role="option" aria-selected={m.id === sel} className={`ib-item ${m.id === sel ? 'on' : ''} ${m.read ? '' : 'unread'}`} onClick={() => pick(m)}>
                  <span className={`ib-ic ${k.tone}`}><Icon size={16} aria-hidden="true" /></span>
                  <span className="ib-item-main"><span className="ib-item-top"><strong>{m.sender}</strong><em className="muted small">{daysLabel(m.date, today)}</em></span>
                    <span className="ib-subject">{m.title}</span>
                    <span className="muted small ib-snippet">{m.body.split('\n')[0]}</span></span>
                  {!m.read && <span className="ib-dot" aria-label="Não lida" />}
                </button>
              </li>); })}
          </ul>
        )}
      </section>
      <section className="card ib-read">
        {!open ? <div className="ib-empty"><Mail size={34} aria-hidden="true" /><p className="muted">Escolha uma mensagem para ler.</p></div> : (
          <article className="ib-mail">
            <header className="ib-mail-head">
              <span className={`ib-tag ${KIND[open.kind].tone}`}>{TAG_OF[open.sender] ?? KIND[open.kind].label}</span>
              <h2>{open.title}</h2>
              <div className="ib-meta"><span className={`ib-ic ${KIND[open.kind].tone}`}>{(() => { const Icon = ICON_OF[open.sender] ?? KIND[open.kind].icon; return <Icon size={18} aria-hidden="true" />; })()}</span>
                <span><strong>{open.sender}</strong>{clubName && <span className="muted"> · {clubName}</span>}<span className="muted small ib-to">para: {coachFirstName} (treinador) · {fmtDate(open.date)}</span></span></div>
            </header>
            <div className="ib-body">
              <p>Olá, {coachFirstName},</p>
              {(open.body || open.title).split('\n').filter((x) => x.trim()).map((para, i) => <p key={i}>{para}</p>)}
              {open.playerIds && <MailPlayers profileId={profileId} careerId={careerId} ids={open.playerIds} onOpenPlayer={onOpenPlayer} />}
              <p className="ib-sign">Atenciosamente,<br /><strong>{open.sender}</strong>{clubName && <><br /><span className="muted">{clubName}</span></>}</p>
            </div>
            {open.action && (
              <footer className="ib-action"><span className="muted small">Ação sugerida</span>
                <button onClick={() => onGo(open.action!)}>{open.actionLabel ?? 'Abrir'}<ArrowRight size={16} aria-hidden="true" /></button></footer>
            )}
          </article>
        )}
      </section>
    </div>
  );
}

function daysLabel(date: string, today: string): string {
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : d < 7 ? `há ${d} dias` : fmtDate(date);
}

/** Tabela dos jogadores citados numa mensagem (estimativas atuais: as faixas estreitam conforme os olheiros observam). */
function MailPlayers({ profileId, careerId, ids, onOpenPlayer }: { profileId: string; careerId: string; ids: string[]; onOpenPlayer?: (id: string) => void }) {
  const [rows, setRows] = useState<MarketPlayerDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ids.join(',');
  useEffect(() => {
    let stale = false;
    setRows(null);
    unwrap(window.api.getScoutedPlayers(profileId, careerId, ids)).then((r) => { if (!stale) setRows(r); }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!rows) return <p className="muted small">Carregando jogadores…</p>;
  if (!rows.length) return <p className="muted small">Os jogadores citados não estão mais disponíveis (aposentados).</p>;
  return (
    <div className="ib-players scroll">
      <table>
        <thead><tr><th>Jogador</th><th>Clube</th><th>Nacionalidade</th><th>Posição</th><th>Idade</th><th>Força (est.)</th><th>Potencial (est.)</th><th className="right">Valor</th><th>Conhecimento</th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id}>
            <td>{onOpenPlayer ? <button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button> : p.name}</td>
            <td>{p.clubName ?? <em className="muted">Sem clube</em>}</td><td>{p.nationalityName}</td><td><PosPill pos={p.position} /></td><td>{p.age}</td>
            <td>{fmtRange20(p.estOverall)}</td><td>{fmtRange20(p.estPotential)}</td><td className="right">{fmtMoney(p.marketValue)}</td><td><KnowledgeBar value={p.knowledge} /></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}
