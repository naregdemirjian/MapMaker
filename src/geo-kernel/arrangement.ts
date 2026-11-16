// The parcel map of one sphere map space: a planar subdivision of the sphere into faces ("parcels").
//
// Persistent data (three tables): vertices (fixed-point lon/lat), segments (great-circle arcs between two
// vertices, carrying the face id on their left and right) and faces (with split lineage: a split face
// becomes a non-leaf parent of its pieces, and the pieces inherit its history).
//
// Every border ever drawn permanently cuts the faces it crosses. Faces are never merged by editing,
// so earlier history is never rewritten by geometry work. Derived structures (half-edges, cycles,
// spatial indexes) are rebuilt from the persistent rows and are never authoritative.
import {
  type Vec3, angle, arcDirectionAtEnd, arcDirectionAtStart, cross, dot, e7ToVec, normalize, tangentBasis, vecToE7, E7,
} from './vec.ts';
import { orient, arcsCross, arcIntersection, distanceToArc } from './predicates.ts';
import { SpatialGrid, arcBox, pointBox } from './spatial-grid.ts';

/** A fixed, generic reference point used as "the point at infinity" when classifying cycles. */
export const PINF: Vec3 = normalize([0.3141592653589793, -0.7071067811865476, 0.6324555320336759]);
/** Smallest snapping distance (radians): absorbs fixed-point rounding of computed intersections. */
export const MIN_SNAP = 5e-9;

export interface VertexRow { id: number; space_id: string; lon: number; lat: number }
export interface SegmentRow { id: number; space_id: string; a: number; b: number; left_face: number; right_face: number }
export interface FaceRow { id: number; space_id: string; parent_id: number | null; is_leaf: number }
export type KernelTable = 'vertex' | 'segment' | 'face';
export type KernelRow = VertexRow | SegmentRow | FaceRow;
export interface RowChange { table: KernelTable; before: KernelRow | null; after: KernelRow | null }
export interface KernelDiff { changes: RowChange[]; rootFace: { before: number; after: number } | null }
export interface IdSource { next(table: KernelTable): number }
export interface PathStep { seg: number; fwd: boolean }

export class TopologyError extends Error {}

