// How a shot's graphics look (D184): the events box, text boxes, the date and the title share one style of panel
// and text, as a video editor's titles have: the panel's shape (rounded, square, cut corners, a pill, a tab), a
// gradient, frosted glass blurring the map behind it, grain, a shadow, a glow, an accent bar; the text's shadow, its
// gradient, spacing, capitals and line height; how it comes in and goes (slid, scaled, blurred in, wiped, line after
// line). Templates set a whole look at once. Pure data and drawing helpers on a canvas.

export type PanelShape = 'rounded' | 'square' | 'cut' | 'pill' | 'tab';
export interface Shade { color: string; opacity: number; blur: number; x: number; y: number }
export interface PanelStyle {
  shape: PanelShape;
  /** A gradient instead of the plain background (at the background's strength). */
  gradient: { from: string; to: string; angle: number } | null;
  /** The map behind it blurred by so many pixels (0: none), as frosted glass. */
  glass: number;
  /** Grain over the panel (0 to 1). */
  grain: number;
  shadow: Shade | null;
  glow: { color: string; opacity: number; blur: number } | null;
  /** A bar of colour along one side. */
  accent: { side: 'none' | 'left' | 'top' | 'bottom'; color: string; width: number };
}
export interface TextStyle {
  shadow: Shade | null;
  /** Letters coloured from one colour to another, top to bottom (null: the text's colour). */
  gradient: { from: string; to: string } | null;
  /** Space between letters, in hundredths of the letters' size. */
  spacing: number;
  upper: boolean;
  /** Line height, as a share of the letters' size. */
  lineHeight: number;
}
export const ANIMS_IN = ['none', 'fade', 'rise', 'pop', 'type', 'slide-left', 'slide-right', 'slide-up', 'scale', 'blur', 'wipe'] as const;
export const ANIMS_OUT = ['none', 'fade', 'sink', 'slide-left', 'slide-right', 'blur', 'wipe'] as const;
export type AnimIn = (typeof ANIMS_IN)[number];
export type AnimOut = (typeof ANIMS_OUT)[number];
export const ANIM_NAMES: Record<AnimIn | AnimOut, string> = {
  none: 'At once', fade: 'Fade', rise: 'Rise', sink: 'Sink', pop: 'Pop', type: 'Type on', 'slide-left': 'Slide from the left', 'slide-right': 'Slide from the right',
  'slide-up': 'Slide up', scale: 'Grow', blur: 'Blur in', wipe: 'Wipe',
};

export interface GraphicStyle {
  panel: PanelStyle;
  text: TextStyle;
  /** Each line comes in this many seconds after the one before (0: all together). */
  stagger: number;
}

export const DEFAULT_GRAPHIC: GraphicStyle = {
  panel: { shape: 'rounded', gradient: null, glass: 0, grain: 0, shadow: null, glow: null, accent: { side: 'none', color: '#ffd166', width: 6 } },
  text: { shadow: null, gradient: null, spacing: 0, upper: false, lineHeight: 1.25 },
  stagger: 0,
};

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const colour = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
const shadeOf = (o: unknown): Shade | null => {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  return { color: colour(s.color, '#000000'), opacity: num(s.opacity, 0, 1, 0.5), blur: num(s.blur, 0, 200, 12), x: num(s.x, -200, 200, 0), y: num(s.y, -200, 200, 4) };
};

