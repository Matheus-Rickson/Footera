/**
 * Janela do Laboratório: escolhe um cenário, preenche os parâmetros (formulário gerado da definição do cenário), roda num worker
 * com progresso e cancelamento, e mostra o relatório — as mesmas seções que o terminal (`npm run lab:run`) e o HTML exportado mostram.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OptionSource, ParamDef, ParamValue, Progress, Report, Section } from '../core/types.ts';

interface CatalogItem { id: string; title: string; description: string; params: ParamDef[] }
type Opt = { value: string; label: string };
declare global {
  interface Window {
    lab: {
      catalog: () => Promise<CatalogItem[]>;
      options: (source: OptionSource, params: Record<string, ParamValue>) => Promise<Opt[]>;
      run: (id: string, params: Record<string, ParamValue>) => Promise<Report>;
      cancel: () => Promise<boolean>;
      save: (r: Report) => Promise<string>;
      openReports: () => Promise<string>;
      onProgress: (fn: (p: Progress) => void) => () => void;
    };
  }
}

const defaults = (s: CatalogItem): Record<string, ParamValue> => Object.fromEntries(s.params.map((d) => [d.key, d.default]));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function App() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [sel, setSel] = useState<string>('');
  const [values, setValues] = useState<Record<string, Record<string, ParamValue>>>({});
  const [opts, setOpts] = useState<Record<string, Opt[] | 'loading' | string>>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [shown, setShown] = useState<Report | null>(null);
  /** caminho do HTML salvo, por execução (início + cenário) */
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return localStorage.getItem('lab.theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('lab.theme', theme); } catch { /* opcional */ } }, [theme]);
  useEffect(() => { window.lab.catalog().then((c) => { setCatalog(c); setSel(c[0]?.id ?? ''); setValues(Object.fromEntries(c.map((s) => [s.id, defaults(s)]))); }).catch((e) => setError(errText(e))); }, []);
  useEffect(() => window.lab.onProgress(setProgress), []);

  const scenario = catalog.find((s) => s.id === sel);
  const v = (scenario && values[scenario.id]) || {};
  const universe = String(v.universe ?? '');

  // opções dinâmicas (clubes mudam com o universo; saves e formações uma vez)
  const sources = useMemo(() => [...new Set((scenario?.params ?? []).flatMap((d) => (d.kind === 'select' && d.source ? [d.source] : [])))], [scenario]);
  useEffect(() => {
    for (const src of sources) {
      const key = src === 'clubs' ? `clubs:${universe}` : src;
      if (opts[key] !== undefined) continue;
      setOpts((o) => ({ ...o, [key]: 'loading' }));
      window.lab.options(src, { universe }).then((list) => setOpts((o) => ({ ...o, [key]: list }))).catch((e) => setOpts((o) => ({ ...o, [key]: `erro: ${errText(e)}` })));
    }
  }, [sources, universe, opts]);

  const set = (k: string, val: ParamValue) => scenario && setValues((all) => ({ ...all, [scenario.id]: { ...all[scenario.id], [k]: val } }));

  const run = useCallback(async () => {
    if (!scenario) return;
    setRunning(true); setError(null); setProgress({ done: 0, total: 1, label: 'preparando' });
    try {
      const r = await window.lab.run(scenario.id, v);
      setHistory((h) => [...h, r]); setShown(r);
    } catch (e) { setError(errText(e)); } finally { setRunning(false); setProgress(null); }
  }, [scenario, v]);

  const report = shown;
  const keyOf = (r: Report) => `${r.startedAt}|${r.scenario}`;

  return (
    <div className="lab">
      <header className="lab-top">
        <strong className="lab-brand">FOOTERA <span>Laboratório</span></strong>
        <span className="muted small">Testes do jogo à parte: nada aqui altera os seus saves.</span>
        <div className="lab-top-actions">
          <button className="secondary" onClick={() => void window.lab.openReports()}>Pasta de relatórios</button>
          <button className="secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</button>
        </div>
      </header>
      <div className="lab-body">
        <aside className="lab-side">
          <section className="card ui-panel">
            <header className="ui-panel-head"><h2 className="ui-band">Cenários</h2></header>
            <nav className="lab-list" aria-label="Cenários">
              {catalog.map((s) => (
                <button key={s.id} className={`lab-item ${s.id === sel ? 'lab-on' : ''}`} aria-current={s.id === sel ? 'true' : undefined} onClick={() => setSel(s.id)}>
                  <b>{s.title}</b><span>{s.description}</span>
                </button>
              ))}
            </nav>
          </section>
          <section className="card ui-panel lab-hist">
            <header className="ui-panel-head"><h2 className="ui-band">Execuções desta sessão</h2></header>
            {history.length === 0 ? <p className="muted small">Nenhuma ainda.</p> : (
              <nav className="lab-list" aria-label="Execuções">
                {history.map((r, i) => (
                  <button key={i} className={`lab-item ${r === shown ? 'lab-on' : ''}`} onClick={() => setShown(r)}>
                    <b>{r.title}</b><span>{r.startedAt.slice(11, 19)} · {(r.ms / 1000).toFixed(1)} s</span>
                  </button>
                )).reverse()}
              </nav>
            )}
          </section>
        </aside>

        <main className="lab-main">
          {scenario && (
            <section className="card ui-panel">
              <header className="ui-panel-head"><h2 className="ui-band">{scenario.title}</h2>
                <div className="ui-panel-actions">
                  {running ? <button className="danger" onClick={() => void window.lab.cancel()}>Cancelar</button>
                    : <button onClick={() => void run()}>Rodar</button>}
                  <button className="secondary" disabled={running} onClick={() => setValues((all) => ({ ...all, [scenario.id]: defaults(scenario) }))}>Valores padrão</button>
                </div>
              </header>
              <p className="muted small lab-desc">{scenario.description}</p>
              <div className="lab-form">
                {scenario.params.map((d) => <Field key={d.key} d={d} value={v[d.key] ?? d.default} disabled={running} onChange={(x) => set(d.key, x)}
                  dynamic={d.kind === 'select' && d.source ? opts[d.source === 'clubs' ? `clubs:${universe}` : d.source] : undefined} />)}
              </div>
              {progress && (
                <div className="lab-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                  <i style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
                  <span>{Math.floor((100 * progress.done) / Math.max(1, progress.total))}%{progress.label ? ` · ${progress.label}` : ''}</span>
                </div>
              )}
              {error && <p className="error" role="alert">{error}</p>}
            </section>
          )}
          {report && <ReportView r={report} savedPath={saved[keyOf(report)]} onSave={async () => { const p = await window.lab.save(report); setSaved((s) => ({ ...s, [keyOf(report)]: p })); }} />}
        </main>
      </div>
    </div>
  );
}

