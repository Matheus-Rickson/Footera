import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronDown, FolderOpen, Lock, PackageOpen, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { PackInfoDto, PacksOverviewDto } from '../../shared/api.ts';
import { errMsg, fmtNum, unwrap } from '../util.ts';
import { HelpTip } from '../help.tsx';

interface Props { onBack: () => void }


export function PacksView({ onBack }: Props) {
  const [ov, setOv] = useState<PacksOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'overwrite'; name: string } | { kind: 'remove'; pack: PackInfoDto } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => { setOv(await unwrap(window.api.listPacks())); }, []);
  useEffect(() => { load().catch((e) => setError(errMsg(e))); }, [load]);
  async function run(fn: () => Promise<void>) { setBusy(true); setError(null); setNotice(null); try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }

  const enabled = (ov?.packs ?? []).filter((p) => p.enabled).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => p.id);
  const order = (ids: string[]) => run(async () => { setOv(await unwrap(window.api.setPackOrder(ids))); });
  const toggle = (p: PackInfoDto) => order(p.enabled ? enabled.filter((x) => x !== p.id) : [...enabled, p.id]);
  const move = (p: PackInfoDto, d: -1 | 1) => { const i = enabled.indexOf(p.id), j = i + d; if (j < 0 || j >= enabled.length) return; const n = [...enabled]; [n[i], n[j]] = [n[j]!, n[i]!]; void order(n); };
  const importZip = (overwrite: boolean) => run(async () => {
    const r = await unwrap(window.api.importPack(overwrite));
    if (r.status === 'exists') { setConfirm({ kind: 'overwrite', name: r.name ?? r.id ?? '' }); return; }
    setConfirm(null);
    if (r.status === 'imported') { setNotice(`Pacote "${r.name}" importado. Ative-o na lista para usá-lo nas próximas carreiras.`); await load(); }
  });
  const remove = (p: PackInfoDto) => run(async () => { setConfirm(null); setOv(await unwrap(window.api.removePack(p.id))); setNotice(`Pacote "${p.name}" removido.`); });

  return (
    <main className="shell nc-fit pk">
      <header className="nc-top">
        <div className="nc-top-title">
          <h1>Pacotes de dados <HelpTip text="Pacotes de dados (patches) alteram ou ampliam a base do jogo: criam ou editam países, ligas, clubes e jogadores. A base fixa vem sempre primeiro; os pacotes ativos são aplicados na ordem da lista (o de baixo vence em caso de conflito). Valem para carreiras NOVAS; carreiras já criadas não mudam." /></h1>
          <span className="muted small">Coloque pastas de pacote em {ov?.folder ?? '…'} ou importe um .zip.</span>
        </div>
        <button className="secondary" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Menu principal</button>
      </header>

      <div className="pk-toolbar">
        <button disabled={busy} onClick={() => void importZip(false)}><Upload size={16} aria-hidden="true" />Importar .zip</button>
        <button className="secondary" disabled={busy} onClick={() => void run(async () => { await unwrap(window.api.openPacksFolder()); })}><FolderOpen size={16} aria-hidden="true" />Abrir pasta</button>
        <button className="nc-ghost" disabled={busy} onClick={() => void run(load)}><RefreshCw size={14} aria-hidden="true" />Recarregar</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
      {confirm?.kind === 'overwrite' && (
        <div className="notice pk-confirm" role="alert">Já existe um pacote com o mesmo id ("{confirm.name}"). Substituir pela versão escolhida?
          <button disabled={busy} onClick={() => void importZip(true)}>Substituir</button><button className="secondary" onClick={() => setConfirm(null)}>Cancelar</button></div>
      )}
      {confirm?.kind === 'remove' && (
        <div className="notice pk-confirm" role="alert">Remover o pacote "{confirm.pack.name}" do disco? Carreiras já criadas não são afetadas.
          <button className="danger" disabled={busy} onClick={() => void remove(confirm.pack)}>Remover</button><button className="secondary" onClick={() => setConfirm(null)}>Cancelar</button></div>
      )}

      <section className="pk-list" aria-label="Ordem de carga">
        {ov && (
          <div className="pk-row pk-base">
            <span className="pk-lock" title="A base do jogo é sempre a primeira"><Lock size={15} aria-hidden="true" /></span>
            <div className="pk-main"><strong>{ov.base.name}</strong><span className="muted small">versão {ov.base.version} · sempre ativa, sempre primeiro</span></div>
          </div>
        )}
        {ov?.packs.length === 0 && (
          <div className="pk-empty"><PackageOpen size={30} aria-hidden="true" /><p>Nenhum pacote instalado. Importe um .zip ou copie a pasta de um pacote para a pasta de pacotes.</p></div>
        )}
        {ov?.packs.map((p) => {
          const broken = p.issues.length > 0, pos = enabled.indexOf(p.id);
          return (
            <div key={p.folder} className={`pk-row ${p.enabled ? 'on' : ''} ${broken ? 'broken' : ''}`}>
              <label className="pk-switch" title={broken ? 'Corrija os erros do pacote para poder ativá-lo' : p.enabled ? 'Desativar' : 'Ativar'}>
                <input type="checkbox" checked={p.enabled} disabled={busy || broken} onChange={() => void toggle(p)} aria-label={`Ativar ${p.name}`} /><span />
              </label>
              <div className="pk-main">
                <strong>{p.name} <span className="muted small">v{p.version}{p.author ? ` · ${p.author}` : ''}</span></strong>
                {p.description && <span className="muted small">{p.description}</span>}
                <div className="pk-chips">
                  {p.counts && (['countries', 'leagues', 'clubs', 'players'] as const).filter((k) => p.counts![k] > 0).map((k) => (
                    <span key={k} className="pk-chip">{fmtNum(p.counts![k])} {({ countries: 'país(es)', leagues: 'liga(s)', clubs: 'clube(s)', players: 'jogador(es)' })[k]}</span>
                  ))}
                  {p.fullBase && <span className="pk-chip warn">base completa: substitui a base do jogo</span>}
                  {p.requires.length > 0 && <span className="pk-chip">precisa de: {p.requires.join(', ')}</span>}
                  {broken
                    ? <button className="pk-chip bad" onClick={() => setOpen(open === p.folder ? null : p.folder)}><AlertTriangle size={12} aria-hidden="true" />{p.issues.length} erro(s)<ChevronDown size={12} aria-hidden="true" /></button>
                    : <span className="pk-chip good"><CheckCircle2 size={12} aria-hidden="true" />válido</span>}
                </div>
                {open === p.folder && <ul className="pk-issues">{p.issues.slice(0, 50).map((x, i) => <li key={i}>{x}</li>)}</ul>}
              </div>
              <div className="pk-actions">
                {p.enabled && <span className="pk-order" title="Posição na ordem de carga">{pos + 1}º</span>}
                <button className="nc-ghost" disabled={busy || !p.enabled || pos <= 0} aria-label="Subir na ordem" onClick={() => move(p, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                <button className="nc-ghost" disabled={busy || !p.enabled || pos >= enabled.length - 1} aria-label="Descer na ordem" onClick={() => move(p, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                <button className="nc-ghost" disabled={busy} aria-label={`Remover ${p.name}`} onClick={() => setConfirm({ kind: 'remove', pack: p })}><Trash2 size={14} aria-hidden="true" /></button>
              </div>
            </div>
          );
        })}
      </section>

      {ov && (
        <footer className={`nc-footer pk-summary ${ov.universe.ok ? '' : 'bad'}`}>
          {ov.universe.ok ? (
            <>
              <div className="nc-stat"><span>Universo das próximas carreiras</span><strong>{ov.universe.countries} países · {ov.universe.leagues} ligas · {fmtNum(ov.universe.clubs)} clubes · {fmtNum(ov.universe.players)} jogadores</strong></div>
              <div className="nc-stat"><span>Pacotes ativos</span><strong>{enabled.length}</strong></div>
              <div className="nc-stat"><span>Avisos {ov.universe.warnings.length > 0 && <HelpTip text={ov.universe.warnings.slice(0, 8).join(' • ') + (ov.universe.warnings.length > 8 ? ` • … e mais ${ov.universe.warnings.length - 8}` : '')} />}</span><strong>{ov.universe.warnings.length}</strong></div>
            </>
          ) : (
            <div className="pk-errors">
              <strong><AlertTriangle size={16} aria-hidden="true" /> A combinação de pacotes ativos tem erros — novas carreiras ficam bloqueadas até corrigir ou desativar:</strong>
              <ul>{ov.universe.errors.slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}{ov.universe.errors.length > 6 && <li>… e mais {ov.universe.errors.length - 6}</li>}</ul>
            </div>
          )}
        </footer>
      )}
    </main>
  );
}
