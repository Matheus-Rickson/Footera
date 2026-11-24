import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Ban, Cross, Dumbbell, LayoutGrid, Save, SlidersHorizontal, Trash2, UserCog, Users, Wand2, X } from 'lucide-react';
import type { SchemeDto, TacticsOverviewDto, TacticsSquadPlayer } from '../../shared/api.ts';
import type { TeamTactics } from '../../game/match-engine/types.ts';
import type { Position } from '../../shared/types.ts';
import { ANCHORS, FORMATIONS, customFormationId, formationLabel, getFormation } from '../../game/match-engine/formations.ts';
import { isRelatedPosition } from '../../game/match-engine/roles.ts';
import { roleFactorFrom } from '../../game/match-engine/playerRoles.ts';
import { BUILDUP_LABEL, MENTALITY_LABEL, errMsg, fmtDate, shortName, unwrap } from '../util.ts';
import { PlayerFace, POS_NAME, posLabel, PosPill, to20, tone } from '../playerUi.tsx';
import { useImages } from '../images.ts';
import { PlayerQuickView } from './PlayerProfile.tsx';
import { RoleField } from '../roleField.tsx';
import { Panel } from '../ui/index.tsx';

interface Props { profileId: string; careerId: string; /** abre a ficha completa do jogador */ onOpenPlayer?: (id: string) => void }
/**
 * Tática em edição = o esquema ativo (salvo a cada mudança). `lineup` null = escalação automática a cada jogo.
 * `roles`: função de cada vaga (fica com a vaga, não com o jogador; null = a que mais combina com quem estiver ali).
 */
interface Work { scheme: SchemeDto; formation: string; settings: TeamTactics; lineup: string[] | null; roles: Array<string | null> }
const NO_ROLES = (): Array<string | null> => Array<string | null>(11).fill(null);

/** faixa vertical do gramado usada pelos crachás: nome, posição e função cabem embaixo do goleiro e em cima do centroavante */
const FIELD_TOP = 4, FIELD_SPAN = 0.84;
const chipStyle = (id: string) => { const a = ANCHORS.find((x) => x.id === id)!; return { left: `${a.x}%`, top: `${FIELD_TOP + (100 - a.y) * FIELD_SPAN}%` }; };
const anchorsOf = (formation: string) => getFormation(formation).slots.map((s) => s.anchor);
/** volta ao nome da pré-definição quando as posições (na mesma ordem) são as dela */
const formationFrom = (anchors: string[]) => FORMATIONS.find((f) => f.slots.map((s) => s.anchor).join() === anchors.join())?.id ?? customFormationId(anchors);
/** nome da âncora na tela (ALE/ALD/ME/MD ou a sigla da função) */
const anchorLabel = (id: string) => posLabel(ANCHORS.find((x) => x.id === id)!.pos);
const anchorTitle = (id: string) => POS_NAME[ANCHORS.find((x) => x.id === id)!.pos];
/** Mantém a função de cada vaga só se ela ainda servir para a posição da vaga (a formação pode ter mudado). */
function keepRoles(formation: string, roles: Array<string | null>, catalog: TacticsOverviewDto['roleCatalog']): Array<string | null> {
  return getFormation(formation).slots.map((s, i) => { const r = roles[i] ? catalog.find((c) => c.id === roles[i]) : undefined; return r && r.positions.includes(s.pos) ? r.id : null; });
}
const rolesInput = (roles: Array<string | null>) => (roles.some((r) => r !== null) ? roles : null);
const fitTone = (p: TacticsSquadPlayer, pos: Position) => (p.position === pos ? 'great' : p.secondaryPositions.includes(pos) || isRelatedPosition(p.position, pos) ? 'good' : 'poor');

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Record<T, string>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ui-seg" role="radiogroup" aria-label={label}>
      {(Object.keys(options) as T[]).map((k) => <button key={k} type="button" role="radio" aria-checked={value === k} className={`ui-seg-btn ${value === k ? 'ui-seg-on' : ''}`} onClick={() => onChange(k)}>{options[k]}</button>)}
    </div>
  );
}

