import { useEffect, useState } from 'react';
import type { HistoryRowDto, NewsDto, TrophyRoomDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtMoney, unwrap } from '../util.ts';
import { OUTCOME_LABEL } from './SeasonView.tsx';

interface Props { profileId: string; careerId: string; refreshKey: string }
const NEWS_LABEL: Record<NewsDto['kind'], string> = {
  season: 'Temporada', trophy: 'Título', transfer: 'Transferência', contract: 'Contrato', youth: 'Base', retirement: 'Aposentadoria', offer: 'Proposta', staff: 'Comissão'
};

/** Carrega um recurso do save sempre que a data ou a rodada mudam. */
function useLoad<T>(fn: () => Promise<T>, key: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fn().then(setData, (e) => setError(errMsg(e))); }, [key]);
  return { data, error };
}

export function NewsView({ profileId, careerId, refreshKey }: Props) {
  const { data, error } = useLoad(() => unwrap(window.api.getNews(profileId, careerId)), refreshKey);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando notícias…</p>;
  return (
    <section className="card scroll tall">
      {data.length === 0 ? <p className="muted">Nenhuma notícia ainda. Transferências do seu clube, renovações e o fim de temporada aparecem aqui.</p> : (
        <ul className="newsfeed">{data.map((n) => (
          <li key={n.id} className={`k-${n.kind}`}>
            <span className="muted small">{fmtDate(n.date)} · {NEWS_LABEL[n.kind]}</span>
            <strong>{n.title}</strong>
            {n.body && <span className="small">{n.body}</span>}
          </li>))}</ul>
      )}
    </section>
  );
}

export function HistoryView({ profileId, careerId, refreshKey }: Props) {
  const { data, error } = useLoad(() => unwrap(window.api.getHistory(profileId, careerId)), refreshKey);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando histórico…</p>;
  const done = data.filter((h: HistoryRowDto) => !h.current);
  return (
    <section className="card">
      <p className="muted small">Campanhas do seu clube nesta carreira. A classificação de cada temporada é recalculada a partir das partidas disputadas.</p>
      <table>
        <thead><tr><th>Temporada</th><th>Competição</th><th>Pos.</th><th>J</th><th>V</th><th>E</th><th>D</th><th>Gols</th><th>Pts</th><th>Desfecho</th><th className="right">Premiação</th></tr></thead>
        <tbody>{data.map((h) => (
          <tr key={h.season} className={h.current ? 'mine' : ''}>
            <td>{h.season}/{String(h.season + 1).slice(2)}{h.current && <span className="muted small"> (em andamento)</span>}</td>
            <td>{h.competitionName}</td><td>{h.played === 0 ? '—' : `${h.position}º/${h.teamCount}`}</td><td>{h.played}</td><td>{h.won}</td><td>{h.drawn}</td><td>{h.lost}</td>
            <td>{h.goalsFor}:{h.goalsAgainst}</td><td><strong>{h.points}</strong></td><td>{h.outcome ? OUTCOME_LABEL[h.outcome] : '—'}</td>
            <td className="right">{h.current ? '—' : fmtMoney(h.prize)}</td>
          </tr>))}</tbody>
      </table>
      {done.length === 0 && <p className="muted">A primeira temporada ainda não terminou.</p>}
    </section>
  );
}

export function TrophiesView({ profileId, careerId, refreshKey }: Props) {
  const { data, error } = useLoad<TrophyRoomDto>(() => unwrap(window.api.getTrophies(profileId, careerId)), refreshKey);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando troféus…</p>;
  return (
    <div className="grid2">
      <section className="card">
        <h2>Seus títulos</h2>
        {data.mine.length === 0 ? <p className="muted">Nenhum título ainda.</p> : (
          <ul className="plain">{data.mine.map((t) => <li key={`${t.season}-${t.competitionName}`} className="trophy"><strong>{t.competitionName}</strong> <span className="muted">({t.country})</span></li>)}</ul>
        )}
      </section>
      <section className="card">
        <h2>Campeões</h2>
        {data.champions.length === 0 ? <p className="muted">Os campeões aparecem depois da primeira virada de temporada.</p> : (
          <table><tbody>{data.champions.map((t) => (
            <tr key={`${t.season}-${t.competitionName}`} className={t.wonByUser ? 'mine' : ''}><td>{t.competitionName}</td><td className="muted">{t.country}</td><td>{t.clubName}</td></tr>))}</tbody></table>
        )}
      </section>
    </div>
  );
}
