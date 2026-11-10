import { useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import type { CareerListDto, CareerSummaryDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtDateTime, fmtPlay, unwrap } from '../util.ts';

interface Props {
  profileId: string; data: CareerListDto | null; error: string | null; busy: boolean;
  onBack: () => void; onOpen: (careerId: string) => void; onChanged: () => Promise<void>;
}

/** save aguardando confirmação de exclusão (carreira legível ou arquivo ilegível) */
type Pending = { id: string; career: CareerSummaryDto | null };

export function CareerList({ profileId, data, error, busy, onBack, onOpen, onChanged }: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const locked = busy || working;

  async function reveal(id: string) {
    setMsg(null);
    try { await unwrap(window.api.revealCareer(profileId, id)); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  }
  async function remove() {
    if (!pending) return;
    setWorking(true); setMsg(null);
    try {
      await unwrap(window.api.deleteCareer(profileId, pending.id));
      setMsg({ ok: true, text: pending.career ? `A carreira de ${pending.career.coachName} (${pending.career.clubName}) foi para a Lixeira.` : 'O save foi para a Lixeira.' });
      setPending(null);
      await onChanged();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setWorking(false); }
  }
  const actions = (id: string, career: CareerSummaryDto | null) => (
    <div className="row csl-actions">
      <button className="secondary icon" disabled={locked} title="Abrir a pasta do save no Explorador" aria-label="Abrir a pasta do save" onClick={() => void reveal(id)}><FolderOpen size={16} aria-hidden="true" /></button>
      <button className="secondary icon danger" disabled={locked} title="Excluir este save" aria-label="Excluir este save" onClick={() => { setMsg(null); setPending({ id, career }); }}><Trash2 size={16} aria-hidden="true" /></button>
    </div>
  );

  return (
    <main className="shell">
      <header className="bar"><h1>Carregar carreira</h1><button className="secondary" onClick={onBack}>Voltar</button></header>
      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p className={msg.ok ? 'ok' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {pending && (
        <section className="card offer csl-confirm">
          <h2>Excluir este save?</h2>
          {pending.career
            ? <p>Treinador <strong>{pending.career.coachName}</strong> · {pending.career.clubName} · temporada {pending.career.seasonLabel} · data do jogo {fmtDate(pending.career.gameDate)} · {fmtPlay(pending.career.playSeconds)} de jogo.</p>
            : <p>Save ilegível <code>{pending.id}</code>.</p>}
          <p className="muted small">A pasta da carreira vai para a Lixeira do Windows: dá para restaurar por lá enquanto a Lixeira não for esvaziada.</p>
          <div className="row">
            <button className="danger" disabled={working} onClick={() => void remove()}><Trash2 size={16} aria-hidden="true" />Excluir</button>
            <button className="secondary" disabled={working} onClick={() => setPending(null)}>Cancelar</button>
          </div>
        </section>
      )}
      <section className="card">
        {!data ? <p className="muted">Carregando…</p> : data.careers.length === 0 ? <p className="muted">Este perfil ainda não tem carreiras.</p> : (
          <table>
            <thead><tr><th>Treinador</th><th>Clube</th><th>Temporada</th><th>Data do jogo</th><th>Último salvamento</th><th>Tempo de jogo</th><th /></tr></thead>
            <tbody>
              {data.careers.map((c) => (
                <tr key={c.id} className={pending?.id === c.id ? 'csl-pending' : ''}>
                  <td>{c.coachName}</td><td>{c.clubName}</td><td>{c.seasonLabel}</td><td>{fmtDate(c.gameDate)}</td>
                  <td>{fmtDateTime(c.updatedAt)}</td><td>{fmtPlay(c.playSeconds)}</td>
                  <td><div className="row csl-row-actions"><button disabled={locked} onClick={() => onOpen(c.id)}>Abrir</button>{actions(c.id, c)}</div></td>
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
          <ul className="csl-unreadable">{data.unreadable.map((u) => <li key={u.id}><span><code>{u.id}</code> — {u.reason}</span>{actions(u.id, null)}</li>)}</ul>
        </section>
      )}
    </main>
  );
}
