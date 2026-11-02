import { useCallback, useEffect, useState } from 'react';
import type { MarketFilter, MarketPlayerDto, OfferResultDto, TransfersOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';
import { YearsPicker } from './YearsPicker.tsx';
import { KnowledgeBar } from './ScoutingView.tsx';

type Tab = 'market' | 'incoming' | 'mine' | 'history';
interface Props {
  profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void>;
  /** Jogador escolhido na ficha ou nos olheiros: abre direto o painel de proposta. */ preselect?: MarketPlayerDto | null; onOpenPlayer: (id: string) => void;
}
const KIND_LABEL = { purchase: 'Compra', sale: 'Venda', ai: 'Outros clubes' } as const;
const range = (r: { low: number; high: number }) => `${r.low}–${r.high}`;

export function TransfersView({ profileId, careerId, refreshKey, onChanged, preselect, onOpenPlayer }: Props) {
  const [tab, setTab] = useState<Tab>('market');
  const [ov, setOv] = useState<TransfersOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [filter, setFilter] = useState<{ position: string; minAge: string; maxAge: string; maxValue: string; name: string; freeOnly: boolean }>({ position: '', minAge: '', maxAge: '', maxValue: '', name: '', freeOnly: false });
  const [results, setResults] = useState<MarketPlayerDto[] | null>(null);
  const [sel, setSel] = useState<MarketPlayerDto | null>(null);
  const [fee, setFee] = useState(0);
  const [wage, setWage] = useState(0);
  const [years, setYears] = useState(3);
  const [answer, setAnswer] = useState<OfferResultDto | null>(null);

  const load = useCallback(async () => { setOv(await unwrap(window.api.getTransfers(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { if (preselect) { setTab('market'); choose(preselect); } }, [preselect]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);

  async function run(fn: () => Promise<void>) { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }

  const search = () => run(async () => {
    const f: MarketFilter = {};
    if (filter.position) f.position = filter.position as MarketFilter['position'];
    if (filter.minAge) f.minAge = Number(filter.minAge);
    if (filter.maxAge) f.maxAge = Number(filter.maxAge);
    if (filter.maxValue) f.maxValue = Math.round(Number(filter.maxValue));
    if (filter.name.trim()) f.name = filter.name.trim();
    if (filter.freeOnly) f.freeOnly = true;
    setResults(await unwrap(window.api.searchMarket(profileId, careerId, f)));
  });

  const choose = (p: MarketPlayerDto) => { setSel(p); setFee(p.clubId ? p.marketValue : 0); setWage(Math.round((p.salary * 1.2) / 100) * 100); setYears(3); setAnswer(null); setNotice(null); };

  const send = (over?: { fee?: number; wage?: number }) => run(async () => {
    if (!sel) return;
    const offer = { playerId: sel.id, fee: sel.clubId ? Math.round(over?.fee ?? fee) : 0, wage: Math.round(over?.wage ?? wage), years };
    if (over?.fee !== undefined) setFee(offer.fee);
    if (over?.wage !== undefined) setWage(offer.wage);
    const r = await unwrap(window.api.makeOffer(profileId, careerId, offer));
    setAnswer(r);
    if (r.outcome === 'completed') {
      setNotice(r.message); setSel(null); setResults((cur) => cur?.filter((x) => x.id !== sel.id) ?? null);
      await onChanged(); await load();
    }
  });

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

  return (
    <div className="grid1">
      <section className="card">
        <div className="row">
          <strong className={w.open ? 'pos' : 'neg'}>{w.open ? `Janela ABERTA até ${fmtDate(w.closesOn!)}` : `Janela FECHADA — abre em ${fmtDate(w.opensOn!)}`}</strong>
          <span className="muted">Caixa: <strong>{fmtNum(ov.balance)}</strong></span>
          <span className="muted">Elenco: <strong>{ov.squadSize}</strong> (mín. {ov.squadMin}, máx. {ov.squadMax})</span>
        </div>
        <p className="muted small">Os atributos reais dos jogadores de outros clubes não são conhecidos: o mercado mostra <strong>estimativas com margem de erro</strong> (contrate olheiros e use “Observar” para estreitar as faixas). Jogadores <strong>sem clube</strong> (contrato encerrado) não custam taxa e podem ser contratados mesmo com a janela fechada.</p>
        {notice && <p className="ok" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          {([['market', 'Mercado'], ['incoming', `Propostas recebidas (${ov.incoming.length})`], ['mine', 'Meus jogadores'], ['history', 'Histórico']] as Array<[Tab, string]>).map(([t, label]) => (
            <button key={t} className={tab === t ? '' : 'secondary'} onClick={() => setTab(t)}>{label}</button>
          ))}
        </div>
      </section>

      {tab === 'market' && (
        <>
          <section className="card">
            <div className="row">
              <label>Posição<select value={filter.position} onChange={(e) => setFilter({ ...filter, position: e.target.value })}>
                <option value="">Todas</option><option value="GK">Goleiros</option><option value="DEF">Defensores</option><option value="MID">Meio-campistas</option><option value="ATT">Atacantes</option>
              </select></label>
              <label>Idade de<input type="number" min={14} max={50} value={filter.minAge} onChange={(e) => setFilter({ ...filter, minAge: e.target.value })} /></label>
              <label>até<input type="number" min={14} max={50} value={filter.maxAge} onChange={(e) => setFilter({ ...filter, maxAge: e.target.value })} /></label>
              <label>Valor máx.<input type="number" min={0} value={filter.maxValue} onChange={(e) => setFilter({ ...filter, maxValue: e.target.value })} /></label>
              <label className="inline"><input type="checkbox" checked={filter.freeOnly} onChange={(e) => setFilter({ ...filter, freeOnly: e.target.checked })} />Só jogadores livres</label>
              <label>Nome<input value={filter.name} maxLength={40} onChange={(e) => setFilter({ ...filter, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} /></label>
              <button disabled={busy} onClick={() => void search()}>Buscar</button>
            </div>
          </section>
          {sel && (
            <section className="card offer">
              <h2>Proposta por <button className="link" onClick={() => onOpenPlayer(sel.id)}>{sel.name}</button></h2>
              <p className="muted small">{sel.position} · {sel.age} anos · {sel.clubName ?? 'Sem clube (livre: sem taxa, contratável fora da janela)'} · valor de mercado {fmtNum(sel.marketValue)} · salário atual {fmtNum(sel.salary)}/mês · contrato até {fmtDate(sel.contractEnd)}</p>
              <div className="row">
                <label>Taxa ao clube (valor total, uma vez)<input type="number" min={0} value={sel.clubId ? fee : 0} disabled={!sel.clubId} onChange={(e) => setFee(Number(e.target.value))} /></label>
                <label>Salário do jogador (por mês)<input type="number" min={1} value={wage} onChange={(e) => setWage(Number(e.target.value))} /></label>
                <YearsPicker label="Anos de contrato" value={years} onChange={setYears} />
                <button disabled={busy || (!w.open && sel.clubId !== null)} onClick={() => void send()}>Enviar proposta</button>
                <button className="secondary" onClick={() => { setSel(null); setAnswer(null); }}>Cancelar</button>
              </div>
              {answer && answer.outcome !== 'completed' && (
                <div className={answer.outcome.endsWith('counter') ? 'notice' : 'error'} role="status">
                  <p>{answer.message}</p>
                  {answer.outcome === 'club_counter' && <button disabled={busy} onClick={() => void send({ fee: answer.counterFee })}>Aceitar contraproposta do clube</button>}
                  {answer.outcome === 'player_counter' && <button disabled={busy} onClick={() => void send({ wage: answer.counterWage })}>Aceitar salário pedido</button>}
                </div>
              )}
            </section>
          )}
          <section className="card scroll tall">
            {!results ? <p className="muted">Use os filtros e clique em Buscar (mostra até 100 jogadores, dos mais valiosos aos menos).</p> : results.length === 0 ? <p className="muted">Nenhum jogador encontrado.</p> : (
              <table>
                <thead><tr><th>Jogador</th><th>Pos.</th><th>Idade</th><th>Clube</th><th className="right">Valor</th><th className="right">Salário</th><th>Contrato</th><th>Força (est.)</th><th>Potencial (est.)</th><th>Olheiros</th><th /></tr></thead>
                <tbody>{results.map((p) => (
                  <tr key={p.id} className={sel?.id === p.id ? 'mine' : ''}>
                    <td><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button></td><td>{p.position}</td><td>{p.age}</td><td>{p.clubName ?? <em className="muted">Sem clube</em>}</td><td className="right">{fmtNum(p.marketValue)}</td><td className="right">{fmtNum(p.salary)}</td>
                    <td>{fmtDate(p.contractEnd)}</td><td>{range(p.estOverall)}</td><td>{range(p.estPotential)}</td><td><KnowledgeBar value={p.knowledge} /></td>
                    <td className="row">
                      <button className="secondary" disabled={!w.open && p.clubId !== null} onClick={() => choose(p)}>Negociar</button>
                      <button className="secondary" disabled={busy} title="Lista de observação dos olheiros" onClick={() => void toggleShortlist(p)}>{p.shortlisted ? 'Não observar' : 'Observar'}</button>
                    </td>
                  </tr>))}</tbody>
              </table>
            )}
          </section>
        </>
      )}

      {tab === 'incoming' && (
        <section className="card">
          {ov.incoming.length === 0 ? <p className="muted">Nenhuma proposta pendente. Jogadores marcados como transferíveis (aba Meus jogadores) atraem mais propostas, e só durante as janelas.</p> : (
            <table><thead><tr><th>Jogador</th><th>Pos.</th><th>Idade</th><th>Comprador</th><th className="right">Taxa oferecida</th><th className="right">Valor de mercado</th><th>Vence em</th><th /></tr></thead>
              <tbody>{ov.incoming.map((o) => (
                <tr key={o.id}><td>{o.playerName}</td><td>{o.position}</td><td>{o.age}</td><td>{o.buyerClubName}</td><td className="right pos">{fmtNum(o.fee)}</td><td className="right">{fmtNum(o.marketValue)}</td><td>{fmtDate(o.expires)}</td>
                  <td className="row"><button disabled={busy} onClick={() => void respond(o.id, true)}>Aceitar</button><button className="secondary" disabled={busy} onClick={() => void respond(o.id, false)}>Recusar</button></td></tr>))}</tbody></table>
          )}
        </section>
      )}

      {tab === 'mine' && (
        <section className="card scroll tall">
          <table><thead><tr><th>Jogador</th><th>Pos.</th><th>Idade</th><th className="right">Valor</th><th className="right">Salário</th><th>Contrato até</th><th>Transferível</th></tr></thead>
            <tbody>{ov.mine.map((p) => (
              <tr key={p.id}><td>{p.name}</td><td>{p.position}</td><td>{p.age}</td><td className="right">{fmtNum(p.marketValue)}</td><td className="right">{fmtNum(p.salary)}</td><td>{fmtDate(p.contractEnd)}</td>
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
    </div>
  );
}
