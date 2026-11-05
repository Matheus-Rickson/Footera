import { useCallback, useEffect, useState } from 'react';
import type { Intensity, TrainingFocus, TrainingOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, unwrap } from '../util.ts';
import { PosPill, to20 } from '../playerUi.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onOpenPlayer: (id: string) => void }
export const FOCUS_LABEL: Record<TrainingFocus, string> = {
  balanced: 'Equilibrado', finishing: 'Finalização', creation: 'Criação', defense: 'Defesa', physical: 'Físico', technical: 'Técnica', goalkeeping: 'Goleiro',
};
const INTENSITY_LABEL: Record<Intensity, string> = { light: 'Leve', normal: 'Normal', hard: 'Forte' };
const pct = (x: number) => `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`;

export function TrainingView({ profileId, careerId, refreshKey, onOpenPlayer }: Props) {
  const [ov, setOv] = useState<TrainingOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getTraining(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  async function run(fn: () => Promise<unknown>) { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando treinamento…</p>;
  const locked = ov.delegated;

  return (
    <div className="grid1">
      <section className="card">
        <h2>Rotina de treino</h2>
        <p className="muted small">Os jogadores evoluem um pouco todo dia 1º do mês, conforme a idade, o potencial, os minutos jogados, a intensidade, o foco individual,
          a comissão técnica e o centro de treinamento. Você pode montar a rotina ou delegá-la ao preparador físico, que escolhe o melhor foco de cada jogador e ajusta a intensidade toda segunda-feira.</p>
        <div className="row">
          <strong>Quem decide:</strong>
          <button className={locked ? 'secondary' : ''} disabled={busy} onClick={() => void run(() => unwrap(window.api.setDelegated(profileId, careerId, false)))}>Eu (técnico)</button>
          <button className={locked ? '' : 'secondary'} disabled={busy || !ov.hasFitnessCoach} title={ov.hasFitnessCoach ? '' : 'Contrate um preparador físico na aba Comissão técnica'}
            onClick={() => void run(() => unwrap(window.api.setDelegated(profileId, careerId, true)))}>Preparador físico</button>
          {!ov.hasFitnessCoach && <span className="muted small">sem preparador físico contratado</span>}
        </div>
        <div className="row">
          <strong>Intensidade:</strong>
          {(['light', 'normal', 'hard'] as Intensity[]).map((i) => (
            <button key={i} className={ov.intensity === i ? '' : 'secondary'} disabled={busy || locked} onClick={() => void run(() => unwrap(window.api.setIntensity(profileId, careerId, i)))}
              title={`Evolução ${pct(ov.intensityEffects[i].growth)} · recuperação ${ov.intensityEffects[i].recovery}/dia · risco de lesão ×${ov.intensityEffects[i].injury}`}>{INTENSITY_LABEL[i]}</button>
          ))}
          <span className="muted small">Evolução {pct(ov.intensityEffects[ov.intensity].growth)} · recuperação {ov.intensityEffects[ov.intensity].recovery}/dia · risco de lesão no treino ×{ov.intensityEffects[ov.intensity].injury}</span>
        </div>
        {locked && <p className="notice">Treino delegado ao preparador físico: ele define focos e intensidade. Clique em “Eu (técnico)” para retomar o controle.</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="card scroll tall">
        <table>
          <thead><tr><th>Pos.</th><th>Jogador</th><th>Idade</th><th>Força</th><th>Pot. est.</th><th>Na temporada</th><th>Condição</th><th>Foco</th><th>Sugestão do preparador</th></tr></thead>
          <tbody>{ov.players.map((p) => (
            <tr key={p.id}>
              <td><PosPill pos={p.position} /></td><td><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button></td><td>{p.age}</td><td>{to20(p.overall)}</td><td>{to20(p.potentialEstimated)}</td>
              {(() => { const d = to20(p.overall) - to20(p.overall - p.seasonChange); return <td className={d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'}>{d > 0 ? `+${d}` : d}</td>; })()}
              <td>{p.injuredUntil ? <span className="neg">lesionado até {fmtDate(p.injuredUntil)}</span> : `${p.condition}%`}</td>
              <td><select value={p.focus} disabled={busy || locked} onChange={(e) => void run(() => unwrap(window.api.setFocus(profileId, careerId, p.id, e.target.value as TrainingFocus)))}>
                {ov.focuses.map((f) => <option key={f} value={f}>{FOCUS_LABEL[f]}</option>)}</select></td>
              <td className="muted">{FOCUS_LABEL[p.suggestedFocus]}</td>
            </tr>))}</tbody>
        </table>
      </section>
    </div>
  );
}
