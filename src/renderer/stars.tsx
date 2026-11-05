import { Star, StarHalf } from 'lucide-react';
import { toStars } from '../shared/scale.ts';

/** Reputação em estrelas (0–5, de meia em meia). O motor usa 0–100; a tela nunca mostra esse número. */
export function Stars({ reputation, size = 14, label }: { reputation: number; size?: number; label?: string }) {
  const v = toStars(reputation);
  const text = `${String(v).replace('.', ',')} de 5 estrelas`;
  return (
    <span className="stars" role="img" aria-label={label ? `${label}: ${text}` : text} title={text}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = v >= i + 1 ? 'full' : v >= i + 0.5 ? 'half' : 'empty';
        return (
          <span key={i} className="star-cell" style={{ width: size, height: size }}>
            <Star size={size} className="star-empty" aria-hidden="true" />
            {fill === 'full' && <Star size={size} className="star-on" aria-hidden="true" />}
            {fill === 'half' && <StarHalf size={size} className="star-on" aria-hidden="true" />}
          </span>
        );
      })}
    </span>
  );
}
