import { useCallback, useEffect, useRef, useState } from 'react';
import { Binoculars } from 'lucide-react';
import type { MarketPageDto, MarketPlayerDto, TransfersOverviewDto } from '../../shared/api.ts';
import { EMPTY_FILTERS, MarketFilters, toMarketFilter, type Filters } from './MarketFilters.tsx';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';
import { fmtRange, fmtRange20, FOOT_LABEL, initials, PlayerFlags, PosPill, tone } from '../playerUi.tsx';
import { KnowledgeBar } from './ScoutingView.tsx';
import { NegotiationModal } from './NegotiationModal.tsx';
import type { SummaryKey } from '../../shared/attributeSummary.ts';

type Tab = 'market' | 'incoming' | 'mine' | 'history';
/** Atributos resumidos na lista do mercado (estimativas). Finalização só para jogadores de linha; Goleiro só para goleiros. */
const SUMMARY_COLS: Array<[SummaryKey, string, string]> = [
  ['fin', 'FIN', 'Finalização'], ['gol', 'GOL', 'Goleiro'], ['tec', 'TEC', 'Técnica'], ['pas', 'PAS', 'Passe'], ['des', 'DES', 'Desarme'], ['fis', 'FIS', 'Físico'], ['vel', 'VEL', 'Velocidade'],
];

interface Props {
  profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void>;
  /** Jogador escolhido na ficha ou nos olheiros: abre direto a janela de negociação. */ preselect?: MarketPlayerDto | null; onOpenPlayer: (id: string) => void;
}
const PAGE = 100;
const KIND_LABEL = { purchase: 'Compra', sale: 'Venda', ai: 'Outros clubes' } as const;
/** Filtros da última busca: continuam valendo ao voltar da ficha de um jogador (a tela é desmontada). */
let lastFilters: Filters = EMPTY_FILTERS;

