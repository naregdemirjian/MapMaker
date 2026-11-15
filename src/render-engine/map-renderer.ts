// The map renderer: draws a map space at a moment in time from the world model and the temporal
// engine. Nothing here is stored history: every pixel is computed from parcels, effects and styles.
//
// This is the Canvas 2D backend. The approved architecture uses deck.gl (WebGL) for the final
// renderer; deck.gl could not be installed in the offline build environment, so this backend sits
// behind the same inputs (world, engine, view, time, options) and can be replaced without touching
// the world model, the engine, the interface or the export pipeline.
import { geoPath, geoGraticule10, geoCircle, geoCentroid, type GeoPermissibleObjects } from 'd3-geo';
import type { World } from '../world-model/world.ts';
import type { Engine, FaceState, Assignment } from '../temporal-engine/engine.ts';
import { parseJSON } from '../temporal-engine/engine.ts';
import type { Instant } from '../core-time/index.ts';
import type { View } from './camera.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';
import { E7 } from '../geo-kernel/vec.ts';

export type PassName = 'background' | 'graticule' | 'fills' | 'borders' | 'labels';
export const ALL_PASSES: PassName[] = ['background', 'graticule', 'fills', 'borders', 'labels'];

export interface MapStyle {
  ocean: string;
  graticule: string;
  border: string;
  borderWidth: number;
  frontGlow: string;
  labelColor: string;
  labelHalo: string;
  font: string;
}

export const DEFAULT_STYLE: MapStyle = {
  ocean: '#14324a', graticule: 'rgba(255,255,255,0.08)', border: '#101820', borderWidth: 1.3,
  frontGlow: '#ffe9a6', labelColor: '#f4efe6', labelHalo: 'rgba(10,16,24,0.85)',
  font: '"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif',
};

export interface RenderOptions {
  passes: Set<PassName>;
  transparent: boolean;
  layerIds: string[]; // partition layers to draw, bottom to top
  style?: MapStyle;
}

export interface LabelInfo { text: string; x: number; y: number; size: number }

interface FaceGeo { geo: GeoPermissibleObjects; area: number; centroid: [number, number] }

export class MapRenderer {
  private geoCache = new WeakMap<Arrangement, { rev: number; faces: Map<number, FaceGeo> }>();
  private pathCache = new Map<string, Path2D>();
  private pathCacheView = '';
  lastLabels: LabelInfo[] = [];

  /** Spherical geometry of a parcel (cached until the parcel map changes). */
  faceGeo(arr: Arrangement, face: number): FaceGeo {
    let c = this.geoCache.get(arr);
    if (!c || c.rev !== arr.revision) { c = { rev: arr.revision, faces: new Map() }; this.geoCache.set(arr, c); }
    let g = c.faces.get(face);
    if (!g) {
      const rings = arr.faceRingsLonLat(face);
      const geo: GeoPermissibleObjects = rings.length === 0
        ? { type: 'Sphere' }
        : { type: 'Polygon', coordinates: rings.map((r) => { const rr = [...r].reverse(); rr.push(rr[0]); return rr; }) };
      const area = arr.faceArea(face);
      const centroid = rings.length === 0 ? [0, 0] as [number, number] : geoCentroid(geo as GeoJSON.Polygon) as [number, number];
      g = { geo, area, centroid };
      c.faces.set(face, g);
    }
    return g;
  }

  facePath(view: View, arr: Arrangement, face: number): Path2D {
    const vk = `${view.key}|${arr.spaceId}|${arr.revision}`;
    if (vk !== this.pathCacheView) { this.pathCache.clear(); this.pathCacheView = vk; }
    let p = this.pathCache.get(String(face));
    if (!p) {
      const d = geoPath(view.projection)(this.faceGeo(arr, face).geo);
      p = new Path2D(d ?? '');
      this.pathCache.set(String(face), p);
    }
    return p;
  }