interface Topology {
  segIds: number[]; // k -> segment id; half-edges 2k (a->b) and 2k+1 (b->a)
  segIndex: Map<number, number>;
  next: Int32Array;
  cycleOf: Int32Array;
  cycles: number[][];
  outgoing: Map<number, number[]>; // vertex -> outgoing half-edges sorted counter-clockwise
  facesCycles: Map<number, number[]>; // face label -> cycle indices
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class Arrangement {
  readonly spaceId: string;
  rootFace: number;
  readonly vertices = new Map<number, VertexRow>();
  readonly segments = new Map<number, SegmentRow>();
  readonly faces = new Map<number, FaceRow>();
  private readonly ids: IdSource;
  private readonly vec = new Map<number, Vec3>();
  private readonly vgrid = new SpatialGrid();
  private readonly sgrid = new SpatialGrid();
  private readonly incident = new Map<number, Set<number>>();
  private readonly pairIndex = new Map<string, number>();
  private log: Map<string, RowChange> | null = null;
  private rootBefore = 0;
  private topo: Topology | null = null;
  /** Bumped on every geometric change; renderers use it to invalidate caches. */
  revision = 0;
  /**
   * Set by the world before an edit: does any recorded history refer to this face? When it is not
   * set, every face is treated as referenced (the original, always-correct behaviour).
   */
  isReferenced: ((faceId: number) => boolean) | null = null;

  private constructor(spaceId: string, rootFace: number, ids: IdSource) {
    this.spaceId = spaceId;
    this.rootFace = rootFace;
    this.ids = ids;
  }

  /** A new, empty sphere: one face covering everything. */
  static createEmpty(spaceId: string, ids: IdSource): { arrangement: Arrangement; diff: KernelDiff } {
    const root = ids.next('face');
    const arr = new Arrangement(spaceId, root, ids);
    arr.begin();
    arr.putFace({ id: root, space_id: spaceId, parent_id: null, is_leaf: 1 });
    const diff = arr.commit();
    diff.rootFace = { before: 0, after: root };
    return { arrangement: arr, diff };
  }

  static fromRows(spaceId: string, rootFace: number, vertices: Iterable<VertexRow>, segments: Iterable<SegmentRow>, faces: Iterable<FaceRow>, ids: IdSource): Arrangement {
    const arr = new Arrangement(spaceId, rootFace, ids);
    for (const f of faces) arr.faces.set(f.id, { ...f });
    for (const v of vertices) arr.indexVertex({ ...v });
    for (const s of segments) arr.indexSegment({ ...s });
    return arr;
  }

  // ---------------------------------------------------------------- change log

  begin(): void {
    if (this.log) throw new TopologyError('Nested kernel operation');
    this.log = new Map();
    this.rootBefore = this.rootFace;
  }

  commit(): KernelDiff {
    if (!this.log) throw new TopologyError('commit() without begin()');
    const changes: RowChange[] = [];
    for (const c of this.log.values()) {
      if (c.before && c.after && JSON.stringify(c.before) === JSON.stringify(c.after)) continue;
      if (!c.before && !c.after) continue;
      changes.push(c);
    }
    const rootFace = this.rootBefore !== this.rootFace ? { before: this.rootBefore, after: this.rootFace } : null;
    this.log = null;
    return { changes, rootFace };
  }

  /** Abandon an operation: undo every change made since begin(). */
  rollback(): void {
    if (!this.log) return;
    const entries = [...this.log.values()];
    this.log = null;
    for (const c of entries.reverse()) this.applyRowChange(c.table, c.after, c.before);
    this.rootFace = this.rootBefore;
  }

  private record(table: KernelTable, id: number, before: KernelRow | null, after: KernelRow | null): void {
    if (!this.log) throw new TopologyError('Kernel change outside an operation');
    const k = `${table}:${id}`;
    const prev = this.log.get(k);
    this.log.set(k, { table, before: prev ? prev.before : before, after });
  }

  /** Apply a row change coming from storage (undo, redo, reload). Not logged. */
  applyRowChange(table: KernelTable, before: KernelRow | null, after: KernelRow | null): void {
    if (table === 'vertex') {
      if (before) this.unindexVertex(before.id);
      if (after) this.indexVertex({ ...(after as VertexRow) });
    } else if (table === 'segment') {
      if (before) this.unindexSegment(before.id);
      if (after) this.indexSegment({ ...(after as SegmentRow) });
    } else {
      if (before) this.faces.delete(before.id);
      if (after) this.faces.set(after.id, { ...(after as FaceRow) });
    }
    this.topo = null;
    this.revision++;
  }

  // ---------------------------------------------------------------- low-level row maintenance

  private indexVertex(v: VertexRow): void {
    this.vertices.set(v.id, v);
    const p = e7ToVec(v.lon, v.lat);
    this.vec.set(v.id, p);
    const [lo, hi] = pointBox(p, 0);
    this.vgrid.insert(v.id, lo, hi);
    if (!this.incident.has(v.id)) this.incident.set(v.id, new Set());
    // A moved vertex changes the bounding boxes of its segments.
    for (const sid of this.incident.get(v.id)!) {
      const s = this.segments.get(sid);
      if (s && this.vec.has(s.a) && this.vec.has(s.b)) {
        const [slo, shi] = arcBox(this.v(s.a), this.v(s.b), 0);
        this.sgrid.insert(sid, slo, shi);
      }
    }
  }

  private unindexVertex(id: number): void {
    this.vertices.delete(id);
    this.vec.delete(id);
    this.vgrid.remove(id);
    const inc = this.incident.get(id);
    if (inc && inc.size === 0) this.incident.delete(id);
  }

  private indexSegment(s: SegmentRow): void {
    this.segments.set(s.id, s);
    this.pairIndex.set(pairKey(s.a, s.b), s.id);
    this.incidentOf(s.a).add(s.id);
    this.incidentOf(s.b).add(s.id);
    const [lo, hi] = arcBox(this.v(s.a), this.v(s.b), 0);
    this.sgrid.insert(s.id, lo, hi);
  }

  private unindexSegment(id: number): void {
    const s = this.segments.get(id);
    if (!s) return;
    this.segments.delete(id);
    if (this.pairIndex.get(pairKey(s.a, s.b)) === id) this.pairIndex.delete(pairKey(s.a, s.b));
    this.incident.get(s.a)?.delete(id);
    this.incident.get(s.b)?.delete(id);
    this.sgrid.remove(id);
  }

  private incidentOf(v: number): Set<number> {
    let s = this.incident.get(v);
    if (!s) this.incident.set(v, (s = new Set()));
    return s;
  }

  private putVertex(v: VertexRow): void {
    const before = this.vertices.get(v.id) ?? null;
    if (before) this.vgrid.remove(v.id);
    this.record('vertex', v.id, before ? { ...before } : null, { ...v });
    this.indexVertex({ ...v });
    this.topo = null;
    this.revision++;
  }

  private putSegment(s: SegmentRow): void {
    const before = this.segments.get(s.id) ?? null;
    if (before && before.a === s.a && before.b === s.b) {
      // Only the face labels change: the geometry, and so the spatial index, stay as they are.
      this.record('segment', s.id, { ...before }, { ...s });
      this.segments.set(s.id, { ...s });
      this.topo = null;
      this.revision++;
      return;
    }
    if (before) this.unindexSegment(s.id);
    this.record('segment', s.id, before ? { ...before } : null, { ...s });
    this.indexSegment({ ...s });
    this.topo = null;
    this.revision++;
  }

  private deleteSegment(id: number): void {
    const before = this.segments.get(id);
    if (!before) return;
    this.record('segment', id, { ...before }, null);
    this.unindexSegment(id);
    this.topo = null;
    this.revision++;
  }

  private putFace(f: FaceRow): void {
    const before = this.faces.get(f.id) ?? null;
    this.record('face', f.id, before ? { ...before } : null, { ...f });
    this.faces.set(f.id, { ...f });
    this.revision++;
  }

  v(id: number): Vec3 {
    const p = this.vec.get(id);
    if (!p) throw new TopologyError(`Unknown vertex ${id}`);
    return p;
  }

  segmentBetween(a: number, b: number): number | undefined {
    return this.pairIndex.get(pairKey(a, b));
  }

  // ---------------------------------------------------------------- vertices and snapping

  /** Find or create the vertex for an input point, snapping to existing vertices, then existing segments. */
  vertexFor(p: Vec3, snap: number): number {
    const tol = Math.max(snap, MIN_SNAP);
    const near = this.nearestVertex(p, tol);
    if (near !== null) return near;
    const seg = this.nearestSegment(p, tol);
    if (seg !== null) {
      const { closest } = distanceToArc(p, this.v(seg.s.a), this.v(seg.s.b));
      return this.splitSegmentAtPoint(seg.s.id, closest, tol);
    }
    return this.newVertex(p);
  }

  private newVertex(p: Vec3): number {
    const [lon, lat] = vecToE7(p);
    const id = this.ids.next('vertex');
    this.putVertex({ id, space_id: this.spaceId, lon, lat });
    return id;
  }

  nearestVertex(p: Vec3, tol: number, exclude?: Set<number>): number | null {
    const [lo, hi] = pointBox(p, tol);
    let best: number | null = null;
    let bestD = tol;
    for (const id of this.vgrid.query(lo, hi)) {
      if (exclude?.has(id)) continue;
      const d = angle(p, this.v(id));
      if (d <= bestD) { bestD = d; best = id; }
    }
    return best;
  }

  nearestSegment(p: Vec3, tol: number, exclude?: Set<number>): { s: SegmentRow; dist: number } | null {
    const [lo, hi] = pointBox(p, tol);
    let best: { s: SegmentRow; dist: number } | null = null;
    for (const id of this.sgrid.query(lo, hi)) {
      if (exclude?.has(id)) continue;
      const s = this.segments.get(id)!;
      const d = distanceToArc(p, this.v(s.a), this.v(s.b));
      if (d.interior && d.dist <= tol && (!best || d.dist < best.dist)) best = { s, dist: d.dist };
    }
    return best;
  }

  /** Split a segment at (near) point p; both halves keep the segment's face labels. Returns the vertex id. */
  private splitSegmentAtPoint(segId: number, p: Vec3, tol: number): number {
    const s = this.segments.get(segId)!;
    const existing = this.nearestVertex(p, Math.max(tol * 0.01, MIN_SNAP));
    const x = existing ?? this.newVertex(p);
    if (x === s.a || x === s.b) return x;
    this.splitSegmentAtVertex(segId, x, tol);
    return x;
  }

  private splitSegmentAtVertex(segId: number, x: number, tol: number): void {
    const s = this.segments.get(segId)!;
    this.deleteSegment(segId);
    this.insertPiece(s.a, x, tol, s.left_face, s.right_face, 0);
    this.insertPiece(x, s.b, tol, s.left_face, s.right_face, 0);
  }

  // ---------------------------------------------------------------- insertion with noding

  /**
   * Insert a polyline (closed = ring) given as unit vectors. Crossings with existing segments are
   * computed exactly, rounded to the fixed-point grid and split; nearby vertices and segments within
   * `snap` radians are snapped onto. Faces are rebuilt afterwards with lineage.
   * Returns the inserted path as directed segments, in input order.
   */
  insertPath(points: Vec3[], opts: { closed: boolean; snap: number }): PathStep[] {
    const tol = Math.max(opts.snap, MIN_SNAP);
    const ids: number[] = [];
    for (const p of points) {
      const id = this.vertexFor(p, tol);
      if (ids.length === 0 || ids[ids.length - 1] !== id) ids.push(id);
    }
    if (opts.closed && ids.length > 1 && ids[0] !== ids[ids.length - 1]) ids.push(ids[0]);
    if (opts.closed && ids.length < 4) throw new TopologyError('The shape is too small to form an area at this zoom level.');
    const path: PathStep[] = [];
    for (let i = 0; i + 1 < ids.length; i++) {
      // Endpoints may have been moved into existing segments by later snapping; vertices persist.
      path.push(...this.insertPiece(ids[i], ids[i + 1], tol, 0, 0, 0));
    }
    this.rebuildFaces();
    return path;
  }

  /** Insert one arc u->w, splitting at crossings and routing through nearby vertices. */
  private insertPiece(u: number, w: number, tol: number, left: number, right: number, depth: number): PathStep[] {
    if (u === w) return [];
    const existing = this.segmentBetween(u, w);
    if (existing !== undefined) {
      const s = this.segments.get(existing)!;
      return [{ seg: existing, fwd: s.a === u }];
    }
    const pu = this.v(u), pw = this.v(w);
    if (angle(pu, pw) > Math.PI * 0.95) throw new TopologyError('A segment is too long; densify the input first.');
    const [lo, hi] = arcBox(pu, pw, tol);
    const splits: Array<{ t: number; id: number }> = [];

    if (depth < 24) {
      for (const x of this.vgrid.query(lo, hi)) {
        if (x === u || x === w) continue;
        const d = distanceToArc(this.v(x), pu, pw);
        if (d.interior && d.dist <= tol) splits.push({ t: angle(pu, this.v(x)), id: x });
      }
      for (const sid of this.sgrid.query(lo, hi)) {
        const s = this.segments.get(sid);
        if (!s || s.a === u || s.a === w || s.b === u || s.b === w) continue;
        const pa = this.v(s.a), pb = this.v(s.b);
        if (arcsCross(pu, pw, pa, pb) !== 'cross') continue;
        const X = arcIntersection(pu, pw, pa, pb);
        let xid = this.nearestVertex(X, tol);
        if (xid === null) xid = this.newVertex(X);
        if (xid !== s.a && xid !== s.b) this.splitSegmentAtVertex(sid, xid, tol);
        if (xid !== u && xid !== w) splits.push({ t: angle(pu, this.v(xid)), id: xid });
      }
    }

    if (splits.length === 0) {
      const id = this.ids.next('segment');
      this.putSegment({ id, space_id: this.spaceId, a: u, b: w, left_face: left, right_face: right });
      return [{ seg: id, fwd: true }];
    }
    splits.sort((p, q) => p.t - q.t || p.id - q.id);
    const chain = [u];
    for (const s of splits) if (chain[chain.length - 1] !== s.id) chain.push(s.id);
    if (chain[chain.length - 1] !== w) chain.push(w);
    const out: PathStep[] = [];
    for (let i = 0; i + 1 < chain.length; i++) out.push(...this.insertPiece(chain[i], chain[i + 1], tol, left, right, depth + 1));
    return out;
  }

  // ---------------------------------------------------------------- topology (half-edges and cycles)

  private he(h: number, t: Topology): { seg: SegmentRow; from: number; to: number; label: number } {
    const s = this.segments.get(t.segIds[h >> 1])!;
    const fwd = (h & 1) === 0;
    return { seg: s, from: fwd ? s.a : s.b, to: fwd ? s.b : s.a, label: fwd ? s.left_face : s.right_face };
  }

  topology(): Topology {
    if (this.topo) return this.topo;
    const segIds = [...this.segments.keys()].sort((a, b) => a - b);
    const segIndex = new Map<number, number>();
    segIds.forEach((id, k) => segIndex.set(id, k));
    const n = segIds.length * 2;
    const outgoing = new Map<number, number[]>();
    const angleOf = new Float64Array(n);
    for (let k = 0; k < segIds.length; k++) {
      const s = this.segments.get(segIds[k])!;
      for (const h of [2 * k, 2 * k + 1]) {
        const from = (h & 1) === 0 ? s.a : s.b;
        const to = (h & 1) === 0 ? s.b : s.a;
        const pf = this.v(from), pt = this.v(to);
        const { east, north } = tangentBasis(pf);
        const d = arcDirectionAtStart(pf, pt);
        angleOf[h] = Math.atan2(dot(d, north), dot(d, east));
        let list = outgoing.get(from);
        if (!list) outgoing.set(from, (list = []));
        list.push(h);
      }
    }
    const pos = new Int32Array(n);
    for (const list of outgoing.values()) {
      list.sort((p, q) => angleOf[p] - angleOf[q] || p - q);
      list.forEach((h, i) => (pos[h] = i));
    }
    const next = new Int32Array(n);
    for (let h = 0; h < n; h++) {
      const twin = h ^ 1;
      const s = this.segments.get(segIds[h >> 1])!;
      const to = (h & 1) === 0 ? s.b : s.a;
      const list = outgoing.get(to)!;
      next[h] = list[(pos[twin] - 1 + list.length) % list.length];
    }
    const cycleOf = new Int32Array(n).fill(-1);
    const cycles: number[][] = [];
    for (let h = 0; h < n; h++) {
      if (cycleOf[h] !== -1) continue;
      const c: number[] = [];
      let x = h;
      let guard = 0;
      while (cycleOf[x] === -1) {
        cycleOf[x] = cycles.length;
        c.push(x);
        x = next[x];
        if (++guard > n + 1) throw new TopologyError('Corrupt half-edge structure');
      }
      cycles.push(c);
    }
    const facesCycles = new Map<number, number[]>();
    cycles.forEach((c, ci) => {
      const label = this.he(c[0], { segIds } as Topology).label;
      let list = facesCycles.get(label);
      if (!list) facesCycles.set(label, (list = []));
      list.push(ci);
    });
    this.topo = { segIds, segIndex, next, cycleOf, cycles, outgoing, facesCycles };
    return this.topo;
  }

  /** Signed turning sum of a cycle; area of its left region = 2*pi - sum (Gauss-Bonnet). */
  private cycleLeftArea(c: number[], t: Topology): number {
    let sum = 0;
    for (let i = 0; i < c.length; i++) {
      const a = this.he(c[i], t);
      const b = this.he(c[(i + 1) % c.length], t);
      const pu = this.v(a.from), pv = this.v(a.to), pw = this.v(b.to);
      if (b.to === a.from) { sum += -Math.PI; continue; } // spike: turn around the tip, face on the left
      const T = arcDirectionAtEnd(pu, pv);
      const O = arcDirectionAtStart(pv, pw);
      sum += Math.atan2(dot(cross(T, O), pv), dot(T, O));
    }
    return 2 * Math.PI - sum;
  }

  // ---------------------------------------------------------------- faces with lineage

  /**
   * Group cycles into faces geometrically, then give each face an id: an unchanged face keeps its id;
   * pieces of a split face become new children of it (the parent stops being a leaf).
   */
  private rebuildFaces(): void {
    const t = this.topology();
    const nC = t.cycles.length;
    if (nC === 0) return;

    // Connected components over vertices.
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let y = x;
      while (parent.get(y) !== r) { const n2 = parent.get(y)!; parent.set(y, r); y = n2; }
      return r;
    };
    for (const s of this.segments.values()) {
      if (!parent.has(s.a)) parent.set(s.a, s.a);
      if (!parent.has(s.b)) parent.set(s.b, s.b);
      const ra = find(s.a), rb = find(s.b);
      if (ra !== rb) parent.set(ra, rb);
    }
    const compSegs = new Map<number, number[]>();
    for (const s of this.segments.values()) {
      const r = find(s.a);
      let l = compSegs.get(r);
      if (!l) compSegs.set(r, (l = []));
      l.push(s.id);
    }
    const compOfCycle = (ci: number) => find(this.he(t.cycles[ci][0], t).from);

    // Per component: the hole cycle (the one whose left side contains PINF).
    const holeOf = new Map<number, number>();
    for (const [comp, segs] of compSegs) holeOf.set(comp, this.locatePinfInComponent(segs, t));

    const isOuter = new Uint8Array(nC);
    const area = new Float64Array(nC);
    for (let ci = 0; ci < nC; ci++) {
      isOuter[ci] = holeOf.get(compOfCycle(ci)) === ci ? 0 : 1;
      area[ci] = this.cycleLeftArea(t.cycles[ci], t);
    }

    // Bounding caps for outer cycles, to skip impossible containment tests.
    const caps: Array<{ c: Vec3; r: number } | null> = new Array(nC).fill(null);
    for (let ci = 0; ci < nC; ci++) {
      if (!isOuter[ci] || area[ci] >= 2 * Math.PI) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const h of t.cycles[ci]) { const p = this.v(this.he(h, t).from); sx += p[0]; sy += p[1]; sz += p[2]; }
      const len = Math.hypot(sx, sy, sz);
      if (len < 1e-9) continue;
      const c: Vec3 = [sx / len, sy / len, sz / len];
      let r = 0;
      for (const h of t.cycles[ci]) r = Math.max(r, angle(c, this.v(this.he(h, t).from)));
      if (r < Math.PI / 2 - 1e-9) caps[ci] = { c, r: r + 1e-9 };
    }

