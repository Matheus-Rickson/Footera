import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SchemeDto, TacticsOverviewDto } from '../../shared/api.ts';
import type { TeamTactics } from '../../game/match-engine/types.ts';
import { BUILDUP_LABEL, MENTALITY_LABEL, errMsg, fmtDate, shortName, unwrap } from '../util.ts';
import { PitchView } from './PitchView.tsx';

interface Draft { id: string | null; name: string; formation: string; settings: TeamTactics; lineup: string[] | null; builtin: boolean }
interface Props { profileId: string; careerId: string }

const fromScheme = (s: SchemeDto): Draft => ({ id: s.id, name: s.name, formation: s.formation, settings: { ...s.settings }, lineup: s.lineup ? [...s.lineup] : null, builtin: s.builtin });

function Slider({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <label><span>{label}: <strong>{value}</strong></span>
      <input type="range" min={1} max={5} step={1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function TacticsView({ profileId, careerId }: Props) {
  const [ov, setOv] = useState<TacticsOverviewDto | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [autoPreview, setAutoPreview] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => { setError(errMsg(e)); setMsg(null); };
  const refreshAuto = useCallback(async (formation: string) => {
    try { setAutoPreview(await unwrap(window.api.autoLineup(profileId, careerId, formation))); } catch (e) { setError(errMsg(e)); }
  }, [profileId, careerId]);

  const load = useCallback(async (selectId?: string) => {
    const o = await unwrap(window.api.getTactics(profileId, careerId));
    setOv(o);
    const s = o.schemes.find((x) => x.id === selectId) ?? o.schemes.find((x) => x.active) ?? o.schemes[0]!;
    setDraft(fromScheme(s));
    await refreshAuto(s.formation);
  }, [profileId, careerId, refreshAuto]);

  useEffect(() => { load().catch(fail); }, [load]);

  const squad = useMemo(() => new Map((ov?.squad ?? []).map((p) => [p.id, p])), [ov]);
  const formation = ov?.formations.find((f) => f.id === draft?.formation);
  if (!ov || !draft || !formation) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando táticas…</p>;

  const readOnly = draft.builtin;
  const ids = draft.lineup ?? autoPreview;
  const set = <K extends keyof TeamTactics>(k: K, v: TeamTactics[K]) => setDraft({ ...draft, settings: { ...draft.settings, [k]: v } });

  async function run(fn: () => Promise<void>) { setBusy(true); setError(null); setMsg(null); try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); } }

  const changeFormation = (f: string) => run(async () => {
    const next = { ...draft, formation: f };
    if (draft.lineup) next.lineup = await unwrap(window.api.autoLineup(profileId, careerId, f));
    setDraft(next); await refreshAuto(f);
  });
  const toggleAuto = (auto: boolean) => run(async () => {
    setDraft({ ...draft, lineup: auto ? null : (await unwrap(window.api.autoLineup(profileId, careerId, draft.formation))) });
  });
  const assign = (slotIdx: number, playerId: string) => {
    const cur = [...(draft.lineup ?? autoPreview)];
    const other = cur.indexOf(playerId);
    if (other >= 0) cur[other] = cur[slotIdx]!;
    cur[slotIdx] = playerId;
    setDraft({ ...draft, lineup: cur });
  };
  const save = () => run(async () => {
    const saved = await unwrap(window.api.saveScheme(profileId, careerId, { id: draft.id, name: draft.name, formation: draft.formation, settings: draft.settings, lineup: draft.lineup }));
    await load(saved.id); setMsg(`Esquema "${saved.name}" salvo.`);
  });
  const duplicate = (id: string) => run(async () => { const d = await unwrap(window.api.duplicateScheme(profileId, careerId, id)); await load(d.id); setMsg(`Criado "${d.name}". Edite e salve.`); });
  const remove = (s: SchemeDto) => { if (!window.confirm(`Excluir o esquema "${s.name}"?`)) return; void run(async () => { await unwrap(window.api.deleteScheme(profileId, careerId, s.id)); await load(); setMsg('Esquema excluído.'); }); };
  const activate = (s: SchemeDto) => run(async () => { await unwrap(window.api.activateScheme(profileId, careerId, s.id)); await load(s.id); setMsg(`"${s.name}" agora é o esquema usado nos jogos.`); });
  const startNew = () => { const base = ov.schemes.find((s) => s.active) ?? ov.schemes[0]!; setDraft({ ...fromScheme(base), id: null, name: 'Novo esquema', builtin: false }); setMsg(null); setError(null); };

  const slotInfo = formation.slots.map((s, i) => {
    const p = squad.get(ids[i] ?? '');
    const natural = !!p && (p.position === s.pos || p.secondaryPositions.includes(s.pos));
    return { s, i, p, natural, unavailable: p?.unavailable ?? null };
  });

  return (
    <div className="tactics">
      <section className="card">
        <div className="bar"><h2>Esquemas</h2><button className="secondary" disabled={busy} onClick={startNew}>Novo esquema</button></div>
        <ul className="schemes">
          {ov.schemes.map((s) => (
            <li key={s.id} className={s.id === draft.id ? 'sel' : ''}>
              <button className="link" onClick={() => { setDraft(fromScheme(s)); void refreshAuto(s.formation); setMsg(null); setError(null); }}>{s.name}</button>
              <span className="muted small">{s.builtin ? ' padrão' : ''}{s.active ? ' · ATIVO' : ''}</span>
              <span className="row">
                {!s.active && <button className="secondary" disabled={busy} onClick={() => void activate(s)}>Ativar</button>}
                <button className="secondary" disabled={busy} onClick={() => void duplicate(s.id)}>Duplicar</button>
                {!s.builtin && <button className="danger" disabled={busy} onClick={() => remove(s)}>Excluir</button>}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">O esquema <strong>ativo</strong> é o usado nas suas próximas partidas.</p>
      </section>

      <section className="card">
        <h2>{draft.id ? (readOnly ? 'Esquema padrão (somente leitura)' : 'Editar esquema') : 'Novo esquema'}</h2>
        {readOnly && <p className="notice">Esquemas padrão não podem ser editados. Use <strong>Duplicar</strong> para criar a sua versão.</p>}
        <div className="grid2">
          <label>Nome<input value={draft.name} maxLength={40} disabled={readOnly} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>Formação
            <select value={draft.formation} disabled={readOnly || busy} onChange={(e) => void changeFormation(e.target.value)}>{ov.formations.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}</select>
          </label>
        </div>

        <h3>Geral</h3>
        <label>Mentalidade
          <select value={draft.settings.mentality} disabled={readOnly} onChange={(e) => set('mentality', e.target.value as TeamTactics['mentality'])}>
            {Object.entries(MENTALITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <div className="grid2">
          <div>
            <h3>Com a bola</h3>
            <label>Saída de bola
              <select value={draft.settings.buildUp} disabled={readOnly} onChange={(e) => set('buildUp', e.target.value as TeamTactics['buildUp'])}>
                {Object.entries(BUILDUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <Slider label="Ritmo" value={draft.settings.tempo} disabled={readOnly} onChange={(v) => set('tempo', v)} />
            <Slider label="Amplitude" value={draft.settings.width} disabled={readOnly} onChange={(v) => set('width', v)} />
          </div>
          <div>
            <h3>Sem a bola</h3>
            <Slider label="Linha defensiva" value={draft.settings.defensiveLine} disabled={readOnly} onChange={(v) => set('defensiveLine', v)} />
            <Slider label="Pressão" value={draft.settings.pressing} disabled={readOnly} onChange={(v) => set('pressing', v)} />
          </div>
        </div>
        <p className="muted small">Instruções de transição (defensiva e ofensiva), marcação, cruzamentos e demais ajustes finos ainda não existem no motor.</p>
      </section>

      <section className="card wide">
        <h2>Escalação</h2>
        <label className="inline"><input type="checkbox" checked={draft.lineup === null} disabled={readOnly || busy} onChange={(e) => void toggleAuto(e.target.checked)} /> Automática (o melhor time disponível a cada jogo)</label>
        <div className="grid2">
          <div className="slots">
            {slotInfo.map(({ s, i, natural, unavailable }) => (
              <div className="slot" key={i}>
                <span className="slotpos">{s.pos}</span>
                <select aria-label={`Jogador para ${s.pos} (posição ${i + 1})`} value={ids[i] ?? ''} disabled={readOnly || draft.lineup === null || busy} onChange={(e) => assign(i, e.target.value)}>
                  {(ov.squad).map((q) => (
                    <option key={q.id} value={q.id} disabled={!!q.unavailable && q.id !== ids[i]}>
                      {q.name} · {q.position} · {q.slotScores[s.pos]}{q.unavailable ? (q.unavailable.kind === 'injured' ? ' · lesionado' : ' · suspenso') : ''}
                    </option>
                  ))}
                </select>
                <span className="small muted">{unavailable ? (unavailable.kind === 'injured' ? `lesionado até ${fmtDate(unavailable.until)} — será substituído` : 'suspenso — será substituído') : natural ? '' : 'fora de posição'}</span>
              </div>
            ))}
            {draft.lineup !== null && !readOnly && <button className="secondary" disabled={busy} onClick={() => void toggleAuto(false)}>Preencher com o melhor time</button>}
          </div>
          <PitchView ariaLabel={`Escalação ${draft.formation}`}
            slots={slotInfo.map(({ s, i, p, natural }) => ({ key: String(i), pos: s.pos, x: s.x, y: s.y, label: shortName(p?.name ?? ''), warn: !natural }))} />
        </div>
        <p className="muted small">O número ao lado de cada jogador é o quanto ele rende naquela função (já considerando a posição natural). Laranja no campo = jogador fora de posição.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {msg && <p className="ok" role="status">{msg}</p>}
        <div className="row end">
          {draft.id && readOnly && <button disabled={busy} onClick={() => void duplicate(draft.id!)}>Duplicar para editar</button>}
          {!readOnly && <button disabled={busy || !draft.name.trim()} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar esquema'}</button>}
        </div>
      </section>
    </div>
  );
}
