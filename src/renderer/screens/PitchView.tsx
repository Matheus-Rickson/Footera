export interface PitchSlot { key: string; pos: string; x: number; y: number; label: string; warn?: boolean }

/** Campo simplificado (SVG). x: 0 = esquerda; y: 0 = próprio gol, 100 = gol adversário. */
export function PitchView({ slots, ariaLabel }: { slots: PitchSlot[]; ariaLabel: string }) {
  return (
    <svg viewBox="0 0 100 130" className="pitch" role="img" aria-label={ariaLabel}>
      <rect x="1" y="1" width="98" height="128" rx="2" className="pitch-bg" />
      <line x1="1" y1="65" x2="99" y2="65" className="pitch-line" /><circle cx="50" cy="65" r="9" className="pitch-line" fill="none" />
      <rect x="25" y="1" width="50" height="16" className="pitch-line" fill="none" /><rect x="25" y="113" width="50" height="16" className="pitch-line" fill="none" />
      {slots.map((s) => {
        const cx = 6 + (s.x / 100) * 88, cy = 124 - (s.y / 100) * 116;
        return (
          <g key={s.key}>
            <circle cx={cx} cy={cy} r="4.2" className={s.warn ? 'dot-off' : 'dot-ok'} />
            <text x={cx} y={cy + 1.4} textAnchor="middle" className="pitch-pos">{s.pos}</text>
            <text x={cx} y={cy + 8.5} textAnchor="middle" className="pitch-name">{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