    // Each component's container: the smallest outer cycle of another component that contains it.
    const containerOf = new Map<number, number>(); // component -> outer cycle index, or -1 for root
    const outerList = [...Array(nC).keys()].filter((ci) => isOuter[ci]);
    for (const [comp, segs] of compSegs) {
      let best = -1;
      const samples = this.sampleVertices(segs);
      for (const ci of outerList) {
        if (compOfCycle(ci) === comp) continue;
        if (best !== -1 && area[ci] >= area[best]) continue;
        const inside = this.pointInOuterCycle(samples, t.cycles[ci], t, caps[ci]);
        if (inside) best = ci;
      }
      containerOf.set(comp, best);
    }

    // Regions: one per outer cycle, plus the root region; holes attach to their container.
    const regionOfCycle = new Int32Array(nC).fill(-1);
    const regions: number[][] = [];
    const regionIndexOfOuter = new Map<number, number>();
    for (const ci of outerList) { regionIndexOfOuter.set(ci, regions.length); regionOfCycle[ci] = regions.length; regions.push([ci]); }
    const ROOT = regions.length;
    regions.push([]);
    for (const [comp] of compSegs) {
      const hole = holeOf.get(comp)!;
      const cont = containerOf.get(comp)!;
      const ri = cont === -1 ? ROOT : regionIndexOfOuter.get(cont)!;
      regions[ri].push(hole);
      regionOfCycle[hole] = ri;
    }

