// Where a change's front starts (D136), worked out from the parcels around it, so that it never gets in the way:
//  - an advancing front ("from the border"): from the border the change shares with its new owner's land as it
//    was before; failing that (the owner's land is across the sea or beyond another country), as a straight front
//    from the side facing the owner's nearest land; a country that held no land before grows from the middle;
//    land given up to nobody is let go from its outer edges inward, toward what its old owner keeps;
//  - an expansion: from the points the change was drawn from (several at once: pincers, encirclement), or the middle;
//  - a dissolve: no front, the land changing hands in patches.
// The change's outline and the source are in longitude and latitude, for the front field (front-field.ts).
import type { Arrangement } from '../geo-kernel/arrangement.ts';
import type { FaceState, CompiledTransition } from '../temporal-engine/engine.ts';
import { E7, type Vec3 } from '../geo-kernel/vec.ts';
import type { FrontSource, Rings } from './front-field.ts';

/** How a change's front starts: the style asked for (from the border, from points, in patches). */
export type FrontKind = 'border' | 'advance' | 'scatter';

export function frontSourceOf(arr: Arrangement, changing: number[], owner: string | null, spec: Pick<CompiledTransition, 'origin' | 'origins'>, kind: FrontKind, states: ReadonlyMap<number, FaceState>): { rings: Rings; source: FrontSource } | null {
  if (!changing.length) return null;
  const rings: Rings = [];
  for (const f of changing) for (const r of arr.faceRingsLonLat(f)) if (r.length >= 3) rings.push(r);
  if (!rings.length) return null;
  if (kind === 'scatter') return { rings, source: { kind: 'scatter' } };
  if (kind === 'advance') {
    const pts = (spec.origins && spec.origins.length > 1 ? spec.origins : spec.origin ? [spec.origin] : []).map(lonLatOf);
    return { rings, source: pts.length ? { kind: 'points', points: pts } : { kind: 'heart' } };
  }
  const inChange = new Set(changing);
  // Who held each parcel before the change (a parcel changing in another change counts as its owner before it).
  const before = (f: number) => { const st = states.get(f); return st ? (st.transition ? st.transition.from : st.value) : null; };
  // The change's own edges (round each of its parcels: only those are looked at, not the whole map's), with
  // what lies across each.
  const topo = arr.topology();
  const lines = (side: (other: number) => boolean): number[] => {
    const out: number[] = [];
    for (const f of changing) for (const c of topo.facesCycles.get(f) ?? []) for (const h of topo.cycles.get(c) ?? []) {
      const sg = arr.segments.get(h >> 1);
      if (!sg) continue;
      const other = sg.left_face === f ? sg.right_face : sg.left_face;
      if (inChange.has(other) || !side(other)) continue;
      const a = arr.vertices.get(sg.a)!, b = arr.vertices.get(sg.b)!;
      out.push(a.lon / E7, a.lat / E7, b.lon / E7, b.lat / E7);
    }
    return out;
  };
  if (owner) {
    // From the border with the owner's land.
    const shared = lines((o) => before(o) === owner);
    if (shared.length) return { rings, source: { kind: 'lines', lonlat: shared } };
    // The owner's land elsewhere: a straight front from the side facing its nearest part.
    const held: number[] = [];
    for (const [f, st] of states) if (!inChange.has(f) && (st.transition ? st.transition.from : st.value) === owner) held.push(f);
    if (held.length) {
      const toward = nearestOf(arr, changing, held);
      if (toward) return { rings, source: { kind: 'toward', point: toward } };
    }
    // A country that held no land before: from the middle.
    return { rings, source: { kind: 'heart' } };
  }
  // Given up to nobody: let go from the outer edges, toward the land its old owners keep.
  const old = new Set<string>();
  for (const f of changing) { const st = states.get(f); if (st?.transition?.from) old.add(st.transition.from); }
  const outer = lines((o) => { const v = before(o); return !v || !old.has(v); });
  if (outer.length) return { rings, source: { kind: 'lines', lonlat: outer } };
  return { rings, source: { kind: 'heart' } };
}

/** A place (longitude, latitude) of a direction. */
function lonLatOf(v: Vec3): [number, number] {
  return [(Math.atan2(v[1], v[0]) * 180) / Math.PI, (Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180) / Math.PI];
}

/** The point of the land `held` nearest to the change (sampled), as longitude and latitude. */
function nearestOf(arr: Arrangement, changing: number[], held: number[]): [number, number] | null {
  const sample = (faces: number[], max: number) => {
    const all: Array<[number, number]> = [];
    for (const f of faces) for (const ring of arr.faceRingsLonLat(f)) for (const p of ring) all.push(p);
    const step = Math.max(1, Math.floor(all.length / max));
    return all.filter((_, i) => i % step === 0);
  };
  const cs = sample(changing, 300), hs = sample(held, 3000);
  if (!cs.length || !hs.length) return null;
  const dir = (p: [number, number]): Vec3 => { const x = (p[0] * Math.PI) / 180, y = (p[1] * Math.PI) / 180; return [Math.cos(y) * Math.cos(x), Math.cos(y) * Math.sin(x), Math.sin(y)]; };
  const vc = cs.map(dir), vh = hs.map(dir);
  let best = -Infinity, ih = 0;
  for (const a of vc) for (let j = 0; j < vh.length; j++) { const b = vh[j], d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; if (d > best) { best = d; ih = j; } }
  return hs[ih];
}