/** A graphic style as stored, checked and kept in range (missing parts from the defaults). */
export function graphicStyleOf(o: unknown): GraphicStyle {
  const g = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const p = (g.panel && typeof g.panel === 'object' ? g.panel : {}) as Record<string, unknown>;
  const t = (g.text && typeof g.text === 'object' ? g.text : {}) as Record<string, unknown>;
  const d = DEFAULT_GRAPHIC;
  const gr = p.gradient as Record<string, unknown> | null | undefined, gl = p.glow as Record<string, unknown> | null | undefined, ac = (p.accent ?? {}) as Record<string, unknown>;
  const tg = t.gradient as Record<string, unknown> | null | undefined;
  return {
    panel: {
      shape: (['rounded', 'square', 'cut', 'pill', 'tab'] as const).includes(p.shape as PanelShape) ? (p.shape as PanelShape) : d.panel.shape,
      gradient: gr && typeof gr === 'object' ? { from: colour(gr.from, '#1d2b3a'), to: colour(gr.to, '#0a1018'), angle: num(gr.angle, -360, 360, 90) } : null,
      glass: num(p.glass, 0, 60, 0), grain: num(p.grain, 0, 1, 0),
      shadow: shadeOf(p.shadow),
      glow: gl && typeof gl === 'object' ? { color: colour(gl.color, '#5ef2ff'), opacity: num(gl.opacity, 0, 1, 0.6), blur: num(gl.blur, 0, 200, 16) } : null,
      accent: { side: (['none', 'left', 'top', 'bottom'] as const).includes(ac.side as 'none') ? (ac.side as PanelStyle['accent']['side']) : 'none', color: colour(ac.color, d.panel.accent.color), width: num(ac.width, 0, 60, d.panel.accent.width) },
    },
    text: {
      shadow: shadeOf(t.shadow),
      gradient: tg && typeof tg === 'object' ? { from: colour(tg.from, '#ffffff'), to: colour(tg.to, '#ffd166') } : null,
      spacing: num(t.spacing, -10, 60, 0), upper: t.upper === true, lineHeight: num(t.lineHeight, 0.8, 3, d.text.lineHeight),
    },
    stagger: num(g.stagger, 0, 5, 0),
  };
}

/** The outline of a panel of a shape (a path begun anew). */
export function panelPath(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, shape: PanelShape): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  if (shape === 'square') ctx.rect(x, y, w, h);
  else if (shape === 'pill') ctx.roundRect(x, y, w, h, h / 2);
  else if (shape === 'tab') ctx.roundRect(x, y, w, h, [r, r, 0, 0]);
  else if (shape === 'cut') {
    const c = Math.max(4, r);
    ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + c); ctx.closePath();
  } else ctx.roundRect(x, y, w, h, r);
}

/** A grain tile (made once): greys about the middle. */
let grainTile: OffscreenCanvas | null = null;
function grain(): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (grainTile) return grainTile;
  const n = 128, c = new OffscreenCanvas(n, n), g = c.getContext('2d')!, img = g.createImageData(n, n);
  let x = 2463534242;
  for (let i = 0; i < n * n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; const v = 96 + (x % 64); img.data.set([v, v, v, 255], i * 4); }
  g.putImageData(img, 0, 0);
  return (grainTile = c);
}

/**
 * A panel (D184): its shadow and glow, frosted glass over the map behind it, its fill (a colour, or a gradient), grain,
 * an accent bar, and its border line. `fill`: the background colour with its strength (null: no fill).
 */
