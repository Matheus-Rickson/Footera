import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Ban, Cross } from 'lucide-react';
import type { SquadRow } from '../../shared/api.ts';
import type { Position } from '../../shared/types.ts';
import { POS_ORDER } from '../../shared/positions.ts';
import { fmtDate } from '../util.ts';
import { Flag, initials, PosPill, tone } from '../playerUi.tsx';

type Group = 'all' | 'GK' | 'DEF' | 'MID' | 'ATT';
const GROUPS: Array<[Group, string]> = [['all', 'Todos'], ['GK', 'Goleiros'], ['DEF', 'Defensores'], ['MID', 'Meio-campistas'], ['ATT', 'Atacantes']];
const GROUP_OF: Record<Position, Exclude<Group, 'all'>> = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF', DM: 'MID', CM: 'MID', LM: 'MID', RM: 'MID', AM: 'MID', LW: 'ATT', RW: 'ATT', SS: 'ATT', CF: 'ATT', ST: 'ATT' };

type Key = 'pos' | 'overall' | 'name' | 'nat' | 'age' | 'height' | 'condition' | 'morale' | 'apps' | 'minutes' | 'goals' | 'assists' | 'rating' | 'yellows' | 'reds';
const VALUE: Record<Key, (p: SquadRow) => number | string> = {
  pos: (p) => POS_ORDER.indexOf(p.position) * 1000 - p.overall, overall: (p) => p.overall, name: (p) => p.name, nat: (p) => p.nationality,
  age: (p) => p.age, height: (p) => p.heightCm, condition: (p) => p.condition, morale: (p) => p.morale,
  apps: (p) => p.stats.appearances, minutes: (p) => p.stats.minutes, goals: (p) => p.stats.goals, assists: (p) => p.stats.assists,
  rating: (p) => p.stats.avgRating ?? -1, yellows: (p) => p.stats.yellows, reds: (p) => p.stats.reds,
};
/** ordem inicial ao clicar: texto e posição crescem; números (força, gols…) começam do maior */
const ASC_FIRST = new Set<Key>(['pos', 'name', 'nat']);
const meterTone = (v: number) => (v >= 75 ? 'great' : v >= 60 ? 'good' : v >= 45 ? 'avg' : 'poor');
const ratingTone = (r: number) => (r >= 7.3 ? 'great' : r >= 6.8 ? 'good' : r >= 6.2 ? 'avg' : 'poor');

