import { useEffect, useState } from 'react';
import { Activity, Bandage, CalendarClock, HeartPulse, Info, ShieldCheck, Stethoscope, TriangleAlert } from 'lucide-react';
import type { MedicalOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, unwrap } from '../util.ts';
import { PlayerFace, PosPill } from '../playerUi.tsx';
import { HelpButton } from '../helpDialog.tsx';
import { useImages } from '../images.ts';

interface Props { profileId: string; careerId: string; refreshKey: string; onOpenPlayer: (id: string) => void }
const INTENSITY_LABEL = { light: 'leve', normal: 'normal', hard: 'forte' } as const;
/** risco diário de lesão no treino (em %): faixa de cor */
const riskTone = (r: number) => (r >= 0.15 ? 'poor' : r >= 0.08 ? 'avg' : 'good');
const backTone = (days: number) => (days <= 7 ? 'good' : days <= 21 ? 'avg' : 'poor');

function Meter({ label, value, low, mid }: { label: string; value: number; low: number; mid: number }) {
  return (
    <span className="md-meter" title={`${label}: ${value}`}>
      <span className="md-meter-label">{label}</span>
      <span className="tn-track"><i className={value < low ? 'low' : value < mid ? 'mid' : ''} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>
      <b>{value}</b>
    </span>
  );
}

export function MedicalView({ profileId, careerId, refreshKey, onOpenPlayer }: Props) {
  const [ov, setOv] = useState<MedicalOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const img = useImages();
  useEffect(() => { unwrap(window.api.getMedical(profileId, careerId)).then(setOv, (e) => setError(errMsg(e))); }, [profileId, careerId, refreshKey]);
  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando departamento médico…</p>;
  const pct = Math.round((ov.recoveryFactor - 1) * 100);

  return (
    <div className="md">
      <section className="card md-top">
        <div className="md-kpis">
          <div><Stethoscope size={16} aria-hidden="true" /><b>{ov.doctor ? ov.doctor.name : 'Nenhum'}</b><span>{ov.doctor ? `Médico · qualidade ${ov.doctor.ability}/20` : 'Médico (contrate na Comissão técnica)'}</span></div>
          <div><HeartPulse size={16} aria-hidden="true" /><b>Nível {ov.medicalLevel}</b><span>Departamento médico</span></div>
          <div><CalendarClock size={16} aria-hidden="true" /><b className={pct <= 0 ? 'pos' : 'neg'}>{pct > 0 ? `+${pct}` : pct}%</b><span>Tempo de lesão</span></div>
          <div><Activity size={16} aria-hidden="true" /><b>{ov.nextSession}</b><span>Próximo treino · intensidade {INTENSITY_LABEL[ov.intensity]}</span></div>
        </div>
        <HelpButton title="Departamento médico">
          <p>Lesões de jogo e de treino duram menos com um bom médico e um departamento médico de nível mais alto (Infraestrutura).</p>
          <p>O risco de lesão no treino depende da sessão (folga, recuperação e dia de jogo não têm risco), da intensidade, da condição (abaixo de 70%
            dobra), da carga de jogos dos últimos dias (acima de 20 aumenta) e do preparador físico, que reduz.</p>
          <p>Quem volta de lesão volta com condição de até 60% e com o ritmo de jogo mais baixo (cai 3 pontos por dia lesionado).</p>
          <p>“Em risco” lista quem tem algum motivo: condição abaixo de 75%, carga alta, ritmo abaixo de 50 ou veterano cansado. Com um preparador
            físico contratado, cada um vem com a recomendação dele.</p>
        </HelpButton>
      </section>

      <div className="md-grid">
        <section className="card md-col">
          <header className="md-colhead"><span className="md-ic md-ic-inj"><Bandage size={16} aria-hidden="true" /></span><h2>Lesionados</h2><span className="md-count">{ov.injured.length}</span></header>
          {ov.injured.length === 0 ? (
            <div className="md-empty"><ShieldCheck size={28} aria-hidden="true" /><p>Ninguém lesionado.</p></div>
          ) : (
            <ul className="md-list">
              {ov.injured.map((p) => (
                <li key={p.id} className="md-item">
                  <PlayerFace img={img} id={p.id} name={p.name} className="tr-avatar" />
                  <div className="md-main">
                    <span className="md-name"><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button><PosPill pos={p.position} /></span>
                    <span className="muted small">{p.note}</span>
                  </div>
                  <div className="md-side">
                    <span className={`inf-pill ${backTone(p.daysLeft)}`}>{p.daysLeft === 1 ? '1 dia' : `${p.daysLeft} dias`}</span>
                    <span className="muted small">volta {fmtDate(p.until)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card md-col">
          <header className="md-colhead"><span className="md-ic md-ic-risk"><TriangleAlert size={16} aria-hidden="true" /></span><h2>Em risco</h2><span className="md-count">{ov.atRisk.length}</span>
            <span className="muted small md-colnote">risco de lesão no treino de amanhã</span></header>
          {ov.atRisk.length === 0 ? (
            <div className="md-empty"><ShieldCheck size={28} aria-hidden="true" /><p>Ninguém em risco: condição, carga e ritmo de jogo em ordem.</p></div>
          ) : (
            <ul className="md-list">
              {ov.atRisk.map((p) => (
                <li key={p.id} className="md-item md-item-risk">
                  <PlayerFace img={img} id={p.id} name={p.name} className="tr-avatar" />
                  <div className="md-main">
                    <span className="md-name"><button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button><PosPill pos={p.position} /></span>
                    <span className="md-meters">
                      <Meter label="Condição" value={p.condition} low={75} mid={88} />
                      <Meter label="Ritmo" value={p.sharpness} low={50} mid={75} />
                      <span className="md-meter"><span className="md-meter-label">Carga</span><b className={p.acuteLoad > 20 ? 'neg' : ''}>{p.acuteLoad.toLocaleString('pt-BR')}</b></span>
                    </span>
                    <span className="md-chips">{p.reasons.map((r) => <span key={r} className="md-chip">{r}</span>)}</span>
                    {p.advice && <span className="md-advice"><Info size={13} aria-hidden="true" />{p.advice}</span>}
                  </div>
                  <div className="md-side">
                    <span className={`inf-pill ${riskTone(p.dailyRisk)}`}>{p.dailyRisk.toLocaleString('pt-BR')}%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!ov.fitnessCoach && ov.atRisk.length > 0 && <p className="muted small md-foot">Com um preparador físico contratado, cada jogador em risco vem com a recomendação dele.</p>}
        </section>
      </div>
    </div>
  );
}