  render(ctx: CanvasRenderingContext2D, view: View, world: World, engine: Engine, spaceId: string, t: Instant, opts: RenderOptions): void {
    const style = opts.style ?? DEFAULT_STYLE;
    const arr = world.arrangement(spaceId);
    const u = view.unit;
    ctx.save();
    ctx.clearRect(0, 0, view.width, view.height);
    if (view.rotation) {
      ctx.translate(view.width / 2, view.height / 2);
      ctx.rotate((view.rotation * Math.PI) / 180);
      ctx.translate(-view.width / 2, -view.height / 2);
    }
    const sphere = new Path2D(geoPath(view.projection)({ type: 'Sphere' }) ?? '');
    if (opts.passes.has('background') && !opts.transparent) {
      ctx.fillStyle = style.ocean;
      ctx.fill(sphere);
    }
    if (opts.passes.has('graticule')) {
      ctx.strokeStyle = style.graticule;
      ctx.lineWidth = 0.8 * u;
      ctx.stroke(new Path2D(geoPath(view.projection)(geoGraticule10()) ?? ''));
    }

    const entities = new Map(world.all('entity').map((e) => [e.id, e]));
    const colorOf = (v: string | null) => (v ? entities.get(v)?.color ?? '#888888' : null);
    const labels: LabelInfo[] = [];

    for (const layerId of opts.layerIds) {
      const layer = world.get('layer', layerId);
      if (!layer || layer.space_id !== spaceId || layer.kind !== 'partition') continue;
      const ls = parseJSON<{ fillOpacity?: number; borderWidth?: number }>(layer.style, {});
      const states = engine.partitionState(spaceId, layerId, t);

      if (opts.passes.has('fills')) {
        ctx.globalAlpha = ls.fillOpacity ?? 0.78;
        const byColor = new Map<string, Path2D>();
        const transitions = new Map<string, { a: Assignment; faces: number[]; states: FaceState[] }>();
        for (const [face, st] of states) {
          if (st.transition) {
            const key = st.assignment!.effectId;
            let g = transitions.get(key);
            if (!g) transitions.set(key, (g = { a: st.assignment!, faces: [], states: [] }));
            g.faces.push(face);
            g.states.push(st);
            continue;
          }
          const c = colorOf(st.value);
          if (!c) continue;
          let p = byColor.get(c);
          if (!p) byColor.set(c, (p = new Path2D()));
          p.addPath(this.facePath(view, arr, face));
        }
        for (const [c, p] of byColor) { ctx.fillStyle = c; ctx.fill(p, 'evenodd'); }
        for (const g of transitions.values()) this.drawTransition(ctx, view, arr, engine, g, colorOf, style, t, ls.fillOpacity ?? 0.78);
        ctx.globalAlpha = 1;
      }

      if (opts.passes.has('borders')) {
        const lines: number[][][] = [];
        for (const s of arr.segments.values()) {
          const a = states.get(s.left_face), b = states.get(s.right_face);
          if (!a || !b) continue;
          if ((a.value ?? '') === (b.value ?? '') && !a.transition && !b.transition) continue;
          if (!a.value && !b.value) continue;
          const va = arr.vertices.get(s.a)!, vb = arr.vertices.get(s.b)!;
          lines.push([[va.lon / E7, va.lat / E7], [vb.lon / E7, vb.lat / E7]]);
        }
        if (lines.length) {
          ctx.strokeStyle = style.border;
          ctx.lineWidth = (ls.borderWidth ?? style.borderWidth) * u;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke(new Path2D(geoPath(view.projection)({ type: 'MultiLineString', coordinates: lines }) ?? ''));
        }
      }

      if (opts.passes.has('labels')) labels.push(...this.layerLabels(view, arr, states, entities));
    }

    if (opts.passes.has('labels')) this.drawLabels(ctx, labels, style, u);
    this.lastLabels = labels;
    ctx.restore();
  }

  private drawTransition(
    ctx: CanvasRenderingContext2D, view: View, arr: Arrangement, engine: Engine,
    g: { a: Assignment; faces: number[]; states: FaceState[] }, colorOf: (v: string | null) => string | null,
    style: MapStyle, t: Instant, opacity: number,
  ): void {
    const region = new Path2D();
    for (const f of g.faces) region.addPath(this.facePath(view, arr, f));
    const drawPrevious = () => g.faces.forEach((f, i) => {
      const c = colorOf(g.states[i].transition?.from ?? null);
      if (c) { ctx.fillStyle = c; ctx.fill(this.facePath(view, arr, f), 'evenodd'); }
    });
    const spec = g.a.transition!;
    const toColor = colorOf(g.a.value);
    const progress = g.states[0].transition?.progress ?? 0;
    if (spec.style === 'advance' && spec.origin) {
      const r = (engine.frontRadius(g.a, t) * 180) / Math.PI;
      if (r <= 0) { drawPrevious(); return; }
      const circle = geoCircle().center(toLonLat(spec.origin)).radius(Math.min(r, 179.9)).precision(0.5)();
      const disc = new Path2D(geoPath(view.projection)(circle) ?? '');
      ctx.save();
      ctx.clip(region, 'evenodd');
      // Not yet reached: the previous owners.
      ctx.save();
      const outside = new Path2D();
      outside.rect(-1e6, -1e6, 2e6, 2e6);
      outside.addPath(disc);
      ctx.clip(outside, 'evenodd');
      drawPrevious();
      ctx.restore();
      // Reached: the new owner, and the advancing frontier highlighted.
      if (toColor) { ctx.fillStyle = toColor; ctx.fill(disc, 'evenodd'); }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = style.frontGlow;
      ctx.lineWidth = 2.2 * view.unit;
      ctx.shadowColor = style.frontGlow;
      ctx.shadowBlur = 10 * view.unit;
      ctx.stroke(disc);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = opacity;
      ctx.restore();
    } else {
      ctx.globalAlpha = opacity * (1 - progress);
      drawPrevious();
      if (toColor) { ctx.globalAlpha = opacity * progress; ctx.fillStyle = toColor; ctx.fill(region, 'evenodd'); }
      ctx.globalAlpha = opacity;
    }
  }