    // Origin of each region: the old face its known labels point to, else the origin of its container.
    const origin = new Int32Array(regions.length).fill(-1);
    const containerRegion = (ri: number): number => {
      if (ri === ROOT) return -1;
      const outer = regions[ri][0];
      const comp = compOfCycle(outer);
      const hole = holeOf.get(comp)!;
      return regionOfCycle[hole];
    };
    const resolve = (ri: number, depth = 0): number => {
      if (origin[ri] !== -1) return origin[ri];
      const counts = new Map<number, number>();
      for (const ci of regions[ri]) for (const h of t.cycles[ci]) {
        const l = this.he(h, t).label;
        if (l > 0) counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      let o = -1, bestN = -1;
      for (const [l, n2] of counts) if (n2 > bestN || (n2 === bestN && l < o)) { o = l; bestN = n2; }
      if (o === -1) o = ri === ROOT || depth > 10000 ? this.rootFace : resolve(containerRegion(ri), depth + 1);
      origin[ri] = o;
      return o;
    };
    for (let ri = 0; ri < regions.length; ri++) if (regions[ri].length > 0 || ri === ROOT) resolve(ri);

    // New ids: keep an unchanged face, split a divided one into children.
    const byOrigin = new Map<number, number[]>();
    for (let ri = 0; ri < regions.length; ri++) {
      if (regions[ri].length === 0 && ri !== ROOT) continue;
      if (ri === ROOT && regions[ri].length === 0) continue;
      let l = byOrigin.get(origin[ri]);
      if (!l) byOrigin.set(origin[ri], (l = []));
      l.push(ri);
    }
    const finalId = new Int32Array(regions.length).fill(-1);
    for (const [o, list] of [...byOrigin.entries()].sort((a, b) => a[0] - b[0])) {
      const face = this.faces.get(o);
      if (list.length === 1 && face && face.is_leaf) { finalId[list[0]] = o; continue; }
      if (face && face.is_leaf && this.isReferenced && !this.isReferenced(o)) {
        // Nothing in history refers to this parcel, so its pieces have nothing of its own to inherit.
        // The piece that already carries most of its borders keeps its identity (no relabelling);
        // the others become its siblings, inheriting exactly what it inherits from its ancestors.
        let keep = list[0], keepN = -1;
        for (const ri of list) {
          let n2 = 0;
          for (const ci of regions[ri]) for (const h of t.cycles[ci]) if (this.he(h, t).label === o) n2++;
          if (n2 > keepN) { keep = ri; keepN = n2; }
        }
        for (const ri of list) {
          if (ri === keep) { finalId[ri] = o; continue; }
          const id = this.ids.next('face');
          this.putFace({ id, space_id: this.spaceId, parent_id: face.parent_id, is_leaf: 1 });
          finalId[ri] = id;
        }
        continue;
      }
      if (face && face.is_leaf) this.putFace({ ...face, is_leaf: 0 });
      for (const ri of list) {
        const id = this.ids.next('face');
        this.putFace({ id, space_id: this.spaceId, parent_id: o, is_leaf: 1 });
        finalId[ri] = id;
      }
    }

    // Write labels onto segments.
    const pending = new Map<number, { left: number; right: number }>();
    for (let ri = 0; ri < regions.length; ri++) {
      const fid = finalId[ri];
      if (fid === -1) continue;
      for (const ci of regions[ri]) for (const h of t.cycles[ci]) {
        const sid = t.segIds[h >> 1];
        const cur = pending.get(sid) ?? { left: this.segments.get(sid)!.left_face, right: this.segments.get(sid)!.right_face };
        if ((h & 1) === 0) cur.left = fid; else cur.right = fid;
        pending.set(sid, cur);
      }
    }
    for (const [sid, lr] of pending) {
      const s = this.segments.get(sid)!;
      if (s.left_face !== lr.left || s.right_face !== lr.right) this.putSegment({ ...s, left_face: lr.left, right_face: lr.right });
    }
    if (finalId[ROOT] !== -1) this.rootFace = finalId[ROOT];
    this.topo = null;
  }

