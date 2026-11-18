// Drawing a space map (Stage 11, D110, D111): far stars behind, rings on the galactic plane every 10
// light-years, each nearby star in its colour on a line down to the plane, the realms of countries
// and factions as glows around the stars they hold, lanes between stars, names. Canvas 2D: a thousand
// stars draw in a few milliseconds.
import type { SpaceView, Vec3 } from './space-view.ts';
import { starColour, starSize, type StarCatalogue, type Star } from './catalogue.ts';
import { seeded } from '../presentation/looks.ts';

/** Who holds a star at the moment shown (D111); `fresh` below 1 while it grows into the realm (shots). */
export interface Holding { owner: string; name: string; color: string; fresh?: number }
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
  /** Orbits to draw (the solar system, D113): closed rings of points as drawn. */
  orbits?: Array<{ color: string; points: Vec3[] }>;
  /** How far a held star's glow reaches (map units; absent: REALM_REACH_LY). */
  realmReach?: number;
}

export interface DrawnStar { id: number; x: number; y: number; r: number }

export const SPACE_BACKGROUND = '#04070d';
/** How far a held star's glow reaches (light-years). */
export const REALM_REACH_LY = 3.2;

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
    ctx.save();
    if (o.transparent) ctx.clearRect(0, 0, W, H);
    else { ctx.fillStyle = o.background ?? SPACE_BACKGROUND; ctx.fillRect(0, 0, W, H); }
    // (An export's layer of realms or of lanes holds only them.)
    if (o.only === 'realms' || o.only === 'lanes') {
      if (cat && o.only === 'realms' && o.holdings?.size) this.realms(ctx, view, cat, o.holdings, o.realmNames !== false, o.realmReach ?? REALM_REACH_LY);
      if (cat && o.only === 'lanes' && o.lanes?.length) this.lanes(ctx, view, cat, o.lanes);
      ctx.restore();
      return;
    }
    if (!o.transparent) this.farStars(ctx, view);
    if (o.grid && o.only !== 'names') this.grid(ctx, view, cat?.radiusLy ?? 50, o.rings, o.axisLabel);
    if (o.orbits && o.only !== 'names') this.orbits(ctx, view, o.orbits);
    if (!cat || o.only === 'background') { ctx.restore(); return; }
    const placed: Array<{ s: Star; x: number; y: number; k: number }> = [];
    for (const s of cat.stars) {
      const p = view.project([s.x, s.y, s.z]);
      if (p && p[0] > -60 && p[0] < W + 60 && p[1] > -60 && p[1] < H + 60) placed.push({ s, x: p[0], y: p[1], k: p[2] });
    }
    if (o.holdings?.size && !o.only) this.realms(ctx, view, cat, o.holdings, o.realmNames !== false, o.realmReach ?? REALM_REACH_LY);
    if (o.lanes?.length && !o.only) this.lanes(ctx, view, cat, o.lanes);
    // Far stars first, so that nearer ones are drawn over them.
    placed.sort((a, b) => a.k - b.k);
    const grow = 1 + 0.12 * Math.max(0, view.camera.zoom);
    if (o.dropLines && !o.only) {
      ctx.lineWidth = Math.max(0.6, 0.9 * u);
      for (const { s, x, y } of placed) {
        if (!s.id || s.system) continue;
        const foot = view.project([s.x, s.y, 0]);
        if (!foot) continue;
        ctx.strokeStyle = s.z >= 0 ? 'rgba(150,180,220,0.32)' : 'rgba(150,180,220,0.18)';
        ctx.setLineDash(s.z >= 0 ? [] : [3 * u, 3 * u]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(foot[0], foot[1]); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(150,180,220,0.35)';
        ctx.fillRect(foot[0] - 1.2 * u, foot[1] - 0.6 * u, 2.4 * u, 1.2 * u);
      }
    }
    for (const { s, x, y, k } of placed) {
      const r = (s.size ?? starSize(s.absmag)) * u * Math.sqrt(k) * grow * (s.id === 0 && !s.size ? 1.3 : 1);
      if (o.only === 'names') { this.lastStars.push({ id: s.id, x, y, r }); continue; }
      const colour = s.color ?? (s.id === 0 ? '#fff1c9' : starColour(s.spect));
      if ((s.absmag < 7 && !s.color) || s.id === 0) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
        g.addColorStop(0, colour);
        g.addColorStop(0.35, colour + '55');
        g.addColorStop(1, colour + '00');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      const held = o.holdings?.get(s.id);
      if (held) { ctx.strokeStyle = held.color; ctx.lineWidth = Math.max(1, 1.6 * u); ctx.beginPath(); ctx.arc(x, y, r + 3 * u, 0, Math.PI * 2); ctx.stroke(); }
      if (o.selected === s.id) { ctx.strokeStyle = '#ffe9a6'; ctx.lineWidth = Math.max(1, 2 * u); ctx.beginPath(); ctx.arc(x, y, r + 7 * u, 0, Math.PI * 2); ctx.stroke(); }
      this.lastStars.push({ id: s.id, x, y, r });
    }
    if (o.names !== 'none') this.names(ctx, view, placed, o);
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

  private farStars(ctx: CanvasRenderingContext2D, view: SpaceView): void {
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
      ctx.fillStyle = `rgba(210,220,255,${(b * 0.55).toFixed(3)})`;
      const s = Math.max(0.6, view.unit * (0.6 + b));
      ctx.fillRect(sx, sy, s, s);
    }
  }

  private orbits(ctx: CanvasRenderingContext2D, view: SpaceView, orbits: Array<{ color: string; points: Vec3[] }>): void {
    ctx.save();
    ctx.lineWidth = Math.max(0.7, 1.1 * view.unit);
    for (const o of orbits) {
      ctx.strokeStyle = o.color;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      let on = false;
      for (const p of o.points) {
        const q = view.project(p);
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
    ctx.font = `500 ${Math.max(8, 11 * u).toFixed(1)}px "Segoe UI", Arial, sans-serif`;
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
      ctx.strokeStyle = r === outer ? 'rgba(140,175,220,0.42)' : 'rgba(140,175,220,0.22)';
      path(Array.from({ length: 121 }, (_, i) => { const a = (i / 120) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a), 0] as Vec3; }));
      const lp = view.project([0, -r, 0]);
      if (lp) { ctx.fillStyle = 'rgba(160,190,230,0.65)'; ctx.fillText(label, lp[0], lp[1]); }
    }
    ctx.strokeStyle = 'rgba(140,175,220,0.14)';
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
        ctx.font = `700 ${size.toFixed(1)}px "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(4,7,13,0.85)';
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
    ctx.font = `500 ${size.toFixed(1)}px "Segoe UI", Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    // Which are named: the Sun, the selected star, held stars and stars of their own names first, then the
    // brightest; companions only close in. Names that would overlap one already written are left out.
    const catalogueName = (n: string) => /^(Gl|GJ|HD|HIP|HYG|NN|Wo) /.test(n);
    const want = (s: Star) => o.names === 'all' || s.id === 0 || s.id === o.selected || !!o.holdings?.has(s.id) || (!s.system && (!catalogueName(s.name) || zoom > 1.2 || s.absmag < 9)) || zoom > 2.2;
    const order = placed.filter((p) => want(p.s)).sort((a, b) => rank(a.s) - rank(b.s));
    function rank(s: Star): number { return s.id === o.selected ? -1e9 : s.id === 0 ? -1e8 : o.holdings?.has(s.id) ? -1e7 + s.absmag : s.size ? -s.size : catalogueName(s.name) ? s.absmag + 100 : s.absmag; }
    const boxes: Array<[number, number, number, number]> = [];
    for (const { s, x, y } of order) {
      const w = ctx.measureText(s.name).width, gap = 6 * u;
      // Right of the star, else left, above or below: the first place no name has taken.
      const places: Array<[number, number]> = [[x + gap, y], [x - gap - w, y], [x - w / 2, y - size], [x - w / 2, y + size]];
      const free = places.map(([bx, by]) => [bx, by - size / 2, bx + w, by + size / 2] as [number, number, number, number])
        .find((box) => !boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3])));
      if (!free) continue;
      boxes.push(free);
      const bx = free[0], by = (free[1] + free[3]) / 2;
      ctx.strokeStyle = 'rgba(4,7,13,0.85)';
      ctx.lineWidth = 3 * u;
      ctx.strokeText(s.name, bx, by);
      ctx.fillStyle = s.id === o.selected ? '#ffe9a6' : o.holdings?.get(s.id)?.color ?? 'rgba(225,232,245,0.92)';
      ctx.fillText(s.name, bx, by);
      this.lastNames.push(s.name);
    }
  }
}