export function TacticsView({ profileId, careerId, onOpenPlayer }: Props) {
  const img = useImages();
  const [ov, setOv] = useState<TacticsOverviewDto | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [autoXI, setAutoXI] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  /** arraste em curso: 'reshape' = titular de linha (pode ir para uma vaga livre, que então aparece); 'swap' = só troca com quem está em campo */
  const [dragging, setDragging] = useState<null | 'swap' | 'reshape'>(null);
  /** crachá que acompanha o ponteiro (coordenadas dentro de `.tc`) */
  const [ghost, setGhost] = useState<{ pid: string; x: number; y: number } | null>(null);
  const drag = useRef<{ pid: string; sx: number; sy: number; active: boolean; target: string | null; targets: string[] } | null>(null);
  /** o clique que o navegador dispara ao soltar não deve abrir a janela de função/estilo nem a do jogador */
  const justDragged = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<(pid: string, target: string) => void>(() => undefined);
  // solta o ponteiro se a tela sair no meio de um arraste
  useEffect(() => () => { document.body.classList.remove('tc-grabbing'); }, []);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [styleOpen, setStyleOpen] = useState(false);
  /** jogador do campo cujo painel de funções está aberto */
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [rolePreview, setRolePreview] = useState<string | null>(null); // função sob o mouse (campinho animado)
  /** jogador do elenco cuja janela de informações está aberta */
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const closeInfo = useCallback(() => setInfoFor(null), []);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const o = await unwrap(window.api.getTactics(profileId, careerId));
    const s = o.schemes.find((x) => x.active) ?? o.schemes[0]!;
    setOv(o);
    setWork({ scheme: s, formation: s.formation, settings: { ...s.settings }, lineup: s.lineup ? [...s.lineup] : null, roles: s.roles ? keepRoles(s.formation, s.roles, o.roleCatalog) : NO_ROLES() });
    setAutoXI(await unwrap(window.api.autoLineup(profileId, careerId, s.formation)));
  }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load]);

  const squad = useMemo(() => new Map((ov?.squad ?? []).map((p) => [p.id, p])), [ov]);

  /** Salva a tática na hora. Se o ativo for uma pré-definição antiga (somente leitura), cria "Minha tática" e a ativa. */
  const persist = useCallback(async (next: Work) => {
    setWork(next); setSaving(true); setError(null);
    try {
      let scheme = next.scheme;
      const input = { formation: next.formation, settings: next.settings, lineup: next.lineup, roles: rolesInput(next.roles) };
      if (scheme.builtin) {
        const names = new Set((ov?.schemes ?? []).map((s) => s.name.toLocaleLowerCase('pt-BR')));
        let name = 'Minha tática'; for (let n = 2; names.has(name.toLocaleLowerCase('pt-BR')); n++) name = `Minha tática ${n}`;
        scheme = await unwrap(window.api.saveScheme(profileId, careerId, { id: null, name, ...input }));
        await unwrap(window.api.activateScheme(profileId, careerId, scheme.id));
        const o = await unwrap(window.api.getTactics(profileId, careerId)); setOv(o);
        scheme = o.schemes.find((x) => x.id === scheme.id) ?? scheme;
      } else scheme = await unwrap(window.api.saveScheme(profileId, careerId, { id: scheme.id, name: scheme.name, ...input }));
      setWork({ ...next, scheme });
    } catch (e) { setError(errMsg(e)); await load().catch(() => undefined); } finally { setSaving(false); }
  }, [ov, profileId, careerId, load]);

  if (!ov || !work) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando táticas…</p>;
  const anchors = anchorsOf(work.formation);
  const ids = work.lineup ?? autoXI;
  const slotOf = new Map(ids.map((id, i) => [id, i]));
  const occupant = new Map(anchors.map((a, i) => [a, ids[i]!]));

  /** Solta (ou clica) o jogador `pid` na âncora `target`. */
  function place(pid: string, target: string) {
    setHint(null); setSelected(null);
    const lineup = [...ids];
    const from = slotOf.get(pid);
    const ti = anchors.indexOf(target);
    if (ti >= 0) { // âncora ocupada: troca de lugar (ou entra no lugar do titular)
      if (from === ti) return;
      if (from !== undefined) lineup[from] = lineup[ti]!;
      lineup[ti] = pid;
      void persist({ ...work!, lineup });
      return;
    }
    // âncora vazia: só um titular pode ir para lá (a formação muda); o goleiro fica no gol
    if (from === undefined) { setHint('Solte sobre um titular para trocá-lo. Para mudar a formação, arraste um titular para uma posição vazia do campo.'); return; }
    if (from === 0 || target === 'GK') { setHint('O goleiro fica no gol: troque-o por outro jogador soltando sobre ele.'); return; }
    const nextAnchors = [...anchors]; nextAnchors[from] = target;
    const formation = formationFrom(nextAnchors);
    void persist({ ...work!, formation, lineup, roles: keepRoles(formation, work!.roles, ov!.roleCatalog) });
  }
  placeRef.current = place;
  const applyPreset = async (id: string) => {
    setHint(null);
    try { const lineup = await unwrap(window.api.autoLineup(profileId, careerId, id)); setAutoXI(lineup); await persist({ ...work, formation: id, lineup, roles: NO_ROLES() }); } catch (e) { setError(errMsg(e)); }
  };
  const bestXI = async () => {
    try { const lineup = await unwrap(window.api.autoLineup(profileId, careerId, work.formation)); setAutoXI(lineup); await persist({ ...work, lineup }); } catch (e) { setError(errMsg(e)); }
  };
  const setAuto = async (auto: boolean) => {
    if (auto) { setAutoXI(await unwrap(window.api.autoLineup(profileId, careerId, work.formation))); await persist({ ...work, lineup: null }); }
    else await persist({ ...work, lineup: [...ids] });
  };
  const setSetting = <K extends keyof TeamTactics>(k: K, v: TeamTactics[K]) => {
    const next = { ...work, settings: { ...work.settings, [k]: v } };
    setWork(next);
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(() => void persist(next), 350);
  };
  const userSchemes = ov.schemes.filter((s) => !s.builtin);
  const loadScheme = async (id: string) => { try { await unwrap(window.api.activateScheme(profileId, careerId, id)); await load(); } catch (e) { setError(errMsg(e)); } };
  const saveAs = async () => {
    try {
      const s = await unwrap(window.api.saveScheme(profileId, careerId, { id: null, name: newName, formation: work.formation, settings: work.settings, lineup: work.lineup, roles: rolesInput(work.roles) }));
      await unwrap(window.api.activateScheme(profileId, careerId, s.id)); setNewName(''); await load();
    } catch (e) { setError(errMsg(e)); }
  };
  const removeScheme = async () => {
    if (work.scheme.builtin || !window.confirm(`Excluir o esquema "${work.scheme.name}"?`)) return;
    try { await unwrap(window.api.deleteScheme(profileId, careerId, work.scheme.id)); await load(); } catch (e) { setError(errMsg(e)); }
  };
  /** posição de uma âncora na tela (mesma conta do `style` dos crachás) */
  const anchorPoint = (id: string, f: DOMRect) => { const a = ANCHORS.find((x) => x.id === id)!; return { x: f.left + (a.x / 100) * f.width, y: f.top + ((FIELD_TOP + (100 - a.y) * FIELD_SPAN) / 100) * f.height }; };
  /**
   * Arraste por ponteiro (no lugar do arrastar-e-soltar nativo): o crachá acompanha o cursor, a vaga válida mais perto
   * acende como um ímã (não é preciso acertar o círculo) e, ao soltar, os jogadores deslizam até o lugar novo.
   * Reserva só troca com um titular; titular de linha também pode ir para uma vaga livre (muda a formação); goleiro só troca.
   */
  const beginDrag = (pid: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || saving || drag.current) return;
    const from = slotOf.get(pid);
    const reshape = from !== undefined && from !== 0;
    const targets = reshape ? ANCHORS.map((a) => a.id) : anchors.filter((a) => a !== (from !== undefined ? anchors[from] : ''));
    drag.current = { pid, sx: e.clientX, sy: e.clientY, active: false, target: null, targets };
    const move = (ev: PointerEvent) => {
      const d = drag.current; if (!d) return;
      if (!d.active) {
        if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 6) return; // abaixo disso é um clique
        d.active = true; setDragging(reshape ? 'reshape' : 'swap'); setHint(null); document.body.classList.add('tc-grabbing');
      }
      ev.preventDefault();
      const f = fieldRef.current?.getBoundingClientRect();
      let target: string | null = null;
      if (f && ev.clientX > f.left - 24 && ev.clientX < f.right + 24 && ev.clientY > f.top - 24 && ev.clientY < f.bottom + 24) {
        let best = Infinity;
        for (const id of d.targets) { const p = anchorPoint(id, f); const dist = Math.hypot(p.x - ev.clientX, p.y - ev.clientY); if (dist < best) { best = dist; target = id; } }
      }
      if (target !== d.target) { d.target = target; setDragOver(target); }
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setGhost({ pid: d.pid, x: ev.clientX - r.left, y: ev.clientY - r.top });
    };
    const finish = (drop: boolean) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc);
      const d = drag.current; drag.current = null;
      document.body.classList.remove('tc-grabbing');
      setDragging(null); setDragOver(null); setGhost(null);
      if (!d?.active) return;
      justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 0);
      if (drop && d.target) placeRef.current(d.pid, d.target);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(false); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', esc);
  };
  const presetActive = FORMATIONS.find((f) => f.id === work.formation)?.id ?? null;
  const catalog = new Map(ov.roleCatalog.map((r) => [r.id, r]));
  const slotsNow = getFormation(work.formation).slots;
  const fitOf = (p: TacticsSquadPlayer, roleId: string) => p.roles.find((r) => r.id === roleId) ?? { id: roleId, suitability: 0, familiarity: 0 };
  /** em automático, o motor escolhe a função que mais rende para o jogador na vaga (compatibilidade × domínio) — mesmo cálculo daqui */
  const autoRole = (p: TacticsSquadPlayer, pos: Position) => {
    const opts = ov.roleCatalog.filter((r) => r.positions.includes(pos));
    const score = (id: string) => { const f = fitOf(p, id); return roleFactorFrom(f.suitability, f.familiarity, p.slotScores[pos]); };
    return opts.reduce((a, b) => (score(b.id) > score(a.id) ? b : a), opts[0]!);
  };
  const roleIn = (i: number, p: TacticsSquadPlayer) => (work.roles[i] ? catalog.get(work.roles[i]!)! : autoRole(p, slotsNow[i]!.pos));
  const setRole = (i: number, roleId: string | null) => { const roles = [...work.roles]; roles[i] = roleId; void persist({ ...work, roles }); };
  const trainRole = async (pid: string, roleId: string | null) => {
    try { await unwrap(window.api.setRoleFocus(profileId, careerId, pid, roleId)); setOv(await unwrap(window.api.getTactics(profileId, careerId))); } catch (e) { setError(errMsg(e)); }
  };
  const roleSlot = roleFor !== null ? slotOf.get(roleFor) : undefined;
  const rolePlayer = roleFor !== null && roleSlot !== undefined ? squad.get(roleFor) : undefined;
  /** "Trocar de lugar": fecha o painel e deixa o jogador selecionado para o próximo clique numa posição */
  const startMove = (pid: string) => { setRoleFor(null); setInfoFor(null); setSelected(pid); setHint('Clique na posição de destino (sobre um titular, eles trocam; numa posição vazia, a formação muda).'); };

  /** função da vaga no crachá do jogador (funções de render, não componentes: nada é remontado a cada mudança) */
  function chipRole(i: number) {
    const p = squad.get(ids[i]!); if (!p) return null;
    const r = roleIn(i, p);
    return <span className={`tc-chip-role ${work!.roles[i] ? '' : 'auto'}`} title={`Função: ${r.label}${work!.roles[i] ? '' : ' (automática)'}`}>{r.label}</span>;
  }
  function rolePanel(p: TacticsSquadPlayer, i: number) {
    const pos = slotsNow[i]!.pos;
    const chosen = work!.roles[i];
    const options = ov!.roleCatalog.filter((r) => r.positions.includes(pos));
    const focus = p.roleFocus ? catalog.get(p.roleFocus) : undefined;
    return (
      <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setRoleFor(null); }}>
      <div className="modal tc-roles-modal" role="dialog" aria-modal="true" aria-label={`Função de ${p.name}`} onKeyDown={(e) => { if (e.key === 'Escape') setRoleFor(null); }}>
        <header className="modal-head"><UserCog size={18} aria-hidden="true" />
          <div className="tc-roles-head"><h2>Função de {shortName(p.name)} · {POS_NAME[pos]}</h2><span className="muted small">A função fica com a vaga: quem jogar aqui joga assim.</span></div>
          <button className="secondary icon" aria-label="Fechar" autoFocus onClick={() => { setRoleFor(null); setRolePreview(null); }}><X size={16} aria-hidden="true" /></button></header>
        <div className="modal-body tc-roles">
        <div className="tc-roles-main">
        <div className="tc-roles-list" onMouseLeave={() => setRolePreview(null)}>
          <button className={`tc-role ${chosen === null ? 'on' : ''}`} disabled={saving} onClick={() => setRole(i, null)}
            onMouseEnter={() => setRolePreview(autoRole(p, pos).id)} onFocus={() => setRolePreview(autoRole(p, pos).id)}>
            <span className="tc-role-name">Automática</span><span className="tc-role-desc muted small">A que mais rende para quem estiver na vaga. Hoje: {autoRole(p, pos).label}.</span>
          </button>
          {options.map((r) => {
            const f = fitOf(p, r.id);
            return (
              <button key={r.id} className={`tc-role ${chosen === r.id ? 'on' : ''}`} disabled={saving} onClick={() => setRole(i, r.id)}
                onMouseEnter={() => setRolePreview(r.id)} onFocus={() => setRolePreview(r.id)}>
                <span className="tc-role-name">{r.label}</span>
                <span className="tc-role-desc muted small">{r.description}</span>
                <span className="tc-role-meter" title="Quanto os atributos dele combinam com a função"><span>Compatibilidade</span><i><b className={tone(f.suitability)} style={{ width: `${f.suitability}%` }} /></i><em>{to20(f.suitability)}</em></span>
                <span className="tc-role-meter" title="Quanto ele já sabe jogar assim (cresce jogando e treinando a função)"><span>Domínio</span><i><b className={tone(f.familiarity)} style={{ width: `${f.familiarity}%` }} /></i><em>{f.familiarity}%</em></span>
              </button>
            );
          })}
        </div>
        <div className="row small tc-roles-train"><Dumbbell size={14} aria-hidden="true" />
          <label className="inline">Função a treinar no mês:
            <select value={p.roleFocus ?? ''} disabled={saving} onChange={(e) => void trainRole(p.id, e.target.value || null)}>
              <option value="">Nenhuma</option>
              {options.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              {focus && !focus.positions.includes(pos) && <option value={focus.id}>{focus.label}</option>}
            </select></label>
          <span className="muted">O domínio também cresce jogando na função. Com o foco de atributos em Equilibrado (Treinamento), a evolução mensal privilegia os atributos da função treinada e a compatibilidade sobe aos poucos (até o potencial).</span>
        </div>
        </div>
        <RoleField roleId={rolePreview ?? chosen ?? autoRole(p, pos).id} pos={pos}
          title={rolePreview ? catalog.get(rolePreview)?.label : chosen ? catalog.get(chosen)?.label : `Automática: ${autoRole(p, pos).label}`} />
        </div>
        <footer className="modal-foot"><button className="secondary" onClick={() => startMove(p.id)}><ArrowLeftRight size={14} aria-hidden="true" />Trocar de lugar</button>
          <span className="muted small">{saving ? 'Salvando…' : 'Salvo automaticamente'}</span><button onClick={() => setRoleFor(null)}>Concluir</button></footer>
      </div>
      </div>
    );
  }

  return (
    <div className="tc" ref={rootRef}>
      <div className="tc-grid">
      <div className="tc-side">
      <div className="tc-bar card">
        <div className="tc-presets">
          <span className="tc-label">Pré-definições</span>
          <div className="ui-seg" role="radiogroup" aria-label="Formações pré-definidas">
            {FORMATIONS.map((f) => <button key={f.id} type="button" role="radio" aria-checked={presetActive === f.id} className={`ui-seg-btn ${presetActive === f.id ? 'ui-seg-on' : ''}`} disabled={saving} onClick={() => void applyPreset(f.id)}>{f.id}</button>)}
          </div>
        </div>
        <div className="tc-schemes">
          <select aria-label="Esquema" value={work.scheme.builtin ? '' : work.scheme.id} onChange={(e) => e.target.value && void loadScheme(e.target.value)}>
            {work.scheme.builtin && <option value="">Pré-definição {work.scheme.formation}</option>}
            {userSchemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input placeholder="Salvar como…" aria-label="Nome do novo esquema" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
          <button className="secondary icon" title="Salvar como novo esquema" disabled={!newName.trim() || saving} onClick={() => void saveAs()}><Save size={15} aria-hidden="true" /></button>
          {!work.scheme.builtin && <button className="secondary icon" title="Excluir este esquema" disabled={saving || userSchemes.length < 1} onClick={() => void removeScheme()}><Trash2 size={15} aria-hidden="true" /></button>}
          <span className="muted small tc-status">{saving ? 'Salvando…' : 'Salvo automaticamente'}</span>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

        <Panel className="tc-list" title="Elenco" icon={<Users size={18} aria-hidden="true" />} actions={<>
              <label className="inline small"><input type="checkbox" checked={work.lineup === null} disabled={saving} onChange={(e) => void setAuto(e.target.checked)} />Automática a cada jogo</label>
              <button className="secondary" disabled={saving} onClick={() => void bestXI()}><Wand2 size={14} aria-hidden="true" />Melhor escalação</button>
            </>}>
          <div className="tc-scroll">
            <table>
              <thead><tr><th>Escalado</th><th>Pos.</th><th className="center">Força</th><th>Jogador</th><th className="right">Cond.</th><th className="center" title="Quanto rende na vaga em que está escalado">Na vaga</th></tr></thead>
              <tbody>
                {ov.squad.map((p) => {
                  const i = slotOf.get(p.id);
                  const pos = i !== undefined ? getFormation(work.formation).slots[i]!.pos : null;
                  const anchor = i !== undefined ? anchors[i]! : null;
                  return (
                    <tr key={p.id} onPointerDown={beginDrag(p.id)} className={`tc-row ${i !== undefined ? 'tc-starter' : ''} ${selected === p.id ? 'tc-sel' : ''} ${ghost?.pid === p.id ? 'tc-lifted' : ''}`}
                      onClick={() => { if (justDragged.current) return; if (selected === p.id) setSelected(null); else setInfoFor(p.id); }} title="Clique para ver o jogador; arraste para o campo para escalá-lo">
                      <td>{anchor ? <span className="tc-badge" title={anchorTitle(anchor)}>{anchorLabel(anchor)}</span> : <span className="muted small">—</span>}</td>
                      <td><PosPill pos={p.position} /></td>
                      <td className="center"><span className={`sq-ovr ${tone(p.overall)}`}>{to20(p.overall)}</span></td>
                      <td><span className="sq-player"><PlayerFace img={img} id={p.id} name={p.name} className="tr-avatar" /><span className="tc-name">{p.name}</span>
                        {p.unavailable?.kind === 'injured' && <span className="tr-flag tr-flag-injury" title={`Lesionado até ${fmtDate(p.unavailable.until)}`}><Cross size={11} aria-hidden="true" /></span>}
                        {p.unavailable?.kind === 'suspended' && <span className="tr-flag tr-flag-susp" title={`Suspenso na liga (${p.unavailable.matches} jogo(s)); nas copas valem as suspensões de cada copa`}><Ban size={11} aria-hidden="true" /></span>}</span></td>
                      <td className="right">{Math.round(p.condition)}%</td>
                      <td className="center">{pos ? <b className={`tc-fit ${fitTone(p, pos)}`}>{to20(p.slotScores[pos])}</b> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hint && <p className="notice small" role="status">{hint}</p>}
          <p className="muted small">Clique num jogador para ver atributos, posições, funções e estatísticas. Arraste-o para o campo: sobre um titular, eles trocam; um titular arrastado para uma posição vazia muda a formação. Também dá para usar "Colocar em campo" na janela do jogador e depois clicar na posição.</p>
        </Panel>
      </div>

        <Panel className="tc-field-card" title={`Formação ${formationLabel(work.formation)}`} icon={<LayoutGrid size={18} aria-hidden="true" />}
          actions={<span className="muted small">{work.lineup === null ? 'Escalação automática: o melhor time disponível a cada jogo' : 'Escalação fixa: lesionados e suspensos são trocados no dia do jogo'}</span>}>
          <div ref={fieldRef} className={`tc-field ${dragging === 'reshape' || selected ? 'tc-placing' : ''} ${dragging ? 'tc-dragging' : ''}`} role="group" tabIndex={0} aria-label="Campo: clique no gramado (fora dos jogadores) ou tecle Enter para ajustar o estilo de jogo"
            onClick={(e) => { if (justDragged.current) return; if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.tc-lines')) { setSelected(null); setStyleOpen(true); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setStyleOpen(true); }}>
            <div className="tc-lines" aria-hidden="true"><i /><b /><s /><u /></div>
            {ANCHORS.filter((a) => !occupant.get(a.id) || !squad.get(occupant.get(a.id)!)).map((a) => (
              <button key={a.id} className={`tc-empty ${dragOver === a.id ? 'over' : ''} ${selected ? 'armed' : ''}`} style={chipStyle(a.id)} title={`Posição livre: ${anchorTitle(a.id)}`} aria-label={`Posição livre ${anchorTitle(a.id)}`}
                onClick={() => { if (selected) place(selected, a.id); }}><span>{anchorLabel(a.id)}</span></button>
            ))}
            {/* ordem fixa por id: trocar de vaga só muda left/top (o crachá desliza); reordenar o DOM cortaria a transição */}
            {anchors.map((aid, i) => ({ aid, pid: ids[i]! })).filter((x) => squad.has(x.pid)).sort((a, b) => (a.pid < b.pid ? -1 : 1)).map(({ aid, pid }) => {
              const a = ANCHORS.find((x) => x.id === aid)!;
              const p = squad.get(pid)!;
              return (
                <button key={pid} className={`tc-chip-p ${dragOver === a.id ? 'over' : ''} ${selected === p.id ? 'sel' : ''} ${ghost?.pid === p.id ? 'tc-lifted' : ''}`} style={chipStyle(a.id)} title={`${p.name} — ${anchorTitle(a.id)} (rende ${to20(p.slotScores[a.pos])} de 20)`}
                  onPointerDown={beginDrag(p.id)}
                  onClick={() => { if (justDragged.current) return; if (selected) place(selected, a.id); else setRoleFor(pid); }}>
                  <PlayerFace img={img} id={p.id} name={p.name} className={`tc-face ${fitTone(p, a.pos)}`} />
                  <span className="tc-chip-name">{shortName(p.name)}</span>
                  <span className="tc-chip-pos"><b>{anchorLabel(a.id)}</b><i className={fitTone(p, a.pos)}>{to20(p.slotScores[a.pos])}</i></span>
                  {chipRole(anchors.indexOf(a.id))}
                  {p.unavailable && <span className="tc-out" title={p.unavailable.kind === 'injured' ? 'Lesionado: será trocado no dia do jogo' : 'Suspenso: será trocado no dia do jogo'}>!</span>}
                </button>
              );
            })}
          </div>
          <div className="row small muted tc-legend"><span className="tc-key great" />Posição natural<span className="tc-key good" />Secundária ou parecida<span className="tc-key poor" />Fora de posição
            <span className="tc-style-hint"><SlidersHorizontal size={13} aria-hidden="true" />Clique num jogador para a função dele; no gramado, para o estilo de jogo ({MENTALITY_LABEL[work.settings.mentality]?.toLowerCase()})</span></div>
        </Panel>
      </div>

      {ghost && squad.get(ghost.pid) && (
        <div className="tc-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          <PlayerFace img={img} id={ghost.pid} name={squad.get(ghost.pid)!.name} className="tc-face" />
          <span className="tc-chip-name">{shortName(squad.get(ghost.pid)!.name)}</span>
        </div>
      )}
      {rolePlayer && roleSlot !== undefined && rolePanel(rolePlayer, roleSlot)}
      {infoFor && <PlayerQuickView profileId={profileId} careerId={careerId} playerId={infoFor} onClose={closeInfo} onOpenFull={onOpenPlayer}
        actions={<button className="secondary" onClick={() => startMove(infoFor)}><ArrowLeftRight size={14} aria-hidden="true" />{slotOf.has(infoFor) ? 'Trocar de lugar' : 'Colocar em campo'}</button>} />}
      {styleOpen && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setStyleOpen(false); }}>
          <div className="modal tc-style-modal" role="dialog" aria-modal="true" aria-label="Estilo de jogo" onKeyDown={(e) => { if (e.key === 'Escape') setStyleOpen(false); }}>
            <header className="modal-head"><SlidersHorizontal size={18} aria-hidden="true" /><h2>Estilo de jogo</h2>
              <button className="secondary icon" aria-label="Fechar" onClick={() => setStyleOpen(false)}><X size={16} aria-hidden="true" /></button></header>
            <div className="modal-body tc-style">
        <div className="tc-style-item"><span>Mentalidade</span><Seg label="Mentalidade" value={work.settings.mentality} options={MENTALITY_LABEL as Record<TeamTactics['mentality'], string>} onChange={(v) => setSetting('mentality', v)} /></div>
        <div className="tc-style-item"><span>Saída de bola</span><Seg label="Saída de bola" value={work.settings.buildUp} options={BUILDUP_LABEL as Record<TeamTactics['buildUp'], string>} onChange={(v) => setSetting('buildUp', v)} /></div>
        {([['tempo', 'Ritmo'], ['width', 'Amplitude'], ['defensiveLine', 'Linha defensiva'], ['pressing', 'Pressão']] as const).map(([k, label]) => (
          <label key={k} className="tc-style-item"><span>{label}: <strong>{work.settings[k]}</strong></span>
            <input type="range" min={1} max={5} step={1} value={work.settings[k]} onChange={(e) => setSetting(k, Number(e.target.value))} /></label>
        ))}
            </div>
            <footer className="modal-foot"><span className="muted small">{saving ? 'Salvando…' : 'Salvo automaticamente'}</span><button onClick={() => setStyleOpen(false)}>Concluir</button></footer>
          </div>
        </div>
      )}
    </div>
  );
}
