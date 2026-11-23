/**
 * Cores de destaque de um clube tiradas do escudo (interface "Estádio noturno", docs/INTERFACE.md). Puro e determinístico:
 * recebe os pixels já reduzidos (o processo principal encolhe a imagem para ~32 px) e devolve a cor primária, a secundária,
 * a versão para texto e a cor de texto sobre a primária, com contraste garantido contra o fundo noturno.
 */

/** Fundo da interface (escolha do usuário): o contraste das cores do clube é medido contra ele. */
export const NIGHT_BG = '#03050a';
/** Contraste mínimo de um elemento gráfico (aba, faixa, borda) e de texto na cor do clube (WCAG 2.x). */
export const MIN_GRAPHIC = 3;
export const MIN_TEXT = 4.5;

export interface ClubPalette {
  /** cor de preenchimento (aba ativa, botão Continuar, faixas) — contraste ≥ 3:1 contra o fundo */
  primary: string;
  /** cor de apoio (degradês, segunda faixa) — contraste ≥ 3:1 contra o fundo */
  secondary: string;
  /** a primária clareada para texto sobre o fundo — contraste ≥ 4,5:1 */
  text: string;
  /** texto sobre a primária: quase preto ou branco, o de maior contraste */
  ink: string;
  /** tema claro ("dia de jogo"): primária escurecida até 3:1 contra o branco, texto até 4,5:1 e a tinta sobre ela */
  light: { primary: string; text: string; ink: string };
  /** escudo sem cor (preto, branco, cinza): paleta prateada neutra do jogo */
  neutral: boolean;
}

type RGB = [number, number, number];

