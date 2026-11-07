import { useEffect, useRef, useState } from 'react';
import { Info, Loader2, Square } from 'lucide-react';
import { addDays } from '../../shared/date.ts';
import type { ContinueStepDto, SimulationSummaryDto } from '../../shared/api.ts';
import { errMsg, fmtWeekday, unwrap } from '../util.ts';

/** Tempo mínimo de cada dia na tela, para dar para ver os dias passando e clicar em "Parar aqui". */
const STEP_MS = 280;
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export interface ContinueOutcome { date: string; stop: ContinueStepDto['stop'] | 'user' | 'target'; message: string; error?: string }

/**
 * Caixa "Avançando o tempo" do botão Continuar: avança dia a dia (`continueDay`) até o jogo do seu clube, uma decisão importante,
 * o fim da temporada, o dia escolhido na faixa de datas ou o clique em "Parar aqui". Jogos de outros clubes passam direto.
 */
export function ContinueBox({ profileId, careerId, startDate, onSimulated, onDone }: {
  profileId: string; careerId: string; startDate: string;
  onSimulated?: (s: SimulationSummaryDto) => void; onDone: (o: ContinueOutcome) => void;
}) {
  const [date, setDate] = useState(startDate);
  const [target, setTarget] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const targetRef = useRef<string | null>(null);
  targetRef.current = target;

  const startedRef = useRef(false), aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    if (startedRef.current) return () => { aliveRef.current = false; }; // um laço só por abertura (mesmo se o efeito rodar de novo)
    startedRef.current = true;
    void (async () => {
      let cur = startDate, last: ContinueOutcome | null = null;
      try {
        for (;;) {
          const t0 = Date.now();
          const step = await unwrap(window.api.continueDay(profileId, careerId));
          if (!aliveRef.current) return;
          if (step.simulation && step.simulation.simulated > 0) onSimulated?.(step.simulation);
          cur = step.date; setDate(cur);
          if (step.stop) { last = { date: cur, stop: step.stop, message: step.message }; break; }
          if (targetRef.current && cur >= targetRef.current) { last = { date: cur, stop: 'target', message: 'Parou no dia escolhido.' }; break; }
          if (stopRef.current) { last = { date: cur, stop: 'user', message: 'Você parou o avanço do tempo.' }; break; }
          const wait = STEP_MS - (Date.now() - t0);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          if (stopRef.current) { last = { date: cur, stop: 'user', message: 'Você parou o avanço do tempo.' }; break; }
        }
      } catch (e) {
        last = { date: cur, stop: null, message: '', error: errMsg(e) };
      }
      if (aliveRef.current && last) onDone(last);
    })();
    return () => { aliveRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const days = [-2, -1, 0, 1, 2].map((d) => addDays(date, d));
  return (
    <div className="ct-back" role="dialog" aria-modal="true" aria-labelledby="ct-title">
      <div className="ct-box">
        <div className="ct-head">
          <Loader2 size={18} className="ct-spin" aria-hidden="true" />
          <div>
            <h2 id="ct-title">Avançando o tempo</h2>
            <span className="ct-date" aria-live="polite">{longDate(date)}</span>
          </div>
        </div>
        <div className="ct-strip">
          {days.map((d) => {
            const now = d === date, future = d > date, chosen = d === target;
            return (
              <button key={d} className={`ct-day ${now ? 'ct-day-now' : ''} ${chosen ? 'ct-day-target' : ''}`} disabled={!future}
                title={future ? (chosen ? 'Desmarcar: não parar neste dia' : 'Parar neste dia') : undefined}
                onClick={() => setTarget((t) => (t === d ? null : d))}>
                <strong>{dayMonth(d)}</strong><span>{fmtWeekday(d)}</span>
              </button>
            );
          })}
        </div>
        <p className="ct-info"><Info size={14} aria-hidden="true" />O tempo para sozinho no dia de jogo do seu time ou se surgir uma decisão importante.{target ? ` Também para em ${dayMonth(target)}.` : ' Clique num dia para parar nele.'}</p>
        <button className="secondary ct-stop" disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); }}>
          <Square size={14} aria-hidden="true" />{stopping ? 'Parando…' : 'Parar aqui'}
        </button>
      </div>
    </div>
  );
}
