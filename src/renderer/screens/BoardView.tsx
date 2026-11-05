import { useCallback, useEffect, useState } from 'react';
import type { BoardOverviewDto, BoardStatus } from '../../shared/api.ts';
import { Plus } from 'lucide-react';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { Stars } from '../stars.tsx';
import { HelpTip } from '../help.tsx';
import { COACH_ATTRS, type CoachAttrKey } from '../../shared/coachAttributes.ts';
import { COACH_ATTR_CAP, COACH_EFFECT } from '../../game/coach-engine/coach.ts';

/** O que cada atributo do treinador faz no jogo (efeito máximo, com o atributo em 20; na base 5 não há efeito). */
const pct = (x: number) => `${Math.round(x * 100)}%`;
const COACH_EFFECT_TEXT: Record<CoachAttrKey, string> = {
  tactics: `Força do time em campo: até +${String(COACH_EFFECT.tactics * 100).replace('.', ',')}% (soma ao entrosamento).`,
  motivation: `Conversa no vestiário: efeito bom até ${pct(COACH_EFFECT.talkBoost)} maior; efeito ruim até ${pct(COACH_EFFECT.talkSoften)} menor.`,
  youth: `Evolução mensal dos jogadores de até 21 anos do seu clube (elenco e base): até +${pct(COACH_EFFECT.youth)}.`,
  discipline: `Chance de cartão (amarelo e vermelho) dos seus jogadores: até −${pct(COACH_EFFECT.cards)}.`,
  negotiation: `Taxa pedida pelos clubes e salário pedido pelos jogadores (contratação e renovação): até −${pct(COACH_EFFECT.negotiation)}.`,
  adaptability: `Quem entra ou muda de posição por decisão sua rende até +${pct(COACH_EFFECT.inGame)}; ao assumir um clube novo, até +${COACH_EFFECT.newClub} de confiança da diretoria.`,
};

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }
const STATUS: Record<BoardStatus, { label: string; cls: string }> = {
  pending: { label: 'a começar', cls: 'muted' }, on_track: { label: 'no caminho', cls: 'pos' }, close: { label: 'perto da meta', cls: 'notice-text' }, off_track: { label: 'fora da meta', cls: 'neg' },
};

