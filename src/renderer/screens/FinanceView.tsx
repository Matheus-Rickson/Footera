import { useCallback, useEffect, useState } from 'react';
import { Handshake, Search, Trash2 } from 'lucide-react';
import type { FinanceLedgerDto, FinanceOverviewDto, SponsorOfferDto, SponsorSlotDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, fmtNum, unwrap } from '../util.ts';
import { composeBar } from '../../shared/financeChart.ts';
import { BarChart, Donut, Gauge, LineChart, Sparkline, VIZ } from '../charts.tsx';
import { Dialog, HelpButton } from '../helpDialog.tsx';

export const CATEGORY_LABEL: Record<string, string> = {
  gate: 'Bilheteria', tv: 'Direitos de TV', sponsorship: 'Patrocínios', merchandising: 'Produtos oficiais',
  prize: 'Premiações', youth: 'Categorias de base (salários)', scouting: 'Olheiros', coaching: 'Comissão técnica (salários)', infrastructure: 'Obras de infraestrutura', transfer_in: 'Venda de jogadores', transfer_out: 'Compra de jogadores', wages: 'Salários dos jogadores', staff: 'Estrutura e base', maintenance: 'Estádio e instalações', operations: 'Administração e viagens',
};
const INCOME = ['gate', 'tv', 'sponsorship', 'merchandising', 'transfer_in', 'prize'];
const EXPENSE = ['wages', 'coaching', 'staff', 'youth', 'scouting', 'maintenance', 'operations', 'transfer_out', 'infrastructure'];
const money = fmtMoney;
/** valor curto para eixos: € 1,2 mi / € 350 mil */
export const moneyShort = (v: number): string => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return `${s}€ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: a >= 1e7 ? 0 : 1 })} mi`;
  if (a >= 1e3) return `${s}€ ${Math.round(a / 1e3).toLocaleString('pt-BR')} mil`;
  return `${s}€ ${Math.round(a)}`;
};
const monthLabel = (m: string) => `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
type Tab = 'overview' | 'flows' | 'sponsors' | 'gate' | 'ledger';
const TABS: Array<[Tab, string]> = [['overview', 'Visão geral'], ['flows', 'Receitas e despesas'], ['sponsors', 'Patrocínios'], ['gate', 'Bilheteria'], ['ledger', 'Extrato']];

function CardHead({ title, help, children }: { title: string; help?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="fn-head"><h2>{title}{help && <HelpButton title={title}>{help}</HelpButton>}</h2>{children}</div>;
}

export function FinanceView({ profileId, careerId, refreshKey }: { profileId: string; careerId: string; refreshKey: string }) {
  const [d, setD] = useState<FinanceOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let stale = false;
    unwrap(window.api.getFinance(profileId, careerId)).then((r) => { if (!stale) { setD(r); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey, tick]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return <p className="muted">Carregando finanças…</p>;
  const offers = d.sponsorSlots.reduce((s, x) => s + x.offers.filter((o) => o.status === 'open').length, 0);
  return (
    <div className="fn">
      <div className="pf-tabs fn-tabs" role="tablist" aria-label="Seções das finanças">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`pf-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {label}{t === 'sponsors' && offers > 0 && <span className="fn-badge">{offers}</span>}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview d={d} />}
      {tab === 'flows' && <Flows d={d} />}
      {tab === 'sponsors' && <Sponsors d={d} profileId={profileId} careerId={careerId} onChanged={reload} />}
      {tab === 'gate' && <Gate d={d} />}
      {tab === 'ledger' && <Ledger profileId={profileId} careerId={careerId} refreshKey={`${refreshKey}:${tick}`} />}
    </div>
  );
}

