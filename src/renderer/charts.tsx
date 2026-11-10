/**
 * Gráficos SVG próprios (v0.8.10), sem biblioteca: linha (com área e marca de faixa), barras agrupadas, rosca, medidor e minigráfico.
 * Cores por variável CSS (`--viz-*`, tema escuro e claro em styles.css; paleta validada com o validador da skill de visualização:
 * ordem fixa, nunca por posição). Cada gráfico mede o próprio contêiner (ResizeObserver) e desenha em pixels reais, para caber em
 * telas sem rolagem; todos têm dica ao passar o mouse e rótulo acessível.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const VIZ = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)'];
export const VIZ_OTHER = 'var(--viz-other)';

/** Tamanho do contêiner (px), atualizado quando ele muda. */
function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** "Bonitos" valores de eixo entre min e max (3 a 5 marcas). */
function ticks(min: number, max: number, count = 4): number[] {
  if (max === min) return [min];
  const span = max - min, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

interface TipState { x: number; y: number; content: ReactNode }
function Tip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width - 200;
  return <div className="vz-tip" role="tooltip" style={{ left: flip ? undefined : tip.x + 12, right: flip ? width - tip.x + 12 : undefined, top: Math.max(0, tip.y - 10) }}>{tip.content}</div>;
}

export interface LinePoint { label: string; value: number | null; detail?: ReactNode }
/**
 * Linha com área. `band` = faixa horizontal destacada (ex.: teto da licença); `invert` = eixo invertido (posição: 1º no alto);
 * `zero` = desenha a linha do zero quando os valores cruzam o zero.
 */
