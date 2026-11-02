import { useCallback, useEffect, useState } from 'react';
import type { MarketPlayerDto, PlayerProfileDto, Range } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';
import { KnowledgeBar } from './ScoutingView.tsx';

const ATTR_LABEL: Record<string, string> = {
  finishing: 'Finalização', passing: 'Passe', dribbling: 'Drible', tackling: 'Desarme', marking: 'Marcação', firstTouch: 'Primeiro toque', crossing: 'Cruzamento',
  heading: 'Cabeceio', longShots: 'Chute de longe', goalkeeping: 'Goleiro', vision: 'Visão de jogo', composure: 'Compostura', decisions: 'Decisões',
  positioning: 'Posicionamento', workRate: 'Empenho', leadership: 'Liderança', aggression: 'Agressividade', pace: 'Velocidade', stamina: 'Resistência',
  strength: 'Força física', agility: 'Agilidade', jumping: 'Impulsão', naturalFitness: 'Preparo natural',
};
const GROUP_LABEL = { technical: 'Técnicos', mental: 'Mentais', physical: 'Físicos' } as const;
const FOOT_LABEL: Record<string, string> = { right: 'direito', left: 'esquerdo', both: 'ambos' };
const VERDICT_CLASS = { starter: 'ok', rotation: 'notice', depth: 'notice', no: 'error' } as const;
const fmtRange = (r: Range) => (r.low === r.high ? `${r.low}` : `${r.low}–${r.high}`);

interface Props {
  profileId: string; careerId: string; playerId: string;
  onClose: () => void; onNegotiate: (p: MarketPlayerDto) => void; onChanged?: () => void;
}

export function PlayerProfile({ profileId, careerId, playerId, onClose, onNegotiate, onChanged }: Props) {
  const [p, setP] = useState<PlayerProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setP(await unwrap(window.api.getPlayerProfile(profileId, careerId, playerId))); }, [profileId, careerId, playerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load]);

  async function toggleShortlist() {
    if (!p?.market) return;
    setBusy(true);
    try { await unwrap(window.api.setShortlisted(profileId, careerId, p.id, !p.market.shortlisted)); await load(); onChanged?.(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!p) return <section className="card">{error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando ficha…</p>}<button className="secondary" onClick={onClose}>Fechar</button></section>;

  return (
    <section className="card profile">
      <div className="bar">
        <div>
          <h2>{p.name}</h2>
          <p className="muted">{p.position}{p.secondaryPositions.length ? ` (também ${p.secondaryPositions.join(', ')})` : ''} · {p.age} anos · {p.nationality} · pé {FOOT_LABEL[p.foot] ?? p.foot} · {p.heightCm} cm, {p.weightKg} kg</p>
          <p className="muted">{p.own ? (p.youth ? 'Suas categorias de base' : 'Seu elenco') : p.clubName ?? 'Sem clube (livre)'} · valor {fmtNum(p.marketValue)} · {p.clubId || p.youth ? `salário ${fmtNum(p.salary)}/mês · contrato até ${fmtDate(p.contractEnd)}` : `pretensão salarial ~${fmtNum(p.salary)}/mês · sem contrato`}</p>
        </div>
        <div className="row">
          {p.market && <button className="secondary" disabled={busy} onClick={() => void toggleShortlist()}>{p.market.shortlisted ? 'Tirar da lista de observação' : 'Observar'}</button>}
          {p.market && <button disabled={!p.negotiable} title={p.negotiable ? '' : 'Janela de transferências fechada'} onClick={() => onNegotiate(p.market!)}>Negociar</button>}
          <button className="secondary" onClick={onClose}>Fechar</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="grid2">
        <div>
          <h3>{p.own ? 'Avaliação' : 'Relatório dos olheiros'}</h3>
          <table><tbody>
            <tr><td>Força{p.own ? '' : ' (estimada)'}</td><td><strong>{fmtRange(p.estOverall)}</strong></td></tr>
            <tr><td>Potencial estimado</td><td><strong>{fmtRange(p.estPotential)}</strong></td></tr>
            {!p.own && <tr><td>Conhecimento</td><td><KnowledgeBar value={p.knowledge} /></td></tr>}
          </tbody></table>
          {p.verdict && <p className={VERDICT_CLASS[p.verdict.level]}>{p.verdict.text}</p>}
          <h3>Temporada atual</h3>
          <p className="muted">{p.stats.appearances} jogo(s) · {p.stats.goals} gol(s) · {p.stats.assists} assistência(s){p.stats.avgRating !== null ? ` · nota média ${p.stats.avgRating.toFixed(2)}` : ''}</p>
        </div>
        <div>
          <h3>Atributos (1 a 20)</h3>
          {!p.attributes ? <p className="muted">Os olheiros ainda não conhecem o jogador o suficiente para relatar atributos (a partir de 25% de conhecimento). Clique em “Observar”.</p> : (
            <div className="attrs">
              {(Object.keys(GROUP_LABEL) as Array<keyof typeof GROUP_LABEL>).map((g) => (
                <table key={g}><thead><tr><th colSpan={2}>{GROUP_LABEL[g]}</th></tr></thead>
                  <tbody>{Object.entries(p.attributes![g]).map(([k, r]) => <tr key={k}><td>{ATTR_LABEL[k] ?? k}</td><td className="right"><strong>{fmtRange(r)}</strong></td></tr>)}</tbody></table>
              ))}
            </div>
          )}
          {!p.own && p.attributes && <p className="muted small">Faixas: o valor real está dentro delas. Ficam mais estreitas conforme os olheiros conhecem o jogador.</p>}
        </div>
      </div>
    </section>
  );
}
