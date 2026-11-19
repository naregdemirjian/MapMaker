// Drawing a space map (Stage 11, D110, D111): far stars behind, rings on the galactic plane every 10
// light-years, each nearby star in its colour on a line down to the plane, the realms of countries
// and factions as glows around the stars they hold, lanes between stars, names. Canvas 2D: a thousand
// stars draw in a few milliseconds.
import type { SpaceView, Vec3 } from './space-view.ts';
import { starColour, starSize, type StarCatalogue, type Star } from './catalogue.ts';
import { seeded } from '../presentation/looks.ts';
import type { GalaxyDust } from './galaxy.ts';
import { DEFAULT_SKY, NAME_FONTS, hexRgb, mix, starColourIn, type SkyLook } from './sky-look.ts';
import { territoryField, paintTerritory, territoryBorders, realmLabels, type TerritorySite } from './territory.ts';

/**
 * Who holds a star at the moment shown (D111); `fresh` below 1 while it grows into the realm (shots), and
 * then `from`: who held it before, whose space round it shrinks meanwhile (D132). An empty `owner`: given
 * up to nobody a moment ago (only its former holder's shrinking space is drawn).
 */
export interface Holding { owner: string; name: string; color: string; fresh?: number; from?: { owner: string; name: string; color: string } | null }
/** A lane between two stars (D111), drawn `progress` of the way (1: whole). */
export interface Lane { a: number; b: number; color: string; progress: number }

export interface SpaceDrawOptions {
  transparent: boolean;
  /** Rings and spokes on the galactic plane, with their distances. */
  grid: boolean;
  /** Lines from each star down to the plane. */
  dropLines: boolean;
  /** Star names: 'auto' (named stars, more as the view closes in), 'all', or 'none'. */
  names: 'auto' | 'all' | 'none';
  holdings?: Map<number, Holding>;
  lanes?: Lane[];
  selected?: number | null;
  /** Realms' names over their stars. */
  realmNames?: boolean;
  background?: string;
  /** Only part of the picture (an export's separate pass): the sky and rings, the names, the realms or the lanes. */
  only?: 'background' | 'names' | 'realms' | 'lanes';
  /** The rings on the plane (drawn radius and label); absent: every 10 up to the map's radius, in light-years. */
  rings?: Array<{ r: number; label: string }>;
  /** Written beyond the rings toward +x (null: nothing); absent: the way to the galactic centre. */
  axisLabel?: string | null;
  /** Orbits to draw (the solar system, D113): closed rings of points as drawn (`small`: a moon's, left out until the view makes it large enough to see). */
  orbits?: Array<{ color: string; points: Vec3[]; small?: boolean }>;
  /** How far a held star's glow reaches (map units; absent: REALM_REACH_LY). */
  realmReach?: number;
  /** Stars with known planets (D118): a faint ring round each. */
  planets?: ReadonlySet<number>;
  /** A galaxy's glow, and its arms' names (D116). */
  dust?: GalaxyDust;
  armNames?: Array<{ name: string; at: Vec3 }>;
  /** How the map looks (D130, D131, D132); absent: the natural look. */
  look?: SkyLook;
  /** Screen seconds into a shot (stars twinkle with it); absent: still. */
  seconds?: number;
  /** Realms at war with each other (their borders drawn as fronts, D132). */
  wars?: Array<[string, string]>;
}

export interface DrawnStar { id: number; x: number; y: number; r: number }

