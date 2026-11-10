import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Frown, Handshake, Lock, Meh, Smile, Tag, UserX, Wallet } from 'lucide-react';
import type { ContractRowDto, RenewResultDto, SquadStatusDto } from '../../shared/api.ts';
import { PROSPECT_MAX_AGE, SQUAD_STATUSES, STATUS_INFO } from '../../game/career-engine/contracts.ts';
import { groupOf, type PositionGroup } from '../../game/transfer-engine/transfer.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { posLabel, PosPill, PlayerFace, to20, tone } from '../playerUi.tsx';
import { useImages } from '../images.ts';
import { YearsPicker } from './YearsPicker.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }

type Filter = 'all' | 'expiring' | 'listed' | 'unhappy';
type Action = 'renew' | 'list' | 'end';
const GROUPS: Array<[PositionGroup | 'all', string]> = [['all', 'Todos os setores'], ['GK', 'Goleiros'], ['DEF', 'Defensores'], ['MID', 'Meio-campistas'], ['ATT', 'Atacantes']];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const statusLabel = (s: SquadStatusDto) => STATUS_INFO[s].label;

/** Barra do tempo de jogo: parte dos minutos jogada na temporada, com a marca do que o status promete. */
function MinutesBar({ c }: { c: ContractRowDto }) {
  const share = c.minutesShare;
  const state = share === null ? 'none' : share >= c.expectedShare ? 'ok' : share < 0.6 * c.expectedShare ? 'low' : 'mid';
  return (
    <div className="kt-minutes" title={share === null ? 'O clube ainda não jogou nesta temporada' : `${c.seasonMinutes} min em ${c.appearances} jogo(s); o clube jogou ${c.clubMatches}. Combinado: cerca de ${pct(c.expectedShare)} dos minutos.`}>
      <div className="kt-bar"><span className={`kt-bar-fill kt-bar-${state}`} style={{ width: `${Math.round((share ?? 0) * 100)}%` }} /><i className="kt-bar-mark" style={{ left: `${Math.round(c.expectedShare * 100)}%` }} /></div>
      <small>{share === null ? 'sem jogos' : `${pct(share)} · espera ${pct(c.expectedShare)}`}</small>
    </div>
  );
}

function VerdictIcon({ v }: { v: ContractRowDto['verdict'] }) {
  if (v === 'unhappy') return <Frown size={15} className="neg" aria-label="Insatisfeito com o tempo de jogo" />;
  if (v === 'happy') return <Smile size={15} className="pos" aria-label="Satisfeito com o tempo de jogo" />;
  if (v === 'ok') return <Meh size={15} className="muted" aria-label="Tempo de jogo aceitável" />;
  return null;
}

