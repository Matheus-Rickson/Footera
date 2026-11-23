import { useState, type ReactNode } from 'react';
import { FolderOpen, Play, Trash2 } from 'lucide-react';
import type { CareerListDto, CareerSummaryDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtDateTime, fmtPlay, unwrap } from '../util.ts';
import { ClubCrest } from '../flags.tsx';
import { useImages } from '../images.ts';
import { clubVars, useClubPalette } from '../clubColors.ts';

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
      {!data ? <p className="muted">Carregando…</p> : data.careers.length === 0 ? <section className="card"><p className="muted">Este perfil ainda não tem carreiras.</p></section> : (
        <ul className="csl-slots" aria-label="Carreiras salvas">
          {data.careers.map((c) => <SaveSlot key={c.id} c={c} pending={pending?.id === c.id} locked={locked} onOpen={() => onOpen(c.id)} actions={actions(c.id, c)} />)}
        </ul>
      )}
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

/** Uma carreira salva, como um "slot" de jogo: escudo e cores do clube, treinador, temporada, data do jogo e tempo jogado. */
function SaveSlot({ c, pending, locked, onOpen, actions }: { c: CareerSummaryDto; pending: boolean; locked: boolean; onOpen: () => void; actions: ReactNode }) {
  const img = useImages();
  const pal = useClubPalette(c.clubId || null);
  return (
    <li className={`csl-slot club-scope ${pending ? 'csl-pending' : ''}`} style={clubVars(pal)}>
      {c.clubId ? <ClubCrest id={c.clubId} name={c.clubName} size={44} src={img.url('clubs', c.clubId)} /> : <span className="csl-noclub" aria-hidden="true">—</span>}
      <div className="csl-slot-main">
        <strong>{c.clubId ? c.clubName : 'Sem clube'}</strong>
        <span className="muted small">{c.coachName} · temporada {c.seasonLabel} · data do jogo {fmtDate(c.gameDate)}</span>
      </div>
      <div className="csl-slot-meta small">
        <span>Salvo em {fmtDateTime(c.updatedAt)}</span>
        <span className="muted">{fmtPlay(c.playSeconds)} de jogo</span>
      </div>
      <div className="row csl-row-actions"><button className="csl-open" disabled={locked} onClick={onOpen}><Play size={15} aria-hidden="true" />Abrir</button>{actions}</div>
    </li>
  );
}
