import { useCallback, useEffect, useState } from 'react';
import type { NewSeasonReportDto, SeasonStatusDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';

interface Props { profileId: string; careerId: string; refreshKey: string; onChanged: () => Promise<void>; onOpenContracts: () => void }
export const OUTCOME_LABEL = { champion: 'Campeão', promoted: 'Acesso', relegated: 'Rebaixado' } as const;
const ZONE_LABEL = { promotion: 'zona de acesso', continental: 'zona de vaga continental', relegation: 'zona de rebaixamento' } as const;

export function SeasonView({ profileId, careerId, refreshKey, onChanged, onOpenContracts }: Props) {
  const [st, setSt] = useState<SeasonStatusDto | null>(null);
  const [report, setReport] = useState<NewSeasonReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => { setSt(await unwrap(window.api.getSeasonStatus(profileId, careerId))); }, [profileId, careerId]);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load, refreshKey]);

  async function start() {
    setBusy(true); setError(null);
    try {
      const r = await unwrap(window.api.startNextSeason(profileId, careerId));
      setReport(r); setConfirm(false);
      await onChanged(); await load();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!st) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Carregando temporada…</p>;
  const u = st.user;
  const userLeft = u ? Math.max(0, (st.leagues.find((l) => l.competitionId === u.competitionId)?.totalRounds ?? 0) - u.played) : 0;

  return (
    <div className="grid1">
      {report && <SeasonReport r={report} onClose={() => setReport(null)} />}

      <section className="card">
        <h2>Temporada {st.label}</h2>
        {!st.complete && <p>{u && <>Seu clube tem <strong>{userLeft}</strong> jogo(s) pela frente; </>}faltam {st.matchesLeft} partida(s) somando todas as ligas. A virada de temporada acontece em <strong>{fmtDate(st.turnoverDate)}</strong>, depois da última rodada.</p>}
        {st.complete && !st.canStart && <p className="notice">Todas as partidas foram disputadas. Avance o calendário até <strong>{fmtDate(st.turnoverDate)}</strong> para iniciar a nova temporada (os salários e receitas de maio e junho continuam sendo lançados).</p>}
        {st.canStart && (
          <div className="notice">
            <p><strong>Chegou o dia {fmtDate(st.turnoverDate)}.</strong> Ao iniciar a nova temporada: prêmios da liga são pagos, clubes sobem e descem, jogadores se aposentam,
              contratos que vencem hoje terminam (os seus só continuam se você renovou), todos evoluem um ano, a IA promove jovens da base e quem completou 19 anos sem promoção sai da base, suspensões e cartões zeram e o novo calendário é sorteado.
              A janela de transferências de verão abre no mesmo dia.</p>
            {st.expiring.length > 0 && <p className="error">{st.expiring.length} jogador(es) do seu elenco ficarão livres se o contrato não for renovado antes.</p>}
            {!confirm
              ? <button disabled={busy} onClick={() => setConfirm(true)}>Iniciar temporada {st.season + 1}/{String(st.season + 2).slice(2)}</button>
              : <div className="row"><span>Esta ação não pode ser desfeita.</span><button disabled={busy} onClick={() => void start()}>Confirmar virada</button><button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancelar</button></div>}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Seu clube</h2>
          {u ? (
            <>
              {u.played === 0 ? <p>{u.competitionName}: a liga ainda não começou ({u.teamCount} clubes).</p> : (
                <>
                  <p><strong>{u.position}º de {u.teamCount}</strong> na {u.competitionName} · {u.points} pts em {u.played} jogo(s)</p>
                  {u.zone && <p className="muted">Hoje na {ZONE_LABEL[u.zone]}.</p>}
                  <p className="muted">Premiação se a liga terminasse agora: <strong>{fmtNum(u.prizeIfEndedNow)}</strong></p>
                </>
              )}
            </>
          ) : <p className="muted">Clube sem competição nesta temporada.</p>}
        </section>
        <section className="card">
          <h2>Contratos que vencem em {fmtDate(st.turnoverDate)}</h2>
          {st.expiring.length === 0 ? <p className="muted">Nenhum: todo o elenco tem contrato para a próxima temporada.</p> : (
            <>
              <table><tbody>{st.expiring.map((c) => <tr key={c.id}><td>{c.position}</td><td>{c.name}</td><td>{c.age} anos</td><td className="right">{fmtNum(c.salary)}/mês</td></tr>)}</tbody></table>
              <button className="secondary" onClick={onOpenContracts}>Renovar contratos</button>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Ligas</h2>
        <table>
          <thead><tr><th>Competição</th><th>País</th><th>Rodadas</th><th>Líder</th></tr></thead>
          <tbody>{st.leagues.map((l) => <tr key={l.competitionId}><td>{l.name}</td><td>{l.country}</td><td>{l.roundsPlayed}/{l.totalRounds}</td><td>{l.leader ?? '—'}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

function SeasonReport({ r, onClose }: { r: NewSeasonReportDto; onClose: () => void }) {
  return (
    <section className="card offer">
      <div className="bar"><h2>Começa a temporada {r.label}</h2><button className="secondary" onClick={onClose}>Fechar</button></div>
      {r.previous && (
        <p><strong>{r.previous.position}º lugar</strong> de {r.previous.teamCount} na {r.previous.competitionName}
          {r.previous.outcome && <> · <strong>{OUTCOME_LABEL[r.previous.outcome]}</strong></>} · premiação de {fmtNum(r.previous.prize)}</p>
      )}
      <p className="muted">Nesta temporada o clube disputa a <strong>{r.newLeague}</strong>.</p>
      <div className="grid2">
        <div>
          <h3>Campeões</h3>
          <ul className="plain">{r.champions.map((c) => <li key={c.competitionName}>{c.competitionName} ({c.country}): <strong>{c.clubName}</strong></li>)}</ul>
          <h3>Acessos e rebaixamentos</h3>
          {r.movements.map((m) => <p key={m.country} className="small"><strong>{m.country}</strong> — sobem: {m.promoted.join(', ')}; descem: {m.relegated.join(', ')}</p>)}
        </div>
        <div>
          <h3>Seu elenco</h3>
          <ul className="plain small">
            <li>Deixaram a base (19 anos, sem promoção): {r.youthReleased.length ? r.youthReleased.join(', ') : 'ninguém'}</li>
            <li>Fim de contrato: {r.releasedUser.length ? r.releasedUser.join(', ') : 'ninguém'}</li>
            <li>Aposentadorias: {r.retiredUser.length ? r.retiredUser.join(', ') : 'ninguém'}</li>
            {r.autoPromoted.length > 0 && <li className="neg">Promovidos às pressas para completar o elenco (da base, ou gerados se a base não tinha o setor): {r.autoPromoted.join(', ')}</li>}
          </ul>
          <h3>Mercado</h3>
          <p className="small muted">Outros clubes renovaram {r.aiRenewed} contrato(s) e liberaram {r.aiReleased} jogador(es); {r.retiredTotal} jogador(es) se aposentaram no total. Os sem clube aparecem no mercado (filtro “Só jogadores livres”).</p>
        </div>
      </div>
    </section>
  );
}