export const SPACE_BACKGROUND = '#04070d';
/** A front between realms at war (D132). */
const FRONT_COLOUR = '#ff5c3a';
/** The size a star is drawn at when its brightness does not count (see SkyLook.sizeByBrightness). */
const MEAN_STAR = 3.2;
/** A number between 0 and 1 for a star (its twinkle's own pace and phase). */
const hashOf = (id: number) => (Math.imul(id + 0x9e3779b9, 2654435761) >>> 0) / 4294967296;
const rgba = (hex: string, a: number) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`; };
/** The holder of a star now (a star just given up to nobody has none: only its former holder's space shrinks). */
const heldBy = (holdings: Map<number, Holding> | undefined, id: number): Holding | null => { const h = holdings?.get(id); return h && h.owner ? h : null; };
/** A star's height above (+) or below (−) the plane, as written on a chart (light-years). */
const heightLabel = (z: number) => `${z > 0 ? '+' : '−'}${Math.abs(z) < 10 ? Math.abs(z).toFixed(1) : Math.round(Math.abs(z))}`;
/** How far a held star's glow reaches (light-years). */
export const REALM_REACH_LY = 3.2;

/** Soft clouds of colour (D130): smooth noise, wrapping east and west, in two colours; kept per pair of colours. */
const nebulae = new Map<string, OffscreenCanvas>();
function nebulaTexture(a: string, b: string): OffscreenCanvas {
  const key = `${a}|${b}`;
  let c = nebulae.get(key);
  if (c) return c;
  const W = 256, H = 128, rnd = seeded(77);
  // Value noise on lattices of several sizes (each wrapping in x), added up.
  const octave = (n: number) => { const g = Array.from({ length: (n + 1) * (Math.ceil(n / 2) + 1) }, () => rnd()); return (x: number, y: number) => {
    const fx = (x / W) * n, fy = (y / H) * (n / 2), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, w = n + 1;
    const v = (ii: number, jj: number) => g[(jj * w) + (((ii % n) + n) % n)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (v(i, j) * (1 - sx) + v(i + 1, j) * sx) * (1 - sy) + (v(i, j + 1) * (1 - sx) + v(i + 1, j + 1) * sx) * sy;
  }; };
  const shape = [octave(4), octave(8), octave(16), octave(32)], hue = [octave(3), octave(6)];
  c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D, img = g.createImageData(W, H);
  const ca = hexRgb(a), cb = hexRgb(b);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = shape[0](x, y) * 0.5 + shape[1](x, y) * 0.27 + shape[2](x, y) * 0.15 + shape[3](x, y) * 0.08;
    const k = Math.max(0, Math.min(1, (n - 0.45) * 2.6)), m = Math.max(0, Math.min(1, hue[0](x, y) * 0.7 + hue[1](x, y) * 0.3));
    const i = (y * W + x) * 4;
    img.data[i] = ca[0] + (cb[0] - ca[0]) * m; img.data[i + 1] = ca[1] + (cb[1] - ca[1]) * m; img.data[i + 2] = ca[2] + (cb[2] - ca[2]) * m;
    img.data[i + 3] = Math.round(k * k * 255);
  }
  g.putImageData(img, 0, 0);
  nebulae.set(key, c);
  return c;
}

const FAR_STARS = (() => {
  const rnd = seeded(2027), out: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 1400; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    // Denser toward the galactic plane, as the Milky Way is.
    if (Math.abs(z) > 0.35 && rnd() < 0.55) continue;
    out.push([r * Math.cos(a), r * Math.sin(a), z, 0.15 + rnd() * rnd() * 0.75]);
  }
  return out;
})();

export class SpaceRenderer {
  /** Where each star was drawn (for choosing one with the pointer). */
  lastStars: DrawnStar[] = [];
  /** Names drawn in the last frame (for tests). */
  lastNames: string[] = [];

  render(ctx: CanvasRenderingContext2D, view: SpaceView, cat: StarCatalogue | null, o: SpaceDrawOptions): void {
    const { width: W, height: H, unit: u } = view;
    this.lastStars = [];
    this.lastNames = [];
    const look = o.look ?? DEFAULT_SKY;
    this.look = look;
    ctx.save();
    if (o.transparent) ctx.clearRect(0, 0, W, H);
    else this.sky(ctx, view, look, o.background);
    // (An export's layer of realms or of lanes holds only them.)
    if (o.only === 'realms' || o.only === 'lanes') {
      if (cat && o.only === 'realms' && o.holdings?.size) this.realmsAs(ctx, view, cat, o, look);
      if (cat && o.only === 'lanes' && o.lanes?.length) this.lanes(ctx, view, cat, o.lanes);
      ctx.restore();
      return;
    }
    if (!o.transparent && !o.dust && look.farStars > 0) this.farStars(ctx, view, look.farStars);
    if (o.dust && o.only !== 'names') this.dust(ctx, view, o.dust);
    if (o.grid && o.only !== 'names') {
      if (view.chart && look.chartGrid !== 'rings') this.chartGrid(ctx, view, cat?.radiusLy ?? 50, look, o.rings);
      else this.grid(ctx, view, cat?.radiusLy ?? 50, o.rings, o.axisLabel);
    }
    if (o.armNames && o.names !== 'none' && (!o.only || o.only === 'names')) this.armNames(ctx, view, o.armNames);
    if (o.orbits && o.only !== 'names') this.orbits(ctx, view, o.orbits);
    if (!cat || o.only === 'background') { ctx.restore(); return; }
    const placed: Array<{ s: Star; x: number; y: number; k: number }> = [];
    for (const s of cat.stars) {
      const p = view.project([s.x, s.y, s.z]);
      if (p && p[0] > -60 && p[0] < W + 60 && p[1] > -60 && p[1] < H + 60) placed.push({ s, x: p[0], y: p[1], k: p[2] });
    }
    // Moons (D117) only where the view sets them apart from their planet.
    if (placed.some((p) => p.s.around !== undefined)) {
      const at = new Map(placed.map((p) => [p.s.id, p]));
      for (let i = placed.length - 1; i >= 0; i--) {
        const m = placed[i], body = m.s.around !== undefined ? at.get(m.s.around) : undefined;
        if (body && Math.hypot(m.x - body.x, m.y - body.y) < ((body.s.size ?? 4) + 9) * u * Math.sqrt(body.k)) placed.splice(i, 1);
      }
    }
    this.realmNames = [];
    if (o.holdings?.size && !o.only) this.realmsAs(ctx, view, cat, o, look, false);
    if (o.lanes?.length && !o.only) this.lanes(ctx, view, cat, o.lanes);
    // Far stars first, so that nearer ones are drawn over them.
    placed.sort((a, b) => a.k - b.k);
    const grow = 1 + 0.12 * Math.max(0, view.camera.zoom);
    if (o.dropLines && look.dropLines && !view.chart && !o.only) {
      ctx.lineWidth = Math.max(0.6, 0.9 * u);
      for (const { s, x, y } of placed) {
        if (!s.id || s.system) continue;
        const foot = view.project([s.x, s.y, 0]);
        if (!foot) continue;
        ctx.strokeStyle = rgba(look.grid, s.z >= 0 ? look.gridOpacity : look.gridOpacity * 0.56);
        ctx.setLineDash(s.z >= 0 ? [] : [3 * u, 3 * u]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(foot[0], foot[1]); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(look.grid, look.gridOpacity * 1.1);
        ctx.fillRect(foot[0] - 1.2 * u, foot[1] - 0.6 * u, 2.4 * u, 1.2 * u);
      }
    }
    for (const { s, x, y, k } of placed) {
      // (Planets and moons keep their sizes; a star's size follows its brightness as much as the look says.)
      const natural = s.size ?? starSize(s.absmag);
      const base = s.size ? s.size : MEAN_STAR + (natural - MEAN_STAR) * look.sizeByBrightness;
      const r = base * look.size * u * Math.sqrt(k) * grow * (s.id === 0 && !s.size ? 1.3 : 1);
      if (o.only === 'names') { this.lastStars.push({ id: s.id, x, y, r }); continue; }
      const held = heldBy(o.holdings, s.id);
      const nat = s.color ?? (s.id === 0 ? '#fff1c9' : starColour(s.spect));
      // (Planets and a galaxy's places keep their own colours by temperature: they have no spectrum.)
      const colour = s.color && look.colours === 'temperature' ? s.color : starColourIn(look, nat, s.spect, held?.color ?? null);
      // (How much a star shines out: bright stars fully, faint ones a little; planets in between.)
      const weight = s.color ? 0.55 : s.id === 0 ? 1 : Math.max(0.15, Math.min(1, (9 - s.absmag) / 6));
      const flicker = look.twinkle > 0 && o.seconds !== undefined ? 1 - look.twinkle * 0.55 * (0.5 + 0.5 * Math.sin(o.seconds * (2.2 + 2.6 * hashOf(s.id)) * Math.PI + hashOf(s.id + 7) * 40)) : 1;
      this.star(ctx, x, y, r, colour, look, weight, flicker, u);
      if (o.planets?.has(s.id)) { ctx.strokeStyle = 'rgba(120,220,200,0.7)'; ctx.lineWidth = Math.max(0.8, 1.1 * u); ctx.setLineDash([2 * u, 2 * u]); ctx.beginPath(); ctx.arc(x, y, r + 4.5 * u, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      if (held && look.colours !== 'owner') { ctx.strokeStyle = held.color; ctx.lineWidth = Math.max(1, 1.6 * u); ctx.beginPath(); ctx.arc(x, y, r + 3 * u, 0, Math.PI * 2); ctx.stroke(); }
      if (o.selected === s.id) { ctx.strokeStyle = '#ffe9a6'; ctx.lineWidth = Math.max(1, 2 * u); ctx.beginPath(); ctx.arc(x, y, r + 7 * u, 0, Math.PI * 2); ctx.stroke(); }
      this.lastStars.push({ id: s.id, x, y, r });
    }
    if (o.names !== 'none') this.names(ctx, view, placed, o);
    if (this.realmNames.length && (!o.only || o.only === 'names')) this.drawRealmNames(ctx, look);
    ctx.restore();
  }


  /** The look of the last frame drawn (for the grid and names). */
  private look: SkyLook = DEFAULT_SKY;

  /** The sky: its colour, a glow toward the middle, and soft clouds of colour that turn with the view. */
  private sky(ctx: CanvasRenderingContext2D, view: SpaceView, look: SkyLook, colour?: string): void {
    const W = view.width, H = view.height;
    ctx.fillStyle = colour ?? look.background;
    ctx.fillRect(0, 0, W, H);
    if (look.backgroundGlow) {
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, look.backgroundGlow);
      g.addColorStop(1, rgba(look.backgroundGlow, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (look.nebula > 0) {
      const tex = nebulaTexture(look.nebulaA, look.nebulaB);
      // (Wrapping east and west: the clouds move as the view turns round, a little as it tips.)
      const tw = W * 2, th = H * 1.3;
      const ox = -((((view.camera.lon / 360) % 1) + 1) % 1) * tw, oy = -(H * 0.15) - (view.camera.lat / 90) * H * 0.12;
      ctx.save();
      ctx.globalAlpha = look.nebula;
      ctx.globalCompositeOperation = 'screen';
      ctx.imageSmoothingEnabled = true;
      for (let x = ox; x < W; x += tw) ctx.drawImage(tex as unknown as CanvasImageSource, x, oy, tw, th);
      ctx.restore();
    }
  }

  /** One star as the look draws it: its glow, spikes, halo, its shape and outline. */
  private star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, look: SkyLook, weight: number, flicker: number, u: number): void {
    ctx.save();
    ctx.globalAlpha = flicker;
    if (look.glow > 0 && look.glowStrength > 0) {
      const R = r * (1 + 2.2 * look.glow), a = look.glowStrength * weight;
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, rgba(colour, a)); g.addColorStop(0.35, rgba(colour, a * 0.4)); g.addColorStop(1, rgba(colour, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    }
    if (look.spikes > 0 && weight > 0.3) {
      const L = r * 7 * look.spikeLength * weight, w = Math.max(0.45 * u, r * 0.2), lines = look.spikes / 2;
      for (let i = 0; i < lines; i++) {
        const a = ((look.spikeAngle + (i * 180) / lines) * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
        for (const side of [1, -1]) {
          const tx = x + dx * L * side, ty = y + dy * L * side;
          const g = ctx.createLinearGradient(x, y, tx, ty);
          g.addColorStop(0, rgba(colour, 0.9 * weight)); g.addColorStop(1, rgba(colour, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(x - dy * w, y + dx * w); ctx.lineTo(tx, ty); ctx.lineTo(x + dy * w, y - dx * w); ctx.closePath(); ctx.fill();
        }
      }
    }
    if (look.halo > 0 && weight > 0.4) {
      ctx.strokeStyle = rgba(colour, look.halo * 0.6 * weight);
      ctx.lineWidth = Math.max(0.6 * u, r * 0.16);
      ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.stroke();
    }
    const path = new Path2D();
    const poly = (n: number, outer: number, inner: number, turn: number) => {
      for (let i = 0; i < n * 2; i++) {
        const a = turn + (i * Math.PI) / n, q = i % 2 ? inner : outer;
        if (i) path.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); else path.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
      }
      path.closePath();
    };
    let stroke = false;
    switch (look.shape) {
      case 'soft': {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.7);
        g.addColorStop(0, colour); g.addColorStop(0.5, rgba(colour, 0.7)); g.addColorStop(1, rgba(colour, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return;
      }
      case 'diamond': path.moveTo(x, y - r * 1.35); path.lineTo(x + r, y); path.lineTo(x, y + r * 1.35); path.lineTo(x - r, y); path.closePath(); break;
      case 'sparkle4': poly(4, r * 1.9, r * 0.5, -Math.PI / 2); break;
      case 'sparkle6': poly(6, r * 1.8, r * 0.6, -Math.PI / 2); break;
      case 'square': path.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8); break;
      case 'dot': path.arc(x, y, Math.max(0.6 * u, r * 0.55), 0, Math.PI * 2); break;
      case 'ring': path.arc(x, y, r * 1.15, 0, Math.PI * 2); stroke = true; break;
      case 'cross': path.moveTo(x - r * 1.5, y); path.lineTo(x + r * 1.5, y); path.moveTo(x, y - r * 1.5); path.lineTo(x, y + r * 1.5); stroke = true; break;
      default: path.arc(x, y, r, 0, Math.PI * 2);
    }
    if (look.outline > 0) { ctx.strokeStyle = look.outlineColour; ctx.lineWidth = look.outline * u * 2 + (stroke ? Math.max(1, r * 0.4) : 0); ctx.lineJoin = 'round'; ctx.stroke(path); }
    if (stroke) {
      ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1 * u, r * 0.4); ctx.lineCap = 'round'; ctx.stroke(path);
      if (look.shape === 'ring') { ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x, y, Math.max(0.7 * u, r * 0.35), 0, Math.PI * 2); ctx.fill(); }
    } else { ctx.fillStyle = colour; ctx.fill(path); }
    ctx.restore();
  }

  /** On a chart (D131): how far above (+) or below the plane a star stands, as a number or as a symbol. */
  private height(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, z: number, look: SkyLook, u: number): void {
    ctx.save();
    const c = look.names;
    if (look.heights === 'numbers') {
      ctx.font = `500 ${(size * 0.78).toFixed(1)}px ${NAME_FONTS[look.nameFont]}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = rgba(look.background, 0.8); ctx.lineWidth = 2.4 * u; ctx.lineJoin = 'round';
      ctx.strokeText(heightLabel(z), x, y);
      ctx.fillStyle = rgba(c, 0.62);
      ctx.fillText(heightLabel(z), x, y);
    } else {
      // Above: a filled mark pointing up; below: an open one pointing down.
      const sz = size * 0.32, cx = x + sz, d = z > 0 ? -1 : 1;
      ctx.beginPath(); ctx.moveTo(cx, y + d * sz); ctx.lineTo(cx - sz * 0.9, y - d * sz * 0.6); ctx.lineTo(cx + sz * 0.9, y - d * sz * 0.6); ctx.closePath();
      if (z > 0) { ctx.fillStyle = rgba(c, 0.85); ctx.fill(); } else { ctx.strokeStyle = rgba(c, 0.85); ctx.lineWidth = Math.max(0.8, 1.1 * u); ctx.stroke(); }
    }
    ctx.restore();
  }
  /** How wide a star's height is written beside its name (numbers: in the smaller lettering). */
  private heightWidth(ctx: CanvasRenderingContext2D, z: number, size: number, look: SkyLook): number {
    if (look.heights === 'symbols') return size * 0.64;
    const font = ctx.font;
    ctx.font = `500 ${(size * 0.78).toFixed(1)}px ${NAME_FONTS[look.nameFont]}`;
    const w = ctx.measureText(heightLabel(z)).width;
    ctx.font = font;
    return w;
  }

  /** A chart's grid (D131): squares or hexes every so many light-years, numbered faintly, over what is in view. */
  private chartGrid(ctx: CanvasRenderingContext2D, view: SpaceView, radius: number, look: SkyLook, rings?: Array<{ r: number; label: string }>): void {
    if (look.chartGrid === 'none') return;
    const u = view.unit, W = view.width, H = view.height, sc = view.scale;
    const step = look.chartSpacing > 0 ? look.chartSpacing : rings?.length ? Math.min(...rings.map((x) => x.r)) : Math.max(1, radius / 5);
    if (step * sc < 6) return;
    // The map's extent on the chart: from the picture's corners (the chart may be turned).
    const rot = (view.camera.rotation * Math.PI) / 180, cr = Math.cos(rot), sr = Math.sin(rot);
    const back = (sx: number, sy: number) => { const dx = sx - W / 2, dy = sy - H / 2; const x = dx * cr + dy * sr, y = -dx * sr + dy * cr; return [view.target[0] + x / sc, view.target[1] - y / sc]; };
    const corners = [back(0, 0), back(W, 0), back(0, H), back(W, H)];
    const x0 = Math.min(...corners.map((c) => c[0])), x1 = Math.max(...corners.map((c) => c[0])), y0 = Math.min(...corners.map((c) => c[1])), y1 = Math.max(...corners.map((c) => c[1]));
    ctx.save();
    ctx.strokeStyle = rgba(look.grid, look.gridOpacity);
    ctx.lineWidth = Math.max(0.8, 1.1 * u);
    ctx.fillStyle = rgba(look.grid, Math.min(1, look.gridOpacity * 1.8));
    ctx.font = `500 ${Math.max(7, 9.5 * u).toFixed(1)}px ${NAME_FONTS[look.nameFont]}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const P = (x: number, y: number): [number, number, number] => view.project([x, y, 0]) ?? [NaN, NaN, 0];
    if (look.chartGrid === 'squares') {
      const i0 = Math.floor(x0 / step), i1 = Math.ceil(x1 / step), j0 = Math.floor(y0 / step), j1 = Math.ceil(y1 / step);
      if ((i1 - i0) + (j1 - j0) > 600) { ctx.restore(); return; }
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) { const a = P(i * step, y0), b = P(i * step, y1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      for (let j = j0; j <= j1; j++) { const a = P(x0, j * step), b = P(x1, j * step); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke();
      // (Each line's distance from the Sun, at the picture's bottom and left edges.)
      if (step * sc > 34 * u) {
        for (let i = i0; i <= i1; i++) { const p = P(i * step, y0 + (y1 - y0) * 0.02); if (p[0] > 12 && p[0] < W - 12) ctx.fillText(`${round(i * step)}`, p[0], Math.min(H - 8 * u, p[1])); }
        for (let j = j0; j <= j1; j++) { const p = P(x0 + (x1 - x0) * 0.02, j * step); if (p[1] > 12 && p[1] < H - 12) ctx.fillText(`${round(j * step)}`, Math.max(14 * u, p[0]), p[1]); }
      }
    } else {
      // Flat-topped hexes, `step` from side to side; numbered column and row (as sector maps are) when large enough.
      const s = step / Math.sqrt(3), wcol = 1.5 * s, hrow = step;
      const c0 = Math.floor(x0 / wcol) - 1, c1 = Math.ceil(x1 / wcol) + 1, r0 = Math.floor(y0 / hrow) - 1, r1 = Math.ceil(y1 / hrow) + 1;
      if ((c1 - c0) * (r1 - r0) > 6000) { ctx.restore(); return; }
      const label = s * sc > 30 * u;
      ctx.beginPath();
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const cx = c * wcol, cy = r * hrow + (c & 1 ? hrow / 2 : 0);
        for (let k = 0; k <= 6; k++) { const a = (k * Math.PI) / 3, q = P(cx + s * Math.cos(a), cy + s * Math.sin(a)); if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
      }
      ctx.stroke();
      if (label) for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const cy = r * hrow + (c & 1 ? hrow / 2 : 0), q = P(c * wcol, cy - hrow * 0.36);
        ctx.fillText(`${String(((c % 100) + 100) % 100).padStart(2, '0')}${String(((r % 100) + 100) % 100).padStart(2, '0')}`, q[0], q[1]);
      }
    }
    ctx.restore();
    function round(v: number) { return Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('en-GB')}k` : `${Math.round(v * 10) / 10}`; }
  }

  private realmCache: {
    key: string; canvas: OffscreenCanvas; labels: Array<{ name: string; colour: string; x: number; y: number; room: number; cells: number }>;
    lines: Array<{ colour: string; width: number; segs: number[]; front: boolean }>;
  } | null = null;

  /** Realms as the look draws them (D132): territories with borders (and fronts), soft glows, or not at all. */
  private realmsAs(ctx: CanvasRenderingContext2D, view: SpaceView, cat: StarCatalogue, o: SpaceDrawOptions, look: SkyLook, drawNow = true): void {
    const holdings = o.holdings!;
    this.realmNames = [];
    const reach = o.realmReach ?? REALM_REACH_LY, names = o.realmNames !== false;
    if (look.realms === 'none') return;
    if (look.realms === 'glow') {
      const live = new Map([...holdings].filter(([, h]) => h.owner));
      if (live.size) this.realms(ctx, view, cat, live, names, reach);
      return;
    }
    // (The fill in cells of two pixels at HD and below, of four at 4K: it is soft; the lines are drawn as lines, sharp at any size.)
    const W = view.width, H = view.height, u = view.unit, cell = Math.max(2, Math.round(W / 960));
    const owners: Array<{ id: string; name: string; colour: string }> = [], index = new Map<string, number>();
    const ownerOf = (id: string, name: string, colour: string) => { let i = index.get(id); if (i === undefined) { i = owners.length; index.set(id, i); owners.push({ id, name, colour }); } return i; };
    const sites: TerritorySite[] = [];
    let sig = '';
    for (const [id, h] of holdings) {
      const st = cat.byId.get(id);
      const p = st ? view.project([st.x, st.y, st.z]) : null;
      if (!p) continue;
      const f = Math.max(0, Math.min(1, h.fresh ?? 1)), grow = 1 - (1 - f) * (1 - f), R = reach * view.scale * p[2];
      // (Changing hands: the new holder's space grows out from the star over the one before; given up: it shrinks back to it.)
      const owner = h.owner ? ownerOf(h.owner, h.name, h.color) : -1, from = h.from ? ownerOf(h.from.owner, h.from.name, h.from.color) : -1;
      if (owner < 0 && (from < 0 || grow >= 1)) continue;
      sites.push({ x: p[0], y: p[1], r: R, owner, from, grow });
      sig += `${id}:${h.owner}:${h.from?.owner ?? ''}:${grow.toFixed(4)}:${p[0].toFixed(2)},${p[1].toFixed(2)};`;
    }
    const war = new Set<string>();
    for (const [a, b] of o.wars ?? []) { war.add(`${a}|${b}`); war.add(`${b}|${a}`); }
    const c = view.camera;
    const key = `${W}x${H}|${cell}|${c.lon}|${c.lat}|${c.zoom}|${c.rotation}|${c.target?.join(',') ?? ''}|${view.chart ? 1 : 0}|${view.scale}|${look.realmFill}|${look.realmBorder}|${look.realmGlow}|${[...war].join(',')}|${owners.map((x) => x.colour + x.name).join(',')}|${sig}`;
    let kept = this.realmCache;
    if (!kept || kept.key !== key) {
      const field = territoryField(W, H, cell, sites, owners.length);
      const img = paintTerritory(field, { colours: owners.map((x) => hexRgb(x.colour)), fill: look.realmFill, glow: look.realmGlow, unit: u });
      const canvas = new OffscreenCanvas(field.cols, field.rows);
      (canvas.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(img, 0, 0);
      const labels = realmLabels(field, owners.length).map((l, i) => (l ? { name: owners[i].name, colour: owners[i].colour, ...l } : null)).filter((l): l is NonNullable<typeof l> => !!l);
      // The border lines: a realm's edge in its own colour, lightened; between two realms, the two mixed; between two at war, a front.
      const w = look.realmBorder * u, light = (c: string) => mix(c, '#ffffff', 0.28);
      const lines = w <= 0 ? [] : territoryBorders(field).map(({ a, b, segs }) => {
        const front = b >= 0 && war.has(`${owners[a].id}|${owners[b].id}`);
        return { colour: front ? FRONT_COLOUR : b < 0 ? light(owners[a].colour) : mix(light(owners[a].colour), light(owners[b].colour), 0.5), width: front ? w * 1.8 + 0.8 * u : w, segs, front };
      }).sort((x, y) => Number(x.front) - Number(y.front));
      kept = this.realmCache = { key, canvas, labels, lines };
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(kept.canvas as unknown as CanvasImageSource, 0, 0, kept.canvas.width * cell, kept.canvas.height * cell);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const l of kept.lines) {
      // (One path a line, stroked once: its pieces join without overlaps showing.)
      const path = new Path2D();
      for (let i = 0; i < l.segs.length; i += 4) { path.moveTo(l.segs[i], l.segs[i + 1]); path.lineTo(l.segs[i + 2], l.segs[i + 3]); }
      // (A front glows: a wide faint line under it.)
      if (l.front) { ctx.strokeStyle = rgba(l.colour, 0.22); ctx.lineWidth = l.width * 3.5; ctx.stroke(path); }
      ctx.strokeStyle = rgba(l.colour, 0.92); ctx.lineWidth = l.width;
      ctx.stroke(path);
    }
    ctx.restore();
    this.realmNames = [];
    if (names) {
      ctx.save();
      for (const l of kept.labels) {
        // (Only realms with room for a name: as large as their room allows, spaced out, never wider than the realm.)
        if (l.room < 10 * u || l.cells * cell * cell < 900 * u * u) continue;
        let size = Math.max(10 * u, Math.min(30 * u, l.room * 0.55));
        const text = l.name.toUpperCase();
        ctx.font = `700 ${size.toFixed(1)}px ${NAME_FONTS[look.nameFont]}`;
        const room = Math.sqrt(l.cells) * cell * 1.1, w = ctx.measureText(text).width * 1.08;
        if (w > room) size = Math.max(9 * u, size * (room / w));
        ctx.font = `700 ${size.toFixed(1)}px ${NAME_FONTS[look.nameFont]}`;
        const tw = ctx.measureText(text).width * 1.08;
        this.realmNames.push({ text, x: l.x, y: l.y, size, colour: l.colour, box: [l.x - tw / 2, l.y - size * 0.6, l.x + tw / 2, l.y + size * 0.6] });
      }
      ctx.restore();
      if (drawNow) this.drawRealmNames(ctx, look);
    }
  }

  /** Realms' names (D132) worked out with their territories, drawn over the stars and their names. */
  private realmNames: Array<{ text: string; x: number; y: number; size: number; colour: string; box: [number, number, number, number] }> = [];
  private drawRealmNames(ctx: CanvasRenderingContext2D, look: SkyLook): void {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const n of this.realmNames) {
      ctx.font = `700 ${n.size.toFixed(1)}px ${NAME_FONTS[look.nameFont]}`;
      if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${(n.size * 0.08).toFixed(1)}px`;
      ctx.strokeStyle = rgba(look.background, 0.85); ctx.lineWidth = Math.max(2, n.size * 0.22);
      ctx.strokeText(n.text, n.x, n.y);
      ctx.fillStyle = n.colour;
      ctx.fillText(n.text, n.x, n.y);
    }
    ctx.restore();
  }

  private dustLayer: OffscreenCanvas | null = null;
  /**
   * A galaxy's glow (D116): its many faint points, each a little soft square as large as the part of
   * the galaxy it stands for, added up on a layer of their own (so that crowded parts glow), then laid
   * on the sky.
   */
  private dust(ctx: CanvasRenderingContext2D, view: SpaceView, d: GalaxyDust): void {
    const W = Math.max(1, Math.ceil(view.width)), H = Math.max(1, Math.ceil(view.height));
    if (!this.dustLayer || this.dustLayer.width !== W || this.dustLayer.height !== H) { this.dustLayer = new OffscreenCanvas(W, H); this.dustKey = ''; }
    // (The same view of the same galaxy: the glow drawn before, while the date or the realms change.)
    const c = view.camera, key = `${c.lon}|${c.lat}|${c.zoom}|${c.rotation}|${c.target?.join(',') ?? ''}|${view.scale}`;
    if (this.dustKey !== key || this.dustOf !== d) this.paintDust(view, d, W, H);
    this.dustKey = key; this.dustOf = d;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.dustLayer, 0, 0);
    ctx.restore();
  }
  private dustKey = '';
  private dustOf: GalaxyDust | null = null;
  private paintDust(view: SpaceView, d: GalaxyDust, W: number, H: number): void {
    const g = this.dustLayer!.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const base = d.size * view.scale, alpha = [0.07, 0.07, 0.045, 0.15];
    for (let c = 0; c < d.colors.length; c++) {
      g.fillStyle = d.colors[c];
      for (let i = 0; i < d.count; i++) {
        if (d.points[i * 4 + 3] !== c) continue;
        const p = view.project([d.points[i * 4], d.points[i * 4 + 1], d.points[i * 4 + 2]]);
        if (!p || p[0] < -20 || p[1] < -20 || p[0] > W + 20 || p[1] > H + 20) continue;
        const r = Math.max(0.7, base * p[2]);
        // (Smaller grains keep their brightness: what they stand for is as bright, only smaller.)
        g.globalAlpha = Math.min(0.6, alpha[c] * Math.max(1, 2.2 / r));
        g.fillRect(p[0] - r, p[1] - r, 2 * r, 2 * r);
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  /** The names of a galaxy's arms (D116), faint, along the arms. */
  private armNames(ctx: CanvasRenderingContext2D, view: SpaceView, names: Array<{ name: string; at: Vec3 }>): void {
    const u = view.unit, size = Math.max(9, 13 * u);
    ctx.save();
    ctx.font = `italic 500 ${size.toFixed(1)}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(190,210,255,0.62)';
    for (const a of names) {
      const p = view.project(a.at);
      if (p) ctx.fillText(a.name, p[0], p[1]);
    }
    ctx.restore();
  }

  /** The star drawn nearest to (x, y), within a few pixels of its disc, or null. */
  starAt(x: number, y: number, slack = 6): number | null {
    let best: number | null = null, bestD = Infinity;
    for (const s of this.lastStars) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= Math.max(s.r + slack, 9) && d < bestD) { best = s.id; bestD = d; }
    }
    return best;
  }

  private farStars(ctx: CanvasRenderingContext2D, view: SpaceView, amount = 1): void {
    const { right, up, forward } = view, W = view.width, H = view.height;
    // Infinitely far: only the camera's direction moves them. (The lens's zoom spreads them out.)
    const f = (Math.min(W, H) * 0.46) * Math.pow(2, view.camera.zoom) * 3;
    const rot = (view.camera.rotation * Math.PI) / 180, cr = Math.cos(rot), sr = Math.sin(rot);
    for (const [x, y, z, b] of FAR_STARS) {
      const d = x * forward[0] + y * forward[1] + z * forward[2];
      if (d <= 0.05) continue;
      const px = ((x * right[0] + y * right[1] + z * right[2]) / d) * f, py = -((x * up[0] + y * up[1] + z * up[2]) / d) * f;
      const sx = W / 2 + px * cr - py * sr, sy = H / 2 + px * sr + py * cr;
      if (sx < 0 || sy < 0 || sx > W || sy > H) continue;
      ctx.fillStyle = `rgba(210,220,255,${Math.min(1, b * 0.55 * Math.min(1, amount)).toFixed(3)})`;
      const s = Math.max(0.6, view.unit * (0.6 + b));
      ctx.fillRect(sx, sy, s, s);
      // (More than the usual: as many again, faint, between them.)
      if (amount > 1) { ctx.fillStyle = `rgba(200,212,255,${(b * 0.45 * (amount - 1)).toFixed(3)})`; ctx.fillRect(W - sx, (sy + H * 0.37) % H, s * 0.8, s * 0.8); }
    }
  }

  private orbits(ctx: CanvasRenderingContext2D, view: SpaceView, orbits: Array<{ color: string; points: Vec3[]; small?: boolean }>): void {
    ctx.save();
    ctx.lineWidth = Math.max(0.7, 1.1 * view.unit);
    for (const o of orbits) {
      const pts = o.points.map((p) => view.project(p));
      // (A moon's orbit only once it is wide enough to be seen round its planet.)
      if (o.small) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const q of pts) if (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
        if (!(Math.hypot(x1 - x0, y1 - y0) > 22 * view.unit)) continue;
      }
      ctx.strokeStyle = o.color;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      let on = false;
      for (const q of pts) {
        if (!q) { on = false; continue; }
        if (on) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); on = true; }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private grid(ctx: CanvasRenderingContext2D, view: SpaceView, radius: number, rings?: Array<{ r: number; label: string }>, axisLabel?: string | null): void {
    const u = view.unit;
    ctx.lineWidth = Math.max(0.6, 0.9 * u);
    const look = this.look;
    ctx.font = `500 ${Math.max(8, 11 * u).toFixed(1)}px ${NAME_FONTS[look.nameFont]}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const path = (pts: Vec3[]) => {
      ctx.beginPath();
      let on = false;
      for (const p of pts) {
        const q = view.project(p);
        if (!q) { on = false; continue; }
        if (on) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); on = true; }
      }
      ctx.stroke();
    };
    const list = rings ?? Array.from({ length: Math.floor(radius / 10 + 1e-9) }, (_, i) => ({ r: 10 * (i + 1), label: `${10 * (i + 1)} ly` }));
    const outer = Math.max(...list.map((x) => x.r));
    for (const { r, label } of list) {
      ctx.strokeStyle = rgba(look.grid, r === outer ? look.gridOpacity * 1.3 : look.gridOpacity * 0.7);
      path(Array.from({ length: 121 }, (_, i) => { const a = (i / 120) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a), 0] as Vec3; }));
      const lp = view.project([0, -r, 0]);
      if (lp) { ctx.fillStyle = rgba(mix(look.grid, '#ffffff', 0.12), look.gridOpacity * 2); ctx.fillText(label, lp[0], lp[1]); }
    }
    ctx.strokeStyle = rgba(look.grid, look.gridOpacity * 0.44);
    const inner = Math.min(...list.map((x) => x.r));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      path([[inner * Math.cos(a), inner * Math.sin(a), 0], [outer * Math.cos(a), outer * Math.sin(a), 0]]);
    }
    // Toward the galactic centre (galactic longitude 0), or what else the map's +x points to.
    const text = axisLabel === undefined ? '→ galactic centre' : axisLabel;
    const gc = text ? view.project([outer * 1.12, 0, 0]) : null;
    if (gc && text) { ctx.fillStyle = 'rgba(200,170,120,0.8)'; ctx.fillText(text, gc[0], gc[1]); }
  }

  /**
   * Realms: a glow around every star a country or faction holds, all of one owner's glows joined into
   * one region (drawn whole, then laid on lightly), with its edge, and the owner's name over its stars.
   */
  private realms(ctx: CanvasRenderingContext2D, view: SpaceView, cat: StarCatalogue, holdings: Map<number, Holding>, names: boolean, reach: number): void {
    const W = view.width, H = view.height, u = view.unit;
    const byOwner = new Map<string, { h: Holding; pts: Array<[number, number, number]> }>();
    for (const [id, h] of holdings) {
      const s = cat.byId.get(id);
      const p = s ? view.project([s.x, s.y, s.z]) : null;
      if (!p) continue;
      let g = byOwner.get(h.owner);
      if (!g) byOwner.set(h.owner, (g = { h, pts: [] }));
      // (A star newly held grows into the realm: its glow widens from nothing, easing out.)
      const f = Math.max(0, Math.min(1, h.fresh ?? 1)), grow = 1 - (1 - f) * (1 - f);
      if (grow > 0.01) g.pts.push([p[0], p[1], reach * view.scale * p[2] * grow]);
    }
    const layer = new OffscreenCanvas(Math.max(1, Math.ceil(W)), Math.max(1, Math.ceil(H)));
    const lc = layer.getContext('2d')!;
    for (const { h, pts } of byOwner.values()) {
      lc.clearRect(0, 0, layer.width, layer.height);
      lc.fillStyle = h.color;
      for (const [x, y, r] of pts) { lc.beginPath(); lc.arc(x, y, r, 0, Math.PI * 2); lc.fill(); }
      // The edge: the region grown a little, less the region.
      ctx.save();
      ctx.globalAlpha = 0.85;
      lc.globalCompositeOperation = 'source-over';
      const edge = new OffscreenCanvas(layer.width, layer.height), ec = edge.getContext('2d')!;
      ec.fillStyle = h.color;
      for (const [x, y, r] of pts) { ec.beginPath(); ec.arc(x, y, r + 1.6 * u, 0, Math.PI * 2); ec.fill(); }
      ec.globalCompositeOperation = 'destination-out';
      ec.drawImage(layer, 0, 0);
      ctx.drawImage(edge, 0, 0);
      ctx.globalAlpha = 0.22;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
      if (names && pts.length) {
        const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        const size = Math.max(10, 17 * u);
        ctx.save();
        ctx.font = `700 ${size.toFixed(1)}px ${NAME_FONTS[this.look.nameFont]}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = rgba(this.look.background, 0.85);
        ctx.lineWidth = 4 * u;
        const top = Math.min(...pts.map((p) => p[1] - p[2]));
        const ly = Math.max(size, top - size * 0.8);
        ctx.strokeText(h.name, x, ly);
        ctx.fillStyle = h.color;
        ctx.fillText(h.name, x, ly);
        ctx.restore();
      }
    }
  }

  private lanes(ctx: CanvasRenderingContext2D, view: SpaceView, cat: StarCatalogue, lanes: Lane[]): void {
    const u = view.unit;
    ctx.save();
    ctx.lineCap = 'round';
    for (const l of lanes) {
      const a = cat.byId.get(l.a), b = cat.byId.get(l.b);
      if (!a || !b || l.progress <= 0) continue;
      const f = Math.min(1, l.progress);
      const pa = view.project([a.x, a.y, a.z]), pb = view.project([a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f]);
      if (!pa || !pb) continue;
      ctx.strokeStyle = l.color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = Math.max(1, 2 * u);
      ctx.setLineDash([6 * u, 4 * u]);
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      ctx.setLineDash([]);
      // Still on its way (an expedition, a fleet): a pointed head at the front.
      if (f < 1) {
        const dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, size = 7 * u;
        ctx.globalAlpha = 1;
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.moveTo(pb[0] + ux * size, pb[1] + uy * size);
        ctx.lineTo(pb[0] - ux * size * 0.6 - uy * size * 0.6, pb[1] - uy * size * 0.6 + ux * size * 0.6);
        ctx.lineTo(pb[0] - ux * size * 0.6 + uy * size * 0.6, pb[1] - uy * size * 0.6 - ux * size * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(4,7,13,0.8)'; ctx.lineWidth = Math.max(1, 1.2 * u); ctx.stroke();
      }
    }
    ctx.restore();
  }

  private names(ctx: CanvasRenderingContext2D, view: SpaceView, placed: Array<{ s: Star; x: number; y: number; k: number }>, o: SpaceDrawOptions): void {
    const u = view.unit, zoom = view.camera.zoom;
    const size = Math.max(8, 11.5 * u * (1 + 0.08 * Math.max(0, zoom)));
    const look = this.look;
    ctx.font = `500 ${size.toFixed(1)}px ${NAME_FONTS[look.nameFont]}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    // Which are named: the Sun, the selected star, held stars and stars of their own names first, then the
    // brightest; companions only close in. Names that would overlap one already written are left out.
    const catalogueName = (n: string) => /^(Gl|GJ|HD|HIP|HYG|NN|Wo) /.test(n);
    // (A galaxy's many star systems, D116: named only close in.)
    const want = (s: Star) => o.names === 'all' || s.id === 0 || s.id === o.selected || !!heldBy(o.holdings, s.id) || (s.minor ? zoom > 1.6 : (!s.system && (!catalogueName(s.name) || zoom > 1.2 || s.absmag < 9)) || zoom > 2.2);
    const order = placed.filter((p) => want(p.s)).sort((a, b) => rank(a.s) - rank(b.s));
    function rank(s: Star): number { return s.id === o.selected ? -1e9 : s.id === 0 ? -1e8 : heldBy(o.holdings, s.id) ? -1e7 + s.absmag : s.size ? -s.size : catalogueName(s.name) ? s.absmag + 100 : s.absmag; }
    // (Realms' names are written over the stars: star names keep out of their way.)
    const boxes: Array<[number, number, number, number]> = this.realmNames.map((n) => n.box);
    // On a chart (D131), a star's height above or below the plane beside its name.
    const heights = view.chart && look.heights !== 'none';
    for (const { s, x, y } of order) {
      const z = heights && !s.minor && s.around === undefined && Math.abs(s.z) >= 0.05 ? s.z : null;
      const w0 = ctx.measureText(s.name).width, gap = 6 * u;
      const w = w0 + (z === null ? 0 : 3 * u + this.heightWidth(ctx, z, size, look));
      // Right of the star, else left, above or below: the first place no name has taken.
      const places: Array<[number, number]> = [[x + gap, y], [x - gap - w, y], [x - w / 2, y - size], [x - w / 2, y + size]];
      const free = places.map(([bx, by]) => [bx, by - size / 2, bx + w, by + size / 2] as [number, number, number, number])
        .find((box) => !boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])));
      if (!free) continue;
      boxes.push(free);
      const bx = free[0], by = (free[1] + free[3]) / 2;
      ctx.strokeStyle = rgba(look.background, 0.85);
      ctx.lineWidth = 3 * u;
      ctx.strokeText(s.name, bx, by);
      ctx.fillStyle = s.id === o.selected ? '#ffe9a6' : heldBy(o.holdings, s.id)?.color ?? rgba(look.names, 0.92);
      ctx.fillText(s.name, bx, by);
      if (z !== null) this.height(ctx, bx + w0 + 3 * u, by, size, z, look, u);
      this.lastNames.push(s.name);
    }
  }
}
