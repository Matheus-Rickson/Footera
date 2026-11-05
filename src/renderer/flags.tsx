/**
 * Bandeiras dos países da base (SVG simplificado, sem arquivos externos). Código de país de 3 letras → desenho em 30×20.
 * País sem desenho: retângulo neutro com o código.
 */
import type { ReactNode } from 'react';

const H = (colors: string[]) => colors.map((c, i) => <rect key={i} x={0} y={(20 / colors.length) * i} width={30} height={20 / colors.length} fill={c} />);
const V = (colors: string[]) => colors.map((c, i) => <rect key={i} x={(30 / colors.length) * i} y={0} width={30 / colors.length} height={20} fill={c} />);

const FLAGS: Record<string, () => ReactNode> = {
  BRA: () => <><rect width={30} height={20} fill="#009c3b" /><polygon points="15,2.5 27.5,10 15,17.5 2.5,10" fill="#ffdf00" /><circle cx={15} cy={10} r={4.2} fill="#002776" /><path d="M10.9 9.2 Q15 8 19.1 10.4" stroke="#fff" strokeWidth={0.7} fill="none" /></>,
  ENG: () => <><rect width={30} height={20} fill="#fff" /><rect x={12.5} width={5} height={20} fill="#ce1124" /><rect y={7.5} width={30} height={5} fill="#ce1124" /></>,
  ESP: () => <>{H(['#aa151b', '#f1bf00', '#f1bf00', '#aa151b'])}<rect x={7} y={7} width={3.5} height={6} rx={0.8} fill="#aa151b" opacity={0.85} /></>,
  GER: () => <>{H(['#000', '#dd0000', '#ffce00'])}</>,
  ITA: () => <>{V(['#009246', '#fff', '#ce2b37'])}</>,
  FRA: () => <>{V(['#0055a4', '#fff', '#ef4135'])}</>,
  POR: () => <><rect width={12} height={20} fill="#006600" /><rect x={12} width={18} height={20} fill="#ff0000" /><circle cx={12} cy={10} r={3.6} fill="#ffcc00" /><circle cx={12} cy={10} r={2.2} fill="#fff" stroke="#ff0000" strokeWidth={0.6} /></>,
  NED: () => <>{H(['#ae1c28', '#fff', '#21468b'])}</>,
  ARG: () => <>{H(['#74acdf', '#fff', '#74acdf'])}<circle cx={15} cy={10} r={2} fill="#f6b40e" /></>,
  BEL: () => <>{V(['#000', '#fdda24', '#ef3340'])}</>,
  JPN: () => <><rect width={30} height={20} fill="#fff" /><circle cx={15} cy={10} r={6} fill="#bc002d" /></>,
  AUT: () => <>{H(['#ed2939', '#fff', '#ed2939'])}</>,
  MEX: () => <>{V(['#006847', '#fff', '#ce1126'])}<circle cx={15} cy={10} r={2.2} fill="#8c6a3f" /></>,
  IRL: () => <>{V(['#169b62', '#fff', '#ff883e'])}</>,
  CRO: () => <>{H(['#ff0000', '#fff', '#171796'])}<g transform="translate(12.3 5.2)">{[0, 1, 2, 3].flatMap((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={c * 1.8} y={r * 1.8} width={1.8} height={1.8} fill={(r + c) % 2 ? '#fff' : '#ff0000'} />))}<rect width={5.4} height={7.2} fill="none" stroke="#171796" strokeWidth={0.4} /></g></>,
  RUS: () => <>{H(['#fff', '#0039a6', '#d52b1e'])}</>,
};

export function Flag({ code, size = 28, title }: { code: string; size?: number; title?: string }) {
  const draw = FLAGS[code];
  return (
    <svg className="nc-flag" width={size * 1.5} height={size} viewBox="0 0 30 20" role="img" aria-label={title ?? code}>
      {draw ? draw() : <><rect width={30} height={20} fill="#555" /><text x={15} y={13} fontSize={7} textAnchor="middle" fill="#fff">{code}</text></>}
      <rect width={30} height={20} fill="none" stroke="rgba(0,0,0,.25)" strokeWidth={0.6} />
    </svg>
  );
}

/** Escudo gerado do clube (até a etapa de fotos/escudos): cores fixas pelo id e as iniciais. Não é o escudo "oficial" de nada. */
/** Cores do clube (matizes 0–360) enquanto a base não tem cores cadastradas: fixas pelo id, as mesmas do escudo gerado. */
export function clubHues(id: string): { hue: number; hue2: number } {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return { hue, hue2: (hue + 40 + (Math.abs(h >> 8) % 140)) % 360 };
}

