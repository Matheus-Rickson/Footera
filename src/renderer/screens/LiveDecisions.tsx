import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ClipboardList, MessageSquare, X } from 'lucide-react';
import type { LiveMatchDto } from '../../shared/api.ts';
import type { Position } from '../../shared/types.ts';
import { TALK_MESSAGES, TALK_TONES, type TalkTone } from '../../game/match-engine/teamTalk.ts';
import type { LivePlayer } from '../matchLive.ts';
import { POS_NAME, PosPill } from '../playerUi.tsx';

function Modal({ title, icon, onClose, busy, children, foot }: { title: string; icon: ReactNode; onClose: () => void; busy: boolean; children: ReactNode; foot: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);
  return (
    <div className="modal-back">
      <div className="modal lv-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">{icon}<h2>{title}</h2><button className="secondary icon" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={16} aria-hidden="true" /></button></header>
        <div className="modal-body">{children}</div>
        <footer className="modal-foot">{foot}</footer>
      </div>
    </div>
  );
}

/** Intervalo: o técnico escolhe uma fala pronta; a reação (moral) aparece depois de escolher. */
export function TeamTalkModal({ score, side, live, said, busy, error, onSay, onSkip, onSubs, onContinue }: {
  score: [number, number]; side: 0 | 1; live: LiveMatchDto; said: TalkTone | null; busy: boolean; error: string | null;
  onSay: (tone: TalkTone) => void; onSkip: () => void; onSubs: () => void; onContinue: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const diff = score[side] - score[side === 0 ? 1 : 0];
  const situation = diff > 0 ? `vencendo por ${diff}` : diff < 0 ? `perdendo por ${-diff}` : 'empatando';
  const reactions = Object.entries(live.morale).map(([id, m]) => ({ id, ...m }));
  const up = reactions.filter((x) => x.delta > 0).length, down = reactions.filter((x) => x.delta < 0).length, same = reactions.length - up - down;
  const avg = reactions.length ? reactions.reduce((s, x) => s + x.delta, 0) / reactions.length : 0;
  const msg = TALK_MESSAGES.find((m) => m.id === pick);
  return (
    <Modal title="Vestiário — intervalo" icon={<MessageSquare size={18} aria-hidden="true" />} busy={busy} onClose={onContinue}
      foot={said ? <><button className="secondary" disabled={busy} onClick={onSubs}><ArrowLeftRight size={15} aria-hidden="true" />Substituições</button><button disabled={busy} onClick={onContinue}>Voltar ao jogo</button></>
        : <><button className="secondary" disabled={busy} onClick={onSkip}>Não falar nada</button><button className="secondary" disabled={busy} onClick={onSubs}><ArrowLeftRight size={15} aria-hidden="true" />Substituições</button>
          <button disabled={busy || !msg} onClick={() => msg && onSay(msg.tone)}>Falar com o elenco</button></>}>
      <p className="muted">Seu time vai para o intervalo <strong>{situation}</strong> ({score[0]} x {score[1]}). O que você diz ao grupo mexe na moral de todos os relacionados <strong>só nesta partida</strong> (no 2º tempo); não fica para os próximos jogos.</p>
      {!said ? (
        <div className="lv-tones">
          {(Object.keys(TALK_TONES) as TalkTone[]).map((tone) => (
            <div key={tone} className="lv-tone">
              <h3>{TALK_TONES[tone].label}</h3>
              <p className="muted small">{TALK_TONES[tone].hint}</p>
              {TALK_MESSAGES.filter((m) => m.tone === tone).map((m) => (
                <button key={m.id} className={`lv-msg ${pick === m.id ? 'on' : ''}`} aria-pressed={pick === m.id} disabled={busy} onClick={() => setPick(m.id)}>“{m.text}”</button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="lv-result">
          <p><strong>Você decidiu {TALK_TONES[said].label.toLowerCase()} o elenco.</strong></p>
          <div className="lv-react">
            <span className="great">{up} motivado(s)</span><span className="muted">{same} indiferente(s)</span><span className="poor">{down} abalado(s)</span>
          </div>
          <p className="muted small">Variação média de moral: <strong className={avg > 0 ? 'great' : avg < 0 ? 'poor' : ''}>{avg > 0 ? '+' : ''}{avg.toFixed(1).replace('.', ',')}</strong> ponto(s).</p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>
  );
}

/** Substituições do técnico: escolha quem sai (em campo) e quem entra (banco). */
export function SubsModal({ onPitch, bench, used, max, reason, busy, error, onConfirm, onClose }: {
  onPitch: LivePlayer[]; bench: LiveMatchDto['bench']; used: number; max: number; reason: string | null; busy: boolean; error: string | null;
  onConfirm: (out: string, inn: string) => void; onClose: () => void;
}) {
  const [out, setOut] = useState<string | null>(null);
  const [inn, setInn] = useState<string | null>(null);
  const left = max - used;
  const outP = onPitch.find((p) => p.id === out), inP = bench.find((p) => p.id === inn);
  const offPosition = outP && inP && inP.position !== outP.slot ? `${inP.name} é ${POS_NAME[inP.position].toLowerCase()} e vai jogar como ${POS_NAME[outP.slot].toLowerCase()}: fora da posição natural, rende menos.` : null;
  return (
    <Modal title="Substituições" icon={<ArrowLeftRight size={18} aria-hidden="true" />} busy={busy} onClose={onClose}
      foot={<><button className="secondary" disabled={busy} onClick={onClose}>Voltar ao jogo</button>
        <button disabled={busy || !out || !inn || left <= 0} onClick={() => { if (out && inn) { onConfirm(out, inn); setOut(null); setInn(null); } }}>Confirmar substituição</button></>}>
      {reason && <p className="notice" role="status">{reason}</p>}
      <p className="muted small">{left > 0 ? `Restam ${left} de ${max} substituições.` : 'O time já fez todas as substituições permitidas.'} Quem entra assume a posição de quem sai.</p>
      <div className="lv-subs">
        <div>
          <h3>Sai (em campo)</h3>
          {onPitch.map((p) => (
            <button key={p.id} className={`lv-pick ${out === p.id ? 'on' : ''}`} aria-pressed={out === p.id} disabled={busy || left <= 0} onClick={() => setOut(p.id)}>
              <PosPill pos={p.slot} /><span className="lv-pick-name">{p.name}</span>
              <span className="muted small">{p.condition !== null ? `${Math.round(p.condition)}%` : ''}{p.rating !== null ? ` · nota ${p.rating.toFixed(1)}` : ''}{p.yellow ? ' · amarelo' : ''}{p.injured ? ' · lesionado' : ''}</span>
            </button>
          ))}
        </div>
        <div>
          <h3>Entra (banco)</h3>
          {bench.length === 0 && <p className="muted small">Ninguém disponível no banco.</p>}
          {bench.map((p) => (
            <button key={p.id} className={`lv-pick ${inn === p.id ? 'on' : ''}`} aria-pressed={inn === p.id} disabled={busy || left <= 0} onClick={() => setInn(p.id)}>
              <PosPill pos={p.position} /><span className="lv-pick-name">{p.name}</span><span className="muted small">força {p.overall} · {p.condition}%</span>
            </button>
          ))}
        </div>
      </div>
      {offPosition && <p className="notice" role="status">{offPosition}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>
  );
}

type Suggestion = LiveMatchDto['suggestions'][number];
const KIND_LABEL: Record<Suggestion['kind'], string> = { injury: 'Lesão', goalkeeper: 'Sem goleiro', chase: 'Buscar o resultado', protect: 'Segurar o resultado', fresh: 'Cansaço / rendimento' };

/** O auxiliar indica trocas (com a justificativa); o técnico aceita, escolhe outra ou recusa. */
export function AssistantModal({ items, names, positions, busy, error, left, onAccept, onOther, onClose }: {
  items: Suggestion[]; names: Map<string, string>; positions: Map<string, Position>; busy: boolean; error: string | null; left: number;
  onAccept: (s: Suggestion) => Promise<boolean>; onOther: () => void; onClose: () => void;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const key = (s: Suggestion) => `${s.out}:${s.in}`;
  return (
    <Modal title="Sugestão do auxiliar" icon={<ClipboardList size={18} aria-hidden="true" />} busy={busy} onClose={onClose}
      foot={<><button className="secondary" disabled={busy} onClick={onOther}><ArrowLeftRight size={15} aria-hidden="true" />Escolher outra troca</button>
        <button disabled={busy} onClick={onClose}>{done.size ? 'Voltar ao jogo' : 'Agora não'}</button></>}>
      <p className="muted small">Seu auxiliar analisou o jogo e indica {items.length === 1 ? 'esta troca' : 'estas trocas'}. A decisão é sua. Restam {left} substituição(ões).</p>
      <div className="lv-suggest">
        {items.map((s) => {
          const isDone = done.has(key(s));
          const outPos = positions.get(s.out);
          return (
            <div key={key(s)} className={`lv-sg ${isDone ? 'done' : ''}`}>
              <div className="lv-sg-head">
                <span className="lv-sg-kind">{KIND_LABEL[s.kind]}</span>
                <span className="lv-sg-swap">{outPos && <PosPill pos={outPos} />}<span className="lv-out">{names.get(s.out) ?? 'Jogador'}</span>
                  <ArrowLeftRight size={14} aria-hidden="true" /><PosPill pos={s.slot} /><span className="lv-in">{names.get(s.in) ?? 'Jogador'}</span></span>
              </div>
              <p className="lv-sg-why">“{s.reason}”</p>
              {s.reshape && (s.reshape.to !== s.reshape.from || s.reshape.changes.length > 0) && (
                <div className="lv-sg-shape">
                  <strong>{s.reshape.to !== s.reshape.from ? `Formação: ${s.reshape.from} → ${s.reshape.to}` : `Formação ${s.reshape.to} com ajustes`}</strong>
                  {s.reshape.changes.map((c) => <span key={c.id}>{names.get(c.id) ?? 'Jogador'}: <PosPill pos={c.from} /> → <PosPill pos={c.to} /></span>)}
                </div>
              )}
              <button disabled={busy || isDone || left <= 0} onClick={() => void onAccept(s).then((ok) => { if (ok) setDone((d) => new Set(d).add(key(s))); })}>{isDone ? 'Troca feita' : s.reshape && s.reshape.to !== s.reshape.from ? 'Fazer a troca e mudar a formação' : 'Fazer esta troca'}</button>
            </div>
          );
        })}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>
  );
}
