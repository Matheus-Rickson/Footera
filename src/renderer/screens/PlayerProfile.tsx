import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Binoculars, CircleGauge, Crosshair, Dumbbell, FileSignature, Footprints, Gauge, Hand, Ruler, Share2, Shield, Weight, Wind, X,
  type LucideIcon,
} from 'lucide-react';
import type { MarketPlayerDto, PlayerProfileDto, Range } from '../../shared/api.ts';
import type { Position } from '../../shared/types.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { KnowledgeBar } from './ScoutingView.tsx';
import { fmtRange, fmtRange20, FOOT_LABEL, initials, PlayerFlags, POS_NAME, PosPill, to20, tone } from '../playerUi.tsx';
import { useImages } from '../images.ts';
import { attributeHelp } from '../../game/world/attributeInfo.ts';
import { HelpTip } from '../help.tsx';
import { Stars } from '../stars.tsx';

const ATTR_LABEL: Record<string, string> = {
  finishing: 'Finalização', passing: 'Passe', dribbling: 'Drible', tackling: 'Desarme', marking: 'Marcação', firstTouch: 'Primeiro toque', crossing: 'Cruzamento',
  heading: 'Cabeceio', longShots: 'Chute de longe', goalkeeping: 'Goleiro (geral)', vision: 'Visão de jogo', composure: 'Compostura', decisions: 'Decisões',
  positioning: 'Posicionamento', workRate: 'Empenho', leadership: 'Liderança', aggression: 'Agressividade', pace: 'Velocidade', stamina: 'Resistência',
  strength: 'Força física', agility: 'Agilidade', jumping: 'Impulsão', naturalFitness: 'Preparo natural',
  reflexes: 'Reflexos', oneOnOne: 'Um contra um', handling: 'Manejo', aerial: 'Jogo aéreo', rushingOut: 'Saídas do gol', kicking: 'Reposição',
};
const GROUP_LABEL = { goalkeeper: 'Goleiro', technical: 'Técnicos', mental: 'Mentais', physical: 'Físicos' } as const;
/** grupos exibidos: o de goleiro só para goleiros (nos demais ele existe, mas não interessa) */
const groupsFor = (pos: Position) => (Object.keys(GROUP_LABEL) as Array<keyof typeof GROUP_LABEL>).filter((g) => g !== 'goalkeeper' || pos === 'GK');
/** Posições num campo vertical (ataque para cima), em % da largura/altura. */
const POS_XY: Record<Position, [number, number]> = { GK: [50, 91], CB: [50, 76], LB: [17, 70], RB: [83, 70], LWB: [9, 57], RWB: [91, 57], DM: [50, 61], CM: [50, 49], LM: [13, 43], RM: [87, 43], AM: [50, 36], LW: [17, 28], RW: [83, 28], SS: [36, 22], CF: [50, 11], ST: [64, 14] };
const VERDICT_CLASS = { starter: 'ok', rotation: 'notice', depth: 'notice', no: 'error' } as const;

/** Resumo em 6 grupos (escala 0–100 = média dos atributos 1–20 × 5). Goleiros trocam "Finalização" por "Goleiro". */
interface Group { key: string; short: string; label: string; icon: LucideIcon; keys: string[] }
const GROUPS_OUTFIELD: Group[] = [
  { key: 'fin', short: 'FIN', label: 'Finalização', icon: Crosshair, keys: ['finishing', 'longShots', 'composure'] },
  { key: 'tec', short: 'TEC', label: 'Técnica', icon: Footprints, keys: ['dribbling', 'firstTouch', 'crossing'] },
  { key: 'pas', short: 'PAS', label: 'Passe', icon: Share2, keys: ['passing', 'vision', 'decisions'] },
  { key: 'des', short: 'DES', label: 'Desarme', icon: Shield, keys: ['tackling', 'marking', 'positioning'] },
  { key: 'fis', short: 'FIS', label: 'Físico', icon: Dumbbell, keys: ['strength', 'stamina', 'jumping', 'naturalFitness'] },
  { key: 'vel', short: 'VEL', label: 'Velocidade', icon: Wind, keys: ['pace', 'agility'] },
];
const GROUPS_GK: Group[] = [{ key: 'gol', short: 'GOL', label: 'Goleiro', icon: Hand, keys: ['goalkeeping', 'positioning', 'agility'] }, ...GROUPS_OUTFIELD.slice(1)];

