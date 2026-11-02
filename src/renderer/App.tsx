import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, CareerListDto, CareerOverviewDto, ProfileDto } from '../shared/api.ts';
import { errMsg, fmtDate, fmtDateTime, unwrap } from './util.ts';
import { NewCareer } from './screens/NewCareer.tsx';
import { CareerList } from './screens/CareerList.tsx';
import { CareerDashboard } from './screens/CareerDashboard.tsx';

type Screen = { name: 'home' } | { name: 'new' } | { name: 'load' } | { name: 'career'; overview: CareerOverviewDto };
const LS_KEY = 'fmsim.profileId';

function readStoredProfile(): string | null { try { return localStorage.getItem(LS_KEY); } catch { return null; } }
function storeProfile(id: string): void { try { localStorage.setItem(LS_KEY, id); } catch { /* preferência opcional */ } }

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [profiles, setProfiles] = useState<ProfileDto[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [careers, setCareers] = useState<CareerListDto | null>(null);
  const [newProfile, setNewProfile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setInfo(await unwrap(window.api.appInfo()));
        const list = await unwrap(window.api.listProfiles());
        setProfiles(list);
        const stored = readStoredProfile();
        setProfileId(list.find((p) => p.id === stored)?.id ?? list[0]?.id ?? null);
      } catch (e) { setError(errMsg(e)); }
    })();
  }, []);

  const refreshCareers = useCallback(async (id: string | null) => {
    if (!id) { setCareers(null); return; }
    try { setCareers(await unwrap(window.api.listCareers(id))); } catch (e) { setCareers(null); setError(errMsg(e)); }
  }, []);
  useEffect(() => { void refreshCareers(profileId); }, [profileId, refreshCareers, screen.name]);

  async function addProfile() {
    setError(null); setBusy(true);
    try {
      const p = await unwrap(window.api.createProfile(newProfile));
      setProfiles((prev) => [...prev, p]); setProfileId(p.id); storeProfile(p.id); setNewProfile('');
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  async function openCareer(careerId: string) {
    if (!profileId) return;
    setError(null); setBusy(true);
    try { setScreen({ name: 'career', overview: await unwrap(window.api.openCareer(profileId, careerId)) }); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (screen.name === 'new' && profileId) {
    return <NewCareer profileId={profileId} onBack={() => setScreen({ name: 'home' })} onCreated={(id) => openCareer(id)} />;
  }
  if (screen.name === 'load' && profileId) {
    return <CareerList profileId={profileId} data={careers} error={error} onBack={() => setScreen({ name: 'home' })} onOpen={openCareer} busy={busy} />;
  }
  if (screen.name === 'career') {
    const { profileId: pid, id: cid } = screen.overview.summary;
    const refresh = async () => { setScreen({ name: 'career', overview: await unwrap(window.api.openCareer(pid, cid)) }); };
    return <CareerDashboard key={cid} overview={screen.overview} onExit={() => setScreen({ name: 'home' })} onRefresh={refresh} />;
  }

  const latest = careers?.careers[0];
  return (
    <main className="shell narrow">
      <header className="hero">
        <h1>Football Manager Simulator</h1>
        <p className="muted">Gerencie um clube, desenvolva jovens e construa sua carreira de treinador.</p>
      </header>

      <section className="card">
        <h2>Perfil local</h2>
        {profiles.length > 0 ? (
          <label>Perfil ativo
            <select value={profileId ?? ''} onChange={(e) => { setProfileId(e.target.value); storeProfile(e.target.value); }}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ) : <p className="muted">Crie um perfil para começar. Ele fica apenas neste computador, sem conta online.</p>}
        <div className="row">
          <input placeholder="Nome do novo perfil" value={newProfile} maxLength={40}
            onChange={(e) => setNewProfile(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newProfile.trim()) void addProfile(); }} />
          <button className="secondary" onClick={() => void addProfile()} disabled={busy || !newProfile.trim()}>Criar perfil</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="card menu">
        <button disabled={!profileId} onClick={() => setScreen({ name: 'new' })}>Nova carreira</button>
        <button disabled={!latest || busy} onClick={() => latest && void openCareer(latest.id)}>Continuar carreira</button>
        <button disabled={!profileId} onClick={() => setScreen({ name: 'load' })}>Carregar carreira</button>
        <button disabled title="Disponível na Fase 10 (exportação e importação de saves)">Importar save <small>Fase 10</small></button>
        <button disabled title="Ainda não implementado">Editor de dados <small>Pendente</small></button>
        <button disabled title="Ainda não implementado">Configurações <small>Pendente</small></button>
        <button className="danger" onClick={() => void window.api.quit()}>Sair</button>
      </section>

      {latest && (
        <section className="card">
          <h2>Última carreira</h2>
          <p><strong>{latest.coachName}</strong> — {latest.clubName}</p>
          <p className="muted">Temporada {latest.season} · jogo em {fmtDate(latest.gameDate)} · salvo em {fmtDateTime(latest.updatedAt)}</p>
        </section>
      )}
      {info && <footer className="muted small">v{info.version} · dados em {info.dataDir}</footer>}
    </main>
  );
}