export function drawPanel(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string | null, ps: PanelStyle, u: number, border?: { color: string; width: number }): void {
  const path = () => panelPath(ctx, x, y, w, h, radius, ps.shape);
  // Shadow and glow: cast by the panel's shape (a shape filled with the fill, or faintly, so the shadow shows).
  for (const s of [ps.shadow ? { color: ps.shadow.color, opacity: ps.shadow.opacity, blur: ps.shadow.blur, x: ps.shadow.x, y: ps.shadow.y } : null, ps.glow ? { ...ps.glow, x: 0, y: 0 } : null]) {
    if (!s || s.opacity <= 0) continue;
    ctx.save();
    ctx.shadowColor = withAlpha(s.color, s.opacity);
    ctx.shadowBlur = s.blur * u;
    ctx.shadowOffsetX = s.x * u;
    ctx.shadowOffsetY = s.y * u;
    // (Only the shadow: the shape is drawn far away and its shadow brought back.)
    const far = 100000;
    ctx.translate(-far, 0);
    ctx.shadowOffsetX += far * ctx.getTransform().a;
    path();
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }
  if (ps.glass > 0 && 'canvas' in ctx) {
    ctx.save();
    path();
    ctx.clip();
    const m = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${(ps.glass * u).toFixed(1)}px)`;
    ctx.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
    ctx.setTransform(m);
    ctx.restore();
  }
  if (fill) {
    path();
    if (ps.gradient) {
      const a = (ps.gradient.angle * Math.PI) / 180, cx = x + w / 2, cy = y + h / 2, ux = Math.cos(a), uy = -Math.sin(a), half = Math.abs((w / 2) * ux) + Math.abs((h / 2) * uy);
      const g = ctx.createLinearGradient(cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half);
      const alpha = alphaOf(fill);
      g.addColorStop(0, withAlpha(ps.gradient.from, alpha));
      g.addColorStop(1, withAlpha(ps.gradient.to, alpha));
      ctx.fillStyle = g;
    } else ctx.fillStyle = fill;
    ctx.fill();
  }
  if (ps.grain > 0) {
    const tile = grain();
    const pattern = tile ? ctx.createPattern(tile as unknown as CanvasImageSource, 'repeat') : null;
    if (pattern) { ctx.save(); path(); ctx.clip(); ctx.globalAlpha *= ps.grain; ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = pattern; ctx.fillRect(x, y, w, h); ctx.restore(); }
  }
  if (ps.accent.side !== 'none' && ps.accent.width > 0) {
    const aw = ps.accent.width * u;
    ctx.save();
    path();
    ctx.clip();
    ctx.fillStyle = ps.accent.color;
    if (ps.accent.side === 'left') ctx.fillRect(x, y, aw, h);
    else if (ps.accent.side === 'top') ctx.fillRect(x, y, w, aw);
    else ctx.fillRect(x, y + h - aw, w, aw);
    ctx.restore();
  }
  if (border && border.width > 0) { path(); ctx.lineWidth = border.width; ctx.strokeStyle = border.color; ctx.stroke(); }
}

/** Space a panel's accent bar takes on the left (for the text). */
export const accentInset = (ps: PanelStyle, u: number) => (ps.accent.side === 'left' ? ps.accent.width * u : 0);

/** Text written in a style (D184): its shadow, gradient and spacing; `fill` the colour without a gradient. */
export function writeText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, ts: TextStyle, u: number, outline?: { color: string; width: number }): void {
  const t = ts.upper ? text.toLocaleUpperCase() : text;
  ctx.save();
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${((ts.spacing / 100) * size).toFixed(1)}px`;
  if (outline && outline.width > 0) { ctx.strokeStyle = outline.color; ctx.lineWidth = outline.width; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); }
  if (ts.shadow && ts.shadow.opacity > 0) {
    ctx.shadowColor = withAlpha(ts.shadow.color, ts.shadow.opacity);
    ctx.shadowBlur = ts.shadow.blur * u; ctx.shadowOffsetX = ts.shadow.x * u; ctx.shadowOffsetY = ts.shadow.y * u;
  }
  if (ts.gradient) {
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, ts.gradient.from); g.addColorStop(1, ts.gradient.to);
    ctx.fillStyle = g;
  } else ctx.fillStyle = fill;
  ctx.fillText(t, x, y);
  ctx.restore();
}

/** How far line `i` of `n` has come in when the whole has come in `enter` (0 to 1), each line `stagger` seconds after the last over `seconds`. */
export function lineProgress(enter: number, i: number, n: number, stagger: number, seconds: number): number {
  if (stagger <= 0 || n <= 1 || seconds <= 0) return enter;
  const total = seconds + stagger * (n - 1), at = enter * total - stagger * i;
  return Math.max(0, Math.min(1, at / seconds));
}

/** How a graphic is placed while it comes in (`p` 0 to 1) or goes (`q` 1 to 0): its move, scale, blur, strength and the share shown by a wipe. */
export function animState(kind: AnimIn | AnimOut, p: number, size: number): { dx: number; dy: number; scale: number; blur: number; alpha: number; wipe: number } {
  const e = 1 - (1 - p) * (1 - p) * (1 - p); // (easing out)
  const s = { dx: 0, dy: 0, scale: 1, blur: 0, alpha: 1, wipe: 1 };
  if (kind === 'fade') s.alpha = p;
  else if (kind === 'rise') { s.alpha = p; s.dy = (1 - e) * size * 0.9; }
  else if (kind === 'sink') { s.alpha = p; s.dy = (1 - e) * size * 0.9; }
  else if (kind === 'slide-left') { s.alpha = Math.min(1, p * 2); s.dx = (e - 1) * size * 6; }
  else if (kind === 'slide-right') { s.alpha = Math.min(1, p * 2); s.dx = (1 - e) * size * 6; }
  else if (kind === 'slide-up') { s.alpha = Math.min(1, p * 2); s.dy = (1 - e) * size * 3; }
  else if (kind === 'scale') { s.alpha = Math.min(1, p * 2); s.scale = 0.3 + 0.7 * e; }
  else if (kind === 'blur') { s.alpha = p; s.blur = (1 - p) * size * 0.4; }
  else if (kind === 'wipe') s.wipe = e;
  return s;
}

