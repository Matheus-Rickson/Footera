import type { CareerListDto } from '../../shared/api.ts';
import { fmtDate, fmtDateTime, fmtPlay } from '../util.ts';

interface Props {
  profileId: string; data: CareerListDto | null; error: string | null; busy: boolean;
  onBack: () => void; onOpen: (careerId: string) => void;
}

export function CareerList({ data, error, busy, onBack, onOpen }: Props) {
  return (
    <main className="shell">
      <header className="bar"><h1>Carregar carreira</h1><button className="secondary" onClick={onBack}>Voltar</button></header>
      {error && <p className="error" role="alert">{error}</p>}
      <section className="card">
        {!data ? <p className="muted">Carregando…</p> : data.careers.length === 0 ? <p className="muted">Este perfil ainda não tem carreiras.</p> : (
          <table>
            <thead><tr><th>Treinador</th><th>Clube</th><th>Temporada</th><th>Data do jogo</th><th>Último salvamento</th><th>Tempo de jogo</th><th /></tr></thead>
            <tbody>
              {data.careers.map((c) => (
                <tr key={c.id}>
                  <td>{c.coachName}</td><td>{c.clubName}</td><td>{c.season}</td><td>{fmtDate(c.gameDate)}</td>
                  <td>{fmtDateTime(c.updatedAt)}</td><td>{fmtPlay(c.playSeconds)}</td>
                  <td><button disabled={busy} onClick={() => onOpen(c.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {data && data.unreadable.length > 0 && (
        <section className="card">
          <h2>Saves ilegíveis</h2>
          <p className="muted">Estes arquivos não puderam ser abertos e foram deixados intactos no disco.</p>
          <ul>{data.unreadable.map((u) => <li key={u.id}><code>{u.id}</code> — {u.reason}</li>)}</ul>
        </section>
      )}
    </main>
  );
}
