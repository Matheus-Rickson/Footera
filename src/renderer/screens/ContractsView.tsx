import { useCallback, useEffect, useState } from 'react';
import type { ContractRowDto, RenewResultDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';
import { PosPill, posLabel } from '../playerUi.tsx';
import { YearsPicker } from './YearsPicker.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }

export function ContractsView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [rows, setRows] = useState<ContractRowDto[] | null>(null);
  const [sel, setSel] = useState<ContractRowDto | null>(null);
  const [wage, setWage] = useState(0);
  const [years, setYears] = useState(2);
  const [answer, setAnswer] = useState<RenewResultDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setRows(await unwrap(window.api.getContracts(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);

  const choose = (c: ContractRowDto) => { setSel(c); setWage(Math.round((c.salary * 1.1) / 100) * 100); setYears(Math.min(2, c.maxYears)); setAnswer(null); setNotice(null); setError(null); };

  async function send(overWage?: number) {
    if (!sel) return;
    setBusy(true); setError(null);
    try {
      const w = Math.round(overWage ?? wage);
      if (overWage !== undefined) setWage(w);
      const r = await unwrap(window.api.renewContract(profileId, careerId, { playerId: sel.id, wage: w, years }));
      setAnswer(r);
      if (r.outcome === 'accepted') { setNotice(r.message); setSel(null); await load(); await onChanged(); }
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!rows) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando contratos…</p>;
  const expiring = rows.filter((r) => r.expiresThisSeason).length;

  return (
    <div className="grid1">
      <section className="card">
        <p>{rows.length} jogadores · <strong className={expiring ? 'neg' : 'pos'}>{expiring} contrato(s) vencem na próxima virada (1º/jul)</strong></p>
        <p className="muted small">Contratos não são renovados automaticamente: quem não renovar sai de graça na virada de temporada. A renovação só é possível com até 24 meses restantes;
          o novo contrato conta a partir do fim do atual e sempre termina em 30/jun. Veteranos aceitam menos temporadas.</p>
        {notice && <p className="ok" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {sel && (
        <section className="card offer">
          <h2>Renovar com {sel.name}</h2>
          <p className="muted small">{posLabel(sel.position)} · {sel.age} anos · força {sel.overall} · salário atual {fmtNum(sel.salary)}/mês · contrato até {fmtDate(sel.contractEnd)} · aceita até {sel.maxYears} temporada(s)</p>
          <div className="row">
            <label>Novo salário (por mês)<input type="number" min={1} value={wage} onChange={(e) => setWage(Number(e.target.value))} /></label>
            <YearsPicker label="Temporadas a mais" value={years} max={sel.maxYears} onChange={setYears} />
            <span>Novo contrato até <strong>{fmtDate(`${sel.renewBaseYear + years}-06-30`)}</strong></span>
            <button disabled={busy} onClick={() => void send()}>Propor renovação</button>
            <button className="secondary" onClick={() => { setSel(null); setAnswer(null); }}>Cancelar</button>
          </div>
          {answer && answer.outcome !== 'accepted' && (
            <div className={answer.outcome === 'counter' ? 'notice' : 'error'} role="status">
              <p>{answer.message}</p>
              {answer.outcome === 'counter' && <button disabled={busy} onClick={() => void send(answer.counterWage)}>Aceitar salário pedido</button>}
            </div>
          )}
        </section>
      )}

      <section className="card scroll tall">
        <table>
          <thead><tr><th>Pos.</th><th>Jogador</th><th>Idade</th><th>Força</th><th className="right">Salário</th><th>Contrato até</th><th>Meses</th><th /></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id} className={c.expiresThisSeason ? 'expiring' : sel?.id === c.id ? 'mine' : ''}>
              <td><PosPill pos={c.position} /></td><td>{c.name}</td><td>{c.age}</td><td>{c.overall}</td><td className="right">{fmtNum(c.salary)}</td><td>{fmtDate(c.contractEnd)}</td><td>{c.monthsLeft}</td>
              <td><button className="secondary" disabled={!c.canRenew || busy} title={c.canRenew ? '' : 'Só com até 24 meses restantes de contrato'} onClick={() => choose(c)}>Renovar</button></td>
            </tr>))}</tbody>
        </table>
      </section>
    </div>
  );
}