/** A colour (#rrggbb, or rgba()) at a strength. */
export function withAlpha(c: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  return c;
}
const alphaOf = (c: string) => { const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(c); return m ? Number(m[1]) : 1; };

/** Whole looks for a shot's graphics: the panel, the text, the colours. */
export interface GraphicTemplate { id: string; name: string; style: GraphicStyle; colors: { text: string; accent: string; title: string; background: string; backgroundOpacity: number; font: string } }
export const GRAPHIC_TEMPLATES: GraphicTemplate[] = [
  {
    id: 'news', name: 'News lower third',
    style: { ...DEFAULT_GRAPHIC, panel: { ...DEFAULT_GRAPHIC.panel, shape: 'square', shadow: { color: '#000000', opacity: 0.45, blur: 14, x: 0, y: 6 }, accent: { side: 'left', color: '#d62828', width: 10 } }, text: { ...DEFAULT_GRAPHIC.text, upper: false }, stagger: 0.12 },
    colors: { text: '#111827', accent: '#d62828', title: '#d62828', background: '#ffffff', backgroundOpacity: 0.95, font: 'Segoe UI' },
  },
  {
    id: 'documentary', name: 'Documentary',
    style: { ...DEFAULT_GRAPHIC, panel: { ...DEFAULT_GRAPHIC.panel, shape: 'rounded', glass: 12, gradient: { from: '#1b2533', to: '#06090d', angle: 90 }, accent: { side: 'top', color: '#d8b46a', width: 3 } }, text: { ...DEFAULT_GRAPHIC.text, shadow: { color: '#000000', opacity: 0.6, blur: 6, x: 0, y: 2 }, spacing: 2 }, stagger: 0.2 },
    colors: { text: '#efe6d2', accent: '#d8b46a', title: '#d8b46a', background: '#0a1018', backgroundOpacity: 0.62, font: 'Georgia' },
  },
  {
    id: 'hud', name: 'Game display',
    style: { ...DEFAULT_GRAPHIC, panel: { ...DEFAULT_GRAPHIC.panel, shape: 'cut', glow: { color: '#36e1ff', opacity: 0.7, blur: 18 }, grain: 0.15, accent: { side: 'left', color: '#36e1ff', width: 4 } }, text: { ...DEFAULT_GRAPHIC.text, upper: true, spacing: 8, shadow: { color: '#36e1ff', opacity: 0.6, blur: 10, x: 0, y: 0 } }, stagger: 0.08 },
    colors: { text: '#bff6ff', accent: '#36e1ff', title: '#36e1ff', background: '#02121a', backgroundOpacity: 0.78, font: 'Consolas' },
  },
  {
    id: 'parchment', name: 'Parchment',
    style: { ...DEFAULT_GRAPHIC, panel: { ...DEFAULT_GRAPHIC.panel, shape: 'rounded', grain: 0.55, gradient: { from: '#f3e3bf', to: '#d9bf8c', angle: 90 }, shadow: { color: '#2a1a08', opacity: 0.5, blur: 18, x: 0, y: 6 } }, text: { ...DEFAULT_GRAPHIC.text, spacing: 1 }, stagger: 0 },
    colors: { text: '#3b2a14', accent: '#8b1e1e', title: '#8b1e1e', background: '#ead7ae', backgroundOpacity: 1, font: 'Georgia' },
  },
  {
    id: 'minimal', name: 'Minimal',
    style: { ...DEFAULT_GRAPHIC, panel: { ...DEFAULT_GRAPHIC.panel }, text: { ...DEFAULT_GRAPHIC.text, shadow: { color: '#000000', opacity: 0.8, blur: 8, x: 0, y: 2 } }, stagger: 0 },
    colors: { text: '#ffffff', accent: '#ffffff', title: '#ffffff', background: '#000000', backgroundOpacity: 0, font: 'Segoe UI' },
  },
];
