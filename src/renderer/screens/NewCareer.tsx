import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClubList, PhotoPick } from '../../shared/api.ts';
import type { Methodology } from '../../shared/types.ts';
import { errMsg, fmtNum, METHODOLOGY, unwrap } from '../util.ts';

interface Props { profileId: string; onBack: () => void; onCreated: (careerId: string) => void }

const newSeed = () => `universo-${Math.random().toString(36).slice(2, 8)}`;

export function NewCareer({ profileId, onBack, onCreated }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [seed, setSeed] = useState(newSeed);
  const [list, setList] = useState<ClubList | null>(null);
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [clubId, setClubId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [nationality, setNationality] = useState('BRA');
  const [methodology, setMethodology] = useState<Methodology>('possession');
  const [photo, setPhoto] = useState<PhotoPick | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<PhotoPick | null>(null);
  photoRef.current = photo;

  // Carrega os clubes do universo da semente (descarta respostas antigas).
  useEffect(() => {
    const s = seed.trim();
    if (!s || s.length > 64) { setList(null); return; }
    let stale = false;
    const t = setTimeout(() => {
      unwrap(window.api.listClubs(s)).then((r) => {
        if (stale) return;
        setList(r); setClubId(null); setError(null);
        if (!r.countries.some((c) => c.code === nationality)) setNationality(r.countries[0]?.code ?? 'BRA');
      }).catch((e) => { if (!stale) setError(errMsg(e)); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // Descarta a foto pendente ao sair da tela sem criar a carreira.
  useEffect(() => () => { const p = photoRef.current; if (p) void window.api.discardPhoto(p.token); }, []);

  const leagues = useMemo(() => [...new Set((list?.clubs ?? []).map((c) => `${c.country} — ${c.league}`))], [list]);
  const visible = useMemo(() => (list?.clubs ?? [])
    .filter((c) => leagueFilter === 'all' || `${c.country} — ${c.league}` === leagueFilter)
    .sort((a, b) => a.country.localeCompare(b.country) || a.leagueTier - b.leagueTier || b.reputation - a.reputation), [list, leagueFilter]);
  const chosen = list?.clubs.find((c) => c.id === clubId) ?? null;

  const startYear = list ? Number(list.startDate.slice(0, 4)) : 2026;
  const maxBirth = `${startYear - 18}-07-01`, minBirth = `${startYear - 90}-01-01`;
  const formOk = firstName.trim() && lastName.trim() && birthDate && birthDate >= minBirth && birthDate <= maxBirth;

  async function pick() {
    setError(null);
    try {
      const p = await unwrap(window.api.pickPhoto());
      if (!p) return;
      if (photo) void window.api.discardPhoto(photo.token);
      setPhoto(p);
    } catch (e) { setError(errMsg(e)); }
  }
  async function removePhoto() {
    if (photo) await window.api.discardPhoto(photo.token);
    setPhoto(null);
  }
  async function create() {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      const c = await unwrap(window.api.createCareer({
        profileId, seed: seed.trim(), clubId: chosen.id, photoToken: photo?.token ?? null,
        coach: { firstName, lastName, birthDate, nationality, methodology },
      }));
      setPhoto(null); // token consumido pelo processo principal
      onCreated(c.id);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <main className="shell">
      <header className="bar">
        <h1>Nova carreira <span className="muted small">— passo {step} de 2</span></h1>
        <button className="secondary" onClick={onBack}>Cancelar</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      {step === 1 && (
        <>
          <section className="card">
            <h2>1. Universo e clube</h2>
            <div className="row">
              <label className="grow">Semente do universo (a mesma semente gera sempre o mesmo mundo)
                <input value={seed} maxLength={64} onChange={(e) => setSeed(e.target.value)} />
              </label>
              <button className="secondary" onClick={() => setSeed(newSeed())}>Sortear outra</button>
            </div>
            <label>Filtrar por liga
              <select value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}>
                <option value="all">Todas as ligas</option>
                {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </section>
          <section className="card scroll">
            {!list ? <p className="muted">Gerando universo…</p> : (
              <table className="pick">
                <thead><tr><th /><th>Clube</th><th>Liga</th><th>Reputação</th><th>Força média</th><th>Estádio</th><th>Capacidade</th></tr></thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.id} className={c.id === clubId ? 'selected' : ''} onClick={() => setClubId(c.id)}>
                      <td><input type="radio" name="club" checked={c.id === clubId} onChange={() => setClubId(c.id)} aria-label={`Escolher ${c.name}`} /></td>
                      <td>{c.name}</td><td>{c.country} — {c.league}</td><td>{c.reputation}</td><td>{c.avgOverall}</td><td>{c.stadium}</td><td>{fmtNum(c.capacity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <div className="row end"><button disabled={!chosen} onClick={() => setStep(2)}>Continuar{chosen ? ` com ${chosen.name}` : ''}</button></div>
        </>
      )}

      {step === 2 && chosen && (
        <>
          <section className="card">
            <h2>2. Treinador — {chosen.name}</h2>
            <div className="grid2">
              <label>Nome<input value={firstName} maxLength={40} onChange={(e) => setFirstName(e.target.value)} /></label>
              <label>Sobrenome<input value={lastName} maxLength={40} onChange={(e) => setLastName(e.target.value)} /></label>
              <label>Data de nascimento
                <input type="date" value={birthDate} min={minBirth} max={maxBirth} onChange={(e) => setBirthDate(e.target.value)} />
              </label>
              <label>Nacionalidade
                <select value={nationality} onChange={(e) => setNationality(e.target.value)}>
                  {(list?.countries ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
            </div>
            <p className="muted small">Idade na data de início da carreira ({list?.startDate.split('-').reverse().join('/')}): mínimo 18 e máximo 90 anos.</p>
          </section>

          <section className="card">
            <h2>Metodologia</h2>
            <div className="options">
              {(Object.keys(METHODOLOGY) as Methodology[]).map((m) => (
                <label key={m} className={`option ${methodology === m ? 'on' : ''}`}>
                  <input type="radio" name="meth" checked={methodology === m} onChange={() => setMethodology(m)} />
                  <strong>{METHODOLOGY[m].label}</strong><span className="muted small">{METHODOLOGY[m].description}</span>
                </label>
              ))}
            </div>
            <p className="muted small">A metodologia define as preferências táticas iniciais; você poderá usar qualquer estilo depois.</p>
          </section>

          <section className="card">
            <h2>Fotografia (opcional)</h2>
            <div className="row">
              {photo ? <img className="photo" src={photo.dataUrl} alt="Pré-visualização da foto do treinador" /> : <div className="photo placeholder">Sem foto</div>}
              <div>
                <div className="row">
                  <button className="secondary" onClick={() => void pick()}>{photo ? 'Substituir…' : 'Escolher imagem…'}</button>
                  {photo && <button className="secondary" onClick={() => void removePhoto()}>Remover</button>}
                </div>
                {photo && <p className="muted small">{photo.fileName} · {photo.format.toUpperCase()} · {photo.width}×{photo.height} · {fmtNum(Math.round(photo.bytes / 1024))} KB</p>}
                <p className="muted small">PNG ou JPEG, até 5 MB, de 64×64 a 4096×4096. Uma cópia será guardada dentro do save.</p>
              </div>
            </div>
          </section>

          <div className="row end">
            <button className="secondary" onClick={() => setStep(1)} disabled={busy}>Voltar</button>
            <button disabled={!formOk || busy} onClick={() => void create()}>{busy ? 'Criando carreira…' : 'Iniciar carreira'}</button>
          </div>
        </>
      )}
    </main>
  );
}
