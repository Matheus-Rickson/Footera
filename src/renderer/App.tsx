import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Moon, Play, Plus, Power, Sun, Upload } from 'lucide-react';
import { useTheme } from './theme.ts';
import footeraMark from './assets/footera-mark.png';
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
  const [theme, toggleTheme] = useTheme();

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
      <div className="bar">
        <span />
        <button className="secondary" onClick={toggleTheme} title="Alternar entre tema escuro e claro">
          {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        </button>
      </div>
      <header className="hero">
        <span className="brand-mark" role="img" aria-label="Logo do FOOTERA" style={{ ['--mark' as string]: `url(${footeraMark})` }} />
        <h1 className="brand-name">FOOTERA</h1>
        <p className="brand-tagline">Build your club. Create your legacy.</p>
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
          <input className="grow" placeholder="Nome do novo perfil" value={newProfile} maxLength={40}
            onChange={(e) => setNewProfile(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newProfile.trim()) void addProfile(); }} />
          <button className="secondary" onClick={() => void addProfile()} disabled={busy || !newProfile.trim()}><Plus size={16} aria-hidden="true" />Criar perfil</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {latest && (
        <section className="card">
          <h2>Última carreira</h2>
          <div className="bar">
            <div>
              <p><strong>{latest.coachName}</strong> — {latest.clubName}</p>
              <p className="muted small">Temporada {latest.season} · jogo em {fmtDate(latest.gameDate)} · salvo em {fmtDateTime(latest.updatedAt)}</p>
            </div>
            <button disabled={busy} onClick={() => void openCareer(latest.id)}><Play size={16} aria-hidden="true" />Continuar</button>
          </div>
        </section>
      )}

      <section className="card menu">
        <button disabled={!profileId} onClick={() => setScreen({ name: 'new' })}><Plus size={18} aria-hidden="true" />Nova carreira</button>
        <button className="secondary" disabled={!profileId} onClick={() => setScreen({ name: 'load' })}><FolderOpen size={18} aria-hidden="true" />Carregar carreira</button>
        <button className="secondary" disabled title="Disponível na Fase 10 (exportação e importação de saves)"><Upload size={18} aria-hidden="true" />Importar save <span className="muted small">— em breve (Fase 10)</span></button>
        <button className="danger" onClick={() => void window.api.quit()}><Power size={18} aria-hidden="true" />Sair</button>
      </section>
      {info && <footer className="muted small center">v{info.version} · dados em {info.dataDir}</footer>}
    </main>
  );
}
