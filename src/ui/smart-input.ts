// What a smart brush works with (Stage 12, D148), gathered from the map near a stroke, on screen: rivers, coasts
// and lakes and today's borders (the Earth's; a planet's rivers), the map's own borders and the lines on its
// layers as they are at the date viewed, the heights (ridges, valleys, rough ground, passes), and for the
// strategic brush the towns and the points placed on the map.
import { store } from './store.ts';
import { screenToLonLat, lonLatToScreen, radiansPerPixel, type View } from '../render-engine/camera.ts';
import { chooseScale } from '../render-engine/basemap.ts';
import { followTargets, followOffered, boxesMeet, type LonLatBox } from '../render-engine/follow-targets.ts';
import type { SmartFeature, SmartInput, SmartPoint } from '../render-engine/smart-brush.ts';
import type { Pt } from '../render-engine/stroke.ts';
import { basemapSourceOf, terrainSourceOf, planetOf, sculptOf, seaLevelPoints } from '../world-model/world-settings.ts';
import type { MapSpaceRow } from '../world-model/schema.ts';
import { stampsAt } from '../terrain/sculpt.ts';
import { sculpted } from '../terrain/sculpt-cache.ts';
import { riversSoon } from '../terrain/river-cache.ts';
import { heightAt } from '../terrain/grid.ts';
import { seaLevelAt } from '../terrain/sea-level.ts';
import { E7 } from '../geo-kernel/vec.ts';
import type { SmartSettings } from './smart-settings.ts';

/** What a map offers a smart brush (D148). */
export function smartOffered(space: MapSpaceRow | null | undefined) {
  const heights = terrainSourceOf(space);
  return followOffered(basemapSourceOf(space) === 'natural-earth' && heights !== 'paleo', heights);
}

/** The box (degrees) of points on screen, grown by `padPx` pixels. Null if none are on the map. */
export function boxOfScreen(view: View, pts: Pt[], padPx: number): LonLatBox | null {
  const box: LonLatBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const q of pts) {
    const ll = screenToLonLat(view, q[0], q[1]);
    if (!ll) continue;
    box[0] = Math.min(box[0], ll[0]); box[1] = Math.min(box[1], ll[1]); box[2] = Math.max(box[2], ll[0]); box[3] = Math.max(box[3], ll[1]);
  }
  if (!(box[2] >= box[0])) return null;
  const pad = (padPx * radiansPerPixel(view) * 180) / Math.PI;
  return [box[0] - pad, Math.max(-90, box[1] - pad), box[2] + pad, Math.min(90, box[3] + pad)];
}

/** The map's own borders (on the layer drawn on, at the date viewed) near a box, as lines on screen. */
function mapBorders(view: View, near: LonLatBox): SmartFeature[] {
  const w = store.world, engine = store.engine;
  const layer = w?.get('layer', store.layerId);
  if (!w || !engine || !layer || layer.kind !== 'partition') return [];
  const arr = w.arrangement(store.spaceId);
  const states = engine.partitionState(store.spaceId, layer.id, store.time);
  const owner = (f: number) => states.get(f)?.value ?? null;
  // The border segments near the box, then joined into lines through the points only two of them share.
  const segs: Array<[number, number]> = [];
  for (const sg of arr.segments.values()) {
    if (owner(sg.left_face) === owner(sg.right_face)) continue;
    const a = arr.vertices.get(sg.a), b = arr.vertices.get(sg.b);
    if (!a || !b) continue;
    const box: LonLatBox = [Math.min(a.lon, b.lon) / E7, Math.min(a.lat, b.lat) / E7, Math.max(a.lon, b.lon) / E7, Math.max(a.lat, b.lat) / E7];
    if (box[2] - box[0] > 180 || !boxesMeet(box, near)) continue;
    segs.push([sg.a, sg.b]);
  }
  const at = new Map<number, number[]>();
  segs.forEach(([a, b], i) => { for (const v of [a, b]) { const l = at.get(v); if (l) l.push(i); else at.set(v, [i]); } });
  const used = new Uint8Array(segs.length);
  const lines: number[][] = [];
  const walk = (start: number, from: number) => {
    const line = [from];
    let i = start, v = from;
    while (i >= 0 && !used[i]) {
      used[i] = 1;
      const [a, b] = segs[i];
      v = v === a ? b : a;
      line.push(v);
      const next = at.get(v)!;
      i = next.length === 2 ? (next[0] === i ? next[1] : next[0]) : -1;
    }
    lines.push(line);
  };
  // (Lines begin where three or more borders meet, or one ends; what is left are loops.)
  for (const [v, list] of at) if (list.length !== 2) for (const i of list) if (!used[i]) walk(i, v);
  for (let i = 0; i < segs.length; i++) if (!used[i]) walk(i, segs[i][0]);
  const out: SmartFeature[] = [];
  const jump = Math.max(view.width, view.height) / 2;
  for (const line of lines) {
    let piece: Pt[] = [];
    const flush = () => { if (piece.length >= 2) out.push({ kind: 'border', pts: piece }); piece = []; };
    for (const v of line) {
      const r = arr.vertices.get(v)!;
      const p = lonLatToScreen(view, r.lon / E7, r.lat / E7);
      const last = piece[piece.length - 1];
      if (!p || (last && Math.hypot(p[0] - last[0], p[1] - last[1]) > jump)) { flush(); if (p) piece.push(p); continue; }
      piece.push(p);
    }
    flush();
  }
  return out;
}