type Attrs = NonNullable<PlayerProfileDto['attributes']>;
function groupRange(attrs: Attrs, keys: string[]): Range {
  const flat: Record<string, Range> = { ...attrs.technical, ...attrs.mental, ...attrs.physical };
  const rs = keys.map((k) => flat[k]).filter((r): r is Range => !!r);
  const avg = (f: (r: Range) => number) => Math.round((rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length)) * 5);
  return { low: avg((r) => r.low), high: avg((r) => r.high) };
}
const trait = (v: number) => (v >= 15 ? 'Alta' : v >= 8 ? 'Média' : 'Baixa');

interface Props {
  profileId: string; careerId: string; playerId: string;
  onClose: () => void; onNegotiate: (p: MarketPlayerDto) => void; onChanged?: () => void;
}
type Tab = 'overview' | 'attributes' | 'history';

export function PlayerProfile({ profileId, careerId, playerId, onClose, onNegotiate, onChanged }: Props) {
  const [p, setP] = useState<PlayerProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const img = useImages();
  const load = useCallback(async () => { setP(await unwrap(window.api.getPlayerProfile(profileId, careerId, playerId))); }, [profileId, careerId, playerId]);
  useEffect(() => { setTab('overview'); load().catch((e) => setError(errMsg(e))); }, [load]);

  async function toggleShortlist() {
    if (!p?.market) return;
    setBusy(true);
    try { await unwrap(window.api.setShortlisted(profileId, careerId, p.id, !p.market.shortlisted)); await load(); onChanged?.(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!p) return <section className="card">{error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando ficha…</p>}<button className="secondary" onClick={onClose}>Fechar</button></section>;
  const groups = (p.position === 'GK' ? GROUPS_GK : GROUPS_OUTFIELD).map((g) => ({ ...g, range: groupRange(p.attributes, g.keys) }));
  const level = p.own ? `${to20(p.estOverall.low)}` : `${to20((p.estOverall.low + p.estOverall.high) / 2)}`;
  const unknownTip = 'Os olheiros ainda não conhecem o jogador o bastante (50% de conhecimento).';

  return (
    <div className="grid1">
      <section className="card pf-head">
        <div className="pf-top">
          <div className="pf-id">
            {img.url('players', p.id) ? <img className="pf-avatar pf-photo" src={img.url('players', p.id)!} alt={`Foto de ${p.name}`} /> : <div className="pf-avatar" aria-hidden="true">{initials(p.name)}</div>}
            <div className="pf-level" title={p.own ? 'Força atual' : `Força estimada pelos olheiros: ${fmtRange20(p.estOverall)}`}>
              <strong>{level}</strong><span>{p.own ? 'NÍVEL' : `~ ${fmtRange20(p.estOverall)}`}</span>
            </div>
            <div className="pf-main">
              <h2>{p.name}{p.market && <PlayerFlags p={p.market} />}</h2>
              <div className="row pf-meta">
                <span>{p.nationalityName}</span><span className="pf-sep" />
                <span>{p.own ? (p.youth ? 'Suas categorias de base' : 'Seu elenco') : p.clubName ?? 'Sem clube'}</span><span className="pf-sep" />
                <Stars reputation={p.reputation} label="Reputação" />
              </div>
              <div className="row pf-meta">
                <PosPill pos={p.position} />
                <span>{FOOT_LABEL[p.foot] ?? p.foot}</span>
                <span>{p.age} anos <span className="muted">({fmtDate(p.birthDate)})</span></span>
              </div>
            </div>
          </div>
          <div className="pf-traits">
            {([['Profissionalismo', p.personality?.professionalism], ['Ambição', p.personality?.ambition], ['Fidelidade', p.personality?.loyalty]] as Array<[string, number | undefined]>).map(([label, v]) => (
              <div key={label} className="pf-trait" title={v === undefined ? unknownTip : `${v}/20`}>
                <span className={`pf-chip ${v === undefined ? '' : tone(v * 5)}`}>{v === undefined ? '?' : trait(v)}</span>{label}
              </div>
            ))}
          </div>
          <div className="pf-body">
            <div className="row muted small"><Ruler size={14} aria-hidden="true" />{p.heightCm} cm<Weight size={14} aria-hidden="true" />{p.weightKg} kg</div>
            <div className="pf-meter"><span className="meter"><i style={{ width: `${p.condition}%` }} /></span><b>{p.condition}%</b> Condição</div>
            <div className="pf-meter" title={p.morale === null ? unknownTip : ''}>
              <span className="meter"><i className={p.morale !== null && p.morale < 50 ? 'mid' : ''} style={{ width: `${p.morale ?? 0}%` }} /></span><b>{p.morale === null ? '?' : `${p.morale}%`}</b> Moral
            </div>
          </div>
        </div>
        <div className="pf-strip">
          <span><span className="muted">Valor</span> <strong>{fmtMoney(p.marketValue)}</strong></span>
          <span><span className="muted">{p.clubId || p.youth ? 'Salário' : 'Pretensão'}</span> <strong>{fmtMoney(p.salary)}/mês</strong></span>
          <span><span className="muted">Fim do contrato</span> <strong>{p.clubId || p.youth ? fmtDate(p.contractEnd) : '—'}</strong></span>
          <span><span className="muted">Potencial estimado</span> <strong>{fmtRange20(p.estPotential)}</strong></span>
          {!p.own && <span className="row"><span className="muted">Olheiros</span> <KnowledgeBar value={p.knowledge} /></span>}
          <span className="grow" />
          {p.market && <button className="secondary" disabled={busy} onClick={() => void toggleShortlist()}><Binoculars size={16} aria-hidden="true" />{p.market.shortlisted ? 'Observando' : 'Observar'}</button>}
          {p.market && <button disabled={!p.negotiable} title={p.negotiable ? '' : 'Janela de transferências fechada'} onClick={() => onNegotiate(p.market!)}><FileSignature size={16} aria-hidden="true" />Fazer proposta</button>}
          <button className="secondary" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />Voltar</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {p.verdict && <p className={VERDICT_CLASS[p.verdict.level]}><strong>Parecer do olheiro:</strong> {p.verdict.text}</p>}
      </section>

      <div className="pf-tabs" role="tablist">
        {([['overview', 'Visão geral'], ['attributes', 'Atributos'], ['history', 'Histórico']] as Array<[Tab, string]>).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`pf-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="pf-grid">
            <section className="card">
              <h2>Atributos</h2>
              {(
                <div className="pf-attr">
                  <div className="pf-bars">{groups.map((g) => {
                    const Icon = g.icon, r = g.range, mid = (r.low + r.high) / 2;
                    return (
                      <div key={g.key} className="pf-bar">
                        <span className="row"><Icon size={15} aria-hidden="true" />{g.label}</span>
                        <span className="pf-track"><i className={tone(mid)} style={{ width: `${mid}%` }} /></span>
                        <b className={tone(mid)}>{fmtRange20(r)}</b>
                      </div>
                    );
                  })}</div>
                  <Radar groups={groups.map((g) => ({ short: g.short, range: g.range }))} />
                </div>
              )}
            </section>
            <section className="card">
              <h2>Posições</h2>
              <PositionMap natural={p.position} familiar={p.secondaryPositions} />
            </section>
          </div>
          {p.roles && (
            <section className="card">
              <div className="bar"><h2>Funções</h2><span className="muted small">Compatibilidade = quanto os atributos combinam com a função; domínio = quanto ele já sabe jogar assim (cresce jogando e treinando a função em Táticas). Treinar a função com foco Equilibrado também puxa a evolução dos atributos dela.</span></div>
              <div className="pf-roles">
                {[...p.roles.list].sort((a, b) => b.familiarity - a.familiarity || b.suitability - a.suitability).map((r) => (
                  <div key={r.id} className={`pf-role ${p.roles!.focus === r.id ? 'pf-role-focus' : ''}`} title={r.description}>
                    <div className="pf-role-head"><b>{r.label}</b>{r.positions.filter((x) => x !== 'ST').map((x) => <PosPill key={x} pos={x} minor />)}
                      {p.roles!.focus === r.id && <span className="pf-chip" title="Função treinada neste mês"><Dumbbell size={11} aria-hidden="true" /> treinando</span>}</div>
                    <div className="pf-bar"><span className="muted">Compatibilidade</span><span className="pf-track"><i className={tone(r.suitability)} style={{ width: `${r.suitability}%` }} /></span><b className={tone(r.suitability)}>{to20(r.suitability)}</b></div>
                    <div className="pf-bar"><span className="muted">Domínio</span><span className="pf-track"><i className={tone(r.familiarity)} style={{ width: `${r.familiarity}%` }} /></span><b className={tone(r.familiarity)}>{r.familiarity}%</b></div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div className="pf-grid3">
            <section className="card">
              <h2>Desenvolvimento</h2>
              {p.history ? <DevChart points={p.history.map((h) => ({ ...h, overall: to20(h.overall) }))} /> : <p className="muted pf-empty"><Gauge size={28} aria-hidden="true" />A evolução da força só é conhecida para jogadores do seu clube.</p>}
            </section>
            <section className="card">
              <h2>Estatísticas da temporada</h2>
              {p.stats.appearances === 0 ? <p className="muted pf-empty"><CircleGauge size={28} aria-hidden="true" />Nenhuma partida nesta temporada.</p> : (
                <div className="pf-kpis">
                  <div><strong>{p.stats.appearances}</strong><span>jogos</span></div>
                  <div><strong>{p.stats.goals}</strong><span>gols</span></div>
                  <div><strong>{p.stats.assists}</strong><span>assistências</span></div>
                  <div><strong>{p.stats.avgRating?.toFixed(2) ?? '—'}</strong><span>nota média</span></div>
                </div>
              )}
            </section>
            <section className="card">
              <h2>Últimos jogos</h2>
              {p.lastMatches.length === 0 ? <p className="muted pf-empty"><CircleGauge size={28} aria-hidden="true" />Nenhum jogo recente pelo clube.</p> : (
                <table><tbody>{p.lastMatches.map((m) => (
                  <tr key={m.fixtureId}><td className="muted small nowrap">{fmtDate(m.date)}</td><td className="pf-opp" title={m.opponent}>{m.home ? 'vs' : '@'} {m.opponent}</td><td className="muted small nowrap">{m.score}</td>
                    <td className="small nowrap">{m.minutes}'{m.goals ? ` · ${m.goals} gol` : ''}{m.assists ? ` · ${m.assists} ass.` : ''}</td>
                    <td className="right"><span className={`pf-rating ${tone(m.rating * 10)}`}>{m.rating.toFixed(1)}</span></td></tr>))}</tbody></table>
              )}
            </section>
          </div>
        </>
      )}

      {tab === 'attributes' && (
        <section className="card">
          <h2>Atributos detalhados (1 a 20)</h2>
          {(
            <div className="attrs">
              {groupsFor(p.position).filter((g) => p.attributes[g]).map((g) => (
                <table key={g}><thead><tr><th colSpan={2}>{GROUP_LABEL[g]}</th></tr></thead>
                  <tbody>{Object.entries(p.attributes[g]!).map(([k, r]) => <tr key={k}><td><span className="pf-attr-name">{ATTR_LABEL[k] ?? k}<HelpTip text={attributeHelp(k)} /></span></td><td className="right"><strong className={tone(((r.low + r.high) / 2) * 5)}>{fmtRange(r)}</strong></td></tr>)}</tbody></table>
              ))}
            </div>
          )}
          {!p.own && <p className="muted small">Faixas: o valor real está dentro delas e elas estreitam conforme os olheiros conhecem o jogador; com 100% de conhecimento, aparece o valor exato.</p>}
        </section>
      )}

      {tab === 'history' && (
        <div className="grid2">
          <section className="card">
            <h2>Transferências</h2>
            {p.transfers.length === 0 ? <p className="muted">Nenhuma transferência registrada nesta carreira.</p> : (
              <table><thead><tr><th>Data</th><th>De</th><th>Para</th><th className="right">Taxa</th></tr></thead>
                <tbody>{p.transfers.map((t, i) => <tr key={i}><td>{fmtDate(t.date)}</td><td>{t.from ?? <span className="muted">sem clube</span>}</td><td>{t.to}</td><td className="right">{t.fee ? fmtMoney(t.fee) : 'livre'}</td></tr>)}</tbody></table>
            )}
          </section>
          <section className="card">
            <h2>Força por temporada</h2>
            {!p.history ? <p className="muted">Disponível apenas para jogadores do seu clube.</p> : (
              <table><thead><tr><th>Temporada</th><th className="right">Força</th></tr></thead>
                <tbody>{[...p.history].reverse().map((h, i) => <tr key={`${h.season}-${i}`}><td>{h.season}/{String(h.season + 1).slice(2)}{i === 0 ? <span className="muted small"> (atual)</span> : ''}</td><td className="right">{to20(h.overall)}</td></tr>)}</tbody></table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Radar hexagonal: área do centro da faixa (sólida) e do limite superior (tracejada). */
function Radar({ groups }: { groups: Array<{ short: string; range: Range }> }) {
  const cx = 100, cy = 100, R = 70, n = groups.length;
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * R * (v / 100), cy + Math.sin(a) * R * (v / 100)] as const; };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(',')).join(' ');
  return (
    <svg className="pf-radar" viewBox="0 0 200 200" role="img" aria-label="Radar dos atributos">
      {[25, 50, 75, 100].map((ring) => <polygon key={ring} className="pf-ring" points={poly(groups.map(() => ring))} />)}
      {groups.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} className="pf-axis" x1={cx} y1={cy} x2={x} y2={y} />; })}
      <polygon className="pf-area-high" points={poly(groups.map((g) => g.range.high))} />
      <polygon className="pf-area" points={poly(groups.map((g) => (g.range.low + g.range.high) / 2))} />
      {groups.map((g, i) => { const [x, y] = pt(i, 122); return <text key={g.short} className="pf-radar-label" x={x} y={y} textAnchor="middle" dominantBaseline="middle">{g.short}</text>; })}
    </svg>
  );
}

function PositionMap({ natural, familiar }: { natural: Position; familiar: Position[] }) {
  return (
    <div className="pf-posmap">
      <svg viewBox="0 0 100 140" role="img" aria-label="Posições do jogador">
        <rect className="pitch-bg" x="1" y="1" width="98" height="138" rx="3" />
        <line className="pitch-line" x1="1" y1="70" x2="99" y2="70" /><circle className="pitch-line" cx="50" cy="70" r="10" fill="none" />
        <rect className="pitch-line" x="25" y="1" width="50" height="18" fill="none" /><rect className="pitch-line" x="25" y="121" width="50" height="18" fill="none" />
        {(Object.keys(POS_XY) as Position[]).map((pos) => {
          const [x, y] = POS_XY[pos]!; const cls = pos === natural ? 'pf-pos-natural' : familiar.includes(pos) ? 'pf-pos-familiar' : 'pf-pos-none';
          return <g key={pos}><circle className={cls} cx={x} cy={y * 1.4} r={pos === natural ? 5.2 : 4.2} /><title>{POS_NAME[pos]}</title></g>;
        })}
      </svg>
      <div className="row small muted"><span className="pf-dot pf-pos-natural" />Natural<span className="pf-dot pf-pos-familiar" />Familiar</div>
    </div>
  );
}

function DevChart({ points }: { points: Array<{ season: number; overall: number }> }) {
  const w = 300, h = 140, pad = 24;
  const vals = points.map((p) => p.overall);
  const lo = Math.max(0, Math.min(...vals) - 2), hi = Math.min(20, Math.max(...vals) + 2); // escala 1–20
  const x = (i: number) => (points.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (points.length - 1));
  const y = (v: number) => h - pad - ((v - lo) / Math.max(1, hi - lo)) * (h - 2 * pad);
  return (
    <svg className="pf-dev" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Força por temporada">
      <line className="chart-axis" x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} />
      <polyline className="pf-dev-line" points={points.map((p, i) => `${x(i)},${y(p.overall)}`).join(' ')} />
      {points.map((p, i) => (
        <g key={`${p.season}-${i}`}>
          <circle className="pf-dev-dot" cx={x(i)} cy={y(p.overall)} r="3.5" />
          <text className="chart-label" x={x(i)} y={y(p.overall) - 8} textAnchor="middle">{p.overall}</text>
          <text className="chart-label" x={x(i)} y={h - 8} textAnchor="middle">{i === points.length - 1 ? 'atual' : `${String(p.season).slice(2)}/${String(p.season + 1).slice(2)}`}</text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Janela compacta do jogador (Táticas: clique no elenco). Atributos 1–20, posições, funções e estatísticas da temporada;
 * "Ficha completa" leva à ficha inteira e `actions` traz os botões da tela que abriu (ex.: colocar em campo).
 */
export function PlayerQuickView({ profileId, careerId, playerId, onClose, onOpenFull, actions }: {
  profileId: string; careerId: string; playerId: string; onClose: () => void; onOpenFull?: (id: string) => void; actions?: ReactNode;
}) {
  const [p, setP] = useState<PlayerProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const img = useImages();
  useEffect(() => { setP(null); unwrap(window.api.getPlayerProfile(profileId, careerId, playerId)).then(setP).catch((e) => setError(errMsg(e))); }, [profileId, careerId, playerId]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  const roles = p?.roles ? [...p.roles.list].sort((a, b) => b.familiarity - a.familiarity || b.suitability - a.suitability) : [];
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal pq-modal" role="dialog" aria-modal="true" aria-label={p ? `Jogador ${p.name}` : 'Jogador'}>
        <header className="modal-head">
          {p ? (
            <div className="pq-head">
              {img.url('players', p.id) ? <img className="pf-avatar pq-avatar pf-photo" src={img.url('players', p.id)!} alt={`Foto de ${p.name}`} /> : <div className="pf-avatar pq-avatar" aria-hidden="true">{initials(p.name)}</div>}
              <div className="pq-id">
                <h2>{p.name}</h2>
                <div className="row pf-meta"><PosPill pos={p.position} />{p.secondaryPositions.map((s) => <PosPill key={s} pos={s} minor />)}
                  <span>{p.age} anos</span><span>{FOOT_LABEL[p.foot] ?? p.foot}</span><span>{p.heightCm} cm</span><span className="muted">{p.nationalityName}</span><Stars reputation={p.reputation} label="Reputação" /></div>
              </div>
              <div className="pq-level"><strong className={tone(p.estOverall.low)}>{p.own ? to20(p.estOverall.low) : fmtRange20(p.estOverall)}</strong><span>força</span></div>
              <div className="pq-level"><strong>{p.condition}%</strong><span>condição</span></div>
            </div>
          ) : <h2>Jogador</h2>}
          <button className="secondary icon" aria-label="Fechar" autoFocus onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </header>
        <div className="modal-body pq-body">
          {!p ? (error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando…</p>) : (
            <>
              <section className="pq-attrs">
                {groupsFor(p.position).filter((g) => p.attributes[g]).map((g) => (
                  <table key={g}><thead><tr><th colSpan={2}>{GROUP_LABEL[g]}</th></tr></thead>
                    <tbody>{Object.entries(p.attributes[g]!).map(([k, r]) => <tr key={k}><td><span className="pf-attr-name">{ATTR_LABEL[k] ?? k}<HelpTip text={attributeHelp(k)} /></span></td><td className="right"><strong className={tone(((r.low + r.high) / 2) * 5)}>{fmtRange(r)}</strong></td></tr>)}</tbody></table>
                ))}
              </section>
              <section className="pq-side">
                <div>
                  <h3>Posições</h3>
                  <PositionMap natural={p.position} familiar={p.secondaryPositions} />
                </div>
                <div>
                  <h3>Temporada</h3>
                  <div className="pq-kpis">
                    <div><strong>{p.stats.appearances}</strong><span>jogos</span></div>
                    <div><strong>{p.stats.goals}</strong><span>gols</span></div>
                    <div><strong>{p.stats.assists}</strong><span>assist.</span></div>
                    <div><strong>{p.stats.avgRating?.toFixed(2) ?? '—'}</strong><span>nota</span></div>
                  </div>
                </div>
              </section>
              {p.roles && (
                <section className="pq-roles">
                  <h3>Funções <span className="muted small">compatibilidade · domínio</span></h3>
                  <div className="pq-role-list">
                    {roles.map((r) => (
                      <div key={r.id} className={`pq-role ${p.roles!.focus === r.id ? 'pf-role-focus' : ''}`} title={r.description}>
                        <span className="pq-role-name">{r.label}{p.roles!.focus === r.id && <Dumbbell size={11} aria-label="treinando" />}</span>
                        <span className="pq-role-pos">{r.positions.filter((x) => x !== 'ST').map((x) => <PosPill key={x} pos={x} minor />)}</span>
                        <b className={tone(r.suitability)}>{to20(r.suitability)}</b><b className={tone(r.familiarity)}>{r.familiarity}%</b>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
        <footer className="modal-foot pq-foot">
          {actions}
          <span className="grow" />
          {onOpenFull && <button className="secondary" disabled={!p} onClick={() => onOpenFull(playerId)}>Ficha completa</button>}
          <button onClick={onClose}>Fechar</button>
        </footer>
      </div>
    </div>
  );
}
