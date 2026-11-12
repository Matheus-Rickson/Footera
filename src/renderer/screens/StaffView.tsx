import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ClipboardList, Dumbbell, Gauge, Hand, Stethoscope, UserCheck, Wallet } from 'lucide-react';
import type { AiCoachDto, StaffOverviewDto, StaffRole } from '../../shared/api.ts';
import { nationName } from '../../shared/nations.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { Stars } from '../stars.tsx';
import { HelpTip } from '../help.tsx';
import { HelpButton } from '../helpDialog.tsx';
import { CoachSheet } from '../clubSheet.tsx';
import { Flag, initials } from '../playerUi.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }
type Role = StaffOverviewDto['roles'][number];

const ICON: Record<StaffRole, LucideIcon> = { assistant: ClipboardList, fitness: Dumbbell, goalkeeping: Hand, doctor: Stethoscope };
/** multa da demissão: até 3 meses de salário (STAFF_SEVERANCE_MONTHS) */
const SEVERANCE_MONTHS = 3;

/** Qualidade 1–20 em 5 barras (cada barra = 4 pontos, enche proporcionalmente). */
function Quality({ q, compact = false }: { q: number; compact?: boolean }) {
  return (
    <span className="sf-quality" title={`Qualidade ${q} de 20`}>
      <span className="sf-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i}><b style={{ width: `${Math.max(0, Math.min(1, (q - i * 4) / 4)) * 100}%` }} /></i>)}</span>
      <span className={compact ? 'sf-q' : 'muted small'}>{compact ? q : `Qualidade ${q} de 20`}</span>
    </span>
  );
}
const Nat = ({ code }: { code: string }) => <Flag code={code} name={nationName(code)} />;

