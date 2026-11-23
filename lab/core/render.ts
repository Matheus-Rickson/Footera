/** Relatório → HTML independente (exportação) e → texto (terminal). Mesmas seções que a janela desenha. */
import type { Cell, Report, Section } from './types.ts';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cell = (c: Cell) => (c === null ? '—' : c);

function sectionHtml(s: Section): string {
  switch (s.kind) {
    case 'kpis':
      return `<section>${s.title ? `<h2>${esc(s.title)}</h2>` : ''}<div class="kpis">${s.items.map((k) => `<div class="kpi ${k.tone ?? ''}"><span>${esc(k.label)}</span><strong>${esc(k.value)}</strong>${k.hint ? `<small>${esc(k.hint)}</small>` : ''}</div>`).join('')}</div></section>`;
    case 'table':
      return `<section><h2>${esc(s.title)}</h2><div class="tw"><table><thead><tr>${s.columns.map((c, i) => `<th class="${s.numeric?.includes(i) ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${s.numeric?.includes(i) ? 'n' : ''}">${esc(cell(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</section>`;
    case 'checks':
      return `<section><h2>${esc(s.title)}</h2><table><thead><tr><th>Meta</th><th class="n">Resultado</th><th class="n">Faixa</th><th></th></tr></thead><tbody>${s.items.map((c) => `<tr><td>${esc(c.label)}</td><td class="n">${esc(c.value)}</td><td class="n">${esc(c.target)}</td><td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓ ok' : '✗ fora'}</td></tr>`).join('')}</tbody></table></section>`;
    case 'bars': {
      const max = Math.max(1, ...s.items.map((b) => b.value));
      return `<section><h2>${esc(s.title)}</h2><div class="bars">${s.items.map((b) => `<div class="bar"><span>${esc(b.label)}</span><i style="width:${(100 * b.value / max).toFixed(1)}%"></i><em>${esc(b.display ?? b.value)}</em></div>`).join('')}</div>${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</section>`;
    }
    case 'events':
      return `<section><h2>${esc(s.title)}</h2><ol class="ev">${s.items.map((e) => `<li class="t${e.team ?? 'n'}"><b>${esc(e.minute)}</b>${esc(e.text)}</li>`).join('')}</ol></section>`;
    case 'text':
      return `<section>${s.title ? `<h2>${esc(s.title)}</h2>` : ''}<p class="txt ${s.tone ?? ''}">${esc(s.body).replace(/\n/g, '<br>')}</p></section>`;
  }
}

export function reportHtml(r: Report): string {
  const params = Object.entries(r.params).map(([k, v]) => `<code>${esc(k)}=${esc(v)}</code>`).join(' ');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laboratório · ${esc(r.title)}</title><style>
:root{--bg:#0b1120;--s:#111a2e;--b:#22304d;--t:#e5ecf7;--m:#8fa1bf;--ok:#34d399;--warn:#facc15;--bad:#f87171;--acc:#38bdf8}
@media (prefers-color-scheme:light){:root{--bg:#f4f6fb;--s:#fff;--b:#d8deea;--t:#111827;--m:#5b6476;--ok:#059669;--warn:#a16207;--bad:#dc2626;--acc:#0369a1}}
body{margin:0;background:var(--bg);color:var(--t);font:14px/1.45 system-ui,Segoe UI,sans-serif;padding:20px 16px 40px}
main{max-width:1200px;margin:0 auto}h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1rem;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em;color:var(--m)}
header p{color:var(--m);margin:0 0 4px}code{font-size:.78rem;background:var(--s);border:1px solid var(--b);border-radius:4px;padding:1px 5px;margin:2px;display:inline-block}
section{background:var(--s);border:1px solid var(--b);border-radius:8px;padding:14px 16px;margin-top:14px}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.kpi{border:1px solid var(--b);border-radius:6px;padding:8px 10px;display:grid}
.kpi span{color:var(--m);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}.kpi strong{font-size:1.25rem}.kpi small{color:var(--m)}
.kpi.ok strong,.ok{color:var(--ok)}.kpi.warn strong,.warn{color:var(--warn)}.kpi.bad strong,.bad{color:var(--bad)}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--b);white-space:nowrap}
th{color:var(--m);font-size:.78rem;text-transform:uppercase}.n{text-align:right}.note{color:var(--m)}
.bars{display:grid;gap:4px}.bar{display:grid;grid-template-columns:70px 1fr 110px;align-items:center;gap:8px}.bar i{height:10px;background:var(--acc);border-radius:2px;display:block}.bar em{font-style:normal;color:var(--m)}
.ev{list-style:none;margin:0;padding:0;max-height:520px;overflow:auto}.ev li{padding:3px 6px;border-left:3px solid transparent}.ev li b{display:inline-block;width:52px;color:var(--m)}
.ev .t0{border-left-color:var(--acc)}.ev .t1{border-left-color:var(--warn)}
</style></head><body><main><header><h1>${esc(r.title)}</h1><p>${esc(r.startedAt.replace('T', ' ').slice(0, 19))} · ${(r.ms / 1000).toFixed(1)} s</p><p>${params}</p></header>
${r.sections.map(sectionHtml).join('\n')}</main></body></html>`;
}

/** texto para o terminal: KPIs, metas e tabelas (até 25 linhas cada); lance a lance resumido */
export function reportText(r: Report): string {
  const lines: string[] = [`== ${r.title} (${(r.ms / 1000).toFixed(1)} s) ==`];
  const pad = (rows: string[][]) => {
    const w = rows[0]!.map((_, i) => Math.max(...rows.map((x) => (x[i] ?? '').length)));
    return rows.map((x) => x.map((c, i) => c.padEnd(w[i]!)).join('  ').trimEnd());
  };
  for (const s of r.sections) {
    lines.push('');
    if (s.kind === 'kpis') { if (s.title) lines.push(`# ${s.title}`); for (const k of s.items) lines.push(`  ${k.label}: ${k.value}${k.hint ? ` (${k.hint})` : ''}`); }
    else if (s.kind === 'checks') { lines.push(`# ${s.title}`); lines.push(...pad(s.items.map((c) => [c.ok ? '  [ok]  ' : '  [FORA]', c.label, c.value, `meta ${c.target}`]))); }
    else if (s.kind === 'table') { lines.push(`# ${s.title}`); lines.push(...pad([s.columns, ...s.rows.slice(0, 25).map((x) => x.map((c) => String(cell(c))))]).map((l) => `  ${l}`)); if (s.rows.length > 25) lines.push(`  … +${s.rows.length - 25} linhas (veja o HTML)`); }
    else if (s.kind === 'bars') { lines.push(`# ${s.title}`); for (const b of s.items) lines.push(`  ${b.label.padEnd(8)} ${b.display ?? b.value}`); }
    else if (s.kind === 'events') { lines.push(`# ${s.title} (${s.items.length} lances; os principais no HTML)`); }
    else { if (s.title) lines.push(`# ${s.title}`); lines.push(s.body); }
  }
  return lines.join('\n');
}