function Field({ d, value, onChange, disabled, dynamic }: { d: ParamDef; value: ParamValue; onChange: (v: ParamValue) => void; disabled: boolean; dynamic?: Opt[] | 'loading' | string }) {
  const id = `p-${d.key}`;
  const label = <label htmlFor={id}>{d.label}</label>;
  const help = d.help ? <small className="muted">{d.help}</small> : null;
  if (d.kind === 'boolean') return <div className="lab-field lab-check"><label><input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{d.label}</label>{help}</div>;
  if (d.kind === 'number') return <div className="lab-field">{label}<input id={id} type="number" min={d.min} max={d.max} step={d.step ?? 1} value={Number(value)} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? d.default : Number(e.target.value))} />{help}</div>;
  if (d.kind === 'text') return <div className="lab-field">{label}<input id={id} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />{help}</div>;
  const extra = Array.isArray(dynamic) ? dynamic : [];
  return (
    <div className="lab-field">{label}
      <select id={id} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {(d.options ?? []).map((o) => <option key={`f-${o.value}`} value={o.value}>{o.label}</option>)}
        {extra.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {dynamic === 'loading' && <small className="muted">carregando opções…</small>}
      {typeof dynamic === 'string' && dynamic !== 'loading' && <small className="error">{dynamic}</small>}
      {help}
    </div>
  );
}

