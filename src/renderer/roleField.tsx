import { roleMotion, type MotionPoint } from '../game/match-engine/roleMotion.ts';
import { roleById } from '../game/match-engine/playerRoles.ts';
import type { Position } from '../shared/types.ts';

const DUR = 4.2; // segundos por ciclo
const X = (p: MotionPoint) => p.x * 1.05, Y = (p: MotionPoint) => p.y * 0.68;
const kt = (ts: number[]) => ts.map((t) => t.toFixed(3)).join(';');

/**
 * Campinho lateral com a animação da função (tendências da função no motor, não um lance real).
 * O ataque é sempre para a direita.
 */
export function RoleField({ roleId, pos, title }: { roleId: string; pos: Position; title?: string }) {
  const role = roleById(roleId);
  if (!role) return null;
  const m = roleMotion(role, pos);
  const pts = m.player;
  const route = pts.slice(0, -1).map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ');
  const b = m.ball;
  return (
    <figure className="rf">
      <figcaption className="rf-head"><strong>{title ?? role.name}</strong><span className="muted small">ataque →</span></figcaption>
      <svg key={`${roleId}-${pos}`} className="rf-pitch" viewBox="0 0 105 68" role="img" aria-label={`Animação da função ${role.name}: ${m.tags.join('; ')}`}>
        <rect x="0" y="0" width="105" height="68" className="rf-grass" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} x={i * 15} y="0" width="7.5" height="68" className="rf-stripe" />)}
        <g className="rf-lines">
          <rect x="1" y="1" width="103" height="66" /><line x1="52.5" y1="1" x2="52.5" y2="67" /><circle cx="52.5" cy="34" r="9.15" />
          <rect x="1" y="13.85" width="16.5" height="40.3" /><rect x="87.5" y="13.85" width="16.5" height="40.3" />
          <rect x="1" y="24.85" width="5.5" height="18.3" /><rect x="98.5" y="24.85" width="5.5" height="18.3" />
        </g>
        {m.zone && <rect className={`rf-zone ${m.zone.kind}`} x={m.zone.x * 1.05} y={m.zone.y * 0.68} width={m.zone.w * 1.05} height={m.zone.h * 0.68} rx="2" />}
        <polyline className="rf-route" points={route} />
        <circle className="rf-home" cx={X(m.base)} cy={Y(m.base)} r="1.6" />
        {b && (
          <line className={`rf-pass ${b.air ? 'air' : ''}`} x1={X(b.from)} y1={Y(b.from)} x2={X(b.to)} y2={Y(b.to)} />
        )}
        <circle className="rf-player" r="2.6" cx={X(pts[0]!)} cy={Y(pts[0]!)}>
          <animate attributeName="cx" dur={`${DUR}s`} repeatCount="indefinite" keyTimes={kt(pts.map((p) => p.t))} values={pts.map((p) => X(p).toFixed(1)).join(';')} calcMode="spline" keySplines={pts.slice(1).map(() => '0.45 0 0.55 1').join(';')} />
          <animate attributeName="cy" dur={`${DUR}s`} repeatCount="indefinite" keyTimes={kt(pts.map((p) => p.t))} values={pts.map((p) => Y(p).toFixed(1)).join(';')} calcMode="spline" keySplines={pts.slice(1).map(() => '0.45 0 0.55 1').join(';')} />
        </circle>
        {b && (
          <circle className="rf-ball" r="1.2" cx={X(b.from)} cy={Y(b.from)} opacity="0">
            <animate attributeName="cx" dur={`${DUR}s`} repeatCount="indefinite" keyTimes={kt([0, b.t0, b.t1, 1])} values={[X(b.from), X(b.from), X(b.to), X(b.to)].map((v) => v.toFixed(1)).join(';')} />
            <animate attributeName="cy" dur={`${DUR}s`} repeatCount="indefinite" keyTimes={kt([0, b.t0, b.t1, 1])} values={[Y(b.from), Y(b.from), Y(b.to), Y(b.to)].map((v) => v.toFixed(1)).join(';')} />
            <animate attributeName="opacity" dur={`${DUR}s`} repeatCount="indefinite" keyTimes={kt([0, b.t0 - 0.01, b.t0, b.t1, Math.min(0.99, b.t1 + 0.06), 1])} values="0;0;1;1;0;0" />
            {b.air && <animate attributeName="r" dur={`${DUR}s`} repeatCount="indefinite" keyTimes={kt([0, b.t0, (b.t0 + b.t1) / 2, b.t1, 1])} values="1.2;1.2;2.1;1.2;1.2" />}
          </circle>
        )}
      </svg>
      <ul className="rf-tags">{m.tags.map((t) => <li key={t}>{t}</li>)}</ul>
      <p className="muted small rf-note">Ilustração das tendências da função no motor (para onde ela leva o jogador e em que lances ele mais aparece), não um lance real.</p>
    </figure>
  );
}