/** The lines drawn on the map's layers of lines (roads, railways, canals…) as they are at the date viewed, on screen. */
function layerLines(view: View, near: LonLatBox): SmartFeature[] {
  const w = store.world, engine = store.engine;
  if (!w || !engine) return [];
  const out: SmartFeature[] = [];
  for (const layer of w.all('layer')) {
    if (layer.space_id !== store.spaceId || layer.kind !== 'line' || !layer.visible) continue;
    for (const fa of engine.featuresAt(layer.id, store.time)) for (const part of fa.parts) {
      const pts: Pt[] = [];
      let box: LonLatBox = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i + 1 < part.length; i += 2) box = [Math.min(box[0], part[i]), Math.min(box[1], part[i + 1]), Math.max(box[2], part[i]), Math.max(box[3], part[i + 1])];
      if (!boxesMeet(box, near)) continue;
      for (let i = 0; i + 1 < part.length; i += 2) { const p = lonLatToScreen(view, part[i], part[i + 1]); if (p) pts.push(p); }
      if (pts.length >= 2) out.push({ kind: 'line', pts });
    }
  }
  return out;
}

/** Towns (cities on the map at the date viewed) and the points placed on the map's layers of points, on screen. */
function strategicPoints(view: View): SmartPoint[] {
  const w = store.world, engine = store.engine;
  if (!w || !engine) return [];
  const out: SmartPoint[] = [];
  for (const c of engine.charactersAt(store.spaceId, store.time)) {
    if (w.get('entity', c.entity)?.type_id !== 'settlement') continue;
    const p = lonLatToScreen(view, c.lon, c.lat);
    if (p) out.push({ kind: 'town', p });
  }
  for (const layer of w.all('layer')) {
    if (layer.space_id !== store.spaceId || layer.kind !== 'point' || !layer.visible) continue;
    for (const fa of engine.featuresAt(layer.id, store.time)) {
      const q = fa.parts[0];
      if (!q || q.length < 2) continue;
      const p = lonLatToScreen(view, q[0], q[1]);
      if (p) out.push({ kind: 'point', p });
    }
  }
  return out;
}

/**
 * What a smart brush works with for a stroke (screen pixels) on the map being viewed. `missing`: what could not be
 * had yet (heights still loading, a planet's rivers still being worked out).
 */
export function smartInputFor(view: View, stroke: Pt[], closed: boolean, side: 0 | 1 | -1, s: SmartSettings): { input: SmartInput; missing: string[] } {
  const space = store.world?.get('map_space', store.spaceId);
  const offered = smartOffered(space);
  const w = s.weights, strategic = side !== 0;
  const near = boxOfScreen(view, stroke, 2 * s.radius + 8) ?? [-180, -90, 180, 90];
  const missing: string[] = [];
  const planet = !!planetOf(space);
  const wantHeights = offered.heights && (w.ridges > 0 || (!strategic && w.valleys > 0) || (strategic && (w.rough > 0 || w.passes > 0)));
  const ground = wantHeights || (offered.rivers && planet && w.rivers > 0) ? store.terrainOf(space, store.time) : null;
  const carved = ground ? sculpted(ground.grid, ground.key, stampsAt(sculptOf(space), store.time), (space?.radius_m ?? 6371008.8) / 1000) : null;
  if ((wantHeights || (planet && w.rivers > 0)) && !carved) missing.push('heights');
  const planetRivers = offered.rivers && planet && w.rivers > 0 && carved ? riversSoon(carved.grid, carved.key, () => store.notify()) : null;
  if (offered.rivers && planet && w.rivers > 0 && carved && !planetRivers) missing.push("planet's rivers");
  const earth = (offered.coasts || offered.today) && store.basemap ? chooseScale(store.basemap, view) : null;
  const features: SmartFeature[] = [
    ...followTargets(view, near, { rivers: offered.rivers && w.rivers > 0, coasts: offered.coasts && w.coasts > 0, today: offered.today && w.today > 0 }, earth, planetRivers),
    ...(w.borders > 0 ? mapBorders(view, near) : []),
    ...(w.lines > 0 ? layerLines(view, near) : []),
  ];
  const sea = seaLevelAt(seaLevelPoints(space), store.time);
  const heights = wantHeights && carved ? (x: number, y: number) => { const q = screenToLonLat(view, x, y); return q ? Math.max(sea, heightAt(carved.grid, q[0], q[1])) : null; } : null;
  const points = strategic && (w.towns > 0 || w.points > 0) ? strategicPoints(view) : [];
  return { input: { stroke, closed, radius: s.radius, features, heightAt: heights, points, side }, missing };
}