export function BoardView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [ov, setOv] = useState<BoardOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmJob, setConfirmJob] = useState<number | null>(null);
  const load = useCallback(async () => { setOv(await unwrap(window.api.getBoard(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);
  async function run(fn: () => Promise<string | null>, refreshAll = false) {
    setBusy(true); setError(null); setNotice(null);
    try { setNotice(await fn()); setConfirmJob(null); await load(); if (refreshAll) await onChanged(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando diretoria…</p>;
  const c = ov.club;

  return (
    <div className="grid1">
      {notice && <p className="ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!ov.employed && <p className="notice">Você está <strong>sem clube</strong>. O calendário continua; clubes com vaga fazem propostas conforme a sua reputação (<Stars reputation={ov.coachReputation} />). Aceite uma para voltar a trabalhar.</p>}

      {c && (
        <div className="grid2">
          <section className="card">
            <h2>Confiança da diretoria — {c.name}</h2>
            <div className="meter"><i className={c.confidence < 25 ? 'low' : c.confidence < 50 ? 'mid' : ''} style={{ width: `${c.confidence}%` }} /></div>
            <p><strong>{Math.round(c.confidence)}</strong>/100 {c.warning && <span className="neg">· cargo ameaçado</span>}</p>
            <p className="muted small">Vitórias sobem e derrotas descem a confiança; todo dia 1º a diretoria compara a posição com a meta e olha o caixa. Abaixo de 25 vem um aviso;
              chegando a 10 (depois de 6 jogos no cargo) o treinador é demitido. Na virada, a temporada é avaliada.</p>
          </section>
          <section className="card">
            <h2>Objetivos da temporada</h2>
            <p><strong>{c.objective.label}</strong> — meta: terminar até o {c.objective.target}º (expectativa pelo elenco: {c.objective.expected}º)</p>
            <p>Hoje: {c.objective.position ? `${c.objective.position}º em ${c.objective.played} jogo(s)` : 'liga ainda não começou'} · <span className={STATUS[c.objective.status].cls}>{STATUS[c.objective.status].label}</span></p>
            <h3>Secundários</h3>
            <ul className="plain">{c.secondary.map((s) => <li key={s.label}>{s.label} · <span className={STATUS[s.status].cls}>{STATUS[s.status].label}</span> <span className="muted small">({s.detail})</span></li>)}</ul>
          </section>
          <section className="card wide">
            <h2>Orçamentos</h2>
            <p>Transferências: <strong>{fmtMoney(c.budgets.remaining)}</strong> disponíveis (orçamento {fmtMoney(c.budgets.transfer)}, gasto {fmtMoney(c.budgets.spent)}; vendas devolvem metade da taxa)</p>
            <p>Folha salarial: <strong>{fmtMoney(c.budgets.payroll)}</strong> de um teto de {fmtMoney(c.budgets.wageCeiling)} por mês</p>
            <p className="muted small">A diretoria barra contratações e renovações que estourem o orçamento ou o teto, e veta valores fora da realidade do clube (taxa acima de 2× o valor de mercado,
              salário acima de 2,2× o justo). Obras acima de 30% do caixa precisam de aprovação. Cada pedido de aumento pode ser feito uma vez por temporada e depende da confiança (65+).</p>
            <div className="row">
              <button className="secondary" disabled={busy || !c.requests.transfer} onClick={() => void run(async () => (await unwrap(window.api.requestBudget(profileId, careerId, 'transfer'))).message)}>Pedir mais orçamento de transferências</button>
              <button className="secondary" disabled={busy || !c.requests.wage} onClick={() => void run(async () => (await unwrap(window.api.requestBudget(profileId, careerId, 'wage'))).message)}>Pedir aumento do teto da folha</button>
            </div>
          </section>
        </div>
      )}

      <section className="card">
        <h2>Propostas de emprego ({ov.offers.length})</h2>
        {ov.offers.length === 0 ? <p className="muted">Nenhuma proposta no momento. Clubes que demitem o técnico procuram treinadores com reputação compatível.</p> : (
          <table><thead><tr><th>Clube</th><th>Liga</th><th>Reputação</th><th>Recebida</th><th>Responder até</th><th /></tr></thead>
            <tbody>{ov.offers.map((o) => (
              <tr key={o.id}><td><strong>{o.clubName}</strong></td><td>{o.league}</td><td><Stars reputation={o.reputation} /></td><td>{fmtDate(o.date)}</td><td>{fmtDate(o.expires)}</td>
                <td className="row">{confirmJob === o.id
                  ? <><button disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.respondJobOffer(profileId, careerId, o.id, true)); return `Você é o novo treinador do ${o.clubName}.`; }, true)}>Confirmar troca</button>
                    <button className="secondary" onClick={() => setConfirmJob(null)}>Cancelar</button></>
                  : <><button disabled={busy} onClick={() => setConfirmJob(o.id)}>Aceitar</button>
                    <button className="secondary" disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.respondJobOffer(profileId, careerId, o.id, false)); return 'Proposta recusada.'; })}>Recusar</button></>}</td></tr>))}</tbody></table>
        )}
        {ov.employed && ov.offers.length > 0 && <p className="muted small">Aceitar troca de clube na hora: comissão técnica, olheiros e rotina de treino ficam no clube atual.</p>}
      </section>

      <section className="card">
        <h2>Carreira do treinador</h2>
        <p className="row">Reputação: <Stars reputation={ov.coachReputation} size={18} label="Reputação do treinador" />
          <HelpTip text="Sobe com objetivos cumpridos (mais ainda quando a campanha supera a meta com folga), títulos e acessos; cai com objetivos não cumpridos, rebaixamentos e demissões. Define quais clubes fazem propostas (clubes grandes só chamam treinadores com reputação alta) e dá crédito com a diretoria ao assumir um clube de reputação menor." /></p>
        <h3 className="row">Atributos {ov.coachPoints > 0 && <span className="bd-points">{ov.coachPoints} ponto(s) para distribuir</span>}
          <HelpTip text="Escala 1–20. Na avaliação de cada temporada no cargo o treinador ganha 1 ponto, +1 se cumprir o objetivo, +1 por título e +1 por acesso. Cada atributo vai até 20. Os efeitos começam acima de 5 (a base da criação) e são pequenos de propósito." /></h3>
        <div className="bd-attrs">
          {COACH_ATTRS.map((a) => {
            const v = ov.coachAttributes[a.key];
            return (
              <div key={a.key} className="bd-attr">
                <span className="bd-attr-name">{a.label}<HelpTip text={`${a.description} ${COACH_EFFECT_TEXT[a.key]}`} /></span>
                <div className="meter bd-attr-bar"><i style={{ width: `${(v / COACH_ATTR_CAP) * 100}%` }} /></div>
                <strong className="bd-attr-val">{v}</strong>
                {ov.coachPoints > 0 && <button className="nc-ghost bd-attr-plus" disabled={busy || v >= COACH_ATTR_CAP} aria-label={`Adicionar ponto em ${a.label}`}
                  onClick={() => void run(async () => { setOv(await unwrap(window.api.spendCoachPoint(profileId, careerId, a.key))); return null; })}><Plus size={14} aria-hidden="true" /></button>}
              </div>
            );
          })}
        </div>
        <h3>Clubes</h3>
        <table><thead><tr><th>Clube</th><th>Início</th><th>Fim</th><th>Saída</th></tr></thead>
          <tbody>{ov.spells.map((s, i) => <tr key={i} className={s.end ? '' : 'mine'}><td>{s.clubName}</td><td>{fmtDate(s.start)}</td><td>{s.end ? fmtDate(s.end) : 'atual'}</td><td>{s.reason === 'sacked' ? 'demitido' : s.reason === 'left' ? 'saiu para outro clube' : '—'}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}
