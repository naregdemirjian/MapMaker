// The outlines of a map's parcels as lines ready for drawing (see plane.ts): one ring per boundary
// cycle of the parcel map, with unwrapped longitudes and each point's importance. A cycle keeps its
// id while nothing about it changes, so after an edit only the cycles around the edit are prepared
// again; everything else is reused.
//
// A cycle is cut into chains at the points where three or more borders meet. A chain is shared by
// the two parcels beside it; its points are ranked once in a direction fixed by the chain itself,
// so both parcels simplify it identically and never part or overlap at any level of detail.
import type { Arrangement, Topology } from '../geo-kernel/arrangement.ts';
import { E7 } from '../geo-kernel/vec.ts';
import { rankPoints, type Ring } from './plane.ts';

const RAD = Math.PI / 180;

export interface CycleGeom extends Ring {
  id: number;
  /** Chain i runs from point starts[i] to point starts[i + 1] (the last one back to the first point). */
  starts: Int32Array;
  /** The first half-edge of each chain, in the cycle's direction (its faces: left, and across it). */
  heads: Int32Array;
  /** The vertex each chain starts at (it ends where the next one starts; the last where the first starts). */
  nodes: Int32Array;
  /** 1 where the cycle walks the chain in the chain's own fixed direction: a border is drawn once, from that side. */
  canonical: Uint8Array;
  /** The integral of (1 + sin latitude) d longitude around the ring, in radians (see needsOutline). */
  under: number;
}

/** A closed outline made of border chains (see ParcelGeometry.dissolve). */
export interface DissolvedRing {
  /** Chains in order: points from..to-1 of a cycle (carried on to its first point for its last chain), turned by whole turns. */
  parts: Array<{ cycle: CycleGeom; from: number; to: number; toFirst: boolean; turn: number }>;
  /** A box holding the whole ring (unwrapped longitudes). */
  box: [number, number, number, number];
}

const wrap = (d: number) => d - 360 * Math.round(d / 360);

export class ParcelGeometry {
  private readonly cycles = new Map<number, CycleGeom>();
  private readonly outline = new Map<number, { stamp: number; needs: boolean }>();
  readonly arr: Arrangement;

  constructor(arr: Arrangement) {
    this.arr = arr;
  }

  /** The ring of a boundary cycle (prepared on first use, kept while the cycle exists). */
  cycle(id: number, t: Topology = this.arr.topology()): CycleGeom {
    let c = this.cycles.get(id);
    if (!c) {
      c = this.build(id, t);
      // Cycles that no longer exist are forgotten now and then.
      if (this.cycles.size > 2 * t.cycles.size + 2000) for (const k of [...this.cycles.keys()]) if (!t.cycles.has(k)) this.cycles.delete(k);
      this.cycles.set(id, c);
    }
    return c;
  }

  /**
   * Whether a face's area includes "the rest of the planet" beyond its rings, as the ocean's does:
   * its rings are then drawn as holes in the planet's outline. Rings are filled by the even-odd rule,
   * and a ring that goes round the planet is closed along the south pole; the area so filled is
   * either the face or everything but the face. The two differ by the whole sphere, so comparing with
   * the face's true area settles it: the filled area is minus the sum of the rings' `under`.
   */
  needsOutline(face: number): boolean {
    const stamp = this.arr.faceStamp(face);
    let o = this.outline.get(face);
    if (!o || o.stamp !== stamp) {
      const t = this.arr.topology();
      let filled = 0;
      for (const c of t.facesCycles.get(face) ?? []) filled -= this.cycle(c, t).under;
      o = { stamp, needs: filled < this.arr.faceArea(face) - 2 * Math.PI };
      if (this.outline.size > 4 * t.facesCycles.size + 2000) this.outline.clear();
      this.outline.set(face, o);
    }
    return o.needs;
  }

