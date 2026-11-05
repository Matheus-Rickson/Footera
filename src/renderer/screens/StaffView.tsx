import { useCallback, useEffect, useState } from 'react';
import type { StaffOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }

export function StaffView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [ov, setOv] = useState<StaffOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getStaff(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  async function run(fn: () => Promise<string>, money = false) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); await load(); if (money) await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando comissão técnica…</p>;
  return (
    <div className="grid1">
      <section className="card">
        <p className="muted small">Um profissional por função. Sem alguém contratado, a função rende como um profissional de qualidade {ov.unstaffedQuality}. Salários entram nas Finanças no dia 1º;
          demitir paga até 3 meses de multa. Os candidatos mudam no dia 1º de cada mês.</p>
        <p>Custo mensal da comissão: <strong>{fmtMoney(ov.monthlyCost)}</strong></p>
        {notice && <p className="ok" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <div className="grid2">
        {ov.roles.map((r) => (
          <section key={r.role} className="card">
            <h2>{r.label}</h2>
            <p className="muted small">{r.effect}</p>
            {r.member ? (
              <div className="row">
                <span><strong>{r.member.name}</strong> <span className="muted small">({r.member.nationality})</span> · qualidade {r.member.ability}/20 · {fmtMoney(r.member.salary)}/mês · até {fmtDate(r.member.contractEnd)}</span>
                <button className="danger" disabled={busy} onClick={() => void run(async () => `${r.member!.name} demitido. Multa paga: ${fmtMoney(await unwrap(window.api.fireStaff(profileId, careerId, r.member!.id)))}.`, true)}>Demitir</button>
              </div>
            ) : (
              <table><tbody>{r.candidates.map((c) => (
                <tr key={c.id}><td>{c.name} <span className="muted small">({c.nationality})</span></td><td>{c.ability}/20</td><td className="right">{fmtMoney(c.salary)}/mês</td>
                  <td><button disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.hireStaff(profileId, careerId, c.id)); return `${c.name} contratado como ${r.label.toLowerCase()}.`; })}>Contratar</button></td></tr>))}</tbody></table>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