export function ContractsView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const img = useImages();
  const [rows, setRows] = useState<ContractRowDto[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [action, setAction] = useState<Action>('renew');
  const [filter, setFilter] = useState<Filter>('all');
  const [group, setGroup] = useState<PositionGroup | 'all'>('all');
  const [wage, setWage] = useState(0);
  const [years, setYears] = useState(0);
  const [status, setStatus] = useState<SquadStatusDto>('rotation');
  const [answer, setAnswer] = useState<RenewResultDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setRows(await unwrap(window.api.getContracts(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  const sel = rows?.find((r) => r.id === selId) ?? null;

  const choose = (c: ContractRowDto, a: Action = action) => {
    setSelId(c.id); setAction(a); setAnswer(null); setNotice(null); setError(null);
    const cs = c.talk.counterStatus, cy = c.talk.counterYears;
    setStatus(cs ?? c.squadStatus); setYears(cy !== null && cy <= c.maxExtraYears ? cy : 0);
    setWage(c.talk.lastCounter ?? Math.round((c.salary * 1.1) / 100) * 100);
  };

  async function run(fn: () => Promise<string | null>) {
    setBusy(true); setError(null);
    try { const msg = await fn(); if (msg) setNotice(msg); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  const send = (overWage?: number) => run(async () => {
    if (!sel) return null;
    const w = Math.round(overWage ?? wage);
    if (overWage !== undefined) setWage(w);
    const r = await unwrap(window.api.renegotiateContract(profileId, careerId, { playerId: sel.id, wage: w, years, ...(status !== sel.squadStatus ? { status } : {}) }));
    setAnswer(r);
    await load();
    if (r.outcome === 'accepted') { await onChanged(); setAnswer(null); return r.message; }
    if (r.outcome === 'counter' && r.counterWage) setWage(r.counterWage);
    return null;
  });
  const toggleList = () => run(async () => {
    if (!sel) return null;
    await unwrap(window.api.setListed(profileId, careerId, sel.id, !sel.listed));
    await load();
    return sel.listed ? `${sel.name} saiu da lista de transferências.` : `${sel.name} está na lista de transferências: clubes interessados podem fazer propostas.`;
  });
  const terminate = () => run(async () => {
    if (!sel) return null;
    const r = await unwrap(window.api.terminateContract(profileId, careerId, sel.id));
    setSelId(null); await load(); await onChanged();
    return r.message;
  });

  const visible = useMemo(() => (rows ?? []).filter((r) =>
    (filter === 'all' || (filter === 'expiring' && r.expiresThisSeason) || (filter === 'listed' && r.listed) || (filter === 'unhappy' && r.verdict === 'unhappy'))
    && (group === 'all' || groupOf(r.position) === group)), [rows, filter, group]);

  if (!rows) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando contratos…</p>;
  const payroll = rows.reduce((s, r) => s + r.salary, 0);
  const expiring = rows.filter((r) => r.expiresThisSeason).length;
  const listed = rows.filter((r) => r.listed).length;
  const unhappy = rows.filter((r) => r.verdict === 'unhappy').length;
  const sameTerms = sel && sel.talk.lastCounter !== null && sel.talk.counterStatus === status && sel.talk.counterYears === years;
  const endPreview = sel ? (years > 0 ? sel.renewEnds[years - 1] ?? sel.contractEnd : sel.contractEnd) : '';

  return (
    <div className="kt-page">
      <section className="kt-stats">
        <div className="kt-stat"><Wallet size={18} aria-hidden="true" /><span>Folha mensal</span><strong>{fmtMoney(payroll)}</strong><small>{rows.length} jogadores</small></div>
        <button type="button" className={`kt-stat ${filter === 'expiring' ? 'kt-stat-on' : ''}`} onClick={() => setFilter(filter === 'expiring' ? 'all' : 'expiring')}>
          <CalendarClock size={18} aria-hidden="true" /><span>Vencem nesta temporada</span><strong className={expiring ? 'neg' : 'pos'}>{expiring}</strong><small>saem de graça se não renovar</small></button>
        <button type="button" className={`kt-stat ${filter === 'listed' ? 'kt-stat-on' : ''}`} onClick={() => setFilter(filter === 'listed' ? 'all' : 'listed')}>
          <Tag size={18} aria-hidden="true" /><span>Na lista de transferências</span><strong>{listed}</strong><small>recebem mais propostas</small></button>
        <button type="button" className={`kt-stat ${filter === 'unhappy' ? 'kt-stat-on' : ''}`} onClick={() => setFilter(filter === 'unhappy' ? 'all' : 'unhappy')}>
          <Frown size={18} aria-hidden="true" /><span>Insatisfeitos com o tempo de jogo</span><strong className={unhappy ? 'neg' : 'pos'}>{unhappy}</strong><small>avaliação no dia 1º de cada mês</small></button>
      </section>
      {notice && <p className="ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className={`kt-layout ${sel ? 'kt-layout-open' : ''}`}>
        <section className="card kt-list">
          <div className="kt-filters">
            <div className="row kt-chips" role="radiogroup" aria-label="Filtro">
              {([['all', 'Todos'], ['expiring', 'Vencem'], ['listed', 'Na lista'], ['unhappy', 'Insatisfeitos']] as Array<[Filter, string]>).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={filter === k} className={filter === k ? '' : 'secondary'} onClick={() => setFilter(k)}>{l}</button>))}
            </div>
            <div className="row kt-chips" role="radiogroup" aria-label="Setor">
              {GROUPS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={group === k} className={group === k ? '' : 'secondary'} onClick={() => setGroup(k)}>{l}</button>)}
            </div>
          </div>
          <div className="scroll kt-scroll">
            <table className="kt-table">
              <thead><tr><th>Jogador</th><th>Tempo de jogo</th><th className="right">Moral</th><th className="right">Salário</th><th>Contrato</th></tr></thead>
              <tbody>{visible.map((c) => (
                <tr key={c.id} className={`kt-row ${sel?.id === c.id ? 'kt-row-sel' : ''}`} onClick={() => choose(c)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') choose(c); }}>
                  <td><div className="kt-who"><PosPill pos={c.position} /><div><strong>{c.name}</strong><small className="muted">{c.age} anos · força {to20(c.overall)}</small>
                    <div className="kt-tags">
                      {c.expiresThisSeason && <span className="kt-tag kt-tag-warn">vence</span>}
                      {c.listed && <span className="kt-tag">na lista</span>}
                      {c.retiring && <span className="kt-tag kt-tag-muted" title="Anunciou que esta é a última temporada da carreira">aposenta-se</span>}
                      {c.talk.lockedUntil && <span className="kt-tag kt-tag-muted" title={`Encerrou a conversa de renegociação até ${fmtDate(c.talk.lockedUntil)}`}><Lock size={11} aria-hidden="true" /> sem conversa</span>}
                    </div></div></div></td>
                  <td><div className="kt-play"><span className={`kt-status kt-status-${c.squadStatus}`}>{statusLabel(c.squadStatus)}</span><VerdictIcon v={c.verdict} /></div><MinutesBar c={c} /></td>
                  <td className={`right kt-morale-${tone(c.morale)}`}>{Math.round(c.morale)}</td>
                  <td className="right">{fmtMoney(c.salary)}<small className="muted kt-sub">por mês</small></td>
                  <td><span>{fmtDate(c.contractEnd)}</span><div className="kt-left"><span className={`kt-left-fill ${c.expiresThisSeason ? 'kt-left-warn' : ''}`} style={{ width: `${Math.min(100, Math.round((c.monthsLeft / 60) * 100))}%` }} /></div>
                    <small className="muted">{c.monthsLeft} {c.monthsLeft === 1 ? 'mês' : 'meses'}</small></td>
                </tr>))}
                {visible.length === 0 && <tr><td colSpan={5} className="muted">Nenhum jogador neste filtro.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {sel && (
          <aside className="card kt-panel" aria-label={`Contrato de ${sel.name}`}>
            <header className="kt-panel-head">
              <PlayerFace img={img} id={sel.id} name={sel.name} className="kt-face" />
              <div><h2>{sel.name}</h2><p className="muted small">{posLabel(sel.position)} · {sel.age} anos · força {to20(sel.overall)} · valor {fmtMoney(sel.marketValue)}</p></div>
              <button className="secondary icon" aria-label="Fechar" title="Fechar" onClick={() => setSelId(null)}>×</button>
            </header>
            <dl className="kt-facts">
              <div><dt>Salário</dt><dd>{fmtMoney(sel.salary)}/mês</dd></div>
              <div><dt>Contrato até</dt><dd>{fmtDate(sel.contractEnd)} <small className="muted">({sel.monthsLeft} meses)</small></dd></div>
              <div><dt>Tempo de jogo</dt><dd>{statusLabel(sel.squadStatus)} <small className="muted">(~{pct(sel.expectedShare)} dos minutos)</small></dd></div>
              <div><dt>Na temporada</dt><dd>{sel.seasonMinutes} min · {sel.appearances} de {sel.clubMatches} jogos</dd></div>
              <div><dt>Moral</dt><dd className={`kt-morale-${tone(sel.morale)}`}>{Math.round(sel.morale)}</dd></div>
              <div><dt>Custo da rescisão</dt><dd>{fmtMoney(sel.terminationCost)}</dd></div>
            </dl>
            <div className="row kt-tabs" role="tablist">
              <button role="tab" aria-selected={action === 'renew'} className={action === 'renew' ? '' : 'secondary'} onClick={() => setAction('renew')}><Handshake size={15} aria-hidden="true" />Renegociar</button>
              <button role="tab" aria-selected={action === 'list'} className={action === 'list' ? '' : 'secondary'} onClick={() => setAction('list')}><Tag size={15} aria-hidden="true" />Lista</button>
              <button role="tab" aria-selected={action === 'end'} className={action === 'end' ? '' : 'secondary'} onClick={() => setAction('end')}><UserX size={15} aria-hidden="true" />Rescindir</button>
            </div>

            {action === 'renew' && (sel.retiring ? <p className="notice">{sel.name} vai se aposentar ao fim da temporada: não há renegociação.</p>
              : sel.talk.lockedUntil ? <p className="notice"><Lock size={14} aria-hidden="true" /> {sel.name} encerrou a conversa depois de três propostas recusadas. Volta a negociar em {fmtDate(sel.talk.lockedUntil)}.</p>
              : (
                <div className="kt-renew">
                  <div className="kt-field">
                    <span>Tempo de jogo</span>
                    <div className="row kt-status-pick" role="radiogroup" aria-label="Tempo de jogo">
                      {SQUAD_STATUSES.map((s) => {
                        const off = s === 'prospect' && sel.age > PROSPECT_MAX_AGE;
                        return <button key={s} type="button" role="radio" aria-checked={status === s} disabled={off} className={status === s ? '' : 'secondary'}
                          title={off ? `Promessa só até ${PROSPECT_MAX_AGE} anos` : `Espera jogar cerca de ${pct(STATUS_INFO[s].expected)} dos minutos`} onClick={() => setStatus(s)}>{STATUS_INFO[s].label}</button>;
                      })}
                    </div>
                    {status !== sel.squadStatus && <small className="muted">{STATUS_INFO[status].wageFactor > STATUS_INFO[sel.squadStatus].wageFactor ? 'Status mais alto: ele vai pedir um salário maior.' : 'Status mais baixo: ele aceita ganhar menos, mas a moral cai.'}</small>}
                  </div>
                  <label className="kt-field">Salário oferecido (por mês)<input type="number" min={1} step={100} value={wage} onChange={(e) => setWage(Number(e.target.value))} />
                    <small className="muted">Atual: {fmtMoney(sel.salary)} · {wage >= sel.salary ? '+' : '−'}{fmtMoney(Math.abs(wage - sel.salary))}</small></label>
                  <YearsPicker label="Temporadas a mais" value={years} min={0} max={sel.maxExtraYears} onChange={setYears} />
                  <p className="small">Contrato {years > 0 ? <>passa a ir até <strong>{fmtDate(endPreview)}</strong></> : <>mantido até <strong>{fmtDate(sel.contractEnd)}</strong></>}.
                    {sel.maxExtraYears < sel.maxYears && <span className="muted"> Com {sel.monthsLeft} meses restantes, ele aceita no máximo {sel.maxExtraYears} temporada(s) a mais agora.</span>}</p>
                  <div className="kt-rounds" aria-label={`Tentativas restantes: ${sel.talk.roundsLeft} de 3`}>
                    <span className="muted small">Tentativas</span>
                    {[0, 1, 2].map((i) => <i key={i} className={`kt-dot ${i < sel.talk.roundsLeft ? 'kt-dot-on' : ''}`} />)}
                    <span className="muted small">{sel.talk.roundsLeft} de 3: na 3ª proposta recusada, ele encerra a conversa por 30 dias.</span>
                  </div>
                  {sameTerms && <p className="notice">Ele pediu <strong>{fmtMoney(sel.talk.lastCounter!)}</strong> por mês nestes termos.</p>}
                  {answer && answer.outcome !== 'accepted' && answer.outcome !== 'counter' && <p className={answer.outcome === 'walkout' ? 'error' : 'notice'} role="status">{answer.message}</p>}
                  {answer?.outcome === 'counter' && <p className="notice" role="status">{answer.message}</p>}
                  <div className="row">
                    <button disabled={busy || wage <= 0} onClick={() => void send()}>Enviar proposta</button>
                    {sameTerms && <button className="secondary" disabled={busy} onClick={() => void send(sel.talk.lastCounter!)}>Aceitar o pedido dele</button>}
                  </div>
                </div>
              ))}

            {action === 'list' && (
              <div className="kt-renew">
                <p>{sel.listed ? `${sel.name} está na lista de transferências: clubes interessados recebem o aviso e as propostas por ele ficam mais frequentes.` : `Colocar ${sel.name} na lista avisa o mercado de que o clube aceita vendê-lo: chegam mais propostas, em geral perto do valor de mercado (${fmtMoney(sel.marketValue)}).`}</p>
                <div className="row"><button className={sel.listed ? 'secondary' : ''} disabled={busy} onClick={() => void toggleList()}>{sel.listed ? 'Tirar da lista' : 'Colocar na lista'}</button></div>
                <p className="muted small">As propostas chegam na Caixa de entrada e em Transferências; nada é vendido sem você aceitar.</p>
              </div>
            )}

            {action === 'end' && (
              <div className="kt-renew">
                <p>Rescindir libera {sel.name} na hora. O clube paga os salários que faltam até {fmtDate(sel.contractEnd)}:
                  {' '}<strong className="neg">{fmtMoney(sel.terminationCost)}</strong> ({Math.max(1, sel.monthsLeft)} {Math.max(1, sel.monthsLeft) === 1 ? 'mês' : 'meses'} de {fmtMoney(sel.salary)}).</p>
                <p className="muted small">Ele sai livre e pode assinar com qualquer clube. O elenco precisa continuar com pelo menos 18 jogadores, 2 goleiros e profundidade em cada setor.</p>
                <div className="row"><button className="danger" disabled={busy} onClick={() => void terminate()}><UserX size={15} aria-hidden="true" />Confirmar rescisão</button></div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