  /**
   * The outline of a set of parcels taken together: the border chains with a parcel of the set on
   * one side only, joined end to end into closed rings. Parcels of one owner then draw as the
   * owner's outline, however many parcels history has cut the land into. Each ring is a list of
   * (cycle, chain) pairs in order. Null when the set cannot be drawn so: a parcel whose area takes in
   * the rest of the planet, or an outline that goes round the planet (those are drawn parcel by parcel).
   */
  dissolve(faces: number[], t: Topology = this.arr.topology()): DissolvedRing[] | null {
    const arr = this.arr;
    const inSet = new Set(faces);
    interface Link { cycle: CycleGeom; i: number; from: number; to: number; used: boolean }
    const links: Link[] = [];
    const byStart = new Map<number, Link[]>();
    for (const f of faces) {
      if (this.needsOutline(f)) return null;
      for (const c of t.facesCycles.get(f) ?? []) {
        const g = this.cycle(c, t);
        if (g.wind !== 0) return null;
        const n = g.heads.length;
        for (let i = 0; i < n; i++) {
          if (inSet.has(arr.halfEdgeFace(g.heads[i] ^ 1))) continue; // a border inside the set
          const link: Link = { cycle: g, i, from: g.nodes[i], to: g.nodes[(i + 1) % n], used: false };
          links.push(link);
          const l = byStart.get(link.from);
          if (l) l.push(link); else byStart.set(link.from, [link]);
        }
      }
    }
    // Every chain has the set on its left, so at each meeting point as many arrive as leave: following
    // any unused chain out of the point a chain ends at always closes a ring (even-odd filling does
    // not care which, where several meet).
    const rings: DissolvedRing[] = [];
    for (const first of links) {
      if (first.used) continue;
      const parts: DissolvedRing['parts'] = [];
      let cur: Link | undefined = first;
      let lon = 0, w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
      for (let guard = 0; cur && guard <= links.length; guard++) {
        cur.used = true;
        const g = cur.cycle, a = g.starts[cur.i], last = cur.i === g.starts.length - 1;
        // Each cycle counts longitude its own way round: this chain is turned to carry on where the ring has got to.
        const turn = parts.length ? 360 * Math.round((lon - g.lon[a]) / 360) : 0;
        parts.push({ cycle: g, from: a, to: last ? g.lon.length : g.starts[cur.i + 1] + 1, toFirst: last, turn });
        lon = (last ? g.lon[0] : g.lon[g.starts[cur.i + 1]]) + turn;
        if (g.box[0] + turn < w) w = g.box[0] + turn; if (g.box[2] + turn > e) e = g.box[2] + turn;
        if (g.box[1] < s) s = g.box[1]; if (g.box[3] > n) n = g.box[3];
        if (cur.to === first.from) break;
        const next: Link[] | undefined = byStart.get(cur.to);
        cur = undefined;
        if (next) for (let q = next.length - 1; q >= 0; q--) if (!next[q].used) { cur = next[q]; break; }
      }
      if (!cur) return null; // an outline that does not close: not expected; drawn parcel by parcel
      // Back at the first point: at the same longitude, unless the outline goes round the planet.
      const g0 = parts[0].cycle;
      if (Math.abs(lon - g0.lon[parts[0].from]) > 1) return null;
      rings.push({ parts, box: [w, s, e, n] });
    }
    return rings;
  }

