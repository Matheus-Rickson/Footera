import { useEffect, useState } from 'react';
import type { MedicalOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, unwrap } from '../util.ts';
import { PosPill } from '../playerUi.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onOpenPlayer: (id: string) => void }
const INTENSITY_LABEL = { light: 'leve', normal: 'normal', hard: 'forte' } as const;

export function MedicalView({ profileId, careerId, refreshKey, onOpenPlayer }: Props) {
  const [ov, setOv] = useState<MedicalOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { unwrap(window.api.getMedical(profileId, careerId)).then(setOv, (e) => setError(errMsg(e))); }, [profileId, careerId, refreshKey]);
  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando departamento médico…</p>;
  const pct = Math.round((ov.recoveryFactor - 1) * 100);
  return (
    <div className="grid1">
      <section className="card">
        <p>Médico: <strong>{ov.doctor ? `${ov.doctor.name} (qualidade ${ov.doctor.ability}/20)` : 'nenhum contratado'}</strong> · departamento médico nível <strong>{ov.medicalLevel}</strong> ·
          tempo de lesão <strong className={pct <= 0 ? 'pos' : 'neg'}>{pct > 0 ? `+${pct}` : pct}%</strong> · treino {INTENSITY_LABEL[ov.intensity]}</p>
        <p className="muted small">Lesões de jogo e de treino duram menos com um bom médico e um departamento médico melhor. Jogadores cansados (condição abaixo de 70%) têm o dobro de risco
          de se lesionar no treino; treino forte aumenta o risco e o preparador físico o reduz. Quem volta de lesão volta sem ritmo (condição de até 60%) e recupera aos poucos.</p>
      </section>
      <div className="grid2">
        <section className="card">
          <h2>Lesionados ({ov.injured.length})</h2>
          {ov.injured.length === 0 ? <p className="muted">Ninguém lesionado.</p> : (
            <table><thead><tr><th>Jogador</th><th>Pos.</th><th>Lesão</th><th>Volta em</th></tr></thead>
              <tbody>{ov.injured.map((p) => <tr key={p.id}><td><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button></td><td><PosPill pos={p.position} /></td><td className="muted">{p.note}</td><td>{fmtDate(p.until)} ({p.daysLeft} dia(s))</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="card">
          <h2>Em risco ({ov.atRisk.length})</h2>
          {ov.atRisk.length === 0 ? <p className="muted">Ninguém abaixo de 70% de condição.</p> : (
            <table><thead><tr><th>Jogador</th><th>Pos.</th><th>Condição</th><th>Risco no treino</th></tr></thead>
              <tbody>{ov.atRisk.map((p) => <tr key={p.id}><td><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button></td><td><PosPill pos={p.position} /></td><td className="neg">{p.condition}%</td><td>{p.dailyRisk}% por dia</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
    </div>
  );
}
