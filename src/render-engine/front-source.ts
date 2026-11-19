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
  for (const f of changing) for (const r of arr.faceRingsLonLat(f)) if (r.length >= 3) rings.push(bowed(r));
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
      let from: [number, number] = [a.lon / E7, a.lat / E7];
      const to: [number, number] = [b.lon / E7, b.lat / E7];
      for (const p of between(from, to)) { out.push(from[0], from[1], p[0], p[1]); from = p; }
      out.push(from[0], from[1], to[0], to[1]);
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

/** A place (longitude, latitude) as a direction. */
function dirOf(p: [number, number]): Vec3 {
  const x = (p[0] * Math.PI) / 180, y = (p[1] * Math.PI) / 180;
  return [Math.cos(y) * Math.cos(x), Math.cos(y) * Math.sin(x), Math.sin(y)];
}

/**
 * The points between two ends of a border, about a degree of longitude apart (none when the ends are nearer).
 * A border is an arc of a great circle, which the front's field takes as straight in longitude and latitude:
 * a long one bows toward the pole (by a fifth of a degree over 14° of longitude at 48° N; by degrees over a
 * continent), and the land between the arc and the straight line would be left out of the field.
 */
function between(a: [number, number], b: [number, number]): Array<[number, number]> {
  const span = Math.abs(((b[0] - a[0] + 540) % 360) - 180);
  const n = Math.min(90, Math.ceil(span));
  if (n < 2) return [];
  const va = dirOf(a), vb = dirOf(b);
  const w = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))), sw = Math.sin(w);
  if (!(sw > 1e-9)) return [];
  const out: Array<[number, number]> = [];
  for (let q = 1; q < n; q++) {
    const ka = Math.sin(((n - q) / n) * w) / sw, kb = Math.sin((q / n) * w) / sw;
    out.push(lonLatOf([ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2]]));
  }
  return out;
}

/** A parcel's ring with points put along its long borders (see `between`); the ring itself when none is long. */
function bowed(r: Array<[number, number]>): Array<[number, number]> {
  let out: Array<[number, number]> | null = null;
  for (let i = 0; i < r.length; i++) {
    const more = between(r[i], r[(i + 1) % r.length]);
    if (more.length && !out) out = r.slice(0, i);
    if (out) { out.push(r[i]); for (const p of more) out.push(p); }
  }
  return out ?? r;
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
  const vc = cs.map(dirOf), vh = hs.map(dirOf);
  let best = -Infinity, ih = 0;
  for (const a of vc) for (let j = 0; j < vh.length; j++) { const b = vh[j], d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; if (d > best) { best = d; ih = j; } }
  return hs[ih];
}