export function SquadView({ squad, onOpenPlayer }: { squad: SquadRow[]; onOpenPlayer: (id: string) => void }) {
  const [group, setGroup] = useState<Group>('all');
  const [sort, setSort] = useState<{ key: Key; asc: boolean }>({ key: 'pos', asc: true });

  const rows = useMemo(() => {
    const list = squad.filter((p) => group === 'all' || GROUP_OF[p.position] === group);
    const f = VALUE[sort.key];
    return [...list].sort((a, b) => { const x = f(a), y = f(b); const c = typeof x === 'string' ? x.localeCompare(String(y), 'pt-BR') : x - (y as number); return sort.asc ? c : -c; });
  }, [squad, group, sort]);
  const count = (g: Group) => squad.filter((p) => g === 'all' || GROUP_OF[p.position] === g).length;
  const avg = (f: (p: SquadRow) => number) => (rows.length ? rows.reduce((s, p) => s + f(p), 0) / rows.length : 0);

  const Th = ({ k, label, title, cls = '' }: { k: Key; label: string; title?: string; cls?: string }) => (
    <th className={cls} aria-sort={sort.key === k ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button className="sq-sort" title={title ?? `Ordenar por ${label.toLowerCase()}`} onClick={() => setSort((s) => (s.key === k ? { key: k, asc: !s.asc } : { key: k, asc: ASC_FIRST.has(k) }))}>
        {label}{sort.key === k && (sort.asc ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)}
      </button>
    </th>
  );

  return (
    <section className="card sq">
      <div className="sq-bar">
        <div className="sq-groups" role="tablist" aria-label="Setor">
          {GROUPS.map(([g, label]) => (
            <button key={g} role="tab" aria-selected={group === g} className={`sq-group ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{label}<b>{count(g)}</b></button>
          ))}
        </div>
        <div className="sq-summary muted small">
          <span>Força média <strong>{Math.round(avg((p) => p.overall))}</strong></span>
          <span>Idade média <strong>{avg((p) => p.age).toFixed(1).replace('.', ',')}</strong></span>
          <span>Condição média <strong>{Math.round(avg((p) => p.condition))}%</strong></span>
        </div>
      </div>
      <div className="sq-scroll">
        <table className="sq-table">
          <thead>
            <tr className="sq-groups-row">
              <th colSpan={8} />
              <th colSpan={7} className="sq-season">Estatísticas da temporada</th>
            </tr>
            <tr>
              <Th k="pos" label="Pos." title="Ordenar por posição" />
              <Th k="overall" label="Força" cls="center" />
              <Th k="name" label="Jogador" />
              <Th k="nat" label="Nac." title="Ordenar por nacionalidade" />
              <Th k="age" label="Idade" cls="right" />
              <Th k="height" label="Altura" cls="right" />
              <Th k="condition" label="Condição" />
              <Th k="morale" label="Moral" />
              <Th k="apps" label="J" title="Jogos" cls="right sq-first" />
              <Th k="minutes" label="Min" title="Minutos jogados" cls="right" />
              <Th k="goals" label="G" title="Gols" cls="right" />
              <Th k="assists" label="A" title="Assistências" cls="right" />
              <Th k="rating" label="Nota" title="Nota média" cls="center" />
              <Th k="yellows" label="CA" title="Cartões amarelos" cls="center" />
              <Th k="reds" label="CV" title="Cartões vermelhos" cls="center" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><span className="sq-pos"><PosPill pos={p.position} />{p.secondaryPositions.slice(0, 2).map((s) => <PosPill key={s} pos={s} minor />)}</span></td>
                <td className="center"><span className={`sq-ovr ${tone(p.overall)}`}>{p.overall}</span></td>
                <td>
                  <div className="sq-player">
                    <span className="tr-avatar" aria-hidden="true">{initials(p.name)}</span>
                    <button className="link" onClick={() => onOpenPlayer(p.id)}>{p.name}</button>
                    {p.status.injuredUntil && <span className="tr-flag tr-flag-injury" title={`Lesionado até ${fmtDate(p.status.injuredUntil)}`} aria-label="Lesionado"><Cross size={11} aria-hidden="true" /></span>}
                    {p.status.suspension > 0 && <span className="tr-flag tr-flag-susp" title={`Suspenso por ${p.status.suspension} jogo(s)`} aria-label="Suspenso"><Ban size={11} aria-hidden="true" /></span>}
                  </div>
                </td>
                <td><Flag code={p.nationality} name={p.nationalityName} /></td>
                <td className="right">{p.age}</td>
                <td className="right nowrap">{p.heightCm} cm</td>
                <td><span className="sq-meter" title={`Condição física: ${Math.round(p.condition)}%`}><span className="pf-track"><i className={meterTone(p.condition)} style={{ width: `${p.condition}%` }} /></span><b className={meterTone(p.condition)}>{Math.round(p.condition)}%</b></span></td>
                <td><span className="sq-meter" title={`Moral: ${Math.round(p.morale)} de 100`}><span className="pf-track"><i className={meterTone(p.morale)} style={{ width: `${p.morale}%` }} /></span><b className={meterTone(p.morale)}>{Math.round(p.morale)}</b></span></td>
                <td className="right sq-first">{p.stats.appearances || <span className="muted">0</span>}</td>
                <td className="right">{p.stats.minutes ? p.stats.minutes.toLocaleString('pt-BR') : <span className="muted">0</span>}</td>
                <td className="right">{p.stats.goals || <span className="muted">0</span>}</td>
                <td className="right">{p.stats.assists || <span className="muted">0</span>}</td>
                <td className="center">{p.stats.avgRating === null ? <span className="muted">—</span> : <span className={`pf-rating ${ratingTone(p.stats.avgRating)}`}>{p.stats.avgRating.toFixed(2).replace('.', ',')}</span>}</td>
                <td className="center">{p.stats.yellows ? <span className="tr-card tr-card-y">{p.stats.yellows}</span> : <span className="muted">0</span>}</td>
                <td className="center">{p.stats.reds ? <span className="tr-card tr-card-r">{p.stats.reds}</span> : <span className="muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{rows.length} jogador(es){group !== 'all' ? ' neste setor' : ''}. Clique no nome para abrir a ficha completa; clique no cabeçalho para ordenar. Estatísticas somam todas as competições da temporada pelo clube.</p>
    </section>
  );
}