const hex = (c: RGB) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** Razão de contraste WCAG entre duas cores (1–21). */
export function contrast(a: string, b: string): number {
  const la = luminance(fromHex(a)), lb = luminance(fromHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function fromHsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Clareia (mantendo matiz e saturação) até atingir o contraste pedido contra o fundo noturno. */
export function liftToContrast(color: string, min: number, bg = NIGHT_BG): string {
  const [h, s] = toHsl(fromHex(color));
  let l = toHsl(fromHex(color))[2];
  let out = color;
  while (contrast(out, bg) < min && l < 0.97) { l = Math.min(0.97, l + 0.02); out = hex(fromHsl(h, s, l)); }
  return out;
}

/** Escurece (mantendo matiz e saturação) até atingir o contraste pedido contra um fundo claro. */
export function dropToContrast(color: string, min: number, bg = '#ffffff'): string {
  const [h, s] = toHsl(fromHex(color));
  let l = toHsl(fromHex(color))[2];
  let out = color;
  while (contrast(out, bg) < min && l > 0.03) { l = Math.max(0.03, l - 0.02); out = hex(fromHsl(h, s, l)); }
  return out;
}

const inkFor = (fill: string) => (contrast(fill, NIGHT_BG) >= contrast(fill, '#ffffff') ? NIGHT_BG : '#ffffff');

function finish(primaryRaw: string, secondaryRaw: string, neutral: boolean): ClubPalette {
  const primary = liftToContrast(primaryRaw, MIN_GRAPHIC);
  const secondary = liftToContrast(secondaryRaw, MIN_GRAPHIC);
  const text = liftToContrast(primary, MIN_TEXT);
  const lp = dropToContrast(primaryRaw, MIN_GRAPHIC);
  return { primary, secondary, text, ink: inkFor(primary), light: { primary: lp, text: dropToContrast(lp, MIN_TEXT), ink: inkFor(lp) }, neutral };
}

/** Paleta prateada para escudos sem cor (preto e branco) e quando a imagem não tem pixels opacos. */
export const NEUTRAL_PALETTE: ClubPalette = finish('#c3ccd9', '#7d8899', true);

/** Limiares do agrupamento: pixel opaco, colorido (saturação e brilho mínimos) e fatia mínima de pixels coloridos no escudo. */
export const CREST = { alpha: 128, minSat: 0.28, minValue: 0.18, maxLightness: 0.92, coloredShare: 0.06, secondShare: 0.12, hueGap: 40, bins: 24 } as const;

/**
 * Cores do escudo. `order` é a ordem dos canais na memória: o `toBitmap` do Electron no Windows entrega BGRA.
 * Ignora transparente, quase preto, quase branco e cinza; a primária é a faixa de matiz com mais pixels (média dos pixels dela),
 * a secundária é a próxima faixa a ≥ 40° de distância com pelo menos 12% dos pixels coloridos (senão, a primária mais escura).
 */
export function crestColors(px: Uint8Array, width: number, height: number, order: 'rgba' | 'bgra' = 'rgba'): ClubPalette {
  const n = Math.min(width * height, Math.floor(px.length / 4));
  const bins = Array.from({ length: CREST.bins }, () => ({ count: 0, r: 0, g: 0, b: 0 }));
  let opaque = 0, colored = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = px[o + 3]!;
    if (a < CREST.alpha) continue;
    opaque++;
    const r = order === 'rgba' ? px[o]! : px[o + 2]!, g = px[o + 1]!, b = order === 'rgba' ? px[o + 2]! : px[o]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const value = max / 255, sat = max === 0 ? 0 : (max - min) / max;
    if (value < CREST.minValue || sat < CREST.minSat || (max + min) / 510 > CREST.maxLightness) continue;
    colored++;
    const [h] = toHsl([r, g, b]);
    const bin = bins[Math.floor(h / (360 / CREST.bins)) % CREST.bins]!;
    bin.count++; bin.r += r; bin.g += g; bin.b += b;
  }
  if (opaque === 0 || colored / opaque < CREST.coloredShare) return NEUTRAL_PALETTE;
  // faixas vizinhas somadas (um vermelho entre 345° e 15° não se divide em duas): escolhe o centro com mais pixels na janela de 3
  const win = (k: number) => [-1, 0, 1].reduce((s, d) => s + bins[(k + d + CREST.bins) % CREST.bins]!.count, 0);
  const avg = (k: number): RGB => {
    const ks = [-1, 0, 1].map((d) => bins[(k + d + CREST.bins) % CREST.bins]!);
    const c = ks.reduce((s, x) => s + x.count, 0);
    return [ks.reduce((s, x) => s + x.r, 0) / c, ks.reduce((s, x) => s + x.g, 0) / c, ks.reduce((s, x) => s + x.b, 0) / c];
  };
  const order1 = bins.map((_, k) => k).sort((x, y) => win(y) - win(x) || x - y);
  const k1 = order1[0]!;
  const primary = avg(k1);
  const gapBins = Math.ceil(CREST.hueGap / (360 / CREST.bins));
  const dist = (x: number, y: number) => { const d = Math.abs(x - y) % CREST.bins; return Math.min(d, CREST.bins - d); };
  const k2 = order1.find((k) => dist(k, k1) >= gapBins && win(k) / colored >= CREST.secondShare);
  let secondary: RGB;
  if (k2 !== undefined) secondary = avg(k2);
  else { const [h, s, l] = toHsl(primary); secondary = fromHsl(h, s, Math.max(0.12, l * 0.6)); }
  return finish(hex(primary), hex(secondary), false);
}

/** Paleta a partir das matizes do escudo gerado (`clubHues`), para clubes sem imagem de escudo: as mesmas cores do escudo gerado. */
export function paletteFromHues(hue: number, hue2: number): ClubPalette {
  return finish(hex(fromHsl(hue, 0.55, 0.38)), hex(fromHsl(hue2, 0.6, 0.45)), false);
}

/** Limiares de "cores que se confundem" numa partida: matizes a menos de 45°; cinzas (croma < 0,12) só pelo brilho (< 0,22). */
export const SIDE_GAP = { hue: 45, chroma: 0.12, light: 0.22 } as const;
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
/** Duas cores se confundem na tela? Um cinza e uma cor nunca se confundem; dois cinzas, só se o brilho for parecido. */
export function colorsClash(a: string, b: string): boolean {
  const ra = fromHex(a), rb = fromHex(b);
  const chroma = (c: RGB) => (Math.max(...c) - Math.min(...c)) / 255;
  const [ha, , la] = toHsl(ra), [hb, , lb] = toHsl(rb);
  const ga = chroma(ra) < SIDE_GAP.chroma, gb = chroma(rb) < SIDE_GAP.chroma;
  if (ga || gb) return ga === gb && Math.abs(la - lb) < SIDE_GAP.light;
  return hueDist(ha, hb) < SIDE_GAP.hue;
}
export interface SideColor { color: string; ink: string }
/** Cores reservas do visitante quando as dele se confundem com as do mandante: âmbar e azul ficam a 160° um do outro. */
export const AWAY_FALLBACK = ['#f5b301', '#1aa6ff'] as const;
/**
 * Cores dos dois times numa partida (centro de jogo): o mandante joga com a primária; o visitante, com a primeira de
 * [primária, secundária, prata, âmbar, azul] que não se confunde com a do mandante — como o uniforme reserva.
 * `ink` = texto sobre a cor (quase preto ou branco, o de maior contraste).
 */
export function matchSides(home: ClubPalette, away: ClubPalette): [SideColor, SideColor] {
  const h = home.primary;
  const pick = [away.primary, away.secondary, NEUTRAL_PALETTE.primary, ...AWAY_FALLBACK].find((c) => !colorsClash(h, c)) ?? AWAY_FALLBACK[1];
  return [{ color: h, ink: inkFor(h) }, { color: pick, ink: inkFor(pick) }];
}
