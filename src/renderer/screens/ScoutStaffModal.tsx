import { useCallback, useEffect, useState } from 'react';
import { Binoculars, X } from 'lucide-react';
import type { ScoutingOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';

interface Props { profileId: string; careerId: string; onClose: () => void; onChanged: () => Promise<void>; onOpenScouting?: () => void }

/** Departamento de scouting (aberto pela Infraestrutura): olheiros contratados e candidatos do mês. */
export function ScoutStaffModal({ profileId, careerId, onClose, onChanged, onOpenScouting }: Props) {
  const [ov, setOv] = useState<ScoutingOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getScouting(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function run(fn: () => Promise<string>) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); await load(); await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  const full = ov ? ov.scouts.length >= ov.maxScouts : true;

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal ssm-modal" role="dialog" aria-modal="true" aria-label="Departamento de scouting">
        <header className="modal-head"><Binoculars size={20} aria-hidden="true" /><h2>Departamento de scouting</h2>
          {onOpenScouting && <button className="secondary" onClick={() => { onClose(); onOpenScouting(); }}>Ir para as tarefas</button>}
          <button className="secondary icon" aria-label="Fechar" onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
        <div className="modal-body">
          {!ov ? (error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando…</p>) : <>
            <p className="muted small">Nível {ov.deptLevel} de 20: comporta <strong>{ov.maxScouts}</strong> olheiros (cada um cumpre uma tarefa ativa) e cada tarefa acompanha <strong>{ov.tracked}</strong> jogadores por vez.
              Quem fica sem tarefa observa a lista de observação. Salários no dia 1º de cada mês ({fmtMoney(ov.monthlyCost)}/mês hoje); demitir paga até 3 meses de multa e a tarefa volta para a fila.</p>
            {notice && <p className="ok" role="status">{notice}</p>}
            {error && <p className="error" role="alert">{error}</p>}
            <h3 className="ssm-sub">Olheiros contratados ({ov.scouts.length} de {ov.maxScouts})</h3>
            {ov.scouts.length === 0 ? <p className="muted">Nenhum olheiro: as tarefas ficam na fila e o mercado mostra só as faixas largas de estimativa.</p> : (
              <table>
                <thead><tr><th>Nome</th><th>Qualidade</th><th className="right">Salário</th><th>Contrato até</th><th>Trabalhando em</th><th /></tr></thead>
                <tbody>{ov.scouts.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name} <span className="muted small">({s.nationality})</span></td><td>{s.ability}/20</td><td className="right">{fmtMoney(s.salary)}</td><td>{fmtDate(s.contractEnd)}</td>
                    <td>{s.taskName ?? <span className="muted">Lista de observação</span>}</td>
                    <td><button className="danger" disabled={busy} onClick={() => void run(async () => { const paid = await unwrap(window.api.fireScout(profileId, careerId, s.id)); return `${s.name} demitido. Multa paga: ${fmtMoney(paid)}.`; })}>Demitir</button></td>
                  </tr>))}</tbody>
              </table>
            )}
            <h3 className="ssm-sub">Candidatos deste mês</h3>
            <p className="muted small">A lista muda no dia 1º de cada mês. Qualidade maior = relatório mais rápido.{full ? ` O departamento está cheio: amplie-o na Infraestrutura para contratar mais.` : ''}</p>
            <table>
              <thead><tr><th>Nome</th><th>Qualidade</th><th className="right">Salário pedido</th><th /></tr></thead>
              <tbody>{ov.candidates.map((c) => (
                <tr key={c.id}><td>{c.name} <span className="muted small">({c.nationality})</span></td><td>{c.ability}/20</td><td className="right">{fmtMoney(c.salary)}</td>
                  <td><button disabled={busy || full} title={full ? `Limite de ${ov.maxScouts} olheiros neste nível` : ''} onClick={() => void run(async () => { await unwrap(window.api.hireScout(profileId, careerId, c.id)); return `${c.name} contratado.`; })}>Contratar</button></td></tr>))}</tbody>
            </table>
          </>}
        </div>
      </div>
    </div>
  );
}
