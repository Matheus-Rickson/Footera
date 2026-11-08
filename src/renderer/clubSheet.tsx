import { useEffect, useState, type ReactNode } from 'react';
import { Building2, ChevronRight, Maximize2, UserRound, Users, X } from 'lucide-react';
import type { AiCoachDetailDto, ClubInfoDto } from '../shared/api.ts';
import { COACH_ATTRS } from '../shared/coachAttributes.ts';
import { COACH_ATTR_CAP } from '../game/coach-engine/coach.ts';
import { errMsg, fmtDate, fmtNum, METHODOLOGY, unwrap } from './util.ts';
import { Stars } from './stars.tsx';
import { ClubCrest, Flag } from './flags.tsx';
import { nationName } from '../shared/nations.ts';
import { PosPill } from './playerUi.tsx';
import { useImages } from './images.ts';

const SPELL_END: Record<string, string> = { sacked: 'demitido', replaced: 'substituído', retired: 'aposentou-se' };

/** Foto do técnico (do pacote de dados, em images/coaches/<id>) ou o ícone. */
export function CoachPhoto({ id, name, size, src }: { id: string; name: string; size: number; src: string | null }) {
  return src ? <img className="cs-photo" src={src} alt={`Foto: ${name}`} width={size} height={size} data-coach={id} />
    : <span className="cs-photo cs-photo-empty" style={{ width: size, height: size }} aria-hidden="true"><UserRound size={Math.round(size * 0.55)} /></span>;
}

