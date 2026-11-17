// After an edit the kernel works out the faces only around what changed. That must give exactly the
// faces, ids and labels of the whole-map rebuild: two maps are fed the same random edits, one forced
// each way, and compared row for row after every step (insertions, refused edits, point edits, undo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Arrangement, type IdSource, type KernelTable, type KernelDiff } from '../src/geo-kernel/arrangement.ts';
import { type Vec3, lonLatToVec, slerp, dot, cross } from '../src/geo-kernel/vec.ts';
import { rng } from './helpers.ts';

type Mode = 'full' | 'incremental';

class Twin {
  readonly arr: Arrangement;
  readonly n: Record<KernelTable, number> = { vertex: 0, segment: 0, face: 0 };
  readonly history: KernelDiff[] = [];
  readonly mode: Mode;
  constructor(mode: Mode, referenced: (f: number) => boolean) {
    this.mode = mode;
    const ids: IdSource = { next: (t) => ++this.n[t] };
    this.arr = Arrangement.createEmpty('s', ids).arrangement;
    this.arr.isReferenced = referenced;
  }
  /** Run an edit; returns the error message if it was refused (and rolled back). */
  run(fn: (a: Arrangement) => void): string | null {
    Arrangement.faceRebuild = this.mode;
    this.arr.begin();
    try {
      fn(this.arr);
      this.history.push(this.arr.commit());
      return null;
    } catch (e) {
      this.arr.rollback();
      return (e as Error).message;
    } finally {
      Arrangement.faceRebuild = 'auto';
    }
  }
  undo(): boolean {
    const d = this.history.pop();
    if (!d) return false;
    for (const c of [...d.changes].reverse()) this.arr.applyRowChange(c.table, c.after, c.before);
    if (d.rootFace) this.arr.rootFace = d.rootFace.before;
    return true;
  }
}

function randomRing(r: ReturnType<typeof rng>, where: 'anywhere' | 'cluster'): Vec3[] {
  const cLon = where === 'cluster' ? r.float(-30, 30) : r.float(-180, 180);
  const cLat = where === 'cluster' ? r.float(-20, 20) : r.pick([r.float(-89, 89), r.float(70, 89.9), r.float(-89.9, -70)]);
  const c = lonLatToVec(cLon, cLat);
  const rad = where === 'cluster' ? r.pick([r.float(0.3, 3), r.float(3, 14), r.float(14, 40)]) : r.pick([r.float(0.01, 0.5), r.float(1, 15), r.float(15, 60)]);
  const nv = r.int(3, 11);
  const e: Vec3 = Math.abs(c[2]) > 0.999 ? [0, 1, 0] : ([-c[1], c[0], 0].map((x) => x / Math.hypot(c[0], c[1])) as Vec3);
  const nn = cross(c, e);
  const corners: Vec3[] = [];
  for (let i = 0; i < nv; i++) {
    const ang = (2 * Math.PI * i) / nv + r.float(-0.25, 0.25);
    const t = (rad * r.float(0.5, 1) * Math.PI) / 180;
    const dir: Vec3 = [e[0] * Math.cos(ang) + nn[0] * Math.sin(ang), e[1] * Math.cos(ang) + nn[1] * Math.sin(ang), e[2] * Math.cos(ang) + nn[2] * Math.sin(ang)];
    corners.push([c[0] * Math.cos(t) + dir[0] * Math.sin(t), c[1] * Math.cos(t) + dir[1] * Math.sin(t), c[2] * Math.cos(t) + dir[2] * Math.sin(t)]);
  }
  const pts: Vec3[] = [];
  for (let i = 0; i < nv; i++) {
    const a = corners[i], b = corners[(i + 1) % nv];
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
    const m = Math.max(1, Math.ceil(ang / 2));
    for (let j = 0; j < m; j++) pts.push(slerp(a, b, j / m));
  }
  return pts;
}