export function ClubCrest({ id, name, size = 64 }: { id: string; name: string; size?: number }) {
  const { hue, hue2 } = clubHues(id);
  const words = name.split(/\s+/).filter((w) => w.length > 2 && !/^(fc|cf|sc|sv|ac|us|as|cd|fk|nk|kv)$/i.test(w));
  const ini = (words.length ? words : name.split(/\s+/)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return (
    <svg className="nc-crest" width={size} height={size * 1.15} viewBox="0 0 40 46" role="img" aria-label={`Escudo (gerado) de ${name}`}>
      <path d="M20 1 L38 6 V22 C38 34 30 41 20 45 C10 41 2 34 2 22 V6 Z" fill={`hsl(${hue} 55% 38%)`} stroke="rgba(255,255,255,.75)" strokeWidth={1.4} />
      <path d="M20 1 L38 6 V22 C38 34 30 41 20 45 Z" fill={`hsl(${hue2} 60% 45%)`} opacity={0.55} />
      <text x={20} y={27} fontSize={14} fontWeight={800} textAnchor="middle" fill="#fff">{ini}</text>
    </svg>
  );
}

/**
 * Imagem ILUSTRATIVA de estádio (vista aérea em SVG, fictícia), nas cores do clube e com variações fixas pelo id
 * (oval ou retangular, pista de atletismo, cobertura, entorno). Provisória até a etapa de fotos da base de dados.
 */
export function StadiumArt({ id, title }: { id: string; title: string }) {
  const { hue, hue2 } = clubHues(id);
  let h = 7; for (let i = 0; i < id.length; i++) h = (h * 131 + id.charCodeAt(i)) >>> 0;
  const bit = (n: number) => ((h >>> n) & 1) === 1;
  const oval = bit(1), track = bit(2), fullRoof = bit(3), trees = bit(4);
  const rnd = (i: number) => (((h >>> (i % 24)) ^ (i * 2654435761)) >>> 0) % 1000 / 1000;
  const W = 800, H = 320, cx = 400, cy = 170;
  const blocks = Array.from({ length: 34 }, (_, i) => ({ x: (i % 17) * 48 + rnd(i) * 10, y: i < 17 ? 4 + rnd(i + 3) * 20 : 262 + rnd(i + 5) * 20, w: 30 + rnd(i + 7) * 14, h: 26 + rnd(i + 9) * 20 }));
  const treeDots = Array.from({ length: 40 }, (_, i) => ({ x: rnd(i * 3) < .5 ? 20 + rnd(i * 5) * 150 : 630 + rnd(i * 7) * 150, y: 60 + rnd(i * 11) * 200, r: 6 + rnd(i * 13) * 7 }));
  const outer = oval ? <ellipse cx={cx} cy={cy} rx={235} ry={128} /> : <rect x={cx - 240} y={cy - 125} width={480} height={250} rx={46} />;
  return (
    <svg className="nc-stadium-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Imagem ilustrativa do ${title}`}>
      <defs>
        <pattern id={`mow-${id}`} width={36} height={190} patternUnits="userSpaceOnUse"><rect width={18} height={190} fill="#3f8f3a" /><rect x={18} width={18} height={190} fill="#4a9c43" /></pattern>
        <radialGradient id={`sky-${id}`} cx="50%" cy="45%" r="70%"><stop offset="0%" stopColor="#5d6b5a" /><stop offset="100%" stopColor="#2c3530" /></radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#sky-${id})`} />
      {blocks.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={`hsl(${30 + rnd(i) * 30} 12% ${46 + rnd(i + 1) * 22}%)`} opacity={0.85} />)}
      {trees && treeDots.map((t, i) => <circle key={i} cx={t.x} cy={t.y} r={t.r} fill={`hsl(${105 + rnd(i) * 30} 35% ${24 + rnd(i + 2) * 12}%)`} />)}
      <rect x={0} y={232} width={W} height={10} fill="#3a3f45" /><rect x={0} y={236} width={W} height={2} fill="#c9c9c9" opacity={0.5} />
      <g fill={`hsl(${hue} 12% 78%)`} stroke="rgba(0,0,0,.35)" strokeWidth={2}>{outer}</g>
      <g fill={`hsl(${hue} 55% 42%)`}>{oval ? <ellipse cx={cx} cy={cy} rx={212} ry={108} /> : <rect x={cx - 218} y={cy - 104} width={436} height={208} rx={34} />}</g>
      {/* fileiras da arquibancada: anéis na segunda cor */}
      {[0, 1, 2].map((k) => oval
        ? <ellipse key={k} cx={cx} cy={cy} rx={200 - k * 14} ry={100 - k * 8} fill="none" stroke={`hsl(${hue2} 55% ${46 + k * 6}%)`} strokeWidth={3} opacity={0.7} />
        : <rect key={k} x={cx - 206 + k * 14} y={cy - 96 + k * 8} width={412 - k * 28} height={192 - k * 16} rx={28} fill="none" stroke={`hsl(${hue2} 55% ${46 + k * 6}%)`} strokeWidth={3} opacity={0.7} />)}
      {track && <rect x={cx - 175} y={cy - 80} width={350} height={160} rx={78} fill="#b5523b" />}
      <rect x={cx - 150} y={cy - 70} width={300} height={140} fill={`url(#mow-${id})`} />
      <g fill="none" stroke="#f2f2f2" strokeWidth={2} opacity={0.9}>
        <rect x={cx - 140} y={cy - 62} width={280} height={124} /><line x1={cx} y1={cy - 62} x2={cx} y2={cy + 62} /><circle cx={cx} cy={cy} r={18} />
        <rect x={cx - 140} y={cy - 30} width={38} height={60} /><rect x={cx + 102} y={cy - 30} width={38} height={60} />
      </g>
      {/* cobertura: total ou só nas laterais */}
      <g fill="#e9eef2" opacity={0.9}>
        {fullRoof
          ? (oval ? <ellipse cx={cx} cy={cy} rx={235} ry={128} fill="none" stroke="#e9eef2" strokeWidth={22} /> : <rect x={cx - 240} y={cy - 125} width={480} height={250} rx={46} fill="none" stroke="#e9eef2" strokeWidth={22} />)
          : <><rect x={cx - 170} y={cy - 125} width={340} height={20} rx={6} /><rect x={cx - 170} y={cy + 105} width={340} height={20} rx={6} opacity={0.75} /></>}
      </g>
    </svg>
  );
}