/* ---------------- Visão geral ---------------- */
function Overview({ d }: { d: FinanceOverviewDto }) {
  const p = d.projection;
  const seasonNet = d.season.current.reduce((s, c) => s + c.amount, 0);
  const incomeParts = d.season.current.filter((c) => c.amount > 0).map((c) => ({ label: CATEGORY_LABEL[c.category] ?? c.category, value: c.amount }));
  const expenseParts = d.season.current.filter((c) => c.amount < 0).map((c) => ({ label: CATEGORY_LABEL[c.category] ?? c.category, value: -c.amount }));
  const wage = d.budgets ? d.budgets.payroll / Math.max(1, d.budgets.wageCeiling) : null;
  return (
    <div className="fn-ov">
      <section className="card fn-kpi">
        <span className="fn-kpi-label">Caixa</span>
        <strong className={`fn-kpi-value ${d.balance < 0 ? 'neg' : ''}`}>{money(d.balance)}</strong>
        <span className="muted small">{d.balance < 0 ? 'Saldo negativo: a diretoria cobra a cada mês.' : 'Dinheiro disponível hoje.'}</span>
      </section>
      <section className="card fn-kpi">
        <span className="fn-kpi-label">Resultado da temporada {d.season.label}</span>
        <strong className={`fn-kpi-value ${seasonNet >= 0 ? 'pos' : 'neg'}`}>{money(seasonNet)}</strong>
        <span className="muted small">Receitas menos despesas desde o início da temporada.</span>
      </section>
      <section className="card fn-kpi fn-kpi-gauge">
        {d.budgets && wage !== null ? (
          <>
            <Gauge value={d.budgets.payroll} max={d.budgets.wageCeiling} label="Folha × teto salarial" display={`${Math.round(wage * 100)}%`} tone={wage > 1 ? 'bad' : wage > 0.92 ? 'warn' : 'ok'} />
            <span className="muted small">{money(d.budgets.payroll)} de {money(d.budgets.wageCeiling)} por mês</span>
          </>
        ) : <span className="muted small">Sem orçamento da diretoria.</span>}
      </section>
      <section className="card fn-kpi">
        <span className="fn-kpi-label">Projeção mensal <HelpButton title="Projeção mensal">
          <p>Quanto o clube ganha e gasta por mês <strong>no ritmo atual</strong>, sem transferências e prêmios:</p>
          <ul>
            <li>Receitas: TV, patrocínios vigentes, produtos oficiais e a bilheteria média {p.gateEstimated ? '(estimada pela fórmula: ainda há poucos jogos em casa)' : 'dos últimos jogos em casa'}, distribuída pelos 12 meses.</li>
            <li>Despesas: folha dos jogadores, base, olheiros, comissão técnica, estrutura, estádio e administração.</li>
          </ul>
          <p><strong>Fôlego</strong>: com resultado mensal negativo, quantos meses o caixa aguenta antes de zerar.</p>
        </HelpButton></span>
        <strong className={`fn-kpi-value ${p.net >= 0 ? 'pos' : 'neg'}`}>{money(p.net)}</strong>
        <span className="muted small">{p.net >= 0 ? `Receita ${moneyShort(p.income)} · despesa ${moneyShort(p.expense)}` : d.runwayMonths !== null ? `Fôlego: o caixa cobre cerca de ${d.runwayMonths} mês(es).` : 'O caixa já está esgotado.'}</span>
      </section>

      <section className="card fn-balance">
        <CardHead title="Saldo mês a mês" help={<p>Saldo do caixa no fim de cada mês (o mês corrente mostra o saldo de hoje), reconstruído a partir dos lançamentos. A linha tracejada é o zero.</p>} />
        {d.balanceHistory.length < 2 ? <p className="muted small">Ainda não há meses suficientes para o gráfico.</p>
          : <LineChart ariaLabel="Saldo do caixa no fim de cada mês" format={moneyShort} zero points={d.balanceHistory.map((b) => ({ label: monthLabel(b.month), value: b.balance, detail: <span className="muted">{money(b.balance)}</span> }))} />}
      </section>
      <section className="card fn-months">
        <CardHead title="Receitas × despesas" help={<p>Total de receitas e de despesas de cada mês (até 12 meses). Passe o cursor numa barra para ver de que ela é feita. Meses com * não tiveram a cobrança mensal (save anterior às finanças).</p>}>
          <span className="fn-legend"><i style={{ background: VIZ[0] }} />Receitas <i style={{ background: VIZ[1] }} />Despesas</span>
        </CardHead>
        {d.last12.length === 0 ? <p className="muted small">Nenhum mês liquidado ainda: a primeira cobrança é no dia 1º do mês.</p> : (
          <BarChart ariaLabel="Receitas e despesas por mês" format={moneyShort}
            labels={d.last12.map((m) => `${monthLabel(m.month)}${m.settled ? '' : '*'}`)}
            series={[{ name: 'Receitas', color: VIZ[0]! }, { name: 'Despesas', color: VIZ[1]! }]}
            values={d.last12.map((m) => [m.income, m.expense])}
            detail={(g, s) => {
              const comp = composeBar(d.last12[g]!.items, s === 0 ? 'income' : 'expense');
              return <table className="fn-tip-table"><tbody>{comp.parts.slice(0, 6).map((x) => <tr key={x.category}><td>{CATEGORY_LABEL[x.category] ?? x.category}</td><td className="right">{moneyShort(x.amount)}</td><td className="right muted">{x.pct.toFixed(0)}%</td></tr>)}</tbody></table>;
            }} />
        )}
      </section>
      <section className="card fn-donut-in">
        <CardHead title="De onde vem o dinheiro" help={<p>Composição das receitas da temporada {d.season.label}. As 5 maiores fontes aparecem separadas; o resto fica em "Outros".</p>} />
        <Donut ariaLabel="Composição das receitas da temporada" parts={incomeParts} format={moneyShort} center={{ label: 'Receitas', value: moneyShort(incomeParts.reduce((s, x) => s + x.value, 0)) }} />
      </section>
      <section className="card fn-donut-out">
        <CardHead title="Para onde vai o dinheiro" help={<p>Composição das despesas da temporada {d.season.label}. Salários costumam ser a maior parte; a diretoria acompanha a folha pelo teto salarial.</p>} />
        <Donut ariaLabel="Composição das despesas da temporada" parts={expenseParts} format={moneyShort} center={{ label: 'Despesas', value: moneyShort(expenseParts.reduce((s, x) => s + x.value, 0)) }} />
      </section>
      <section className="card fn-budget">
        <CardHead title="Orçamentos da diretoria" help={<p>Definidos pela diretoria no início da temporada. O <strong>orçamento de transferências</strong> é gasto nas compras (vendas devolvem metade do valor). O <strong>teto salarial</strong> limita a folha mensal: contratações e renovações acima dele são vetadas. Pedidos de aumento ficam na tela Diretoria.</p>} />
        {d.budgets ? (
          <div className="fn-budget-rows">
            <BudgetBar label="Transferências" used={d.budgets.spent} total={d.budgets.transfer} hint={`Restam ${money(d.budgets.remaining)}`} />
            <BudgetBar label="Folha salarial (mensal)" used={d.budgets.payroll} total={d.budgets.wageCeiling} hint={d.budgets.payroll > d.budgets.wageCeiling ? 'Acima do teto' : `Folga de ${money(d.budgets.wageCeiling - d.budgets.payroll)}`} />
          </div>
        ) : <p className="muted small">Sem orçamento definido.</p>}
      </section>
    </div>
  );
}

