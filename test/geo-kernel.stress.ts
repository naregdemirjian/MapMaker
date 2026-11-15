// Heavier randomised stress run for the parcel map kernel (not part of the quick suite).
// Usage: node test/geo-kernel.stress.ts [seeds] [ringsPerSeed]
import { geoContains } from 'd3-geo';
import { Arrangement, type IdSource, type KernelTable } from '../src/geo-kernel/arrangement.ts';
import { type Vec3, lonLatToVec, slerp, dot, cross } from '../src/geo-kernel/vec.ts';
import { rng } from './helpers.ts';

const seeds = Number(process.argv[2] ?? 6);
const rings = Number(process.argv[3] ?? 40);
let failures = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const n: Record<KernelTable, number> = { vertex: 0, segment: 0, face: 0 };
  const ids: IdSource = { next: (t) => ++n[t] };
  const { arrangement: arr } = Arrangement.createEmpty('s', ids);
  const r = rng(seed * 7919);
  const t0 = performance.now();
  let refused = 0;
  for (let k = 0; k < rings; k++) {
    const cLon = r.float(-180, 180), cLat = r.pick([r.float(-89, 89), r.float(70, 89.9), r.float(-89.9, -70)]);
    const c = lonLatToVec(cLon, cLat);
    const rad = r.pick([r.float(0.01, 0.5), r.float(1, 15), r.float(15, 60)]);
    const nv = r.int(3, 12);
    const pts: Vec3[] = [];
    const e: Vec3 = Math.abs(c[2]) > 0.999 ? [0, 1, 0] : ([-c[1], c[0], 0].map((x) => x / Math.hypot(c[0], c[1])) as Vec3);
    const nn = cross(c, e);
    const corners: Vec3[] = [];
    for (let i = 0; i < nv; i++) {
      const ang = (2 * Math.PI * i) / nv + r.float(-0.25, 0.25);
      const t = (rad * r.float(0.5, 1) * Math.PI) / 180;
      const dir: Vec3 = [e[0] * Math.cos(ang) + nn[0] * Math.sin(ang), e[1] * Math.cos(ang) + nn[1] * Math.sin(ang), e[2] * Math.cos(ang) + nn[2] * Math.sin(ang)];
      corners.push([c[0] * Math.cos(t) + dir[0] * Math.sin(t), c[1] * Math.cos(t) + dir[1] * Math.sin(t), c[2] * Math.cos(t) + dir[2] * Math.sin(t)]);
    }
    for (let i = 0; i < nv; i++) {
      const a = corners[i], b = corners[(i + 1) % nv];
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
      const m = Math.max(1, Math.ceil(ang / 1));
      for (let j = 0; j < m; j++) pts.push(slerp(a, b, j / m));
    }
    arr.begin();
    try {
      arr.insertPath(pts, { closed: true, snap: r.pick([1e-8, 1e-7, 1e-6, 1e-5]) });
      arr.commit();
    } catch (err) {
      arr.rollback();
      refused++;
      if (!(err instanceof Error) || !/too small/.test(err.message)) { console.log(`seed ${seed} ring ${k}: ${(err as Error).message}`); failures++; }
    }
    const problems = arr.validate();
    if (problems.length) { console.log(`seed ${seed} ring ${k}:`, problems.slice(0, 5)); failures++; break; }
  }
  const leaves = arr.leafFaces();
  const total = leaves.reduce((s, f) => s + arr.faceArea(f), 0);
  if (Math.abs(total - 4 * Math.PI) > 1e-6) { console.log(`seed ${seed}: area sum ${total}`); failures++; }
  const polys = new Map(leaves.map((f) => {
    const rr = arr.faceRingsLonLat(f);
    return [f, rr.length ? { type: 'Polygon', coordinates: rr.map((x) => { const y = [...x].reverse(); y.push(y[0]); return y; }) } as GeoJSON.Polygon : null];
  }));
  let mismatch = 0;
  for (let i = 0; i < 400; i++) {
    const lon = r.float(-180, 180), lat = r.float(-89.5, 89.5);
    const f = arr.locate(lonLatToVec(lon, lat));
    const p = polys.get(f);
    if (p && !geoContains(p, [lon, lat])) mismatch++;
  }
  if (mismatch) { console.log(`seed ${seed}: ${mismatch} point-location mismatches`); failures++; }
  console.log(`seed ${seed}: ${leaves.length} faces, ${arr.segments.size} segments, ${refused} refused, ${(performance.now() - t0).toFixed(0)} ms`);
}
console.log(failures ? `FAILURES: ${failures}` : 'stress OK');
process.exit(failures ? 1 : 0);