export function StaffView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [ov, setOv] = useState<StaffOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<'staff' | 'coaches'>('staff');
  const [coaches, setCoaches] = useState<AiCoachDto[] | null>(null);
  const [coach, setCoach] = useState<string | null>(null);
  const [firing, setFiring] = useState<StaffRole | null>(null);
  useEffect(() => {
    if (show !== 'coaches') return;
    let stale = false;
    unwrap(window.api.listUnemployedCoaches(profileId, careerId)).then((r) => { if (!stale) setCoaches(r); }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [show, profileId, careerId, refreshKey]);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getStaff(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  async function run(fn: () => Promise<string>, money = false) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); setFiring(null); await load(); if (money) await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  const filter = (
    <div className="mf-seg" role="radiogroup" aria-label="Mostrar">
      {([['staff', 'Comissão do clube'], ['coaches', 'Técnicos sem clube']] as const).map(([v, l]) => (
        <button key={v} role="radio" aria-checked={show === v} className={show === v ? 'on' : ''} onClick={() => setShow(v)}>{l}</button>))}
    </div>
  );

  if (show === 'coaches') return (
    <div className="sf">
      <section className="card sf-top">{filter}</section>
      <section className="card sf-coaches">
        <h2>Técnicos sem clube <HelpTip text="Técnicos desempregados do universo. Quando um clube demite o técnico, a vaga fica aberta por até 30 dias (período em que pode chegar proposta para você) e depois é preenchida por um destes, de reputação compatível com a do clube. Sem clube, perdem um pouco de reputação a cada temporada; aos 70 anos se aposentam." /></h2>
        {error && <p className="error" role="alert">{error}</p>}
        {!coaches ? <p className="muted">Carregando técnicos…</p> : coaches.length === 0 ? <p className="muted">Nenhum técnico sem clube no momento.</p> : (
          <table><thead><tr><th>Técnico</th><th>Idade</th><th>Nacionalidade</th><th>Reputação</th></tr></thead>
            <tbody>{coaches.map((c) => (
              <tr key={c.id}><td><button className="link" onClick={() => setCoach(c.id)}>{c.name}</button></td><td>{c.age}</td><td><Nat code={c.nationality} /></td><td><Stars reputation={c.reputation} /></td></tr>))}</tbody></table>
        )}
      </section>
      {coach && <CoachSheet profileId={profileId} careerId={careerId} coachId={coach} onClose={() => setCoach(null)} />}
    </div>
  );

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando comissão técnica…</p>;
  const hired = ov.roles.filter((r) => r.member);
  const avgQ = Math.round(ov.roles.reduce((s, r) => s + r.quality, 0) / ov.roles.length);

  const card = (r: Role) => {
    const Icon = ICON[r.role];
    const m = r.member;
    return (
      <section key={r.role} className="card sf-card">
        <header className="sf-head">
          <span className="sf-ic"><Icon size={18} aria-hidden="true" /></span>
          <div><h2>{r.label}</h2><Quality q={r.quality} /></div>
          <span className={`sf-status ${m ? 'on' : 'off'}`}>{m ? 'Contratado' : 'Vaga aberta'}</span>
        </header>
        {m ? (
          <div className="sf-person">
            <span className="sf-avatar" aria-hidden="true">{initials(m.name)}</span>
            <div className="sf-who"><strong>{m.name}</strong><span className="muted small"><Nat code={m.nationality} /> · contrato até {fmtDate(m.contractEnd)}</span></div>
            <div className="sf-salary"><b>{fmtMoney(m.salary)}</b><span>por mês</span></div>
          </div>
        ) : <p className="sf-vacant">Sem ninguém na função, ela rende como um profissional de qualidade {ov.unstaffedQuality}.</p>}
        <dl className="sf-rows">
          {r.effects.map((e) => <div key={e.label}><dt>{e.label}</dt><dd>{e.value}</dd></div>)}
        </dl>
        {m ? (
          <footer className="sf-foot">
            {firing === r.role ? (
              <div className="sf-confirm">
                <p className="small">Demitir {m.name}? A multa é de até {SEVERANCE_MONTHS} meses de salário (até {fmtMoney(SEVERANCE_MONTHS * m.salary)}), conforme o tempo de contrato que resta.</p>
                <div className="row">
                  <button className="danger" disabled={busy} onClick={() => void run(async () => `${m.name} demitido. Multa paga: ${fmtMoney(await unwrap(window.api.fireStaff(profileId, careerId, m.id)))}.`, true)}>Confirmar demissão</button>
                  <button className="secondary" onClick={() => setFiring(null)}>Cancelar</button>
                </div>
              </div>
            ) : <button className="secondary sf-fire" disabled={busy} onClick={() => setFiring(r.role)}>Demitir</button>}
          </footer>
        ) : (
          <div className="sf-cands">
            <span className="sf-cands-title">Candidatos deste mês</span>
            {r.candidates.length === 0 ? <p className="muted small">Nenhum candidato disponível neste mês.</p>
              : [...r.candidates].sort((a, b) => b.ability - a.ability).map((c) => (
                <div key={c.id} className="sf-cand">
                  <span className="sf-avatar sf-avatar-sm" aria-hidden="true">{initials(c.name)}</span>
                  <span className="sf-who"><strong>{c.name}</strong><span className="muted small"><Nat code={c.nationality} /></span></span>
                  <Quality q={c.ability} compact />
                  <span className="sf-cand-salary">{fmtMoney(c.salary)}<small>/mês</small></span>
                  <button disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.hireStaff(profileId, careerId, c.id)); return `${c.name} contratado como ${r.label.toLowerCase()}.`; })}>Contratar</button>
                </div>
              ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="sf">
      <section className="card sf-top">
        {filter}
        <div className="sf-kpis">
          <div><Wallet size={16} aria-hidden="true" /><b>{fmtMoney(ov.monthlyCost)}</b><span>Custo mensal</span></div>
          <div><UserCheck size={16} aria-hidden="true" /><b>{hired.length} de {ov.roles.length}</b><span>Funções ocupadas</span></div>
          <div><Gauge size={16} aria-hidden="true" /><b>{avgQ}/20</b><span>Qualidade média</span></div>
        </div>
        <HelpButton title="Comissão técnica">
          <p>Um profissional por função. Sem alguém contratado, a função rende como um profissional de qualidade {ov.unstaffedQuality}.</p>
          <p>Os salários entram nas Finanças no dia 1º. Demitir paga até {SEVERANCE_MONTHS} meses de salário de multa. Os candidatos mudam no dia 1º de cada mês;
            os contratos são de 2 anos.</p>
          <ul>{ov.roles.map((r) => <li key={r.role}><strong>{r.label}</strong>: {r.effect}.</li>)}</ul>
        </HelpButton>
      </section>
      {(notice || error) && (
        <div className="sf-msgs">
          {notice && <p className="ok" role="status">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
      <div className="sf-grid">{ov.roles.map(card)}</div>
    </div>
  );
}
