// Choosing several countries on the map (D189): those a box dragged on the map touches, and those the pointer passes
// over while Ctrl and Shift are held. A country counts when a point of it shows under the box (looked at on a grid of
// points a few pixels apart) or when all of a part of it lies inside the box (an island too small for the grid).
import type { Engine } from '../temporal-engine/engine.ts';
import type { World } from '../world-model/world.ts';
import type { Instant } from '../core-time/index.ts';
import { screenToLonLat, lonLatToScreen, type View } from '../render-engine/camera.ts';
import { parcelGeometry } from '../render-engine/parcel-geometry.ts';
import { lonLatToVec } from '../geo-kernel/vec.ts';

export interface MapAt { engine: Engine; world: World; spaceId: string; layerId: string; t: Instant; view: View }

/** The country (or faction) holding the place under a point of the view, if any. */
export function ownerAtScreen(m: MapAt, x: number, y: number): string | null {
  const ll = screenToLonLat(m.view, x, y);
  return ll ? m.engine.valueAtPoint(m.spaceId, m.layerId, lonLatToVec(ll[0], ll[1]), m.t) : null;
}

/** The countries a box on the view touches (x0, y0, x1, y1 in either order), in the order found. */
export function ownersInRect(m: MapAt, rect: readonly [number, number, number, number]): string[] {
  const x0 = Math.min(rect[0], rect[2]), x1 = Math.max(rect[0], rect[2]), y0 = Math.min(rect[1], rect[3]), y1 = Math.max(rect[1], rect[3]);
  const out = new Set<string>();
  // (At most about 8,000 points looked at, at least 3 pixels apart.)
  const step = Math.max(3, Math.sqrt(((x1 - x0) * (y1 - y0)) / 8000));
  for (let y = y0 + step / 2; y <= y1; y += step) for (let x = x0 + step / 2; x <= x1; x += step) {
    const v = ownerAtScreen(m, x, y);
    if (v) out.add(v);
  }
  // Parts too small for the grid: wholly inside the box.
  const arr = m.world.arrangement(m.spaceId), geom = parcelGeometry(arr), topo = arr.topology();
  const inside = (lon: number, lat: number) => { const p = lonLatToScreen(m.view, lon, lat); return !!p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1; };
  for (const [face, st] of m.engine.partitionState(m.spaceId, m.layerId, m.t)) {
    if (!st.value || out.has(st.value)) continue;
    for (const c of topo.facesCycles.get(face) ?? []) {
      const [w, s, e, n] = geom.cycle(c, topo).box;
      if (inside(w, s) && inside(e, s) && inside(w, n) && inside(e, n)) { out.add(st.value); break; }
    }
  }
  return [...out];
}

/** The countries under a stroke of the pointer from one point of the view to another (looked at every 3 pixels). */
export function ownersAlong(m: MapAt, from: readonly [number, number], to: readonly [number, number]): string[] {
  const out = new Set<string>();
  const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 3));
  for (let i = 0; i <= n; i++) {
    const v = ownerAtScreen(m, from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n);
    if (v) out.add(v);
  }
  return [...out];
}