function Modal({ label, wide, onClose, children }: { label: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'cs-modal' : 'cs-coach-modal'}`} role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}

/** Ficha de um clube (aberta pela tabela de Competições): dados, técnico (clicável) e elenco (clicável → perfil do jogador). */
export function ClubSheet({ profileId, careerId, clubId, onClose, onOpenPlayer, onOpenFull }: {
  profileId: string; careerId: string; clubId: string; onClose: () => void; onOpenPlayer?: (id: string) => void; onOpenFull?: (clubId: string) => void;
}) {
  const [c, setC] = useState<ClubInfoDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coach, setCoach] = useState<string | null>(null);
  const img = useImages();
  useEffect(() => {
    let stale = false;
    setC(null);
    unwrap(window.api.getClubInfo(profileId, careerId, clubId)).then((r) => { if (!stale) setC(r); }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, clubId]);

  return (
    <>
      <Modal label={c ? `Clube: ${c.name}` : 'Clube'} wide onClose={coach ? () => setCoach(null) : onClose}>
        <header className="modal-head">
          {c && <ClubCrest id={c.id} name={c.name} size={40} src={img.url('clubs', c.id)} />}
          <div className="cs-title"><h2>{c && onOpenFull ? <button className="cs-title-btn" title="Abrir a ficha completa do clube" onClick={() => { onClose(); onOpenFull(c.id); }}>{c.name}</button> : c?.name ?? 'Carregando…'}</h2>
            {c && <span className="muted small"><Flag code={c.countryCode} size={12} title={c.country} /> {c.city} · {c.country} · {c.league}</span>}</div>
          {c && onOpenFull && <button className="secondary" onClick={() => { onClose(); onOpenFull(c.id); }}><Maximize2 size={14} aria-hidden="true" />Ficha completa</button>}
          <button className="secondary icon" aria-label="Fechar" autoFocus onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </header>
        <div className="modal-body">
          {error && <p className="error" role="alert">{error}</p>}
          {c && (
            <>
              <div className="cs-facts">
                <div><span>Reputação</span><strong><Stars reputation={c.reputation} size={16} label="Reputação do clube" /></strong></div>
                <div><span>Torcida</span><strong><Users size={14} aria-hidden="true" /> {fmtNum(c.fans)}</strong></div>
                <div><span>Estádio</span><strong><Building2 size={14} aria-hidden="true" /> {c.stadium}</strong><em>{fmtNum(c.capacity)} lugares</em></div>
                <div><span>Elenco</span><strong>{c.squad.length} jogadores</strong><em>idade média {String(c.avgAge).replace('.', ',')}</em></div>
              </div>
              <h3 className="cs-h3">Técnico</h3>
              {c.isUserClub ? <div className="cs-coach cs-coach-static"><UserRound size={18} aria-hidden="true" /><span><strong>{c.userCoach}</strong> <span className="muted small">(você)</span></span></div>
                : c.coach ? (
                  <button className="cs-coach" onClick={() => setCoach(c.coach!.id)} aria-label={`Ver a ficha de ${c.coach.name}`}>
                    <CoachPhoto id={c.coach.id} name={c.coach.name} size={40} src={img.url('coaches', c.coach.id)} />
                    <span className="cs-coach-name"><strong>{c.coach.name}</strong><span className="muted small">{c.coach.age} anos · {c.coach.nationality}{c.coach.since ? ` · no cargo desde ${fmtDate(c.coach.since)}` : ''}</span></span>
                    <Stars reputation={c.coach.reputation} label="Reputação do técnico" />
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ) : <p className="muted"><span className="neg">Vaga aberta</span>: o clube procura um técnico.</p>}
              <h3 className="cs-h3">Elenco</h3>
              <div className="cs-squad">
                <table>
                  <thead><tr><th>Pos.</th><th>Jogador</th><th>Idade</th><th>Nac.</th></tr></thead>
                  <tbody>{c.squad.map((p) => (
                    <tr key={p.id}><td><PosPill pos={p.position} /></td>
                      <td>{onOpenPlayer ? <button className="link" onClick={() => { onClose(); onOpenPlayer(p.id); }}>{p.name}</button> : p.name}</td>
                      <td>{p.age}</td><td>{p.nationality}</td></tr>))}</tbody>
                </table>
              </div>
              {!c.isUserClub && <p className="muted small">A força dos jogadores de outros clubes aparece no perfil de cada um, como estimativa dos seus olheiros.</p>}
            </>
          )}
        </div>
      </Modal>
      {coach && <CoachSheet profileId={profileId} careerId={careerId} coachId={coach} onClose={() => setCoach(null)} />}
    </>
  );
}

/** Ficha de um técnico da IA: dados, atributos (1–20), metodologia e passagens por clubes. */
export function CoachSheet({ profileId, careerId, coachId, onClose }: { profileId: string; careerId: string; coachId: string; onClose: () => void }) {
  const [k, setK] = useState<AiCoachDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const img = useImages();
  useEffect(() => {
    let stale = false;
    setK(null);
    unwrap(window.api.getAiCoach(profileId, careerId, coachId)).then((r) => { if (!stale) setK(r); }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [profileId, careerId, coachId]);

  return (
    <Modal label={k ? `Técnico: ${k.name}` : 'Técnico'} onClose={onClose}>
      <header className="modal-head">
        <CoachPhoto id={coachId} name={k?.name ?? 'Técnico'} size={56} src={img.url('coaches', coachId)} />
        <div className="cs-title"><h2>{k?.name ?? 'Carregando…'}</h2>
          {k && <span className="muted small"><Flag code={k.nationality} size={12} title={nationName(k.nationality)} /> {k.age} anos · {k.retired ? 'aposentado' : k.clubName ?? 'sem clube'}</span>}</div>
        <button className="secondary icon" aria-label="Fechar" autoFocus onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="modal-body">
        {error && <p className="error" role="alert">{error}</p>}
        {k && (
          <>
            <div className="cs-facts">
              <div><span>Reputação</span><strong><Stars reputation={k.reputation} size={16} label="Reputação do técnico" /></strong></div>
              <div><span>Metodologia</span><strong>{METHODOLOGY[k.methodology].label}</strong><em>{METHODOLOGY[k.methodology].description}</em></div>
            </div>
            <h3 className="cs-h3">Atributos</h3>
            <div className="bd-attrs">
              {COACH_ATTRS.map((a) => (
                <div key={a.key} className="bd-attr" title={a.description}>
                  <span className="bd-attr-name">{a.label}</span>
                  <div className="meter bd-attr-bar"><i style={{ width: `${(k.attributes[a.key] / COACH_ATTR_CAP) * 100}%` }} /></div>
                  <strong className="bd-attr-val">{k.attributes[a.key]}</strong>
                </div>
              ))}
            </div>
            <h3 className="cs-h3">Carreira</h3>
            {k.spells.length === 0 ? <p className="muted small">Nenhuma passagem registrada desde o início do jogo.</p> : (
              <table><thead><tr><th>Clube</th><th>Início</th><th>Fim</th><th>Saída</th></tr></thead>
                <tbody>{k.spells.map((s, i) => <tr key={i} className={s.end ? '' : 'mine'}><td>{s.clubName}</td><td>{fmtDate(s.start)}</td><td>{s.end ? fmtDate(s.end) : 'atual'}</td><td>{s.reason ? SPELL_END[s.reason] : '—'}</td></tr>)}</tbody></table>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
