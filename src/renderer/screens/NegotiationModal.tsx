import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleCheck, X } from 'lucide-react';
import type { NegotiationDto, OfferResultDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';
import { fmtRange, initials, PlayerFlags, PosPill } from '../playerUi.tsx';
import { KnowledgeBar } from './ScoutingView.tsx';
import { YearsPicker } from './YearsPicker.tsx';

interface Props {
  profileId: string; careerId: string; playerId: string;
  onClose: () => void; onOpenPlayer: (id: string) => void;
  /** chamada depois de uma contratação concluída (atualiza caixa, elenco e listas) */ onSigned: () => Promise<void>;
}
type Step = 'fee' | 'contract' | 'signed';
type Answer = { kind: 'ok' | 'notice' | 'error'; text: string; action?: { label: string; run: () => void } } | null;

const level = (v: number) => (v >= 67 ? 'Alta' : v >= 40 ? 'Média' : 'Baixa');
const roundWage = (n: number) => Math.max(100, Math.round(n / 100) * 100);

/** Barra 0..100 com rótulo qualitativo (Alta/Média/Baixa) e explicação no tooltip. */
function Gauge({ label, value, hint }: { label: string; value: number; hint: string }) {
  const cls = value >= 67 ? 'good' : value >= 40 ? 'avg' : 'poor';
  return (
    <div className="neg-row" title={hint}>
      <span>{label}</span>
      <span className="neg-gauge"><span className="pf-track"><i className={cls} style={{ width: `${value}%` }} /></span><b className={cls}>{level(value)}</b></span>
    </div>
  );
}

export function NegotiationModal({ profileId, careerId, playerId, onClose, onOpenPlayer, onSigned }: Props) {
  const [n, setN] = useState<NegotiationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('fee');
  const [fee, setFee] = useState(0);
  const [agreedFee, setAgreedFee] = useState<number | null>(null);
  const [wage, setWage] = useState(0);
  const [years, setYears] = useState(3);
  const [answer, setAnswer] = useState<Answer>(null);
  const [busy, setBusy] = useState(false);
  const [signedText, setSignedText] = useState('');
  const firstField = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await unwrap(window.api.getNegotiation(profileId, careerId, playerId));
    setN(d); setFee(d.player.marketValue); setWage(roundWage(d.player.salary * 1.2)); setStep(d.player.clubId ? 'fee' : 'contract');
  }, [profileId, careerId, playerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load]);
  useEffect(() => { firstField.current?.focus(); }, [n, step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function run(fn: () => Promise<void>) { setBusy(true); setAnswer(null); try { await fn(); } catch (e) { setAnswer({ kind: 'error', text: errMsg(e) }); } finally { setBusy(false); } }

  const offerFee = (value: number) => run(async () => {
    setFee(value);
    const r = await unwrap(window.api.proposeFee(profileId, careerId, playerId, Math.round(value)));
    if (r.outcome === 'accepted') { setAgreedFee(Math.round(value)); setStep('contract'); setAnswer({ kind: 'ok', text: r.message }); }
    else if (r.outcome === 'club_counter') setAnswer({ kind: 'notice', text: r.message, action: { label: `Aceitar ${fmtNum(r.counterFee!)}`, run: () => void offerFee(r.counterFee!) } });
    else setAnswer({ kind: 'error', text: r.message });
  });

  const offerContract = (w: number) => run(async () => {
    setWage(w);
    const r: OfferResultDto = await unwrap(window.api.makeOffer(profileId, careerId, { playerId, fee: agreedFee ?? 0, wage: Math.round(w), years }));
    if (r.outcome === 'completed') { setSignedText(r.message); setStep('signed'); await onSigned(); return; }
    if (r.outcome === 'player_counter') { setAnswer({ kind: 'notice', text: r.message, action: { label: `Aceitar ${fmtNum(r.counterWage!)}/mês`, run: () => void offerContract(r.counterWage!) } }); return; }
    if (r.outcome === 'club_counter' || r.outcome === 'club_rejected') { setAgreedFee(null); setStep('fee'); }
    setAnswer({ kind: 'error', text: r.message });
  });

  const p = n?.player;
  const steps: Array<[Step, string]> = [['fee', 'Proposta'], ['contract', 'Contrato'], ['signed', 'Assinatura']];
  const stepIdx = steps.findIndex(([s]) => s === step);

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="neg-title">
        <header className="modal-head">
          <h2 id="neg-title">Proposta de transferência</h2>
          {n && <span className="muted small neg-route">{n.sellerName ?? 'Sem clube'} <ArrowRight size={14} aria-hidden="true" /> <strong>{n.buyerName}</strong></span>}
          <button className="secondary icon" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </header>
        {!n || !p ? <div className="modal-body">{error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando…</p>}</div> : (
          <div className="neg-grid">
            <aside className="neg-side">
              <div className="neg-id">
                <div className="tr-avatar" aria-hidden="true">{initials(p.name)}</div>
                <div>
                  <button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button><PlayerFlags p={p} />
                  <div className="row small muted"><span>{p.nationalityName}</span><PosPill pos={p.position} /><span>{p.age} anos</span></div>
                </div>
              </div>
              <dl className="neg-facts">
                <div><dt>Nível (est.)</dt><dd><span className="tr-level">{fmtRange(p.estOverall)}</span></dd></div>
                <div><dt>Potencial (est.)</dt><dd>{fmtRange(p.estPotential)}</dd></div>
                <div><dt>Olheiros</dt><dd><KnowledgeBar value={p.knowledge} /></dd></div>
                <div><dt>Valor de mercado</dt><dd>{fmtNum(p.marketValue)}</dd></div>
                <div><dt>{p.clubId ? 'Salário atual' : 'Pretensão salarial'}</dt><dd>{fmtNum(p.salary)}/mês</dd></div>
                <div><dt>Fim do contrato atual</dt><dd>{p.clubId ? fmtDate(p.contractEnd) : 'Sem contrato'}</dd></div>
              </dl>
            </aside>

            <section className="neg-main">
              <ol className="neg-steps">
                {steps.map(([s, label], i) => (
                  <li key={s} className={i < stepIdx || (s === 'fee' && !p.clubId && step !== 'fee') ? 'done' : i === stepIdx ? 'on' : ''}>
                    <span>{i < stepIdx ? <Check size={12} aria-hidden="true" /> : i + 1}</span>{s === 'fee' && !p.clubId ? 'Sem taxa' : label}
                  </li>
                ))}
              </ol>

              {step === 'fee' && (
                <>
                  {n.clubWillingness !== null && <Gauge label="Disposição do clube" value={n.clubWillingness} hint="Pelo contrato restante, idade do jogador e caixa do clube vendedor. Zero: o clube não pode liberar o jogador sem desfalcar o elenco." />}
                  <Gauge label="Interesse do jogador" value={n.playerInterest} hint="Pelo prestígio do seu clube em relação ao atual. Menos interesse = pede salário maior." />
                  <div className="neg-row"><span>Caixa disponível</span><strong>{fmtNum(n.balance)}</strong></div>
                  {n.transferBudgetRemaining !== null && <div className="neg-row"><span>Orçamento de transferências (restante)</span><strong>{fmtNum(n.transferBudgetRemaining)}</strong></div>}
                  <div className="neg-row"><span>Folha salarial</span><strong>{fmtNum(n.payroll)}/mês</strong></div>
                  <label className="neg-field">Valor da transferência
                    <input ref={firstField} type="number" min={0} step={10000} value={fee} disabled={busy || !n.windowOpen} onChange={(e) => setFee(Number(e.target.value))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && n.windowOpen) void offerFee(fee); }} />
                    <span className="muted small">{fmtNum(Math.round(fee || 0))} · pago de uma vez ao {n.sellerName}</span>
                  </label>
                  {!n.windowOpen && <p className="notice" role="status">A janela de transferências está fechada{n.opensOn ? `: abre em ${fmtDate(n.opensOn)}` : ''}. Jogadores com clube só podem ser contratados nas janelas.</p>}
                </>
              )}

              {step === 'contract' && (
                <>
                  {p.clubId && agreedFee !== null && (
                    <div className="neg-row"><span>Taxa acordada com o {n.sellerName}</span>
                      <span className="row"><strong>{fmtNum(agreedFee)}</strong><button className="link" disabled={busy} onClick={() => { setStep('fee'); setAnswer(null); }}>Alterar</button></span></div>
                  )}
                  {!p.clubId && <p className="muted small">Jogador sem clube: não há taxa de transferência e a contratação vale mesmo fora da janela.</p>}
                  <Gauge label="Interesse do jogador" value={n.playerInterest} hint="Pelo prestígio do seu clube em relação ao atual. Menos interesse = pede salário maior." />
                  <label className="neg-field">Salário mensal
                    <input ref={firstField} type="number" min={1} step={100} value={wage} disabled={busy} onChange={(e) => setWage(Number(e.target.value))}
                      onKeyDown={(e) => { if (e.key === 'Enter') void offerContract(wage); }} />
                    <span className="muted small">{fmtNum(Math.round(wage || 0))}/mês</span>
                  </label>
                  <YearsPicker label="Duração do contrato (temporadas)" value={years} onChange={setYears} />
                  <div className="neg-row"><span>Folha após a contratação</span>
                    <strong className={n.wageCeiling !== null && n.payroll + wage > n.wageCeiling ? 'neg' : ''}>{fmtNum(n.payroll + Math.round(wage || 0))}/mês{n.wageCeiling !== null && <span className="muted"> · teto {fmtNum(n.wageCeiling)}</span>}</strong></div>
                </>
              )}

              {step === 'signed' && (
                <div className="neg-done">
                  <CircleCheck size={40} aria-hidden="true" />
                  <p><strong>{signedText}</strong></p>
                  <p className="muted small">Contrato de {years} temporada(s) · salário {fmtNum(wage)}/mês{agreedFee ? ` · taxa ${fmtNum(agreedFee)}` : ''}.</p>
                </div>
              )}

              {answer && (
                <div className={answer.kind} role="status">
                  <p>{answer.text}</p>
                  {answer.action && <button disabled={busy} onClick={answer.action.run}>{answer.action.label}</button>}
                </div>
              )}
            </section>
          </div>
        )}
        {n && p && (
          <footer className="modal-foot">
            {step === 'signed' ? (
              <><button className="secondary" onClick={() => onOpenPlayer(p.id)}>Ver ficha</button><button onClick={onClose}>Concluir</button></>
            ) : (
              <>
                <button className="secondary" disabled={busy} onClick={onClose}>Cancelar</button>
                {step === 'fee' && <button disabled={busy || !n.windowOpen || !(fee >= 0)} onClick={() => void offerFee(fee)}>Fazer oferta</button>}
                {step === 'contract' && <button disabled={busy || !(wage > 0)} onClick={() => void offerContract(wage)}>Enviar proposta de contrato</button>}
              </>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