  private sampleVertices(segs: number[]): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const sid of segs) {
      const s = this.segments.get(sid)!;
      for (const v of [s.a, s.b]) if (!seen.has(v)) { seen.add(v); out.push(v); }
      if (out.length >= 6) break;
    }
    return out;
  }

  /** Which cycle of one component has PINF on its left: the face hit first walking from PINF towards the component. */
  private locatePinfInComponent(segs: number[], t: Topology): number {
    const tries = Math.min(segs.length, 16);
    for (let i = 0; i < tries; i++) {
      const target = this.segments.get(segs[Math.floor((i * segs.length) / tries)])!;
      const hit = this.firstHit(PINF, target, () => segs);
      if (!hit) continue;
      const k = t.segIndex.get(hit.seg.id)!;
      return t.cycleOf[hit.side > 0 ? 2 * k : 2 * k + 1];
    }
    throw new TopologyError('Could not classify a boundary (degenerate geometry); try a slightly different shape.');
  }

  /**
   * Walk from p towards the midpoint of a target segment and return the first segment met, with the
   * side p's face is on. The walk is one great-circle arc, or two legs when the target is nearly
   * antipodal to p. Returns null in exactly degenerate situations (the caller tries another target).
   */
  private firstHit(p: Vec3, target: SegmentRow, candidates: (legs: Array<[Vec3, Vec3]>) => Iterable<number>): { seg: SegmentRow; side: number } | null {
    const ua = this.v(target.a), ub = this.v(target.b);
    const tp = normalize([ua[0] + ub[0], ua[1] + ub[1], ua[2] + ub[2]]);
    let legs: Array<[Vec3, Vec3]>;
    if (dot(tp, p) > -0.9) legs = [[p, tp]];
    else {
      let m = cross(p, tp);
      if (Math.hypot(m[0], m[1], m[2]) < 1e-6) m = cross(p, [1, 0, 0]);
      if (Math.hypot(m[0], m[1], m[2]) < 1e-6) m = cross(p, [0, 1, 0]);
      const mid = normalize(m);
      legs = [[p, mid], [mid, tp]];
    }
    const last = legs.length - 1;
    const side0 = orient(ua, ub, legs[last][0]);
    if (side0 === 0) return null;
    let best = { pos: legs.length, seg: target, side: side0 };
    let second = Infinity;
    for (const sid of candidates(legs)) {
      const s = this.segments.get(sid);
      if (!s) continue;
      const pa = this.v(s.a), pb = this.v(s.b);
      for (let li = 0; li < legs.length; li++) {
        if (sid === target.id && li === last) continue; // the walk ends on the target
        const [x, y] = legs[li];
        const r = arcsCross(x, y, pa, pb);
        if (r === 'degenerate') return null;
        if (r !== 'cross') continue;
        const X = arcIntersection(x, y, pa, pb);
        const pos = li + angle(x, X) / angle(x, y);
        const sd = orient(pa, pb, x);
        if (sd === 0) return null;
        if (pos < best.pos) { second = best.pos; best = { pos, seg: s, side: sd }; } else if (pos < second) second = pos;
      }
    }
    if (Math.abs(second - best.pos) < 1e-12) return null;
    return { seg: best.seg, side: best.side };
  }

  /** Is the component (represented by sample vertices) inside the left region of an outer cycle? */
  private pointInOuterCycle(samples: number[], cycle: number[], t: Topology, cap: { c: Vec3; r: number } | null): boolean {
    for (const vid of samples) {
      const p = this.v(vid);
      if (cap && angle(cap.c, p) > cap.r) return false;
      const parity = this.crossingParity(p, cycle.map((h) => t.segIds[h >> 1]));
      if (parity !== null) return parity === 1; // PINF is outside an outer cycle
    }
    throw new TopologyError('Could not decide which area contains a shape (degenerate geometry).');
  }

  /** Parity of crossings of a path from p to PINF with the given segments (null if degenerate). */
  private crossingParity(p: Vec3, segIds: number[]): number | null {
    const legs: Array<[Vec3, Vec3]> = [];
    if (dot(p, PINF) > -0.9) legs.push([p, PINF]);
    else {
      let m = cross(p, PINF);
      if (Math.hypot(m[0], m[1], m[2]) < 1e-6) m = cross(p, [1, 0, 0]);
      const mid = normalize(m);
      legs.push([p, mid], [mid, PINF]);
    }
    let count = 0;
    for (const sid of segIds) {
      const s = this.segments.get(sid)!;
      const pa = this.v(s.a), pb = this.v(s.b);
      for (const [x, y] of legs) {
        const r = arcsCross(x, y, pa, pb);
        if (r === 'degenerate') return null;
        if (r === 'cross') count++;
      }
    }
    return count & 1;
  }

  // ---------------------------------------------------------------- queries

  /** The leaf face containing point p (exact: the first border met walking from p decides). */
  locate(p: Vec3): number {
    if (this.segments.size === 0) return this.rootFace;
    try {
      return this.locateExact(p);
    } catch (e) {
      // A point exactly on a border: any adjacent face is a correct answer; nudge it off the border.
      for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]) {
        const q = normalize([p[0] + dx * 3e-9, p[1] + dy * 3e-9, p[2] + dz * 3e-9]);
        try { return this.locateExact(q); } catch { /* try the next direction */ }
      }
      throw e;
    }
  }

  private locateExact(p: Vec3): number {
    const t = this.topology();
    for (let r = 2e-4; r < 4; r *= 4) {
      const [lo, hi] = pointBox(p, r);
      const cands = [...this.sgrid.query(lo, hi)].sort((a, b) => a - b);
      for (const sid of cands.slice(0, 8)) {
        const res = this.locateVia(p, sid);
        if (res !== null) return res;
      }
    }
    for (const sid of t.segIds) {
      const res = this.locateVia(p, sid);
      if (res !== null) return res;
    }
    throw new TopologyError('Point location failed (degenerate geometry)');
  }

  private locateVia(p: Vec3, targetSeg: number): number | null {
    const target = this.segments.get(targetSeg)!;
    const hit = this.firstHit(p, target, (legs) => {
      const out = new Set<number>();
      for (const [x, y] of legs) { const [lo, hi] = arcBox(x, y, 1e-9); for (const id of this.sgrid.query(lo, hi)) out.add(id); }
      return out;
    });
    if (!hit) return null;
    return hit.side > 0 ? hit.seg.left_face : hit.seg.right_face;
  }

  /** Faces reached from the left side of a path without crossing the path (the inside of a ring). */
  /** The steps of a path whose segments are walked a net number of times (out-and-back pieces enclose nothing). */
  netPath(path: PathStep[]): PathStep[] {
    const count = new Map<number, number>();
    for (const st of path) count.set(st.seg, (count.get(st.seg) ?? 0) + (st.fwd ? 1 : -1));
    return path.filter((st) => (count.get(st.seg) ?? 0) !== 0);
  }

  /**
   * The area enclosed on the left of a set of closed cycles, in steradians, between 0 and 4π.
   * Computed directly from the path's vertices, independently of the face structure, so it can be
   * used to check what a paint operation is about to change.
   */
  pathLeftArea(path: PathStep[]): number {
    const edges: Array<[Vec3, Vec3]> = [];
    for (const st of this.netPath(path)) {
      const s = this.segments.get(st.seg)!;
      edges.push(st.fwd ? [this.v(s.a), this.v(s.b)] : [this.v(s.b), this.v(s.a)]);
    }
    if (edges.length < 3) return 0;
    // A reference point well away from the antipode of every vertex keeps every triangle defined.
    const refs: Vec3[] = [PINF, normalize([-0.53, 0.27, 0.8]), normalize([0.71, 0.66, -0.24]), normalize([0.1, -0.9, -0.4])];
    const ref = refs.find((r) => edges.every(([u]) => dot(r, u) > -1 + 1e-6)) ?? refs[0];
    let sum = 0;
    for (const [u, w] of edges) {
      const det = dot(ref, cross(u, w));
      const den = 1 + dot(ref, u) + dot(u, w) + dot(w, ref);
      sum += 2 * Math.atan2(det, den);
    }
    const full = 4 * Math.PI;
    sum %= full;
    return sum < 0 ? sum + full : sum;
  }

  facesLeftOf(path: PathStep[]): Set<number> {
    const barrier = new Set(path.map((s) => s.seg));
    const start = new Set<number>();
    for (const st of this.netPath(path)) {
      const s = this.segments.get(st.seg)!;
      start.add(st.fwd ? s.left_face : s.right_face);
    }
    const adj = new Map<number, number[]>();
    for (const s of this.segments.values()) {
      if (barrier.has(s.id) || s.left_face === s.right_face) continue;
      (adj.get(s.left_face) ?? adj.set(s.left_face, []).get(s.left_face)!).push(s.right_face);
      (adj.get(s.right_face) ?? adj.set(s.right_face, []).get(s.right_face)!).push(s.left_face);
    }
    const seen = new Set(start);
    const queue = [...start];
    while (queue.length) {
      const f = queue.pop()!;
      for (const g of adj.get(f) ?? []) if (!seen.has(g)) { seen.add(g); queue.push(g); }
    }
    return seen;
  }

  leafFaces(): number[] {
    return [...this.faces.values()].filter((f) => f.is_leaf).map((f) => f.id).sort((a, b) => a - b);
  }

  /** Ancestors of a face, nearest first (excluding itself). */
  ancestors(faceId: number): number[] {
    const out: number[] = [];
    let f = this.faces.get(faceId);
    while (f && f.parent_id !== null) { out.push(f.parent_id); f = this.faces.get(f.parent_id); }
    return out;
  }

  /** Boundary cycles of a face as vertex-id lists, each with the face on its left. */
  faceCycles(faceId: number): number[][] {
    const t = this.topology();
    const list = t.facesCycles.get(faceId) ?? [];
    return list.map((ci) => t.cycles[ci].map((h) => this.he(h, t).from));
  }

  /** Face rings as [lon, lat] degree pairs (face on the left of each ring). Empty for a face with no boundary (whole sphere). */
  faceRingsLonLat(faceId: number): Array<Array<[number, number]>> {
    return this.faceCycles(faceId).map((c) => c.map((vid) => { const r = this.vertices.get(vid)!; return [r.lon / E7, r.lat / E7]; }));
  }

  /** Area of a face in steradians (multiply by radius^2 for physical area). */
  faceArea(faceId: number): number {
    const t = this.topology();
    const list = t.facesCycles.get(faceId);
    if (!list || list.length === 0) return faceId === this.rootFace ? 4 * Math.PI : 0;
    let outer = -1;
    const holes: number[] = [];
    for (const ci of list) {
      // In a face, at most one cycle is "outer"; holes have left areas close to 4*pi minus the hole.
      if (outer === -1 && !this.cycleContainsPinfCached(ci, t)) outer = ci; else holes.push(ci);
    }
    let area = outer === -1 ? 4 * Math.PI : this.cycleLeftArea(t.cycles[outer], t);
    for (const ci of holes) area -= 4 * Math.PI - this.cycleLeftArea(t.cycles[ci], t);
    return area;
  }

  private pinfCache: { topo: Topology; holes: Set<number> } | null = null;
  private cycleContainsPinfCached(ci: number, t: Topology): boolean {
    if (!this.pinfCache || this.pinfCache.topo !== t) {
      const holes = new Set<number>();
      const comps = new Map<number, number[]>();
      const seen = new Set<number>();
      for (const s of this.segments.values()) {
        if (seen.has(s.id)) continue;
        // flood the component
        const stack = [s.a];
        const verts = new Set<number>([s.a]);
        const segs: number[] = [];
        while (stack.length) {
          const v = stack.pop()!;
          for (const sid of this.incident.get(v) ?? []) {
            if (seen.has(sid)) continue;
            seen.add(sid);
            segs.push(sid);
            const o = this.segments.get(sid)!;
            for (const w of [o.a, o.b]) if (!verts.has(w)) { verts.add(w); stack.push(w); }
          }
        }
        comps.set(s.id, segs);
      }
      for (const segs of comps.values()) holes.add(this.locatePinfInComponent(segs, t));
      this.pinfCache = { topo: t, holes };
    }
    return this.pinfCache.holes.has(ci);
  }

  // ---------------------------------------------------------------- topology-preserving vertex edits

  /** Can vertex vid move to p without changing which faces touch which (no crossings, nothing swept over)? */
  canMoveVertex(vid: number, p: Vec3, snap: number): { ok: true } | { ok: false; reason: string } {
    const tol = Math.max(snap, MIN_SNAP);
    const old = this.v(vid);
    const inc = [...(this.incident.get(vid) ?? [])].map((sid) => this.segments.get(sid)!);
    const neighbours = inc.map((s) => (s.a === vid ? s.b : s.a));
    const incSet = new Set(inc.map((s) => s.id));
    if (this.nearestVertex(p, tol, new Set([vid])) !== null) return { ok: false, reason: 'It would land on another point of a border.' };
    if (this.nearestSegment(p, tol, incSet) !== null) return { ok: false, reason: 'It would land on another border.' };
    for (const w of neighbours) {
      const pw = this.v(w);
      if (angle(pw, p) > Math.PI * 0.9) return { ok: false, reason: 'The move is too large.' };
      const [lo, hi] = arcBox(pw, p, tol);
      for (const sid of this.sgrid.query(lo, hi)) {
        if (incSet.has(sid)) continue;
        const s = this.segments.get(sid)!;
        if (s.a === w || s.b === w) continue;
        const r = arcsCross(pw, p, this.v(s.a), this.v(s.b));
        if (r !== 'none') return { ok: false, reason: 'The border would cross another border. Move it in smaller steps or use the territory brush.' };
      }
      for (const x of this.vgrid.query(lo, hi)) {
        if (x === w || x === vid) continue;
        const d = distanceToArc(this.v(x), pw, p);
        if (d.interior && d.dist <= tol) return { ok: false, reason: 'The border would touch another border.' };
      }
      // Nothing may be swept over: no vertex inside triangle (w, old, p), no edge of w inside the wedge.
      const o = orient(pw, old, p);
      if (o !== 0) {
        const tri = [pw, old, p];
        const lo2: Vec3 = [Math.min(...tri.map((q) => q[0])) - 1e-6, Math.min(...tri.map((q) => q[1])) - 1e-6, Math.min(...tri.map((q) => q[2])) - 1e-6];
        const hi2: Vec3 = [Math.max(...tri.map((q) => q[0])) + 1e-6, Math.max(...tri.map((q) => q[1])) + 1e-6, Math.max(...tri.map((q) => q[2])) + 1e-6];
        for (const x of this.vgrid.query(lo2, hi2)) {
          if (x === w || x === vid) continue;
          const px = this.v(x);
          if (orient(pw, old, px) === o && orient(old, p, px) === o && orient(p, pw, px) === o) return { ok: false, reason: 'The border would sweep over another border.' };
        }
        for (const sid of this.incident.get(w) ?? []) {
          if (incSet.has(sid)) continue;
          const s = this.segments.get(sid)!;
          const z = this.v(s.a === w ? s.b : s.a);
          if (orient(pw, old, z) === o && orient(pw, z, p) === o) return { ok: false, reason: 'The border would sweep over another border.' };
        }
      }
    }
    return { ok: true };
  }

  /** Move a vertex (geometry correction). Topology and face ids stay the same. */
  moveVertex(vid: number, p: Vec3, snap: number): void {
    const check = this.canMoveVertex(vid, p, snap);
    if (!check.ok) throw new TopologyError(check.reason);
    const [lon, lat] = vecToE7(p);
    const row = this.vertices.get(vid)!;
    this.putVertex({ ...row, lon, lat }); // also refreshes the incident segments' index boxes
  }

  /** Add a vertex in the middle of a segment (no topology change). */
  insertVertexOnSegment(segId: number, p: Vec3): number {
    const s = this.segments.get(segId);
    if (!s) throw new TopologyError('Unknown segment');
    const { closest } = distanceToArc(p, this.v(s.a), this.v(s.b));
    return this.splitSegmentAtPoint(segId, closest, MIN_SNAP);
  }

  /** Remove a vertex joining exactly two segments of the same border, if the straightened border stays valid. */
  removeVertex(vid: number): void {
    const inc = [...(this.incident.get(vid) ?? [])].map((sid) => this.segments.get(sid)!);
    if (inc.length !== 2) throw new TopologyError('Only a point joining two border sections can be removed.');
    const [s1, s2] = inc;
    const u = s1.a === vid ? s1.b : s1.a;
    const w = s2.a === vid ? s2.b : s2.a;
    if (u === w || this.segmentBetween(u, w) !== undefined) throw new TopologyError('Removing this point would collapse the border.');
    // Orient both halves as u -> vid -> w and read their labels.
    const l1 = s1.a === u ? s1.left_face : s1.right_face;
    const r1 = s1.a === u ? s1.right_face : s1.left_face;
    const l2 = s2.a === vid ? s2.left_face : s2.right_face;
    const r2 = s2.a === vid ? s2.right_face : s2.left_face;
    if (l1 !== l2 || r1 !== r2) throw new TopologyError('This point joins different borders.');
    // The straightened arc u->w must not cross anything or sweep over anything: same as moving vid onto the arc.
    const pu = this.v(u), pw = this.v(w);
    const pv = this.v(vid);
    const o = orient(pu, pv, pw);
    if (o !== 0) {
      const [lo, hi] = arcBox(pu, pw, 1e-6);
      const [lo2, hi2] = arcBox(pu, pv, 1e-6);
      const box: [Vec3, Vec3] = [
        [Math.min(lo[0], lo2[0], pv[0]), Math.min(lo[1], lo2[1], pv[1]), Math.min(lo[2], lo2[2], pv[2])],
        [Math.max(hi[0], hi2[0], pv[0]), Math.max(hi[1], hi2[1], pv[1]), Math.max(hi[2], hi2[2], pv[2])],
      ];
      for (const x of this.vgrid.query(box[0], box[1])) {
        if (x === u || x === w || x === vid) continue;
        const px = this.v(x);
        if (orient(pu, pv, px) === o && orient(pv, pw, px) === o && orient(pw, pu, px) === o) throw new TopologyError('Removing this point would sweep over another border.');
      }
      for (const sid of this.sgrid.query(box[0], box[1])) {
        if (sid === s1.id || sid === s2.id) continue;
        const s = this.segments.get(sid)!;
        if (s.a === u || s.b === u || s.a === w || s.b === w) {
          const other = this.v(s.a === u || s.a === w ? s.b : s.a);
          // Triangle (u, v, w) has orientation o; test the wedge at the shared corner.
          const inside = s.a === u || s.b === u
            ? orient(pu, pv, other) === o && orient(pu, other, pw) === o
            : orient(pw, pu, other) === o && orient(pw, other, pv) === o;
          if (inside) throw new TopologyError('Removing this point would sweep over another border.');
          continue;
        }
        if (arcsCross(pu, pw, this.v(s.a), this.v(s.b)) !== 'none') throw new TopologyError('Removing this point would cross another border.');
      }
    }
    this.deleteSegment(s1.id);
    this.deleteSegment(s2.id);
    const id = this.ids.next('segment');
    this.putSegment({ id, space_id: this.spaceId, a: u, b: w, left_face: l1, right_face: r1 });
    const row = this.vertices.get(vid)!;
    this.record('vertex', vid, { ...row }, null);
    this.unindexVertex(vid);
    this.incident.delete(vid);
  }

  // ---------------------------------------------------------------- validation (tests and health checks)

  validate(): string[] {
    const problems: string[] = [];
    const t = this.topology();
    for (const s of this.segments.values()) {
      for (const f of [s.left_face, s.right_face]) {
        const face = this.faces.get(f);
        if (!face) problems.push(`segment ${s.id} references missing face ${f}`);
        else if (!face.is_leaf) problems.push(`segment ${s.id} references non-leaf face ${f}`);
      }
      if (!this.vertices.has(s.a) || !this.vertices.has(s.b)) problems.push(`segment ${s.id} references a missing vertex`);
    }
    t.cycles.forEach((c, ci) => {
      const l = this.he(c[0], t).label;
      for (const h of c) if (this.he(h, t).label !== l) { problems.push(`cycle ${ci} has mixed face labels`); break; }
    });
    // No two segments may cross.
    for (const s of this.segments.values()) {
      const pa = this.v(s.a), pb = this.v(s.b);
      const [lo, hi] = arcBox(pa, pb, 0);
      for (const sid of this.sgrid.query(lo, hi)) {
        if (sid <= s.id) continue;
        const o = this.segments.get(sid)!;
        if (o.a === s.a || o.a === s.b || o.b === s.a || o.b === s.b) continue;
        if (arcsCross(pa, pb, this.v(o.a), this.v(o.b)) === 'cross') problems.push(`segments ${s.id} and ${sid} cross`);
      }
    }
    if (!this.faces.get(this.rootFace)?.is_leaf) problems.push(`root face ${this.rootFace} is not a leaf`);
    return problems;
  }

  /** All persistent rows (for saving or comparing). */
  rows(): { vertices: VertexRow[]; segments: SegmentRow[]; faces: FaceRow[]; rootFace: number } {
    return {
      vertices: [...this.vertices.values()].sort((a, b) => a.id - b.id).map((r) => ({ ...r })),
      segments: [...this.segments.values()].sort((a, b) => a.id - b.id).map((r) => ({ ...r })),
      faces: [...this.faces.values()].sort((a, b) => a.id - b.id).map((r) => ({ ...r })),
      rootFace: this.rootFace,
    };
  }
}
