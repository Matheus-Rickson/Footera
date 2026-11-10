import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Moon, Package, PencilRuler, Play, Plus, Power, Sun, Trophy, UserPlus } from 'lucide-react';
import { useTheme } from './theme.ts';
import footeraMark from './assets/footera-mark.png';
import homeTactics from './assets/home-tactics.webp';
import type { AppInfo, CareerListDto, CareerOverviewDto, ProfileDto } from '../shared/api.ts';
import { errMsg, fmtDate, fmtDateTime, unwrap } from './util.ts';
import { NewCareer } from './screens/NewCareer.tsx';
import { PacksView } from './screens/PacksView.tsx';
import { EditorView } from './screens/EditorView.tsx';
import { CareerList } from './screens/CareerList.tsx';
import { CareerDashboard } from './screens/CareerDashboard.tsx';
import { ClubCrest } from './flags.tsx';
import { useImages } from './images.ts';

type Screen = { name: 'home' } | { name: 'new' } | { name: 'load' } | { name: 'packs' } | { name: 'editor' } | { name: 'career'; overview: CareerOverviewDto };
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
  const [creatingProfile, setCreatingProfile] = useState(false);
  const img = useImages();

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
  // a lista de carreiras só aparece na tela inicial (carreira mais recente) e em "Carregar carreira": não relê os saves nas outras telas
  const listsCareers = screen.name === 'home' || screen.name === 'load';
  useEffect(() => { if (listsCareers) void refreshCareers(profileId); }, [profileId, refreshCareers, listsCareers]);

  async function addProfile() {
    setError(null); setBusy(true);
    try {
      const p = await unwrap(window.api.createProfile(newProfile));
      setProfiles((prev) => [...prev, p]); setProfileId(p.id); storeProfile(p.id); setNewProfile(''); setCreatingProfile(false);
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
  if (screen.name === 'packs') return <PacksView onBack={() => setScreen({ name: 'home' })} />;
  if (screen.name === 'editor') return <EditorView onBack={() => setScreen({ name: 'home' })} />;
  if (screen.name === 'load' && profileId) {
    return <CareerList profileId={profileId} data={careers} error={error} onBack={() => setScreen({ name: 'home' })} onOpen={openCareer} busy={busy} onChanged={() => refreshCareers(profileId)} />;
  }
  if (screen.name === 'career') {
    const { profileId: pid, id: cid } = screen.overview.summary;
    const refresh = async () => { setScreen({ name: 'career', overview: await unwrap(window.api.openCareer(pid, cid)) }); };
    return <CareerDashboard key={cid} overview={screen.overview} onExit={() => setScreen({ name: 'home' })} onRefresh={refresh} />;
  }

  const latest = careers?.careers[0];
  const profileName = profiles.find((p) => p.id === profileId)?.name;
  const showNewProfile = creatingProfile || profiles.length === 0;
  return (
    <main className="hm">
      <section className="hm-hero" aria-label="FOOTERA">
        <img className="hm-pitch" src={homeTactics} alt="" aria-hidden="true" />
        <div className="hm-brand">
          <span className="brand-mark hm-mark" role="img" aria-label="Logo do FOOTERA" style={{ ['--mark' as string]: `url(${footeraMark})` }} />
          <span className="hm-word">FOOTERA</span>
        </div>
        <div className="hm-claim">
          <p className="hm-tagline">Construa seu clube.<br /><em>Crie seu legado.</em></p>
        </div>
        {info && <span className="hm-version">v{info.version}</span>}
      </section>

      <section className="hm-main">
        <header className="hm-top">
          <div className="hm-hello">
            <span className="muted small">{profileName ? 'Bem-vindo de volta,' : 'Bem-vindo ao FOOTERA'}</span>
            <strong>{profileName ?? 'Crie um perfil para começar'}</strong>
          </div>
          <div className="hm-tools">
            {profiles.length > 0 && (
              <select className="hm-profile" aria-label="Perfil ativo" value={profileId ?? ''} onChange={(e) => { setProfileId(e.target.value); storeProfile(e.target.value); }}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {profiles.length > 0 && (
              <button className="secondary icon" onClick={() => setCreatingProfile((v) => !v)} title="Criar outro perfil local" aria-label="Novo perfil" aria-expanded={creatingProfile}>
                <UserPlus size={16} aria-hidden="true" />
              </button>
            )}
            <button className="secondary icon" onClick={toggleTheme} title={theme === 'dark' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'} aria-label="Alternar tema">
              {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
          </div>
        </header>

        {showNewProfile && (
          <div className="hm-newprofile">
            <input className="grow" placeholder="Nome do novo perfil" title="O perfil fica só neste computador, sem conta online" value={newProfile} maxLength={40} autoFocus={profiles.length > 0}
              onChange={(e) => setNewProfile(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newProfile.trim()) void addProfile(); if (e.key === 'Escape') setCreatingProfile(false); }} />
            <button onClick={() => void addProfile()} disabled={busy || !newProfile.trim()}><Plus size={16} aria-hidden="true" />Criar perfil</button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}

        {latest ? (
          <article className="hm-resume">
            {latest.clubId ? <ClubCrest id={latest.clubId} name={latest.clubName} size={52} src={img.url('clubs', latest.clubId)} /> : <span className="hm-resume-ico" aria-hidden="true"><Play size={22} /></span>}
            <div className="hm-resume-text">
              <span className="hm-label">Continuar carreira</span>
              <strong>{latest.clubId ? latest.clubName : 'Sem clube'}</strong>
              <span className="muted small">{latest.coachName} · temporada {latest.seasonLabel} · {fmtDate(latest.gameDate)}</span>
              <span className="hm-saved">Salvo em {fmtDateTime(latest.updatedAt)}</span>
            </div>
            <button className="hm-play" disabled={busy} onClick={() => void openCareer(latest.id)}><Play size={18} aria-hidden="true" />Continuar</button>
          </article>
        ) : profileId ? (
          <article className="hm-resume">
            <span className="hm-resume-ico" aria-hidden="true"><Trophy size={22} /></span>
            <div className="hm-resume-text">
              <span className="hm-label">Nenhuma carreira ainda</span>
              <strong>Escolha um clube e comece a sua história</strong>
            </div>
          </article>
        ) : null}

        <nav className="hm-tiles" aria-label="Menu principal">
          <button className="hm-tile hm-tile-main" disabled={!profileId} onClick={() => setScreen({ name: 'new' })}>
            <span className="hm-tile-ico"><Plus size={20} aria-hidden="true" /></span><span className="hm-tile-t">Nova carreira</span><span className="hm-tile-d">Escolha país, liga e clube</span>
          </button>
          <button className="hm-tile" disabled={!profileId} onClick={() => setScreen({ name: 'load' })}>
            <span className="hm-tile-ico"><FolderOpen size={20} aria-hidden="true" /></span><span className="hm-tile-t">Carregar carreira</span><span className="hm-tile-d">{careers ? `${careers.careers.length} ${careers.careers.length === 1 ? 'carreira salva' : 'carreiras salvas'}` : 'Suas carreiras salvas'}</span>
          </button>
          <button className="hm-tile" onClick={() => setScreen({ name: 'packs' })}>
            <span className="hm-tile-ico"><Package size={20} aria-hidden="true" /></span><span className="hm-tile-t">Pacotes de dados</span><span className="hm-tile-d">Ative, importe e exporte pacotes</span>
          </button>
          <button className="hm-tile" onClick={() => setScreen({ name: 'editor' })}>
            <span className="hm-tile-ico"><PencilRuler size={20} aria-hidden="true" /></span><span className="hm-tile-t">Editor de dados</span><span className="hm-tile-d">Clubes, jogadores, ligas e copas</span>
          </button>
        </nav>

        <footer className="hm-foot">
          <span className="hm-path muted small" title={info?.dataDir}>{info ? `Dados em ${info.dataDir}` : ''}</span>
          <button className="hm-quit" onClick={() => void window.api.quit()}><Power size={15} aria-hidden="true" />Sair</button>
        </footer>
      </section>
    </main>
  );
}