export function LineChart({ points, format, ariaLabel, band, invert, zero, domain, color = VIZ[0]!, compactLabels }: {
  points: LinePoint[]; format: (v: number) => string; ariaLabel: string; band?: { from: number; to: number; label: string }; invert?: boolean; zero?: boolean;
  domain?: [number, number]; color?: string; compactLabels?: boolean;
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  const pad = { l: 58, r: 12, t: 12, b: 24 };
  let lo = domain ? domain[0] : Math.min(...vals, zero ? 0 : Infinity), hi = domain ? domain[1] : Math.max(...vals, zero ? 0 : -Infinity);
  if (band && !domain) { lo = Math.min(lo, band.from); hi = Math.max(hi, band.to); }
  if (!vals.length) { lo = 0; hi = 1; }
  if (hi === lo) { hi += 1; lo -= 1; }
  if (!domain) { const m = (hi - lo) * 0.08; hi += m; if (lo !== 0 || !zero) lo -= m; }
  const iw = Math.max(1, w - pad.l - pad.r), ih = Math.max(1, h - pad.t - pad.b);
  const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (iw * i) / (points.length - 1));
  const y = (v: number) => pad.t + ih * (invert ? (v - lo) / (hi - lo) : 1 - (v - lo) / (hi - lo));
  const segs: string[] = [];
  let cur = '';
  points.forEach((p, i) => { if (p.value === null) { if (cur) segs.push(cur); cur = ''; } else cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`; });
  if (cur) segs.push(cur);
  const base = invert ? pad.t + ih : y(Math.max(lo, Math.min(hi, zero ? 0 : lo)));
  const area = segs.length === 1 && !invert ? `${segs[0]}L${x(points.length - 1 - [...points].reverse().findIndex((p) => p.value !== null)).toFixed(1)},${base}L${x(points.findIndex((p) => p.value !== null)).toFixed(1)},${base}Z` : null;
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / (compactLabels ? 44 : 64)))));
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const hp = hover !== null ? points[hover] : undefined;
  return (
    <div className="vz-box" ref={ref} onMouseLeave={() => setHover(null)}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} role="img" aria-label={ariaLabel}>
          {band && <g><rect x={pad.l} width={iw} y={Math.min(y(band.from), y(band.to))} height={Math.abs(y(band.to) - y(band.from))} className="vz-band" />
            <text x={pad.l + iw - 4} y={Math.min(y(band.from), y(band.to)) + 12} textAnchor="end" className="vz-band-label">{band.label}</text></g>}
          {ticks(Math.min(lo, hi), Math.max(lo, hi)).map((t) => (
            <g key={t}><line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} className="vz-grid" /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="vz-axis">{format(t)}</text></g>
          ))}
          {zero && lo < 0 && hi > 0 && <line x1={pad.l} x2={pad.l + iw} y1={y(0)} y2={y(0)} className="vz-zero" />}
          {area && <path d={area} fill={color} className="vz-area" />}
          {segs.map((d, i) => <path key={i} d={d} stroke={color} className="vz-line" />)}
          {points.map((p, i) => p.value !== null && (points.length <= 16 || i === hover) && <circle key={i} cx={x(i)} cy={y(p.value)} r={i === hover ? 5 : 3.5} fill={color} className="vz-dot" />)}
          {points.map((p, i) => i % every === 0 && <text key={i} x={x(i)} y={h - 6} textAnchor="middle" className="vz-axis">{p.label}</text>)}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="vz-cross" />}
          <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onMouseMove={onMove} />
        </svg>
      )}
      <Tip width={w} tip={hp && hover !== null ? { x: x(hover), y: hp.value !== null ? y(hp.value) : pad.t, content: <><strong>{hp.label}</strong>{hp.value !== null ? <span>{format(hp.value)}</span> : <span className="muted">sem dado</span>}{hp.detail}</> } : null} />
    </div>
  );
}

export interface BarSeries { name: string; color: string }
/** Barras agrupadas (uma por série em cada grupo). `detail(i, s)` = conteúdo extra da dica (ex.: composição da barra). */
export function BarChart({ labels, series, values, format, ariaLabel, detail, capacity }: {
  labels: string[]; series: BarSeries[]; values: number[][]; format: (v: number) => string; ariaLabel: string;
  detail?: (group: number, serie: number) => ReactNode; /** linha de referência horizontal (ex.: capacidade do estádio) */ capacity?: { value: number; label: string };
}) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ g: number; s: number } | null>(null);
  const pad = { l: 58, r: 10, t: 12, b: 24 };
  const max = Math.max(1, ...values.flat(), capacity?.value ?? 0) * 1.06;
  const iw = Math.max(1, w - pad.l - pad.r), ih = Math.max(1, h - pad.t - pad.b);
  const slot = iw / Math.max(1, labels.length), gap = 2;
  const bw = Math.max(2, Math.min(26, (slot * 0.72 - gap * (series.length - 1)) / series.length));
  const y = (v: number) => pad.t + ih * (1 - v / max);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(iw / 46))));
  const hv = hover ? values[hover.g]?.[hover.s] : undefined;
  const hx = hover ? pad.l + slot * hover.g + slot / 2 : 0;
  return (
    <div className="vz-box" ref={ref} onMouseLeave={() => setHover(null)}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} role="img" aria-label={ariaLabel}>
          {ticks(0, max).map((t) => <g key={t}><line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} className="vz-grid" /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="vz-axis">{format(t)}</text></g>)}
          {labels.map((lab, g) => {
            const cx = pad.l + slot * g + slot / 2, total = bw * series.length + gap * (series.length - 1);
            return (
              <g key={g}>
                <rect x={pad.l + slot * g} y={pad.t} width={slot} height={ih} fill="transparent" onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect(); const rel = (e.clientX - r.left) / Math.max(1, r.width);
                  setHover({ g, s: Math.max(0, Math.min(series.length - 1, Math.floor(rel * series.length))) });
                }} />
                {series.map((s, si) => {
                  const v = values[g]?.[si] ?? 0, bx = cx - total / 2 + si * (bw + gap), top = y(v);
                  const hgt = Math.max(v > 0 ? 1 : 0, pad.t + ih - top), r = Math.min(4, bw / 2, hgt);
                  return <path key={si} pointerEvents="none" className={`vz-bar ${hover && (hover.g !== g || hover.s !== si) ? 'vz-dim' : ''}`} fill={s.color}
                    d={`M${bx},${pad.t + ih}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + bw - r}Q${bx + bw},${top} ${bx + bw},${top + r}V${pad.t + ih}Z`} />;
                })}
                {g % every === 0 && <text x={cx} y={h - 6} textAnchor="middle" className="vz-axis">{lab}</text>}
              </g>
            );
          })}
          {capacity && <g><line x1={pad.l} x2={pad.l + iw} y1={y(capacity.value)} y2={y(capacity.value)} className="vz-ref" /><text x={pad.l + iw - 4} y={y(capacity.value) - 4} textAnchor="end" className="vz-band-label">{capacity.label}</text></g>}
          <line x1={pad.l} x2={pad.l + iw} y1={pad.t + ih} y2={pad.t + ih} className="vz-baseline" />
        </svg>
      )}
      <Tip width={w} tip={hover && hv !== undefined ? { x: hx, y: y(hv), content: <><strong>{labels[hover.g]} · {series[hover.s]!.name}</strong><span>{format(hv)}</span>{detail?.(hover.g, hover.s)}</> } : null} />
    </div>
  );
}

export interface DonutPart { label: string; value: number }
/** Rosca da composição: as 5 maiores partes e "Outros"; legenda com valor e percentual (identidade nunca só pela cor). */
export function Donut({ parts, format, ariaLabel, center }: { parts: DonutPart[]; format: (v: number) => string; ariaLabel: string; center: { label: string; value: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 5), rest = sorted.slice(5).reduce((s, p) => s + p.value, 0);
  const shown = rest > 0 ? [...top, { label: 'Outros', value: rest }] : top;
  const total = shown.reduce((s, p) => s + p.value, 0);
  const R = 50, r = 34, C = 60;
  let acc = 0;
  const arcs = shown.map((p, i) => {
    const a0 = (acc / total) * Math.PI * 2, a1 = ((acc + p.value) / total) * Math.PI * 2; acc += p.value;
    const gap = shown.length > 1 ? 0.02 : 0, s = a0 + gap, e = Math.max(s + 0.001, a1 - gap);
    const pt = (a: number, rad: number) => `${(C + rad * Math.sin(a)).toFixed(2)},${(C - rad * Math.cos(a)).toFixed(2)}`;
    const large = e - s > Math.PI ? 1 : 0;
    const d = shown.length === 1 ? `M${C},${C - R}A${R},${R} 0 1 1 ${C - 0.01},${C - R}L${C - 0.01},${C - r}A${r},${r} 0 1 0 ${C},${C - r}Z`
      : `M${pt(s, R)}A${R},${R} 0 ${large} 1 ${pt(e, R)}L${pt(e, r)}A${r},${r} 0 ${large} 0 ${pt(s, r)}Z`;
    return { d, color: p.label === 'Outros' ? VIZ_OTHER : VIZ[i]!, p, i };
  });
  if (!total) return <p className="muted small">Sem lançamentos no período.</p>;
  return (
    <div className="vz-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={ariaLabel} className="vz-donut-svg">
        {arcs.map((a) => <path key={a.i} d={a.d} fill={a.color} className={hover !== null && hover !== a.i ? 'vz-dim' : ''} onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)} />)}
        <text x={C} y={C - 3} textAnchor="middle" className="vz-donut-label">{hover !== null ? shown[hover]!.label.slice(0, 16) : center.label}</text>
        <text x={C} y={C + 12} textAnchor="middle" className="vz-donut-value">{hover !== null ? format(shown[hover]!.value) : center.value}</text>
      </svg>
      <ul className="vz-legend">
        {arcs.map((a) => (
          <li key={a.i} className={hover === a.i ? 'vz-legend-on' : ''} onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: a.color }} /><span className="vz-legend-name">{a.p.label}</span>
            <span className="vz-legend-val">{format(a.p.value)}</span><span className="vz-legend-pct">{Math.round((a.p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Medidor em meio arco: `value` de `max`; `tone` muda a cor (ok/atenção/alerta), sempre com o número escrito. */
export function Gauge({ value, max, label, display, tone }: { value: number; max: number; label: string; display: string; tone: 'ok' | 'warn' | 'bad' }) {
  const f = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const a = Math.PI * f, R = 44, C = { x: 50, y: 50 };
  const end = `${(C.x - R * Math.cos(a)).toFixed(2)},${(C.y - R * Math.sin(a)).toFixed(2)}`;
  return (
    <div className="vz-gauge">
      <svg viewBox="0 0 100 56" role="img" aria-label={`${label}: ${display}`}>
        <path d={`M${C.x - R},${C.y}A${R},${R} 0 0 1 ${C.x + R},${C.y}`} className="vz-gauge-track" />
        {f > 0 && <path d={`M${C.x - R},${C.y}A${R},${R} 0 0 1 ${end}`} className={`vz-gauge-fill vz-tone-${tone}`} />}
        <text x={50} y={46} textAnchor="middle" className="vz-gauge-value">{display}</text>
      </svg>
      <span className="vz-gauge-label">{label}</span>
    </div>
  );
}

/** Minigráfico de linha (sem eixo) para tabelas. */
export function Sparkline({ values, color = VIZ[0]!, label }: { values: number[]; color?: string; label: string }) {
  if (values.length < 2) return <span className="muted small">—</span>;
  const W = 80, H = 22, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((W - 4) * i) / (values.length - 1) + 2},${(H - 3 - ((v - lo) / span) * (H - 6)).toFixed(1)}`).join('');
  return <svg width={W} height={H} role="img" aria-label={label} className="vz-spark"><path d={d} stroke={color} className="vz-line" /></svg>;
}
