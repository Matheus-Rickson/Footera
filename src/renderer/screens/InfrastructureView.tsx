import { useCallback, useEffect, useState } from 'react';
import type { FacilityKind, InfrastructureOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }

export function InfrastructureView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [ov, setOv] = useState<InfrastructureOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<FacilityKind | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getInfrastructure(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);

  async function build(kind: FacilityKind) {
    setBusy(true); setError(null);
    try { await unwrap(window.api.startUpgrade(profileId, careerId, kind)); setConfirm(null); await load(); await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando infraestrutura…</p>;
  return (
    <div className="grid1">
      <section className="card">
        <p>Caixa: <strong>{fmtNum(ov.balance)}</strong> · estádio com <strong>{fmtNum(ov.capacity)}</strong> lugares</p>
        <p className="muted small">Cada obra sobe um nível (1 a 20), é paga à vista ao encomendar e fica pronta depois do prazo. Só uma obra por vez. Níveis maiores aumentam a manutenção mensal.</p>
        {ov.project && (
          <div className="notice">
            <p>Obra em andamento: <strong>{ov.project.label}</strong> → nível {ov.project.toLevel} · {fmtNum(ov.project.cost)} · {fmtDate(ov.project.start)} a {fmtDate(ov.project.end)}</p>
            <div className="progress"><i style={{ width: `${ov.project.progress}%` }} /></div>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <div className="grid2">
        {ov.facilities.map((f) => (
          <section key={f.kind} className="card">
            <h2>{f.label} <span className="muted">nível {f.level}</span></h2>
            <p className="muted small">Hoje: {f.effect}</p>
            {f.maxed ? <p className="ok">Nível máximo.</p> : (
              <>
                <p className="small">Próximo nível: {f.nextEffect}</p>
                <p className="small">Custo {fmtNum(f.cost!)} · prazo {f.days} dias · manutenção +{fmtNum(f.extraMonthly!)}/mês{f.extraSeats ? ` · +${fmtNum(f.extraSeats)} lugares` : ''}</p>
                {confirm === f.kind
                  ? <div className="row"><button disabled={busy} onClick={() => void build(f.kind)}>Confirmar obra ({fmtNum(f.cost!)})</button><button className="secondary" onClick={() => setConfirm(null)}>Cancelar</button></div>
                  : <button disabled={busy || !!ov.project || ov.balance < f.cost!} title={ov.project ? 'Já há uma obra em andamento' : ov.balance < f.cost! ? 'Caixa insuficiente' : ''} onClick={() => setConfirm(f.kind)}>Encomendar obra</button>}
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
