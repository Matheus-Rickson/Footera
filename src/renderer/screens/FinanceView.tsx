import { useEffect, useRef, useState } from 'react';
import type { FinanceOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';
import { composeBar } from '../../shared/financeChart.ts';

export const CATEGORY_LABEL: Record<string, string> = {
  gate: 'Bilheteria', tv: 'Direitos de TV', sponsorship: 'Patrocínios', merchandising: 'Produtos oficiais',
  prize: 'Premiação da liga', youth: 'Categorias de base (salários)', scouting: 'Olheiros', transfer_in: 'Venda de jogadores', transfer_out: 'Compra de jogadores', wages: 'Salários dos jogadores', staff: 'Comissão técnica e base', maintenance: 'Estádio e instalações', operations: 'Administração e viagens',
};
const KIND_LABEL: Record<string, string> = { shirt: 'Camisa (master)', kit: 'Material esportivo', stadium: 'Naming rights' };
const money = (n: number) => `${n < 0 ? '−' : ''}${fmtNum(Math.abs(n))}`;
const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;

interface Hover { month: string; kind: 'income' | 'expense'; x: number; y: number }

function Chart({ data }: { data: FinanceOverviewDto['last12'] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  if (data.length === 0) return <p className="muted">Nenhum mês foi liquidado ainda. A primeira cobrança ocorre quando o jogo passa do dia 1 do mês.</p>;
  const W = 720, H = 220, pad = { l: 8, r: 8, t: 12, b: 28 };
  const max = Math.max(...data.flatMap((d) => [d.income, d.expense]), 1);
  const slot = (W - pad.l - pad.r) / data.length, bw = Math.min(22, slot / 2.6);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);

  const at = (e: { clientX: number; clientY: number }, month: string, kind: Hover['kind']) => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setHover({ month, kind, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const atFocus = (cx: number, top: number, month: string, kind: Hover['kind']) => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setHover({ month, kind, x: (cx / W) * r.width, y: (top / H) * r.height });
  };

  const shown = hover ? data.find((d) => d.month === hover.month) : undefined;
  const comp = shown && hover ? composeBar(shown.items, hover.kind) : null;
  const wrapW = wrap.current?.clientWidth ?? 0;
  const flip = hover ? hover.x > wrapW - 290 : false;

  return (
    <div className="chart-wrap" ref={wrap} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="group" aria-label={`Receitas e despesas dos últimos ${data.length} meses. Passe o cursor ou use Tab para ver a composição de cada barra.`}>
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={d.month}>
              {(['income', 'expense'] as const).map((kind) => {
                const v = kind === 'income' ? d.income : d.expense, x = kind === 'income' ? cx - bw - 1 : cx + 1;
                const active = hover?.month === d.month && hover.kind === kind;
                return (
                  <rect key={kind} x={x} y={y(v)} width={bw} height={Math.max(H - pad.b - y(v), 1)} tabIndex={0}
                    className={`${kind === 'income' ? 'bar-income' : 'bar-expense'} ${active ? 'active' : ''}`}
                    aria-label={`${monthLabel(d.month)}: ${kind === 'income' ? 'receitas' : 'despesas'} ${money(v)}`}
                    onMouseEnter={(e) => at(e, d.month, kind)} onMouseMove={(e) => at(e, d.month, kind)}
                    onFocus={() => atFocus(x + bw / 2, y(v), d.month, kind)} onBlur={() => setHover(null)} />
                );
              })}
              <text x={cx} y={H - 10} textAnchor="middle" className="chart-label">{monthLabel(d.month)}{d.settled ? '' : '*'}</text>
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="chart-axis" />
      </svg>
      {hover && shown && comp && (
        <div className="chart-tip" role="tooltip" style={{ left: flip ? hover.x - 270 : hover.x + 14, top: Math.max(hover.y - 8, 0) }}>
          <strong>{hover.kind === 'income' ? 'Receitas' : 'Despesas'} · {monthLabel(shown.month)}</strong>
          <table><tbody>
            {comp.parts.map((p) => (
              <tr key={p.category}><td>{CATEGORY_LABEL[p.category] ?? p.category}</td><td className="right">{money(p.amount)}</td><td className="right muted">{p.pct.toFixed(0)}%</td></tr>
            ))}
            <tr className="total"><td>Total</td><td className="right">{money(comp.total)}</td><td /></tr>
          </tbody></table>
          <span className={`small ${shown.net >= 0 ? 'pos' : 'neg'}`}>Resultado do mês: {money(shown.net)}</span>
          {!shown.settled && <span className="small muted">* Mês sem a cobrança mensal (save anterior às finanças): só aparecem lançamentos avulsos, como a bilheteria.</span>}
        </div>
      )}
    </div>
  );
}

export function FinanceView({ profileId, careerId, refreshKey }: { profileId: string; careerId: string; refreshKey: string }) {
  const [d, setD] = useState<FinanceOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    unwrap(window.api.getFinance(profileId, careerId)).then((r) => { if (!stale) { setD(r); setError(null); } }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, refreshKey]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return <p className="muted">Carregando finanças…</p>;
  const p = d.projection;

  return (
    <div className="grid1">
      <div className="grid2">
        <section className="card">
          <h2>Caixa</h2>
          <p className={`big ${d.balance < 0 ? 'neg' : ''}`}>{money(d.balance)}</p>
          {d.balance < 0 && <p className="notice">O clube está com saldo negativo. As consequências (diretoria, restrições de contratação) ainda não foram implementadas.</p>}
          <p className="muted small">{p.net >= 0 ? 'O resultado mensal recorrente é positivo.' : d.runwayMonths !== null ? `No ritmo atual de prejuízo, o caixa cobre cerca de ${d.runwayMonths} mês(es).` : 'O caixa já está esgotado.'}</p>
        </section>
        <section className="card">
          <h2>Projeção mensal recorrente</h2>
          <table><tbody>
            <tr><td>Receitas (TV, patrocínios, produtos)</td><td className="right pos">{money(p.income - p.gate)}</td></tr>
            <tr><td>Bilheteria média {p.gateEstimated ? '(estimada)' : '(dos últimos jogos)'}</td><td className="right pos">{money(p.gate)}</td></tr>
            <tr><td>Despesas (folha, comissão, estádio, administração)</td><td className="right neg">{money(-p.expense)}</td></tr>
            <tr><td><strong>Resultado</strong></td><td className={`right ${p.net >= 0 ? 'pos' : 'neg'}`}><strong>{money(p.net)}</strong></td></tr>
            <tr><td className="muted small">Folha de salários (já incluída)</td><td className="right muted small">{money(p.wageBill)}</td></tr>
          </tbody></table>
          <p className="muted small">A bilheteria é distribuída ao longo dos 12 meses (jogos em casa da temporada ÷ 12) e varia a cada jogo.</p>
        </section>
      </div>

      <section className="card">
        <h2>Receitas e despesas por mês</h2>
        <Chart data={d.last12} />
        <p className="muted small"><span className="dot promotion" /> receitas <span className="dot relegation" /> despesas · passe o cursor sobre uma barra para ver de que ela é feita{d.last12.some((m) => !m.settled) ? ' · * mês parcial (sem cobrança mensal)' : ''}</p>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Último mês liquidado{d.lastSettledMonth ? ` (${monthLabel(d.lastSettledMonth)})` : ''}</h2>
          {d.lastMonth.length === 0 ? <p className="muted">Sem lançamentos ainda.</p> : (
            <table><tbody>{d.lastMonth.map((r) => <tr key={r.category}><td>{CATEGORY_LABEL[r.category] ?? r.category}</td><td className={`right ${r.amount >= 0 ? 'pos' : 'neg'}`}>{money(r.amount)}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="card">
          <h2>Patrocínios vigentes</h2>
          <table><thead><tr><th>Tipo</th><th>Patrocinador</th><th className="right">Por mês</th><th>Até</th></tr></thead>
            <tbody>{d.sponsors.map((s) => <tr key={s.id}><td>{KIND_LABEL[s.kind]}</td><td>{s.sponsor}</td><td className="right">{money(s.monthly)}</td><td>{fmtDate(s.end)}</td></tr>)}</tbody></table>
          <p className="muted small">Contratos vencidos são renovados automaticamente; negociação própria ainda não existe.</p>
        </section>
      </div>

      <section className="card">
        <h2>Bilheteria (últimos jogos em casa)</h2>
        {d.gates.length === 0 ? <p className="muted">Nenhum jogo em casa disputado ainda.</p> : (
          <table><thead><tr><th>Data</th><th>Adversário</th><th className="right">Público</th><th className="right">Ocupação</th><th className="right">Renda</th></tr></thead>
            <tbody>{d.gates.map((g) => <tr key={g.fixtureId}><td>{fmtDate(g.date)}</td><td>{g.opponent}</td><td className="right">{fmtNum(g.attendance)}</td>
              <td className="right">{Math.round((g.attendance / g.capacity) * 100)}%</td><td className="right pos">{money(g.revenue)}</td></tr>)}</tbody></table>
        )}
      </section>

      <section className="card scroll tall">
        <h2>Extrato</h2>
        {d.ledger.length === 0 ? <p className="muted">Sem movimentações ainda.</p> : (
          <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th className="right">Valor</th></tr></thead>
            <tbody>{d.ledger.map((l, i) => <tr key={i}><td>{fmtDate(l.date)}</td><td>{l.description}</td><td className="muted">{CATEGORY_LABEL[l.category] ?? l.category}</td>
              <td className={`right ${l.amount >= 0 ? 'pos' : 'neg'}`}>{money(l.amount)}</td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  );
}