function BudgetBar({ label, used, total, hint }: { label: string; used: number; total: number; hint: string }) {
  const f = total > 0 ? used / total : used > 0 ? 2 : 0;
  return (
    <div className="fn-bb">
      <div className="fn-bb-top"><span>{label}</span><span className="muted small">{moneyShort(used)} / {moneyShort(total)}</span></div>
      <div className="fn-bb-track" role="img" aria-label={`${label}: ${Math.round(f * 100)}%`}><div className={`fn-bb-fill ${f > 1 ? 'fn-bb-over' : f > 0.9 ? 'fn-bb-warn' : ''}`} style={{ width: `${Math.min(100, f * 100)}%` }} /></div>
      <span className={`small ${f > 1 ? 'neg' : 'muted'}`}>{hint}</span>
    </div>
  );
}

/* ---------------- Receitas e despesas por categoria ---------------- */
function Flows({ d }: { d: FinanceOverviewDto }) {
  const cur = new Map(d.season.current.map((c) => [c.category, c.amount]));
  const prev = new Map(d.season.previous.map((c) => [c.category, c.amount]));
  const monthsOf = (cat: string) => d.last12.map((m) => Math.abs(m.items.find((i) => i.category === cat)?.amount ?? 0));
  const block = (title: string, cats: string[], sign: 1 | -1) => {
    const rows = cats.filter((c) => (cur.get(c) ?? 0) !== 0 || (prev.get(c) ?? 0) !== 0);
    const max = Math.max(1, ...rows.flatMap((c) => [Math.abs(cur.get(c) ?? 0), Math.abs(prev.get(c) ?? 0)]));
    const total = rows.reduce((s, c) => s + sign * (cur.get(c) ?? 0), 0), totalPrev = rows.reduce((s, c) => s + sign * (prev.get(c) ?? 0), 0);
    return (
      <section className="card fn-flow">
        <CardHead title={title} help={<p>Total de cada categoria na temporada {d.season.label} (barra cheia) e na anterior{d.season.previousLabel ? ` (${d.season.previousLabel}, barra fina)` : ''}. A linha à direita mostra os últimos 12 meses.</p>}>
          <span className="muted small">{d.season.label}: <strong>{money(total)}</strong>{d.season.previousLabel && <> · {d.season.previousLabel}: {money(totalPrev)}</>}</span>
        </CardHead>
        {rows.length === 0 ? <p className="muted small">Sem lançamentos.</p> : (
          <div className="fn-flow-rows">
            {rows.map((c) => {
              const a = Math.abs(cur.get(c) ?? 0), b = Math.abs(prev.get(c) ?? 0);
              return (
                <div key={c} className="fn-flow-row">
                  <span className="fn-flow-name">{CATEGORY_LABEL[c] ?? c}</span>
                  <div className="fn-flow-bars" title={`${d.season.label}: ${money(a)}${d.season.previousLabel ? ` · ${d.season.previousLabel}: ${money(b)}` : ''}`}>
                    <div className="fn-flow-cur" style={{ width: `${(a / max) * 100}%`, background: sign > 0 ? VIZ[0] : VIZ[1] }} />
                    {d.season.previousLabel && <div className="fn-flow-prev" style={{ width: `${(b / max) * 100}%` }} />}
                  </div>
                  <span className="fn-flow-val">{moneyShort(a)}</span>
                  <Sparkline values={monthsOf(c)} color={sign > 0 ? VIZ[0] : VIZ[1]} label={`${CATEGORY_LABEL[c] ?? c} nos últimos meses`} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };
  return <div className="fn-flows">{block('Receitas', INCOME, 1)}{block('Despesas', EXPENSE, -1)}</div>;
}

/* ---------------- Patrocínios ---------------- */
const PROFILE_LABEL: Record<string, string> = { fixed: 'Valor fixo', bonus: 'Fixo + bônus' };
function Sponsors({ d, profileId, careerId, onChanged }: { d: FinanceOverviewDto; profileId: string; careerId: string; onChanged: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [negotiate, setNegotiate] = useState<SponsorOfferDto | null>(null);
  const [terminate, setTerminate] = useState<SponsorSlotDto | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(p: Promise<{ message: string }>) {
    setBusy(true);
    try { setMsg({ ok: true, text: (await p).message }); onChanged(); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }
  const total = d.sponsorSlots.reduce((s, x) => s + (x.current?.monthly ?? 0), 0);
  return (
    <div className="fn-sp">
      <div className="fn-sp-top">
        <span className="muted small">Patrocínios vigentes: <strong>{money(total)}</strong> por mês</span>
        <HelpButton title="Como funcionam os patrocínios">
          <p>O clube tem três cotas: <strong>camisa (master)</strong>, <strong>material esportivo</strong> e <strong>naming rights</strong> do estádio. O valor de mercado de cada cota depende da reputação do clube e da economia do país.</p>
          <ul>
            <li><strong>Propostas</strong> chegam 60 dias antes de um contrato vencer (e-mail na Caixa de entrada). Numa cota vaga, use "Buscar patrocinador" (uma busca a cada 30 dias).</li>
            <li><strong>Valor fixo</strong> paga mais por mês; <strong>fixo + bônus</strong> paga menos, mas dá bônus por título, acesso ou posição na liga e por título de copa nacional, pagos quando a meta acontece.</li>
            <li><strong>Negociar</strong>: peça um valor maior. A empresa aceita se couber no orçamento dela (que ela não mostra), ou sobe parte do que você pediu. No 3º pedido alto demais ela encerra a conversa e só volta depois de 30 dias.</li>
            <li>Sem decisão até o vencimento, a diretoria aceita a melhor proposta aberta.</li>
            <li><strong>Rescindir</strong> custa 3 mensalidades (ou o que falta do contrato, se for menos) e deixa a cota vaga até você fechar outro contrato.</li>
          </ul>
        </HelpButton>
      </div>
      {msg && <p className={msg.ok ? 'pos small' : 'error'} role="status">{msg.text}</p>}
      <div className="fn-sp-grid">
        {d.sponsorSlots.map((s) => (
          <section key={s.kind} className="card fn-slot">
            <div className="fn-head"><h2>{s.label}</h2><span className="muted small">mercado: {moneyShort(s.reference)}/mês</span></div>
            {s.current ? <DealBox deal={s.current} title="Contrato vigente" /> : <p className="fn-vacant">Cota vaga: sem receita até fechar um contrato.</p>}
            {s.upcoming && <DealBox deal={s.upcoming} title="Próximo contrato (já fechado)" />}
            <div className="fn-slot-actions">
              {s.canSearch && <button className="secondary" disabled={busy} onClick={() => void run(unwrap(window.api.searchSponsors(profileId, careerId, s.kind)))}><Search size={14} aria-hidden="true" /> Buscar patrocinador</button>}
              {!s.canSearch && s.searchFrom && <span className="muted small">Nova busca a partir de {fmtDate(s.searchFrom)}</span>}
              {s.current && s.current.terminationFee > 0 && <button className="danger" disabled={busy} onClick={() => setTerminate(s)}><Trash2 size={14} aria-hidden="true" /> Rescindir</button>}
            </div>
            <h3 className="fn-h3">Propostas {s.offers.length > 0 && `(${s.offers.length})`}</h3>
            {s.offers.length === 0 ? <p className="muted small">{s.current && !s.upcoming ? `Chegam 60 dias antes do vencimento (${fmtDate(s.current.end)}).` : 'Nenhuma proposta aberta.'}</p> : (
              <ul className="fn-offers">
                {s.offers.map((o) => (
                  <li key={o.id} className={o.status === 'walkout' ? 'fn-offer-off' : ''}>
                    <div className="fn-offer-top"><strong>{o.sponsor}</strong><span className={`fn-tag ${o.profile === 'bonus' ? 'fn-tag-bonus' : ''}`}>{PROFILE_LABEL[o.profile]}</span></div>
                    <span className="small">{money(o.standing)}/mês{o.standing > o.initial && <span className="pos"> (+{moneyShort(o.standing - o.initial)})</span>} · {o.years} temporada(s)</span>
                    {o.bonuses.length > 0 && <span className="muted small">Bônus: {o.bonuses.map((b) => `${b.label.toLowerCase()}${b.target ? ` (até ${b.target}º)` : ''} ${moneyShort(b.amount)}`).join(' · ')}</span>}
                    {o.status === 'walkout' ? <span className="neg small">Encerrou a conversa até {fmtDate(o.lockedUntil!)}</span>
                      : <div className="row fn-offer-actions"><span className="muted small">vale até {fmtDate(o.expires)} · {o.roundsLeft} pedido(s)</span><button className="secondary" disabled={busy} onClick={() => setNegotiate(o)}><Handshake size={14} aria-hidden="true" /> Negociar</button></div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {negotiate && <NegotiateDialog offer={negotiate} profileId={profileId} careerId={careerId} onClose={() => setNegotiate(null)} onDone={(text) => { setMsg({ ok: true, text }); setNegotiate(null); onChanged(); }} />}
      {terminate && terminate.current && (
        <Dialog title={`Rescindir: ${terminate.current.sponsor}`} onClose={() => setTerminate(null)} footer={<>
          <button className="secondary" onClick={() => setTerminate(null)}>Cancelar</button>
          <button className="danger" disabled={busy} onClick={() => { const k = terminate.kind; setTerminate(null); void run(unwrap(window.api.terminateSponsor(profileId, careerId, k))); }}>Rescindir e pagar {money(terminate.current.terminationFee)}</button>
        </>}>
          <p>O contrato de {terminate.label.toLowerCase()} com <strong>{terminate.current.sponsor}</strong> ({money(terminate.current.monthly)}/mês até {fmtDate(terminate.current.end)}) será encerrado hoje.</p>
          <p>Multa: <strong className="neg">{money(terminate.current.terminationFee)}</strong>. A cota fica vaga, sem receita, até você fechar um contrato novo em "Buscar patrocinador".</p>
        </Dialog>
      )}
    </div>
  );
}

function DealBox({ deal, title }: { deal: NonNullable<SponsorSlotDto['current']>; title: string }) {
  const start = new Date(`${deal.start}T00:00:00Z`).getTime(), end = new Date(`${deal.end}T00:00:00Z`).getTime();
  return (
    <div className="fn-deal">
      <span className="fn-kpi-label">{title}</span>
      <strong>{deal.sponsor}</strong>
      <span className="fn-deal-money">{money(deal.monthly)}<span className="muted small"> /mês</span></span>
      <span className="muted small">{fmtDate(deal.start)} → {fmtDate(deal.end)} · {Math.round((end - start) / (365.25 * 864e5) * 10) / 10} temporada(s){deal.negotiated ? '' : ' · renovação automática'}</span>
      {deal.bonuses.length > 0 && <span className="small">Bônus: {deal.bonuses.map((b) => `${b.label.toLowerCase()}${b.target ? ` (até ${b.target}º)` : ''} ${moneyShort(b.amount)}`).join(' · ')}</span>}
    </div>
  );
}

function NegotiateDialog({ offer, profileId, careerId, onClose, onDone }: { offer: SponsorOfferDto; profileId: string; careerId: string; onClose: () => void; onDone: (text: string) => void }) {
  const [standing, setStanding] = useState(offer.standing);
  const [rounds, setRounds] = useState(offer.roundsLeft);
  const [ask, setAsk] = useState(Math.round((offer.standing * 1.1) / 100) * 100);
  const [years, setYears] = useState(offer.years);
  const [log, setLog] = useState<Array<{ who: 'you' | 'them'; text: string }>>([{ who: 'them', text: `Oferecemos ${money(offer.standing)} por mês por ${offer.years} temporada(s).` }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  async function send() {
    setBusy(true); setError(null);
    try {
      const r = await unwrap(window.api.negotiateSponsor(profileId, careerId, { offerId: offer.id, monthly: ask, years }));
      setLog((l) => [...l, { who: 'you', text: `Pedimos ${money(ask)} por mês, ${years} temporada(s).` }, { who: 'them', text: r.message }]);
      if (r.outcome === 'accepted') { onDone(r.message); return; }
      if (r.outcome === 'walkout') { setClosed(true); return; }
      setStanding(r.monthly!); setRounds(r.roundsLeft);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }
  async function accept() {
    setBusy(true); setError(null);
    try { onDone((await unwrap(window.api.acceptSponsorOffer(profileId, careerId, offer.id, years))).message); } catch (e) { setError(errMsg(e)); setBusy(false); }
  }
  return (
    <Dialog title={`Negociar com ${offer.sponsor}`} onClose={closed ? () => onDone(log.at(-1)!.text) : onClose} footer={closed ? <button onClick={() => onDone(log.at(-1)!.text)}>Fechar</button> : <>
      <button className="secondary" disabled={busy} onClick={() => void accept()}>Aceitar {money(standing)}/mês</button>
      <button disabled={busy || ask <= standing} onClick={() => void send()}>Pedir {money(ask)}</button>
    </>}>
      <div className="fn-neg">
        <div className="fn-neg-info">
          <span><span className="muted small">Oferta atual</span><strong>{money(standing)}/mês</strong></span>
          <span><span className="muted small">Pedidos restantes</span><strong>{rounds} de 3</strong></span>
          <span><span className="muted small">Perfil</span><strong>{PROFILE_LABEL[offer.profile]}</strong></span>
        </div>
        {offer.bonuses.length > 0 && <p className="small">Bônus do contrato: {offer.bonuses.map((b) => `${b.label}${b.target ? ` (até ${b.target}º)` : ''}: ${money(b.amount)}`).join(' · ')}.</p>}
        <ul className="fn-neg-log">{log.map((l, i) => <li key={i} className={l.who === 'you' ? 'fn-neg-you' : 'fn-neg-them'}>{l.text}</li>)}</ul>
        {!closed && (
          <div className="fn-neg-form">
            <label>Valor mensal pedido
              <input type="range" min={standing} max={Math.round((offer.initial * 1.5) / 100) * 100} step={100} value={ask} onChange={(e) => setAsk(Number(e.target.value))} />
              <strong>{money(ask)}</strong> <span className="muted small">(+{Math.round((ask / standing - 1) * 100)}% sobre a oferta)</span>
            </label>
            <label>Duração
              <select value={years} onChange={(e) => setYears(Number(e.target.value))}>{[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y} temporada(s)</option>)}</select>
            </label>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ---------------- Bilheteria ---------------- */
function Gate({ d }: { d: FinanceOverviewDto }) {
  const games = [...d.gates].reverse();
  const avgAtt = games.length ? games.reduce((s, g) => s + g.attendance, 0) / games.length : 0;
  const avgRev = games.length ? games.reduce((s, g) => s + g.revenue, 0) / games.length : 0;
  return (
    <div className="fn-gate">
      <section className="card fn-kpi"><span className="fn-kpi-label">Preço médio do ingresso</span><strong className="fn-kpi-value">{money(d.ticketPrice)}</strong><span className="muted small">Depende da reputação do clube e da economia do país.</span></section>
      <section className="card fn-kpi"><span className="fn-kpi-label">Capacidade</span><strong className="fn-kpi-value">{fmtNum(d.capacity)}</strong><span className="muted small">Ampliações na tela Infraestrutura.</span></section>
      <section className="card fn-kpi"><span className="fn-kpi-label">Público médio</span><strong className="fn-kpi-value">{games.length ? fmtNum(Math.round(avgAtt)) : '—'}</strong><span className="muted small">{games.length ? `Ocupação de ${Math.round((avgAtt / Math.max(1, d.capacity)) * 100)}%` : 'Nenhum jogo em casa ainda.'}</span></section>
      <section className="card fn-kpi"><span className="fn-kpi-label">Renda média por jogo</span><strong className="fn-kpi-value">{games.length ? money(Math.round(avgRev)) : '—'}</strong><span className="muted small">{d.projection.gateEstimated ? 'Projeção usa a estimativa (poucos jogos).' : 'Base da projeção mensal.'}</span></section>
      <section className="card fn-gate-chart">
        <CardHead title="Público por jogo em casa" help={<p>Pagantes em cada jogo em casa (últimos {games.length}) e a linha da capacidade do estádio. O público depende da reputação do seu clube e do adversário, e cai com chuva, calor ou frio. Passe o cursor numa barra para ver a renda.</p>} />
        {games.length === 0 ? <p className="muted small">Nenhum jogo em casa disputado ainda.</p> : (
          <BarChart ariaLabel="Público dos jogos em casa" format={(v) => fmtNum(Math.round(v))} capacity={{ value: d.capacity, label: `Capacidade ${fmtNum(d.capacity)}` }}
            labels={games.map((g) => g.date.slice(8, 10) + '/' + g.date.slice(5, 7))} series={[{ name: 'Público', color: VIZ[2]! }]} values={games.map((g) => [g.attendance])}
            detail={(i) => <><span>vs {games[i]!.opponent}</span><span>Ocupação {Math.round((games[i]!.attendance / games[i]!.capacity) * 100)}% · renda {money(games[i]!.revenue)}</span></>} />
        )}
      </section>
    </div>
  );
}

/* ---------------- Extrato ---------------- */
function Ledger({ profileId, careerId, refreshKey }: { profileId: string; careerId: string; refreshKey: string }) {
  const [page, setPage] = useState(0);
  const [cat, setCat] = useState('');
  const [data, setData] = useState<FinanceLedgerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    unwrap(window.api.getFinanceLedger(profileId, careerId, { page, ...(cat ? { category: cat } : {}) })).then((r) => { if (!stale) { setData(r); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey, page, cat]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section className="card fn-ledger">
      <div className="fn-head">
        <h2>Extrato</h2>
        <div className="row fn-ledger-tools">
          <select aria-label="Categoria" value={cat} onChange={(e) => { setCat(e.target.value); setPage(0); }}>
            <option value="">Todas as categorias</option>
            {[...INCOME, ...EXPENSE].map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (data.rows.length === 0 ? <p className="muted">Sem movimentações.</p> : (
        <table className="fn-ledger-table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th className="right">Valor</th></tr></thead>
          <tbody>{data.rows.map((l, i) => <tr key={i}><td>{fmtDate(l.date)}</td><td>{l.description}</td><td className="muted">{CATEGORY_LABEL[l.category] ?? l.category}</td>
            <td className={`right ${l.amount >= 0 ? 'pos' : 'neg'}`}>{money(l.amount)}</td></tr>)}</tbody></table>
      ))}
      {data && data.total > 0 && (
        <div className="row fn-pager">
          <button className="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</button>
          <span className="muted small">Página {data.page + 1} de {pages} · {fmtNum(data.total)} lançamento(s)</span>
          <button className="secondary" disabled={data.page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</button>
        </div>
      )}
    </section>
  );
}
