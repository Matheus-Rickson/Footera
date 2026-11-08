import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Binoculars, CircleDollarSign, Clock, Dumbbell, Gauge, GraduationCap, Hammer, HeartPulse, Landmark, Target, Ticket, Users } from 'lucide-react';
import type { FacilityKind, InfrastructureOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, fmtNum, unwrap } from '../util.ts';
import { HelpTip } from '../help.tsx';
import { ScoutStaffModal } from './ScoutStaffModal.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void>; onOpenScouting?: () => void }
type Facility = InfrastructureOverviewDto['facilities'][number];

const ICON: Record<FacilityKind, LucideIcon> = { stadium: Landmark, training: Dumbbell, youth: GraduationCap, recruitment: Target, scouting: Binoculars, medical: HeartPulse };

/** Nível 1–20 em 5 barras (cada barra = 4 níveis, enche proporcionalmente). */
function LevelBars({ level, max }: { level: number; max: number }) {
  const per = max / 5;
  return (
    <span className="inf-level" title={`Nível ${level} de ${max}`}>
      <span className="inf-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i}><b style={{ width: `${Math.max(0, Math.min(1, (level - i * per) / per)) * 100}%` }} /></i>)}</span>
      <span className="muted small">Nível {level} de {max}</span>
    </span>
  );
}

export function InfrastructureView({ profileId, careerId, refreshKey, onChanged, onOpenScouting }: Props) {
  const [ov, setOv] = useState<InfrastructureOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<FacilityKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [scouts, setScouts] = useState(false);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getInfrastructure(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);

  async function build(kind: FacilityKind) {
    setBusy(true); setError(null);
    try { await unwrap(window.api.startUpgrade(profileId, careerId, kind)); setConfirm(null); await load(); await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando infraestrutura…</p>;

  const footer = (f: Facility, extra?: React.ReactNode) => {
    const why = f.maxed ? 'Nível máximo' : ov.project ? 'Já há uma obra em andamento (uma por vez)' : ov.balance < f.cost! ? `Caixa insuficiente (${fmtMoney(ov.balance)})` : '';
    return (
      <footer className="inf-foot">
        {confirm === f.kind && !f.maxed ? (
          <div className="inf-confirm">
            <p className="small">Próximo nível: {f.nextEffect}. Manutenção +{fmtMoney(f.extraMonthly!)}/mês{f.extraSeats ? ` · +${fmtNum(f.extraSeats)} lugares` : ''}. Pago à vista; pronto em {f.days} dias.</p>
            <div className="row"><button disabled={busy} onClick={() => void build(f.kind)}>Confirmar obra ({fmtMoney(f.cost!)})</button><button className="secondary" onClick={() => setConfirm(null)}>Cancelar</button></div>
          </div>
        ) : <>
          <span className="inf-cost" title="Custo de expansão (pago à vista)"><CircleDollarSign size={13} aria-hidden="true" />Expansão <b>{f.maxed ? '—' : fmtMoney(f.cost!)}</b></span>
          <span className="inf-cost" title="Prazo para construção"><Clock size={13} aria-hidden="true" /><b>{f.maxed ? 'nível máximo' : `${f.days} dias`}</b></span>
          <span className="inf-actions">{extra}<button className="secondary" disabled={!!why} title={why} onClick={() => setConfirm(f.kind)}>Expandir</button></span>
        </>}
      </footer>
    );
  };

  const card = (f: Facility) => {
    const Icon = ICON[f.kind];
    return (
      <section key={f.kind} className="card inf-card">
        <header className="inf-head"><span className="inf-ic"><Icon size={18} aria-hidden="true" /></span><div><h2>{f.label} <HelpTip text={`Hoje: ${f.effect}.`} size={12} /></h2><LevelBars level={f.level} max={f.maxLevel} /></div></header>
        <dl className="inf-rows">
          <div><dt>Manutenção</dt><dd>{fmtMoney(f.monthly)}<small> / mês</small></dd></div>
          {f.stats.map((s) => <div key={s.label}><dt>{s.label} <HelpTip text={s.help} size={12} /></dt><dd>{s.tone ? <span className={`inf-pill ${s.tone}`}>{s.value}</span> : s.value}</dd></div>)}
        </dl>
        {footer(f, f.kind === 'scouting' ? <button className="secondary" onClick={() => setScouts(true)}>Gerenciar</button> : undefined)}
      </section>
    );
  };

  const stadium = ov.facilities.find((f) => f.kind === 'stadium')!;
  const s = ov.stadium;
  return (
    <div className="grid1">
      {(ov.project || error) && (
        <section className="card inf-banner">
          {ov.project && <div className="inf-proj"><p><Hammer size={15} aria-hidden="true" /> Obra em andamento: <strong>{ov.project.label}</strong> → nível {ov.project.toLevel} · {fmtMoney(ov.project.cost)} · até {fmtDate(ov.project.end)}</p>
            <div className="progress"><i style={{ width: `${ov.project.progress}%` }} /></div><b>{ov.project.progress}%</b></div>}
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      )}
      <div className="inf-grid">
        <section className="card inf-card">
          <header className="inf-head"><span className="inf-ic"><Landmark size={18} aria-hidden="true" /></span><div><h2>Estádio <HelpTip text={`Público médio e ocupação contam os jogos em casa da temporada atual (${s.homeGames ? `${s.homeGames} até agora` : 'nenhum ainda'}). Cada ampliação: +5% de lugares e mais manutenção.`} size={12} /></h2><LevelBars level={stadium.level} max={stadium.maxLevel} /></div><span className="inf-name">{s.name}</span></header>
          <dl className="inf-rows">
            <div><dt>Capacidade</dt><dd>{fmtNum(s.capacity)}</dd></div>
            <div><dt>Manutenção</dt><dd>{fmtMoney(s.monthly)}<small> / mês</small></dd></div>
          </dl>
          <div className="inf-tiles">
            <div title={`Jogos em casa da temporada atual: ${s.homeGames}`}><Ticket size={15} aria-hidden="true" /><b>{s.avgAttendance === null ? '—' : fmtNum(s.avgAttendance)}</b><span>Público médio</span></div>
            <div><Gauge size={15} aria-hidden="true" /><b>{s.occupancy === null ? '—' : `${s.occupancy}%`}</b><span>Ocupação média</span></div>
            <div><Users size={15} aria-hidden="true" /><b>{fmtNum(s.fans)}</b><span>Torcedores do clube</span></div>
          </div>
          <dl className="inf-rows">
            <div><dt>Preço médio do ingresso <HelpTip text="Calculado pela reputação do clube e pela economia do país; a bilheteria = público × preço." size={12} /></dt><dd>{fmtMoney(s.ticketPrice)}</dd></div>
            <div><dt>Próxima ampliação</dt><dd>{stadium.extraSeats ? `+${fmtNum(stadium.extraSeats)} lugares` : '—'}</dd></div>
          </dl>
          {footer(stadium)}
        </section>
        {ov.facilities.filter((f) => f.kind !== 'stadium').map(card)}
      </div>
      {scouts && <ScoutStaffModal profileId={profileId} careerId={careerId} onClose={() => setScouts(false)} onChanged={async () => { await load(); await onChanged(); }} onOpenScouting={onOpenScouting} />}
    </div>
  );
}