function ReportView({ r, onSave, savedPath }: { r: Report; onSave: () => Promise<void>; savedPath?: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card ui-panel lab-report">
      <header className="ui-panel-head"><h2 className="ui-band">Relatório · {r.title}</h2>
        <div className="ui-panel-actions">
          <span className="muted small">{r.startedAt.replace('T', ' ').slice(0, 19)} · {(r.ms / 1000).toFixed(1)} s</span>
          <button className="secondary" onClick={() => onSave().catch((e) => setErr(errText(e)))}>Salvar HTML e JSON</button>
        </div>
      </header>
      <div className="lab-params">{Object.entries(r.params).map(([k, v]) => <code key={k}>{k}={String(v)}</code>)}</div>
      {savedPath && <p className="ok small">Salvo em {savedPath}</p>}
      {err && <p className="error">{err}</p>}
      {r.sections.map((s, i) => <SectionView key={i} s={s} />)}
    </section>
  );
}

function SectionView({ s }: { s: Section }) {
  if (s.kind === 'kpis') return (
    <div className="lab-sec">{s.title && <h3>{s.title}</h3>}
      <div className="lab-kpis">{s.items.map((k, i) => (
        <div key={i} className="ui-stat lab-kpi"><span className="ui-stat-label">{k.label}</span>
          <span className={`ui-stat-value ${k.tone === 'ok' ? 'ui-tone-good' : k.tone === 'warn' ? 'ui-tone-mid' : k.tone === 'bad' ? 'ui-tone-low' : ''}`}>{k.value}</span>
          {k.hint && <span className="ui-stat-sub">{k.hint}</span>}</div>))}</div>
    </div>
  );
  if (s.kind === 'checks') return (
    <div className="lab-sec"><h3>{s.title}</h3>
      <table className="lab-table"><thead><tr><th>Meta</th><th className="right">Resultado</th><th className="right">Faixa</th><th /></tr></thead>
        <tbody>{s.items.map((c, i) => <tr key={i}><td>{c.label}</td><td className="right">{c.value}</td><td className="right muted">{c.target}</td><td className={c.ok ? 'lab-ok' : 'lab-bad'}>{c.ok ? '✓ ok' : '✗ fora'}</td></tr>)}</tbody></table>
    </div>
  );
  if (s.kind === 'table') return (
    <div className="lab-sec"><h3>{s.title}</h3>
      <div className="lab-tw"><table className="lab-table"><thead><tr>{s.columns.map((c, i) => <th key={i} className={s.numeric?.includes(i) ? 'right' : ''}>{c}</th>)}</tr></thead>
        <tbody>{s.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className={s.numeric?.includes(j) ? 'right' : ''}>{c ?? '—'}</td>)}</tr>)}</tbody></table></div>
      {s.note && <p className="muted small">{s.note}</p>}
    </div>
  );
  if (s.kind === 'bars') {
    const max = Math.max(1, ...s.items.map((b) => b.value));
    return (
      <div className="lab-sec"><h3>{s.title}</h3>
        <div className="lab-bars">{s.items.map((b, i) => <div key={i} className="lab-bar"><span>{b.label}</span><i style={{ width: `${(100 * b.value) / max}%` }} /><em>{b.display ?? b.value}</em></div>)}</div>
        {s.note && <p className="muted small">{s.note}</p>}
      </div>
    );
  }
  if (s.kind === 'events') return (
    <div className="lab-sec"><h3>{s.title}</h3>
      <ol className="lab-ev">{s.items.map((e, i) => <li key={i} className={`lab-ev-${e.team ?? 'n'}`}><b>{e.minute}</b>{e.text}</li>)}</ol>
    </div>
  );
  return <div className="lab-sec">{s.title && <h3>{s.title}</h3>}<p className={s.tone === 'bad' ? 'error' : s.tone === 'warn' ? 'notice' : ''} style={{ whiteSpace: 'pre-line' }}>{s.body}</p></div>;
}