export function compareRebuilds(seed: number, steps: number, where: 'anywhere' | 'cluster'): { edits: number; refused: number; faces: number } {
  // Some faces count as referenced by history, some not (both id rules are exercised).
  const referenced = (f: number) => (f * 2654435761 >>> 0) % 3 !== 0;
  const twins = [new Twin('full', referenced), new Twin('incremental', referenced)];
  const r = rng(seed * 104729 + (where === 'cluster' ? 17 : 0));
  let edits = 0, refused = 0;
  const same = (what: string) => {
    const [a, b] = twins.map((t) => t.arr.rows());
    assert.deepEqual(b.faces, a.faces, `${what}: faces`);
    assert.deepEqual(b.segments, a.segments, `${what}: segment labels`);
    assert.deepEqual(b.vertices, a.vertices, `${what}: vertices`);
    assert.equal(b.rootFace, a.rootFace, `${what}: root face`);
  };
  for (let step = 0; step < steps; step++) {
    const op = r.float(0, 1);
    const what = `seed ${seed} step ${step}`;
    let results: Array<string | null> | null = null;
    if (op < 0.5) {
      const pts = randomRing(r, where), snap = r.pick([1e-8, 1e-7, 1e-6, 1e-5]);
      results = twins.map((t) => t.run((a) => { a.insertPath(pts, { closed: true, snap }); }));
    } else if (op < 0.6) {
      // Several outlines in one operation (as when countries are imported).
      const rings = [randomRing(r, where), randomRing(r, where), randomRing(r, where)];
      results = twins.map((t) => t.run((a) => { a.insertPaths(rings, { closed: true, snap: 1e-7 }); }));
    } else if (op < 0.7) {
      // An open line (a border that does not close): spikes and bridges.
      const pts = randomRing(r, where).slice(0, r.int(2, 6));
      results = twins.map((t) => t.run((a) => { a.insertPath(pts, { closed: false, snap: 1e-7 }); }));
    } else if (op < 0.78) {
      const arr = twins[0].arr;
      const vs = [...arr.vertices.keys()];
      if (!vs.length) continue;
      const vid = r.pick(vs), v = arr.vertices.get(vid)!;
      const to = lonLatToVec(v.lon / 1e7 + r.float(-0.3, 0.3), Math.max(-89.9, Math.min(89.9, v.lat / 1e7 + r.float(-0.3, 0.3))));
      results = twins.map((t) => t.run((a) => { a.moveVertex(vid, to, 1e-7); }));
    } else if (op < 0.84) {
      const arr = twins[0].arr;
      const ss = [...arr.segments.values()];
      if (!ss.length) continue;
      const s = r.pick(ss);
      const pa = arr.v(s.a), pb = arr.v(s.b);
      const mid = slerp(pa, pb, 0.5);
      results = twins.map((t) => t.run((a) => { a.insertVertexOnSegment(s.id, mid); }));
    } else if (op < 0.9) {
      const arr = twins[0].arr;
      const vs = [...arr.vertices.keys()].filter((v) => [...arr.segments.values()].filter((s) => s.a === v || s.b === v).length === 2);
      if (!vs.length) continue;
      const vid = r.pick(vs);
      results = twins.map((t) => t.run((a) => { a.removeVertex(vid); }));
    } else {
      const done = twins.map((t) => t.undo());
      assert.equal(done[0], done[1]);
      same(`${what} (undo)`);
      continue;
    }
    assert.equal(results[1], results[0], `${what}: both accept or both refuse`);
    if (results[0] === null) edits++; else refused++;
    same(what);
    if (step % 10 === 9) assert.deepEqual(twins[1].arr.validate(), [], `${what}: valid`);
  }
  assert.deepEqual(twins[1].arr.validate(), [], `seed ${seed}: valid at the end`);
  assert.deepEqual(twins[1].arr.checkTopology(), [], `seed ${seed}: structure equals a rebuild`);
  const leaves = twins[1].arr.leafFaces();
  const total = leaves.reduce((s, f) => s + twins[1].arr.faceArea(f), 0);
  assert.ok(Math.abs(total - 4 * Math.PI) < 1e-6, `seed ${seed}: face areas sum to the sphere (${total})`);
  return { edits, refused, faces: leaves.length };
}

for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`faces rebuilt around an edit equal a whole-map rebuild: scattered shapes (seed ${seed})`, () => {
    const res = compareRebuilds(seed, 60, 'anywhere');
    assert.ok(res.edits > 20, `${res.edits} edits`);
  });
  test(`faces rebuilt around an edit equal a whole-map rebuild: shapes piled on one another (seed ${seed})`, () => {
    const res = compareRebuilds(seed, 60, 'cluster');
    assert.ok(res.edits > 20 && res.faces > 20, `${res.edits} edits, ${res.faces} faces`);
  });
}
