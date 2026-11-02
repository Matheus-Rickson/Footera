import { useCallback, useEffect, useState } from 'react';
import type { YouthOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void> }

export function YouthView({ profileId, careerId, refreshKey, onChanged }: Props) {
  const [ov, setOv] = useState<YouthOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState<string | null>(null);

  const load = useCallback(async () => { setOv(await unwrap(window.api.getYouth(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);

  async function act(id: string, name: string, kind: 'promote' | 'release') {
    setBusy(true); setError(null); setNotice(null);
    try {
      await unwrap(kind === 'promote' ? window.api.promoteYouth(profileId, careerId, id) : window.api.releaseYouth(profileId, careerId, id));
      setNotice(kind === 'promote' ? `${name} foi promovido ao elenco principal (contrato profissional de 3 temporadas).` : `${name} foi dispensado e está sem clube.`);
      setConfirmRelease(null);
      await load(); await onChanged();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!ov) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando categorias de base…</p>;
  const leaving = ov.players.filter((p) => p.leavesAtTurnover).length;
  const full = ov.seniorSize >= ov.seniorMax;

  return (
    <div className="grid1">
      <section className="card">
        <p>{ov.players.length} de {ov.cap} jovens · nível da base <strong>{ov.academyLevel}/20</strong> · próxima peneira em <strong>{fmtDate(ov.nextIntake)}</strong> · elenco principal {ov.seniorSize}/{ov.seniorMax}</p>
        <p className="muted small">Os jovens treinam aqui, evoluem uma vez por temporada (na virada) e não jogam pela equipe principal nem contam no limite de 30. Quem completar 19 anos até a virada
          e não for promovido deixa o clube. Se o elenco principal ficar sem o mínimo de jogadores num setor, o melhor jovem daquele setor é promovido automaticamente.</p>
        {leaving > 0 && <p className="notice">{leaving} jovem(ns) completa(m) 19 anos até a virada: promova-os ou eles sairão de graça.</p>}
        {ov.lastIntake && <p className="muted small">Última peneira ({fmtDate(ov.lastIntake.date)}): {ov.lastIntake.names.length ? ov.lastIntake.names.join(', ') : 'base lotada, ninguém chegou'}.</p>}
        {notice && <p className="ok" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <section className="card scroll tall">
        {ov.players.length === 0 ? <p className="muted">A base está vazia. A próxima safra chega na peneira.</p> : (
          <table>
            <thead><tr><th>Pos.</th><th>Jogador</th><th>Idade</th><th>Força</th><th>Pot. estimado</th><th className="right">Salário</th><th /></tr></thead>
            <tbody>{ov.players.map((p) => (
              <tr key={p.id} className={p.leavesAtTurnover ? 'expiring' : ''}>
                <td>{p.position}</td><td>{p.name}</td><td>{p.age}</td><td>{p.overall}</td><td>{p.potentialEstimated}</td><td className="right">{fmtNum(p.salary)}</td>
                <td className="row">
                  <button disabled={busy || full} title={full ? 'Elenco principal cheio (30)' : ''} onClick={() => void act(p.id, p.name, 'promote')}>Promover</button>
                  {confirmRelease === p.id
                    ? <><button className="danger" disabled={busy} onClick={() => void act(p.id, p.name, 'release')}>Confirmar dispensa</button><button className="secondary" onClick={() => setConfirmRelease(null)}>Cancelar</button></>
                    : <button className="secondary" disabled={busy} onClick={() => setConfirmRelease(p.id)}>Dispensar</button>}
                </td>
              </tr>))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
