import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, HeartPulse, Trophy, Users } from 'lucide-react';
import type { ClubProfileDto, FixtureDto } from '../../shared/api.ts';
import { errMsg, fmtDate, fmtNum, unwrap } from '../util.ts';
import { Stars } from '../stars.tsx';
import { ClubCrest, Flag } from '../flags.tsx';
import { PosPill } from '../playerUi.tsx';
import { useImages } from '../images.ts';
import { CoachPhoto, CoachSheet } from '../clubSheet.tsx';

const CUP_STATUS: Record<ClubProfileDto['cups'][number]['status'], string> = { alive: 'na disputa', eliminated: 'eliminado', champion: 'campeão' };
const OUTCOME: Record<string, string> = { champion: 'campeão', promoted: 'acesso', relegated: 'rebaixado' };
type SortKey = 'position' | 'name' | 'age' | 'appearances' | 'minutes' | 'goals' | 'assists' | 'cleanSheets' | 'avgRating';
const POS_ORDER = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'SS', 'CF', 'ST'];

/** Ficha completa do clube (tela cheia, a partir da ficha resumida): campanha, jogos, elenco com estatísticas, histórico e títulos. */
export function ClubPage({ profileId, careerId, clubId, onClose, onOpenPlayer, onOpenMatch }: {
  profileId: string; careerId: string; clubId: string; onClose: () => void; onOpenPlayer: (id: string) => void; onOpenMatch: (fixtureId: string) => void;
}) {
  const [c, setC] = useState<ClubProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coach, setCoach] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'position', desc: false });
  const img = useImages();
  useEffect(() => {
    let stale = false;
    setC(null);
    unwrap(window.api.getClubProfile(profileId, careerId, clubId)).then((r) => { if (!stale) setC(r); }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, clubId]);

  const squad = useMemo(() => {
    if (!c) return [];
    const val = (p: ClubProfileDto['squad'][number]): number | string => sort.key === 'position' ? POS_ORDER.indexOf(p.position) : sort.key === 'name' ? p.name : sort.key === 'avgRating' ? p.avgRating ?? -1 : p[sort.key];
    return [...c.squad].sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number); return (sort.desc ? -r : r) || a.name.localeCompare(b.name); });
  }, [c, sort]);

  if (error) return <div className="cpg"><button className="secondary" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />Voltar</button><p className="error" role="alert">{error}</p></div>;
  if (!c) return <p className="muted">Carregando a ficha do clube…</p>;
  const { info, league } = c;
  const th = (key: SortKey, label: string, title?: string) => (
    <th className={key === 'name' ? '' : 'center'} title={title} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className="cpg-sort" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'position' && key !== 'name' && key !== 'age' }))}>{label}{sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}</button>
    </th>
  );
  const fixture = (f: FixtureDto) => {
    const home = f.homeId === info.id, opp = home ? f.awayName : f.homeName, oppId = home ? f.awayId : f.homeId;
    const gf = home ? f.homeGoals : f.awayGoals, ga = home ? f.awayGoals : f.homeGoals;
    const res = f.status === 'played' && gf != null && ga != null ? (gf > ga ? 'V' : gf < ga ? 'D' : 'E') : null;
    return (
      <li key={f.id} className="cpg-fx">
        <span className="muted small cpg-fx-date">{fmtDate(f.date).slice(0, 5)}</span>
        {res ? <i className={`cp-form-${res} cpg-res`}>{res}</i> : <span className="cpg-res muted small">{home ? 'C' : 'F'}</span>}
        <span className="cp-club cpg-fx-opp"><ClubCrest id={oppId} name={opp} size={14} src={img.url('clubs', oppId)} />{home ? '' : '@ '}{opp}</span>
        <span className="muted small cpg-fx-comp">{f.competitionName}</span>
        {f.status === 'played' ? (f.hasReport ? <button className="cp-club-btn" title="Ver o relatório" onClick={() => onOpenMatch(f.id)}><strong>{gf} x {ga}</strong></button> : <strong>{gf} x {ga}</strong>) : <span className="muted small">{home ? 'em casa' : 'fora'}</span>}
      </li>
    );
  };

  return (
    <div className="cpg">
      <section className="card cpg-head">
        <button className="secondary" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />Voltar</button>
        <ClubCrest id={info.id} name={info.name} size={64} src={img.url('clubs', info.id)} />
        <div className="cpg-title">
          <h2>{info.name}{info.isUserClub && <span className="muted small"> (seu clube)</span>}</h2>
          <span className="muted small"><Flag code={info.countryCode} size={12} title={info.country} /> {info.city} · {info.country} · {info.league}</span>
          <Stars reputation={info.reputation} label="Reputação do clube" />
        </div>
        <div className="cpg-facts">
          <div><span>Torcida</span><strong><Users size={14} aria-hidden="true" /> {fmtNum(info.fans)}</strong></div>
          <div><span>Estádio</span><strong><Building2 size={14} aria-hidden="true" /> {info.stadium}</strong><em>{fmtNum(info.capacity)} lugares</em></div>
          <div><span>Elenco</span><strong>{info.squad.length} jogadores</strong><em>idade média {String(info.avgAge).replace('.', ',')}</em></div>
          <div><span>Técnico</span>
            {info.isUserClub ? <strong>{info.userCoach} <span className="muted small">(você)</span></strong>
              : info.coach ? <button className="cpg-coach" onClick={() => setCoach(info.coach!.id)}><CoachPhoto id={info.coach.id} name={info.coach.name} size={22} src={img.url('coaches', info.coach.id)} /><strong>{info.coach.name}</strong><ChevronRight size={14} aria-hidden="true" /></button>
                : <strong className="neg">Vaga aberta</strong>}
          </div>
        </div>
      </section>

      <div className="cpg-grid">
        <section className="card">
          <h3 className="cs-h3 cpg-h3">Temporada</h3>
          {league ? (
            <>
              <p className="cpg-pos"><strong>{league.row.position}º</strong> de {league.total} · {league.name}</p>
              <p className="muted small">{league.row.points} pts · {league.row.won}V {league.row.drawn}E {league.row.lost}D · gols {league.row.goalsFor}–{league.row.goalsAgainst} ({league.row.goalDiff > 0 ? '+' : ''}{league.row.goalDiff}) · rodada {league.roundsPlayed} de {league.totalRounds}</p>
              {league.row.zone && <p className="small"><span className={`dot ${league.row.zone}`} /> {league.row.zone === 'promotion' ? `Zona de acesso${league.zoneTargets.promotion ? ` (${league.zoneTargets.promotion})` : ''}` : league.row.zone === 'continental' ? 'Zona de vaga continental' : `Zona de rebaixamento${league.zoneTargets.relegation ? ` (${league.zoneTargets.relegation})` : ''}`}</p>}
              <span className="cp-form">{league.row.form.map((f, k) => <i key={k} className={`cp-form-${f}`}>{f}</i>)}</span>
            </>
          ) : <p className="muted small">Sem liga em andamento.</p>}
          {c.cups.length > 0 && <ul className="cpg-cups">{c.cups.map((k) => (
            <li key={k.competitionId}><Trophy size={13} aria-hidden="true" /><span>{k.name}</span><span className={`muted small cpg-cup-${k.status}`}>{CUP_STATUS[k.status]}{k.status !== 'champion' && k.stage ? ` · ${k.stage}` : ''}</span></li>
          ))}</ul>}
        </section>
        <section className="card">
          <h3 className="cs-h3 cpg-h3">Últimos jogos</h3>
          {c.recent.length ? <ul className="cpg-fxs">{c.recent.map(fixture)}</ul> : <p className="muted small">Nenhum jogo disputado nesta temporada.</p>}
        </section>
        <section className="card">
          <h3 className="cs-h3 cpg-h3">Próximos jogos</h3>
          {c.upcoming.length ? <ul className="cpg-fxs">{c.upcoming.map(fixture)}</ul> : <p className="muted small">Sem jogos marcados.</p>}
        </section>
      </div>

      <div className="cpg-grid2">
        <section className="card cpg-squad">
          <h3 className="cs-h3 cpg-h3">Elenco — temporada atual</h3>
          <div className="cpg-squad-scroll">
            <table className="cp-mini">
              <thead><tr>{th('position', 'Pos.')}{th('name', 'Jogador')}{th('age', 'Idade')}<th className="center">Nac.</th>{th('appearances', 'J', 'Jogos')}{th('minutes', 'Min', 'Minutos')}{th('goals', 'G', 'Gols')}{th('assists', 'A', 'Assistências')}{th('cleanSheets', 'JSG', 'Jogos sem sofrer gols (goleiros)')}{th('avgRating', 'Nota', 'Nota média')}
                {info.isUserClub && <th className="center">Contrato</th>}</tr></thead>
              <tbody>{squad.map((p) => (
                <tr key={p.id}>
                  <td><PosPill pos={p.position} /></td>
                  <td><button className="cp-club-btn" onClick={() => onOpenPlayer(p.id)}>{p.name}</button>{p.injured && <HeartPulse size={13} className="neg cpg-inj" aria-label="lesionado" />}</td>
                  <td className="center">{p.age}</td><td className="center">{p.nationality}</td>
                  <td className="center">{p.appearances}</td><td className="center">{p.minutes}</td><td className="center">{p.goals}</td><td className="center">{p.assists}</td>
                  <td className="center">{p.position === 'GK' ? p.cleanSheets : '—'}</td>
                  <td className="center">{p.avgRating == null ? '—' : p.avgRating.toFixed(2).replace('.', ',')}</td>
                  {info.isUserClub && <td className="center">{p.contractEnd ? fmtDate(p.contractEnd) : '—'}</td>}
                </tr>))}</tbody>
            </table>
          </div>
          {!info.isUserClub && <p className="muted small">A força dos jogadores de outros clubes aparece no perfil de cada um, como estimativa dos seus olheiros.</p>}
        </section>
        <div className="cpg-side">
          <section className="card">
            <h3 className="cs-h3 cpg-h3">Títulos</h3>
            {c.trophies.length ? <ul className="cpg-list">{c.trophies.map((t, i) => <li key={i}><Trophy size={13} className="cpg-gold" aria-hidden="true" />{t.competitionName}</li>)}</ul>
              : <p className="muted small">Nenhum título desde o início do jogo.</p>}
          </section>
          <section className="card">
            <h3 className="cs-h3 cpg-h3">Histórico</h3>
            {c.history.length ? <ul className="cpg-list">{c.history.map((h) => <li key={h.season}><span>{h.competitionName}</span><strong>{h.position}º</strong>{h.outcome && <span className={`muted small cpg-out-${h.outcome}`}>{OUTCOME[h.outcome]}</span>}</li>)}</ul>
              : <p className="muted small">Ainda não há temporadas encerradas.</p>}
          </section>
        </div>
      </div>
      {coach && <CoachSheet profileId={profileId} careerId={careerId} coachId={coach} onClose={() => setCoach(null)} />}
    </div>
  );
}