  private layerLabels(view: View, arr: Arrangement, states: Map<number, FaceState>, entities: Map<string, { name: string }>): LabelInfo[] {
    const byOwner = new Map<string, { area: number; sx: number; sy: number; sz: number; best: FaceGeo | null }>();
    for (const [face, st] of states) {
      const v = st.transition ? st.transition.from : st.value;
      if (!v) continue;
      const g = this.faceGeo(arr, face);
      if (g.area <= 0 || g.area > 2 * Math.PI) continue;
      let o = byOwner.get(v);
      if (!o) byOwner.set(v, (o = { area: 0, sx: 0, sy: 0, sz: 0, best: null }));
      const [lon, lat] = g.centroid.map((d) => (d * Math.PI) / 180);
      o.sx += g.area * Math.cos(lat) * Math.cos(lon); o.sy += g.area * Math.cos(lat) * Math.sin(lon); o.sz += g.area * Math.sin(lat);
      o.area += g.area;
      if (!o.best || g.area > o.best.area) o.best = g;
    }
    const out: LabelInfo[] = [];
    const scale = view.projection.scale();
    for (const [id, o] of byOwner) {
      const name = entities.get(id)?.name;
      if (!name || !o.best) continue;
      const len = Math.hypot(o.sx, o.sy, o.sz);
      let pos: [number, number] = o.best.centroid;
      if (len > 1e-12) {
        const c: [number, number] = [Math.atan2(o.sy, o.sx) * 180 / Math.PI, Math.asin(o.sz / len) * 180 / Math.PI];
        // use the weighted centre only when it lies inside the owner's largest piece of territory
        if (insideGeo(o.best.geo, c)) pos = c;
      }
      const p = view.projection(pos);
      if (!p) continue;
      const size = Math.max(10 * view.unit, Math.min(44 * view.unit, Math.sqrt(o.area) * scale * 0.18));
      out.push({ text: name, x: p[0], y: p[1], size });
    }
    return out;
  }

  private drawLabels(ctx: CanvasRenderingContext2D, labels: LabelInfo[], style: MapStyle, u: number): void {
    const placed: Array<[number, number, number, number]> = [];
    const sorted = [...labels].sort((a, b) => b.size - a.size || a.text.localeCompare(b.text));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of sorted) {
      ctx.font = `600 ${l.size.toFixed(1)}px ${style.font}`;
      const w = ctx.measureText(l.text).width;
      const box: [number, number, number, number] = [l.x - w / 2, l.y - l.size / 2, l.x + w / 2, l.y + l.size / 2];
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box);
      ctx.lineWidth = Math.max(2, l.size * 0.16);
      ctx.strokeStyle = style.labelHalo;
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = style.labelColor;
      ctx.fillText(l.text, l.x, l.y);
    }
    void u;
  }
}

function toLonLat(v: [number, number, number]): [number, number] {
  return [Math.atan2(v[1], v[0]) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI];
}

function insideGeo(geo: GeoPermissibleObjects, p: [number, number]): boolean {
  if ((geo as { type: string }).type === 'Sphere') return true;
  // Signed spherical area of the polygon with p's antipode excluded: cheap test via d3's area of a tiny cap
  // is overkill; use winding of the projected ring around p instead (good enough for label placement).
  const poly = geo as GeoJSON.Polygon;
  let inside = false;
  for (const ring of poly.coordinates) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (Math.abs(xi - xj) > 180) continue;
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

