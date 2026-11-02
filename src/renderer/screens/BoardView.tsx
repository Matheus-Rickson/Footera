import { useCallback, useEffect, useState } from 'react';
import type { BoardOverviewDto, BoardStatus } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }
const STATUS: Record<BoardStatus, { label: string; cls: string }> = {
  pending: { label: 'a começar', cls: 'muted' }, on_track: { label: 'no caminho', cls: 'pos' }, close: { label: 'perto da meta', cls: 'notice-text' }, off_track: { label: 'fora da meta', cls: 'neg' },
};

export function BoardView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [ov, setOv] = useState<BoardOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmJob, setConfirmJob] = useState<number | null>(null);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getBoard(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  async function run(fn: () => Promise<string | null>, refreshAll = false) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); setConfirmJob(null); await load(); if (refreshAll) await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando diretoria…</p>;
  const c = ov.club;

  return (
    <div className="grid1">
      {notice && <p className="ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!ov.employed && <p className="notice">Você está <strong>sem clube</strong>. O calendário continua; clubes com vaga fazem propostas conforme a sua reputação ({ov.coachReputation}). Aceite uma para voltar a trabalhar.</p>}

      {c && (
        <div className="grid2">
          <section className="card">
            <h2>Confiança da diretoria — {c.name}</h2>
            <div className="meter"><i className={c.confidence < 25 ? 'low' : c.confidence < 50 ? 'mid' : ''} style={{ width: `${c.confidence}%` }} /></div>
            <p><strong>{Math.round(c.confidence)}</strong>/100 {c.warning && <span className="neg">· cargo ameaçado</span>}</p>
            <p className="muted small">Vitórias sobem e derrotas descem a confiança; todo dia 1º a diretoria compara a posição com a meta e olha o caixa. Abaixo de 25 vem um aviso;
              chegando a 10 (depois de 6 jogos no cargo) o treinador é demitido. Na virada, a temporada é avaliada.</p>
          </section>
          <section className="card">
            <h2>Objetivos da temporada</h2>
            <p><strong>{c.objective.label}</strong> — meta: terminar até o {c.objective.target}º (expectativa pelo elenco: {c.objective.expected}º)</p>
            <p>Hoje: {c.objective.position ? `${c.objective.position}º em ${c.objective.played} jogo(s)` : 'liga ainda não começou'} · <span className={STATUS[c.objective.status].cls}>{STATUS[c.objective.status].label}</span></p>
            <h3>Secundários</h3>
            <ul className="plain">{c.secondary.map((s) => <li key={s.label}>{s.label} · <span className={STATUS[s.status].cls}>{STATUS[s.status].label}</span> <span className="muted small">({s.detail})</span></li>)}</ul>
          </section>
          <section className="card wide">
            <h2>Orçamentos</h2>
            <p>Transferências: <strong>{fmtNum(c.budgets.remaining)}</strong> disponíveis (orçamento {fmtNum(c.budgets.transfer)}, gasto {fmtNum(c.budgets.spent)}; vendas devolvem metade da taxa)</p>
            <p>Folha salarial: <strong>{fmtNum(c.budgets.payroll)}</strong> de um teto de {fmtNum(c.budgets.wageCeiling)} por mês</p>
            <p className="muted small">A diretoria barra contratações e renovações que estourem o orçamento ou o teto, e veta valores fora da realidade do clube (taxa acima de 2× o valor de mercado,
              salário acima de 2,2× o justo). Obras acima de 30% do caixa precisam de aprovação. Cada pedido de aumento pode ser feito uma vez por temporada e depende da confiança (65+).</p>
            <div className="row">
              <button className="secondary" disabled={busy || !c.requests.transfer} onClick={() => void run(async () => (await unwrap(window.api.requestBudget(profileId, careerId, 'transfer'))).message)}>Pedir mais orçamento de transferências</button>
              <button className="secondary" disabled={busy || !c.requests.wage} onClick={() => void run(async () => (await unwrap(window.api.requestBudget(profileId, careerId, 'wage'))).message)}>Pedir aumento do teto da folha</button>
            </div>
          </section>
        </div>
      )}

      <section className="card">
        <h2>Propostas de emprego ({ov.offers.length})</h2>
        {ov.offers.length === 0 ? <p className="muted">Nenhuma proposta no momento. Clubes que demitem o técnico procuram treinadores com reputação compatível.</p> : (
          <table><thead><tr><th>Clube</th><th>Liga</th><th>Reputação</th><th>Recebida</th><th>Responder até</th><th /></tr></thead>
            <tbody>{ov.offers.map((o) => (
              <tr key={o.id}><td><strong>{o.clubName}</strong></td><td>{o.league}</td><td>{o.reputation}</td><td>{fmtDate(o.date)}</td><td>{fmtDate(o.expires)}</td>
                <td className="row">{confirmJob === o.id
                  ? <><button disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.respondJobOffer(profileId, careerId, o.id, true)); return `Você é o novo treinador do ${o.clubName}.`; }, true)}>Confirmar troca</button>
                    <button className="secondary" onClick={() => setConfirmJob(null)}>Cancelar</button></>
                  : <><button disabled={busy} onClick={() => setConfirmJob(o.id)}>Aceitar</button>
                    <button className="secondary" disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.respondJobOffer(profileId, careerId, o.id, false)); return 'Proposta recusada.'; })}>Recusar</button></>}</td></tr>))}</tbody></table>
        )}
        {ov.employed && ov.offers.length > 0 && <p className="muted small">Aceitar troca de clube na hora: comissão técnica, olheiros e rotina de treino ficam no clube atual.</p>}
      </section>

      <section className="card">
        <h2>Carreira do treinador</h2>
        <p>Reputação: <strong>{ov.coachReputation}</strong>/100 <span className="muted small">(sobe com objetivos cumpridos, títulos e acessos; cai com fracassos, rebaixamentos e demissões)</span></p>
        <table><thead><tr><th>Clube</th><th>Início</th><th>Fim</th><th>Saída</th></tr></thead>
          <tbody>{ov.spells.map((s, i) => <tr key={i} className={s.end ? '' : 'mine'}><td>{s.clubName}</td><td>{fmtDate(s.start)}</td><td>{s.end ? fmtDate(s.end) : 'atual'}</td><td>{s.reason === 'sacked' ? 'demitido' : s.reason === 'left' ? 'saiu para outro clube' : '—'}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}
