import { useCallback, useEffect, useState } from 'react';
import type { MarketPlayerDto, ScoutAssignment, ScoutingOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { fmtRange20, PosPill } from '../playerUi.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void>; onOpenPlayer: (id: string) => void; onNegotiate: (p: MarketPlayerDto) => void }
const sameAssignment = (a: ScoutAssignment, b: ScoutAssignment) => a.kind === b.kind && (a.kind === 'shortlist' || (b.kind === 'country' && a.countryCode === b.countryCode));

/** Barra de conhecimento (0..100) da rede de olheiros sobre um jogador. */
export function KnowledgeBar({ value }: { value: number }) {
  return <span className="knowledge" title={`Conhecimento dos olheiros: ${value}%`}><i style={{ width: `${value}%` }} /><b>{value}%</b></span>;
}

export function ScoutingView({ profileId, careerId, refreshKey, onChanged, onOpenPlayer, onNegotiate }: Props) {
  const [ov, setOv] = useState<ScoutingOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setOv(await unwrap(window.api.getScouting(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);

  async function run(fn: () => Promise<string | null>, money = false) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); await load(); if (money) await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando olheiros…</p>;
  const full = ov.scouts.length >= ov.maxScouts;
  const assignments: Array<{ label: string; value: ScoutAssignment }> = [{ label: 'Lista de observação', value: { kind: 'shortlist' } }, ...ov.countries.map((c) => ({ label: c.name, value: { kind: 'country', countryCode: c.code } as ScoutAssignment }))];

  const table = (rows: MarketPlayerDto[], removable: boolean) => (
    <table>
      <thead><tr><th>Jogador</th><th>Pos.</th><th>Idade</th><th>Clube</th><th className="right">Valor</th><th>Força (est.)</th><th>Potencial (est.)</th><th>Conhecimento</th><th /></tr></thead>
      <tbody>{rows.map((p) => (
        <tr key={p.id}>
          <td><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button></td><td><PosPill pos={p.position} /></td><td>{p.age}</td><td>{p.clubName ?? <em className="muted">Sem clube</em>}</td><td className="right">{fmtMoney(p.marketValue)}</td>
          <td>{fmtRange20(p.estOverall)}</td><td>{fmtRange20(p.estPotential)}</td><td><KnowledgeBar value={p.knowledge} /></td>
          <td className="row"><button className="secondary" onClick={() => onNegotiate(p)}>Negociar</button>{removable || !p.shortlisted
            ? <button className="secondary" disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.setShortlisted(profileId, careerId, p.id, !p.shortlisted)); return null; })}>{p.shortlisted ? 'Remover' : 'Observar'}</button>
            : <span className="muted small">na lista</span>}</td>
        </tr>))}</tbody>
    </table>
  );

  return (
    <div className="grid1">
      <section className="card">
        <p className="muted small">Olheiros reduzem a margem de erro das estimativas de força e potencial (e aproximam o potencial estimado do real). Designe cada um para
          <strong> um país</strong> (acompanha 5 jogadores por vez até concluir cada relatório, começando pelos mais valiosos) ou para a <strong>lista de observação</strong> (divide o esforço entre os jogadores que você marcou com “Observar” no mercado).
          Salários entram nas Finanças no dia 1º de cada mês; demitir paga até 3 meses de multa. Clique no nome de um jogador para ver a ficha com atributos estimados e o parecer.</p>
        <p>Custo mensal: <strong>{fmtMoney(ov.monthlyCost)}</strong> · {ov.scouts.length} de {ov.maxScouts} olheiros</p>
        {notice && <p className="ok" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="card">
        <h2>Seus olheiros</h2>
        {ov.scouts.length === 0 ? <p className="muted">Nenhum olheiro contratado: o mercado mostra só as faixas largas de estimativa.</p> : (
          <table>
            <thead><tr><th>Nome</th><th>Qualidade</th><th className="right">Salário</th><th>Contrato até</th><th>Designação</th><th /></tr></thead>
            <tbody>{ov.scouts.map((s) => (
              <tr key={s.id}>
                <td>{s.name} <span className="muted small">({s.nationality})</span></td><td>{s.ability}/20</td><td className="right">{fmtMoney(s.salary)}</td><td>{fmtDate(s.contractEnd)}</td>
                <td><div className="row">{assignments.map((a) => (
                  <button key={a.label} className={sameAssignment(a.value, s.assignment) ? '' : 'secondary'} disabled={busy}
                    onClick={() => void run(async () => { await unwrap(window.api.assignScout(profileId, careerId, s.id, a.value)); return null; })}>{a.label}</button>))}</div></td>
                <td><button className="danger" disabled={busy} onClick={() => void run(async () => { const paid = await unwrap(window.api.fireScout(profileId, careerId, s.id)); return `${s.name} demitido. Multa paga: ${fmtMoney(paid)}.`; }, true)}>Demitir</button></td>
              </tr>))}</tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Candidatos deste mês</h2>
        <p className="muted small">A lista muda no dia 1º de cada mês. Qualidade maior = conhecimento cresce mais rápido.</p>
        <table>
          <thead><tr><th>Nome</th><th>Qualidade</th><th className="right">Salário pedido</th><th /></tr></thead>
          <tbody>{ov.candidates.map((c) => (
            <tr key={c.id}><td>{c.name} <span className="muted small">({c.nationality})</span></td><td>{c.ability}/20</td><td className="right">{fmtMoney(c.salary)}</td>
              <td><button disabled={busy || full} title={full ? `Limite de ${ov.maxScouts} olheiros` : ''} onClick={() => void run(async () => { await unwrap(window.api.hireScout(profileId, careerId, c.id)); return `${c.name} contratado.`; })}>Contratar</button></td></tr>))}</tbody>
        </table>
      </section>

      <section className="card scroll">
        <h2>Lista de observação ({ov.shortlist.length})</h2>
        {ov.shortlist.length === 0 ? <p className="muted">Vazia. Use “Observar” na aba Transferências → Mercado.</p> : table(ov.shortlist, true)}
      </section>

      <section className="card scroll">
        <h2>Relatórios (jogadores com ao menos 50% de conhecimento)</h2>
        {ov.reports.length === 0 ? <p className="muted">Nenhum relatório ainda.</p> : table(ov.reports, false)}
      </section>
    </div>
  );
}
