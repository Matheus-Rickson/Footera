import { useCallback, useEffect, useState } from 'react';
import { Briefcase, CheckCircle2, CircleDashed, CircleX, Flag, TrendingUp } from 'lucide-react';
import type { BoardObjectiveDto, BoardOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { Stars } from '../stars.tsx';
import { ClubCrest } from '../flags.tsx';
import { useImages } from '../images.ts';
import { Gauge, LineChart } from '../charts.tsx';
import { HelpButton } from '../helpDialog.tsx';
import { moneyShort } from './FinanceView.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }
const STATUS: Record<BoardObjectiveDto['status'], { label: string; cls: string }> = {
  pending: { label: 'A começar', cls: 'bo-st-pending' }, on_track: { label: 'No caminho', cls: 'bo-st-on' }, close: { label: 'Perto da meta', cls: 'bo-st-close' },
  off_track: { label: 'Fora da meta', cls: 'bo-st-off' }, met: { label: 'Cumprido', cls: 'bo-st-on' }, missed: { label: 'Não cumprido', cls: 'bo-st-off' },
};
const ICON = { met: CheckCircle2, missed: CircleX } as const;
const IMPORTANCE_ORDER: Array<BoardObjectiveDto['importance']> = ['essential', 'important', 'desirable'];
const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function BoardView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [ov, setOv] = useState<BoardOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmJob, setConfirmJob] = useState<number | null>(null);
  const img = useImages();
  const load = useCallback(async () => { setOv(await unwrap(window.api.getBoard(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  async function run(fn: () => Promise<string | null>, refreshAll = false) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); setConfirmJob(null); await load(); if (refreshAll) await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando diretoria…</p>;
  const c = ov.club;

  const offers = (
    <section className="card bo-offers">
      <div className="bo-head"><h2><Briefcase size={16} aria-hidden="true" /> Propostas de emprego ({ov.offers.length})</h2></div>
      {ov.offers.length === 0 ? <p className="muted small">Nenhuma proposta no momento. Clubes que demitem o técnico procuram treinadores com reputação compatível.</p> : (
        <ul className="bo-offer-list">
          {ov.offers.map((o) => (
            <li key={o.id}>
              <div className="bo-offer-info"><strong>{o.clubName}</strong><span className="muted small">{o.league}</span><Stars reputation={o.reputation} /></div>
              <span className="muted small">responder até {fmtDate(o.expires)}</span>
              <div className="row bo-offer-actions">{confirmJob === o.id
                ? <><button disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.respondJobOffer(profileId, careerId, o.id, true)); return `Você é o novo treinador do ${o.clubName}.`; }, true)}>Confirmar troca</button>
                  <button className="secondary" onClick={() => setConfirmJob(null)}>Cancelar</button></>
                : <><button disabled={busy} onClick={() => setConfirmJob(o.id)}>Aceitar</button>
                  <button className="secondary" disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.respondJobOffer(profileId, careerId, o.id, false)); return 'Proposta recusada.'; })}>Recusar</button></>}</div>
            </li>
          ))}
        </ul>
      )}
      {ov.employed && ov.offers.length > 0 && <p className="muted small">Aceitar troca de clube na hora: comissão técnica, olheiros e rotina de treino ficam no clube atual.</p>}
    </section>
  );

  if (!c) {
    return (
      <div className="bo bo-unemployed">
        {notice && <p className="ok" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <p className="notice">Você está <strong>sem clube</strong>. O calendário continua; clubes com vaga fazem propostas conforme a sua reputação (<Stars reputation={ov.coachReputation} />) e a sua licença de treinador. Aceite uma para voltar a trabalhar.</p>
        {offers}
      </div>
    );
  }
  const conf = c.confidence;
  return (
    <div className="bo">
      <section className="card bo-top">
        <ClubCrest id={c.clubId} name={c.name} size={52} src={img.url('clubs', c.clubId)} />
        <div className="bo-top-name">
          <h2>{c.name}</h2>
          {c.profile ? (
            <div className="bo-chips">
              <span className="bo-chip"><Flag size={13} aria-hidden="true" /> Clube {c.profile.sizeLabel.toLowerCase()}</span>
              <span className={`bo-chip bo-phase-${c.profile.phase}`}><TrendingUp size={13} aria-hidden="true" /> {c.profile.phaseLabel}</span>
              <HelpButton title="Tamanho e fase do clube">
                <p><strong>Tamanho: {c.profile.sizeLabel}.</strong> Vem da reputação do clube, da divisão e da posição de reputação no país. Gigantes e grandes têm metas mais altas na liga e nas copas.</p>
                <p><strong>Fase: {c.profile.phaseLabel}.</strong> {c.profile.phaseText}</p>
                <ul>
                  <li><strong>Recém-rebaixado</strong>: o acesso imediato vira essencial.</li>
                  <li><strong>Recém-promovido</strong>: permanência e finanças no azul.</li>
                  <li><strong>Crise financeira</strong>: caixa negativo ou prejuízo previsto acima de 10% da receita; a diretoria pede corte de 10% na folha.</li>
                  <li><strong>Reconstrução</strong>: elenco velho (idade média dos 18 mais fortes ≥ 29,5) ou fraco para a reputação; pede jogos para quem tem até 21 anos.</li>
                  <li><strong>Em ascensão</strong>: terminou a temporada passada 3 ou mais posições acima do esperado.</li>
                </ul>
                <p>Tamanho e fase são definidos no início de cada temporada (ou quando você assume o clube).</p>
              </HelpButton>
            </div>
          ) : <span className="muted small">Classificação do clube disponível a partir da próxima temporada.</span>}
        </div>
        <div className="bo-fans">
          <span className="bo-label">Torcida</span>
          <strong className={c.fans.mood >= 55 ? 'pos' : c.fans.mood >= 40 ? 'notice-text' : 'neg'}>{c.fans.label}</strong>
          <span className="muted small">{c.fans.detail}</span>
        </div>
      </section>

      <section className="card bo-conf">
        <div className="bo-head"><h2>Confiança da diretoria
          <HelpButton title="Confiança da diretoria">
            <ul>
              <li>Cada vitória vale +1,5 e cada derrota −1,5 (−2 para quem tem meta de título ou acesso).</li>
              <li>Todo dia 1º a diretoria compara a posição na liga com a meta (+2 dentro dela, até −6 bem abaixo) e tira 3 se o caixa estiver negativo.</li>
              <li>Abaixo de 25 vem um aviso; chegando a 10 (depois de 6 jogos no cargo) o treinador é demitido.</li>
              <li>Na virada, cada objetivo cumprido ou não soma o peso da sua importância. Falhar na liga com a confiança em 15 ou menos também demite.</li>
            </ul>
          </HelpButton></h2></div>
        <div className="bo-conf-body">
          <Gauge value={conf} max={100} label={c.warning ? 'Cargo ameaçado' : 'de 100'} display={`${Math.round(conf)}`} tone={conf < 25 ? 'bad' : conf < 50 ? 'warn' : 'ok'} />
          {c.confidenceHistory.length >= 2
            ? <LineChart ariaLabel="Confiança da diretoria ao longo do tempo" domain={[0, 100]} format={(v) => String(Math.round(v))} compactLabels
              band={{ from: 0, to: 25, label: 'zona de alerta' }} points={c.confidenceHistory.map((h) => ({ label: dayLabel(h.date), value: h.confidence }))} />
            : <p className="muted small bo-conf-empty">O histórico aparece a partir do dia 1º do próximo mês.</p>}
        </div>
      </section>

      <section className="card bo-obj">
        <div className="bo-head"><h2>Objetivos da temporada
          <HelpButton title="Objetivos da temporada">
            <p>A diretoria define de 4 a 6 objetivos no início da temporada, conforme o tamanho e a fase do clube. Cada um tem uma importância:</p>
            <ul>
              <li><strong>Essencial</strong> (a liga): cumprir dá +15 de confiança, falhar tira 20 (e pode custar o cargo).</li>
              <li><strong>Importante</strong>: +6 ou −8.</li>
              <li><strong>Desejável</strong>: +3 ou −2.</li>
            </ul>
            <p>Objetivos de copa se resolvem quando o clube é eliminado ou chega à fase pedida; os demais são julgados na virada da temporada.</p>
          </HelpButton></h2>
          <span className="muted small">Meta da liga: até {c.objective.target}º · expectativa pelo elenco: {c.objective.expected}º</span></div>
        <div className="bo-obj-list">
          {IMPORTANCE_ORDER.map((imp) => {
            const list = c.objectives.filter((o) => o.importance === imp);
            if (!list.length) return null;
            return (
              <div key={imp} className="bo-obj-group">
                <h3 className="bo-h3">{list[0]!.importanceLabel}</h3>
                {list.map((o) => {
                  const Icon = o.status === 'met' || o.status === 'missed' ? ICON[o.status] : CircleDashed;
                  return (
                    <div key={o.label} className={`bo-objective bo-imp-${o.importance}`}>
                      <Icon size={18} aria-hidden="true" className={STATUS[o.status].cls} />
                      <div className="bo-objective-main">
                        <div className="bo-objective-top"><strong>{o.label}</strong><span className={`bo-st ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span></div>
                        <div className="bo-progress" role="img" aria-label={`Andamento ${Math.round(o.progress * 100)}%`}><i className={STATUS[o.status].cls} style={{ width: `${Math.round(o.progress * 100)}%` }} /></div>
                        <div className="bo-objective-foot"><span className="muted small">{o.detail}</span><span className="small bo-reward"><span className="pos">+{o.reward.met}</span> / <span className="neg">{o.reward.missed}</span></span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {c.objectives.length === 0 && <p className="muted small">{c.objective.label} — meta até {c.objective.target}º.</p>}
        </div>
      </section>

      <section className="card bo-budget">
        <div className="bo-head"><h2>Orçamentos
          <HelpButton title="Orçamentos da diretoria">
            <p>A diretoria barra contratações e renovações que estourem o orçamento de transferências ou o teto salarial, e veta valores fora da realidade do clube (taxa acima de 2× o valor de mercado, salário acima de 2,2× o justo). Vendas devolvem metade da taxa ao orçamento. Obras acima de 30% do caixa precisam de aprovação.</p>
            <p>Cada pedido de aumento pode ser feito uma vez por temporada e depende da confiança (65 ou mais).</p>
          </HelpButton></h2></div>
        {(() => {
          const t = c.budgets.transfer > 0 ? c.budgets.spent / c.budgets.transfer : 0, w = c.budgets.payroll / Math.max(1, c.budgets.wageCeiling);
          return (
            <div className="bo-budget-rows">
              <div className="bo-bar-row">
                <div className="bo-bar-top"><span>Transferências</span><span className="muted small">{moneyShort(c.budgets.spent)} de {moneyShort(c.budgets.transfer)} · restam <strong>{fmtMoney(c.budgets.remaining)}</strong></span></div>
                <div className="bo-progress"><i className={t > 0.9 ? 'bo-st-close' : 'bo-st-on'} style={{ width: `${Math.min(100, t * 100)}%` }} /></div>
              </div>
              <div className="bo-bar-row">
                <div className="bo-bar-top"><span>Folha mensal</span><span className="muted small">{moneyShort(c.budgets.payroll)} de {moneyShort(c.budgets.wageCeiling)}</span></div>
                <div className="bo-progress"><i className={w > 1 ? 'bo-st-off' : w > 0.92 ? 'bo-st-close' : 'bo-st-on'} style={{ width: `${Math.min(100, w * 100)}%` }} /></div>
              </div>
              <div className="row bo-budget-actions">
                <button className="secondary" disabled={busy || !c.requests.transfer} onClick={() => void run(async () => (await unwrap(window.api.requestBudget(profileId, careerId, 'transfer'))).message)}>Pedir mais para transferências</button>
                <button className="secondary" disabled={busy || !c.requests.wage} onClick={() => void run(async () => (await unwrap(window.api.requestBudget(profileId, careerId, 'wage'))).message)}>Pedir aumento do teto</button>
              </div>
            </div>
          );
        })()}
        {notice && <p className="ok small" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {offers}
    </div>
  );
}