export function TransfersView({ profileId, careerId, refreshKey, onChanged, preselect, onOpenPlayer }: Props) {
  const [tab, setTab] = useState<Tab>('market');
  const [ov, setOv] = useState<TransfersOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<Filters>(lastFilters);
  const [results, setResults] = useState<MarketPlayerDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nationalities, setNationalities] = useState<MarketPageDto['nationalities']>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  /** descarta respostas de buscas antigas (filtro mudou enquanto a página carregava) */
  const reqId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLTableRowElement>(null);
  const [negotiating, setNegotiating] = useState<string | null>(null);

  const load = useCallback(async () => { setOv(await unwrap(window.api.getTransfers(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  useEffect(() => { if (preselect) { setTab('market'); setNegotiating(preselect.id); } }, [preselect]);

  const search = useCallback(async (f: Filters) => {
    const id = ++reqId.current;
    try {
      const page = await unwrap(window.api.searchMarket(profileId, careerId, { ...toMarketFilter(f), offset: 0, limit: PAGE }));
      if (id !== reqId.current) return;
      setResults(page.players); setTotal(page.total); setNationalities(page.nationalities);
      scrollRef.current?.scrollTo({ top: 0 });
    } catch (e) { setError(errMsg(e)); }
  }, [profileId, careerId]);
  // rolagem infinita: ao chegar perto do fim da lista, busca a próxima página com os mesmos filtros
  const loadMore = useCallback(async () => {
    if (!results || loadingMore || results.length >= total) return;
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const page = await unwrap(window.api.searchMarket(profileId, careerId, { ...toMarketFilter(filters), offset: results.length, limit: PAGE }));
      if (id === reqId.current) setResults((cur) => [...(cur ?? []), ...page.players.filter((p) => !(cur ?? []).some((c) => c.id === p.id))]);
    } catch (e) { setError(errMsg(e)); } finally { setLoadingMore(false); }
  }, [results, loadingMore, total, profileId, careerId, filters]);
  useEffect(() => {
    const el = sentinel.current, root = scrollRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void loadMore(); }, { root, rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, tab]);
  // busca automática: imediata ao trocar filtros de escolha, com pequena espera ao digitar nome/idade/valor
  useEffect(() => {
    lastFilters = filters;
    const t = setTimeout(() => void search(filters), 300);
    return () => clearTimeout(t);
  }, [filters, search, refreshKey]);

  async function run(fn: () => Promise<void>) { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const respond = (id: number, accept: boolean) => run(async () => {
    await unwrap(window.api.respondOffer(profileId, careerId, id, accept));
    setNotice(accept ? 'Venda concluída.' : 'Proposta recusada.');
    await onChanged(); await load();
  });
  const toggleShortlist = (p: MarketPlayerDto) => run(async () => {
    await unwrap(window.api.setShortlisted(profileId, careerId, p.id, !p.shortlisted));
    setResults((cur) => cur?.map((x) => (x.id === p.id ? { ...x, shortlisted: !p.shortlisted } : x)) ?? null);
  });
  const toggleListed = (id: string, listed: boolean) => run(async () => { await unwrap(window.api.setListed(profileId, careerId, id, listed)); await load(); });

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando transferências…</p>;
  const w = ov.window;
  const tabs: Array<[Tab, string]> = [['market', 'Mercado'], ['incoming', `Propostas recebidas${ov.incoming.length ? ` (${ov.incoming.length})` : ''}`], ['mine', 'Meus jogadores'], ['history', 'Histórico']];

  return (
    <div className="tr-root">
      <div className="tr-head">
        <div className="pf-tabs" role="tablist">
          {tabs.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} className={`pf-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{label}</button>)}
        </div>
        <div className="row small">
          <span className={`tr-window ${w.open ? 'open' : ''}`}>{w.open ? `Janela aberta até ${fmtDate(w.closesOn!)}` : `Janela fechada · abre em ${fmtDate(w.opensOn!)}`}</span>
          <span className="muted">Caixa <strong>{fmtNum(ov.balance)}</strong></span>
          <span className="muted">Elenco <strong>{ov.squadSize}</strong>/{ov.squadMax} (mín. {ov.squadMin})</span>
        </div>
      </div>
      {notice && <p className="ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {tab === 'market' && (
        <section className="card tr-market">
          <MarketFilters filters={filters} set={set} nationalities={nationalities} />
          <p className="muted small">Jogadores de outros clubes aparecem com <strong>estimativas</strong> (contrate olheiros e use <Binoculars size={12} aria-hidden="true" /> para estreitar as faixas).
            Jogadores <strong>sem clube</strong> não custam taxa e podem ser contratados com a janela fechada.</p>

          <div className="tr-scroll" ref={scrollRef}>
            {!results ? <p className="muted">Buscando…</p> : results.length === 0 ? <p className="muted">Nenhum jogador encontrado com esses filtros.</p> : (
              <table className="tr-table">
                <thead>
                  <tr><th>Jogador</th><th>Clube</th><th>Nacionalidade</th><th>Posição</th><th>Secundárias</th><th className="right">Idade</th><th>Nível (est.)</th><th>Potencial (est.)</th>
                    {SUMMARY_COLS.map(([k, short, label]) => <th key={k} className={`center ${k === 'fin' ? 'tr-attr-first' : ''}`} title={`${label} (estimativa dos olheiros, 1–20)`}>{short}</th>)}
                    <th>Pé</th><th className="right">Altura</th><th className="right">Peso</th><th className="right">Valor</th><th className="right">Salário</th><th>Contrato</th><th>Olheiros</th><th /></tr>
                </thead>
                <tbody>{results.map((p) => {
                  const mid = (p.estOverall.low + p.estOverall.high) / 2;
                  const blocked = !w.open && p.clubId !== null;
                  return (
                    <tr key={p.id}>
                      <td><div className="tr-player"><span className="tr-avatar" aria-hidden="true">{initials(p.name)}</span><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button><PlayerFlags p={p} /></div></td>
                      <td>{p.clubName ?? <em className="muted">Sem clube</em>}</td>
                      <td className="nowrap">{p.nationalityName}</td>
                      <td><PosPill pos={p.position} /></td>
                      <td><span className="tr-secs">{p.secondaryPositions.length === 0 ? <span className="muted">—</span> : p.secondaryPositions.map((s) => <PosPill key={s} pos={s} minor />)}</span></td>
                      <td className="right">{p.age}</td>
                      <td><span className={`tr-level ${tone(mid)}`} title="Faixa estimada pelos olheiros">{fmtRange20(p.estOverall)}</span></td>
                      <td className="muted">{fmtRange20(p.estPotential)}</td>
                      {SUMMARY_COLS.map(([k, , label]) => {
                        const r = p.estSummary[k];
                        const na = (k === 'gol') !== (p.position === 'GK') && (k === 'gol' || k === 'fin');
                        return <td key={k} className={`center ${k === 'fin' ? 'tr-attr-first' : ''}`}>{na ? <span className="muted">—</span>
                          : <span className={`tr-attr ${tone((r.low + r.high) / 2)}`} title={`${label}: estimativa ${fmtRange20(r)}`}>{fmtRange20(r)}</span>}</td>;
                      })}
                      <td>{FOOT_LABEL[p.foot] ?? p.foot}</td>
                      <td className="right nowrap">{p.heightCm} cm</td>
                      <td className="right nowrap">{p.weightKg} kg</td>
                      <td className="right">{fmtNum(p.marketValue)}</td>
                      <td className="right">{fmtNum(p.salary)}</td>
                      <td className="nowrap">{p.clubId ? fmtDate(p.contractEnd) : <span className="muted">—</span>}</td>
                      <td><KnowledgeBar value={p.knowledge} /></td>
                      <td><div className="row tr-actions">
                        <button className={`secondary icon ${p.shortlisted ? 'tr-watching' : ''}`} disabled={busy} aria-pressed={p.shortlisted}
                          title={p.shortlisted ? 'Tirar da lista de observação' : 'Adicionar à lista de observação dos olheiros'} onClick={() => void toggleShortlist(p)}><Binoculars size={15} aria-hidden="true" /></button>
                        <button className="secondary" disabled={blocked} title={blocked ? `Janela fechada: abre em ${fmtDate(w.opensOn!)}` : ''} onClick={() => setNegotiating(p.id)}>Negociar</button>
                      </div></td>
                    </tr>
                  );
                })}
                {results.length < total && <tr ref={sentinel} className="tr-more"><td colSpan={99}>{loadingMore ? 'Carregando mais jogadores…' : 'Role para carregar mais'}</td></tr>}</tbody>
              </table>
            )}
          </div>
          {results && results.length > 0 && <p className="muted small">{total.toLocaleString('pt-BR')} jogador(es) disponíveis com esses filtros, do mais valioso ao menos valioso{results.length < total ? ` · ${results.length} carregados (role a lista para ver mais)` : ''}.</p>}
        </section>
      )}

      {tab === 'incoming' && (
        <section className="card">
          {ov.incoming.length === 0 ? <p className="muted">Nenhuma proposta pendente. Jogadores marcados como transferíveis (aba Meus jogadores) atraem mais propostas, e só durante as janelas.</p> : (
            <table><thead><tr><th>Jogador</th><th>Pos.</th><th>Idade</th><th>Comprador</th><th className="right">Taxa oferecida</th><th className="right">Valor de mercado</th><th>Vence em</th><th /></tr></thead>
              <tbody>{ov.incoming.map((o) => (
                <tr key={o.id}><td><button className="link" onClick={() => onOpenPlayer(o.playerId)}>{o.playerName}</button></td><td><PosPill pos={o.position} /></td><td>{o.age}</td><td>{o.buyerClubName}</td><td className="right pos">{fmtNum(o.fee)}</td><td className="right">{fmtNum(o.marketValue)}</td><td>{fmtDate(o.expires)}</td>
                  <td className="row"><button disabled={busy} onClick={() => void respond(o.id, true)}>Aceitar</button><button className="secondary" disabled={busy} onClick={() => void respond(o.id, false)}>Recusar</button></td></tr>))}</tbody></table>
          )}
        </section>
      )}

      {tab === 'mine' && (
        <section className="card">
          <table><thead><tr><th>Jogador</th><th>Pos.</th><th>Idade</th><th className="right">Valor</th><th className="right">Salário</th><th>Contrato até</th><th>Transferível</th></tr></thead>
            <tbody>{ov.mine.map((p) => (
              <tr key={p.id}><td><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button></td><td><PosPill pos={p.position} /></td><td>{p.age}</td><td className="right">{fmtNum(p.marketValue)}</td><td className="right">{fmtNum(p.salary)}</td><td>{fmtDate(p.contractEnd)}</td>
                <td><input type="checkbox" checked={p.listed} disabled={busy} aria-label={`Listar ${p.name} para venda`} onChange={(e) => void toggleListed(p.id, e.target.checked)} /></td></tr>))}</tbody></table>
        </section>
      )}

      {tab === 'history' && (
        <section className="card">
          {ov.recent.length === 0 ? <p className="muted">Nenhuma transferência registrada ainda.</p> : (
            <table><thead><tr><th>Data</th><th>Jogador</th><th>De</th><th>Para</th><th className="right">Taxa</th><th>Tipo</th></tr></thead>
              <tbody>{ov.recent.map((t) => (
                <tr key={t.id} className={t.kind === 'ai' ? '' : 'mine'}><td>{fmtDate(t.date)}</td><td>{t.playerName}</td><td>{t.fromClub ?? '—'}</td><td>{t.toClub}</td><td className="right">{fmtNum(t.fee)}</td><td>{KIND_LABEL[t.kind]}</td></tr>))}</tbody></table>
          )}
        </section>
      )}

      {negotiating && (
        <NegotiationModal profileId={profileId} careerId={careerId} playerId={negotiating}
          onClose={() => setNegotiating(null)} onOpenPlayer={(id) => { setNegotiating(null); onOpenPlayer(id); }}
          onSigned={async () => { setResults((cur) => cur?.filter((x) => x.id !== negotiating) ?? null); await onChanged(); await load(); }} />
      )}
    </div>
  );
}