  private build(id: number, t: Topology): CycleGeom {
    const arr = this.arr;
    let hs = t.cycles.get(id)!;
    const n = hs.length;
    const vertexOf = (h: number) => arr.halfEdgeFrom(h);
    const degree = (v: number) => t.outgoing.get(v)?.length ?? 0;
    // Start at a meeting point of borders; a cycle without one (an island's coast) at its lowest vertex id.
    let first = -1;
    for (let i = 0; i < n; i++) if (degree(vertexOf(hs[i])) !== 2) { first = i; break; }
    const loop = first < 0;
    if (loop) { let low = Infinity; for (let i = 0; i < n; i++) { const v = vertexOf(hs[i]); if (v < low) { low = v; first = i; } } }
    if (first > 0) hs = [...hs.slice(first), ...hs.slice(0, first)];

    const raw = new Float64Array(n), lat = new Float64Array(n), lon = new Float64Array(n);
    const junction = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = vertexOf(hs[i]), row = arr.vertices.get(v)!;
      raw[i] = row.lon / E7; lat[i] = row.lat / E7;
      junction[i] = loop ? (i === 0 ? 1 : 0) : degree(v) !== 2 ? 1 : 0;
    }
    // A point exactly on a pole has no longitude of its own: it takes its neighbour's.
    for (let i = 0; i < n; i++) if (Math.abs(lat[i]) === 90) raw[i] = raw[(i + n - 1) % n];
    lon[0] = raw[0];
    for (let i = 1; i < n; i++) lon[i] = lon[i - 1] + wrap(raw[i] - raw[i - 1]);
    const closing = lon[n - 1] + wrap(raw[0] - raw[n - 1]);
    const wind = Math.round((closing - lon[0]) / 360);
    let under = 0, w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, lj = j === 0 ? closing : lon[j];
      under += (1 + (Math.sin(lat[i] * RAD) + Math.sin(lat[j] * RAD)) / 2) * (lj - lon[i]) * RAD;
      if (lon[i] < w) w = lon[i]; if (lon[i] > e) e = lon[i]; if (lat[i] < s) s = lat[i]; if (lat[i] > nn) nn = lat[i];
    }
    if (wind !== 0) { w = Math.min(w, closing); e = Math.max(e, closing); s = -90; }

    // Chains and the importance of their points.
    const starts: number[] = [], heads: number[] = [], canonical: number[] = [], nodes: number[] = [];
    const imp = new Float32Array(n);
    for (let a = 0; a < n; ) {
      let b = a + 1;
      while (b < n && !junction[b]) b++;
      // Chain a..b (b may be n: back at the first point). Its own direction: from the end whose first half-edge is lower.
      const forward = loop ? (hs[0] >> 1) < (hs[n - 1] >> 1) : hs[a] < (hs[b - 1] ^ 1);
      starts.push(a); heads.push(hs[a]); canonical.push(forward ? 1 : 0); nodes.push(vertexOf(hs[a]));
      imp[a] = Infinity;
      const m = b - a + 1;
      if (m > 2) {
        // Ranked on the chain's own coordinates (unwrapped from the true longitude of its first point,
        // in its own direction), so the parcel on the other side gets exactly the same ranking.
        const x = new Float64Array(m), y = new Float64Array(m);
        const at = (q: number) => (forward ? a + q : b - q) % n;
        x[0] = raw[at(0)]; y[0] = lat[at(0)];
        for (let q = 1; q < m; q++) { x[q] = x[q - 1] + wrap(raw[at(q)] - raw[at(q - 1)]); y[q] = lat[at(q)]; }
        const r = new Float32Array(m);
        if (loop) {
          // No meeting points: anchored also at the point farthest from the start, so the ring keeps its extent.
          let far = 1, farD = -1;
          for (let q = 1; q < m - 1; q++) { const d = (x[q] - x[0]) ** 2 + (y[q] - y[0]) ** 2; if (d > farD) { farD = d; far = q; } }
          r[far] = Infinity;
          rankPoints(x, y, 0, far, r);
          rankPoints(x, y, far, m - 1, r);
        } else rankPoints(x, y, 0, m - 1, r);
        for (let q = 1; q < m - 1; q++) imp[at(q)] = r[q];
      }
      a = b;
    }
    return {
      id, lon, lat, imp, closed: true, arcs: true, box: [w, s, e, nn], wind, under,
      starts: Int32Array.from(starts), heads: Int32Array.from(heads), canonical: Uint8Array.from(canonical), nodes: Int32Array.from(nodes),
    };
  }
}

const geometries = new WeakMap<Arrangement, ParcelGeometry>();

/** The prepared outlines of a parcel map (one per map, made on first use). */
export function parcelGeometry(arr: Arrangement): ParcelGeometry {
  let g = geometries.get(arr);
  if (!g) geometries.set(arr, (g = new ParcelGeometry(arr)));
  return g;
}
