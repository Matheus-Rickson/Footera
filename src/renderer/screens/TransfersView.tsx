import { useCallback, useEffect, useState } from 'react';
import { Binoculars, Search, X } from 'lucide-react';
import type { MarketFilter, MarketPlayerDto, TransfersOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';
import { FOOT_LABEL, fmtRange, initials, PlayerFlags, PosPill, tone } from '../playerUi.tsx';
import { KnowledgeBar } from './ScoutingView.tsx';
import { NegotiationModal } from './NegotiationModal.tsx';

type Tab = 'market' | 'incoming' | 'mine' | 'history';
interface Props {
  profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void>;
  /** Jogador escolhido na ficha ou nos olheiros: abre direto a janela de negociação. */ preselect?: MarketPlayerDto | null; onOpenPlayer: (id: string) => void;
}
interface Filters { position: string; minAge: string; maxAge: string; maxValue: string; name: string; freeOnly: boolean }
const EMPTY: Filters = { position: '', minAge: '', maxAge: '', maxValue: '', name: '', freeOnly: false };
const LIMIT = 100;
const KIND_LABEL = { purchase: 'Compra', sale: 'Venda', ai: 'Outros clubes' } as const;
const POSITION_OPTIONS: Array<[string, string]> = [
  ['', 'Todas as posições'], ['GK', 'Goleiros'], ['DEF', 'Defensores'], ['MID', 'Meio-campistas'], ['ATT', 'Atacantes'],
  ['CB', 'Zagueiro'], ['LB', 'Lateral esquerdo'], ['RB', 'Lateral direito'], ['LWB', 'Ala esquerda'], ['RWB', 'Ala direita'], ['DM', 'Volante'], ['CM', 'Meio-campista'],
  ['LM', 'Meia esquerda'], ['RM', 'Meia direita'], ['AM', 'Meia'], ['LW', 'Ponta esquerda'], ['RW', 'Ponta direita'], ['SS', 'Segundo atacante'], ['CF', 'Centroavante'], ['ST', 'Atacante'],
];
/** Filtros da última busca: continuam valendo ao voltar da ficha de um jogador (a tela é desmontada). */
let lastFilters: Filters = EMPTY;

function toMarketFilter(f: Filters): MarketFilter {
  const m: MarketFilter = {};
  if (f.position) m.position = f.position as MarketFilter['position'];
  if (f.minAge) m.minAge = Number(f.minAge);
  if (f.maxAge) m.maxAge = Number(f.maxAge);
  if (f.maxValue) m.maxValue = Math.round(Number(f.maxValue));
  if (f.name.trim()) m.name = f.name.trim();
  if (f.freeOnly) m.freeOnly = true;
  return m;
}

export function TransfersView({ profileId, careerId, refreshKey, onChanged, preselect, onOpenPlayer }: Props) {
  const [tab, setTab] = useState<Tab>('market');
  const [ov, setOv] = useState<TransfersOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<Filters>(lastFilters);
  const [results, setResults] = useState<MarketPlayerDto[] | null>(null);
  const [negotiating, setNegotiating] = useState<string | null>(null);

  const load = useCallback(async () => { setOv(await unwrap(window.api.getTransfers(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  useEffect(() => { if (preselect) { setTab('market'); setNegotiating(preselect.id); } }, [preselect]);

  const search = useCallback(async (f: Filters) => {
    try { setResults(await unwrap(window.api.searchMarket(profileId, careerId, toMarketFilter(f)))); } catch (e) { setError(errMsg(e)); }
  }, [profileId, careerId]);
  // busca automática: imediata ao trocar filtros de escolha, com pequena espera ao digitar nome/idade/valor
  useEffect(() => {
    lastFilters = filters;
    const t = setTimeout(() => void search(filters), 300);
    return () => clearTimeout(t);
  }, [filters, search, refreshKey]);

  async function run(fn: () => Promise<void>) { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const active = filters.position !== '' || filters.minAge !== '' || filters.maxAge !== '' || filters.maxValue !== '' || filters.name !== '' || filters.freeOnly;

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
    <div className="grid1">
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
          <div className="tr-toolbar">
            <label className="tr-search"><Search size={15} aria-hidden="true" />
              <input placeholder="Buscar jogador pelo nome…" aria-label="Buscar jogador pelo nome" value={filters.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <select className="tr-chip" aria-label="Posição" value={filters.position} onChange={(e) => set({ position: e.target.value })}>
              {POSITION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="tr-chip">Idade
              <input type="number" min={14} max={50} placeholder="de" aria-label="Idade mínima" value={filters.minAge} onChange={(e) => set({ minAge: e.target.value })} />
              <input type="number" min={14} max={50} placeholder="até" aria-label="Idade máxima" value={filters.maxAge} onChange={(e) => set({ maxAge: e.target.value })} />
            </span>
            <span className="tr-chip">Valor até
              <input className="tr-wide" type="number" min={0} step={100000} placeholder="sem limite" aria-label="Valor de mercado máximo" value={filters.maxValue} onChange={(e) => set({ maxValue: e.target.value })} />
            </span>
            <label className={`tr-chip ${filters.freeOnly ? 'on' : ''}`}><input type="checkbox" checked={filters.freeOnly} onChange={(e) => set({ freeOnly: e.target.checked })} />Só livres</label>
            {active && <button className="link" onClick={() => setFilters(EMPTY)}><X size={14} aria-hidden="true" />Limpar</button>}
          </div>
          <p className="muted small">Jogadores de outros clubes aparecem com <strong>estimativas</strong> (contrate olheiros e use <Binoculars size={12} aria-hidden="true" /> para estreitar as faixas).
            Jogadores <strong>sem clube</strong> não custam taxa e podem ser contratados com a janela fechada.</p>

          <div className="tr-scroll">
            {!results ? <p className="muted">Buscando…</p> : results.length === 0 ? <p className="muted">Nenhum jogador encontrado com esses filtros.</p> : (
              <table className="tr-table">
                <thead>
                  <tr><th>Jogador</th><th>Clube</th><th>Nacionalidade</th><th>Posição</th><th>Secundárias</th><th className="right">Idade</th><th>Nível (est.)</th><th>Potencial (est.)</th>
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
                      <td><span className={`tr-level ${tone(mid)}`} title="Faixa estimada pelos olheiros">{fmtRange(p.estOverall)}</span></td>
                      <td className="muted">{fmtRange(p.estPotential)}</td>
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
                })}</tbody>
              </table>
            )}
          </div>
          {results && results.length > 0 && <p className="muted small">{results.length >= LIMIT ? `Mostrando os ${LIMIT} jogadores mais valiosos que atendem aos filtros. Refine a busca para ver outros.` : `${results.length} jogador(es), do mais valioso ao menos valioso.`}</p>}
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
        <section className="card scroll tall">
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
