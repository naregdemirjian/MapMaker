// The planetary engine's mesh (Stage 14, D152): the subdivided icosahedron's cells, areas and neighbours, exact
// point location, the finite-volume operators' accuracy, moving fields between levels, and drawing fields on
// longitude/latitude grids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshAt, cellsAt, locate, nearestBrute, unitOf, triArea } from '../src/planet/mesh/icosphere.ts';
import { laplacian, gradient, advectUpwind, integral, mean, diffuse } from '../src/planet/mesh/operators.ts';
import { prolong, restrict, toLevel, rasterize, rasterizeNearest, sampleGrid, rasterMap } from '../src/planet/mesh/transfer.ts';
import { random } from '../src/terrain/planet.ts';

test('cells, faces, areas and neighbours at every level', () => {
  for (let L = 0; L <= 6; L++) {
    const m = meshAt(L);
    assert.equal(m.n, cellsAt(L));
    assert.equal(m.levels[L].length / 3, 20 * 4 ** L, 'faces');
    // Euler: V − E + F = 2, with E = Σ degree / 2.
    assert.equal(m.n - m.nbr.length / 2 + m.levels[L].length / 3, 2);
    let total = 0, pent = 0;
    for (let i = 0; i < m.n; i++) {
      total += m.area[i];
      const d = m.nbrStart[i + 1] - m.nbrStart[i];
      if (d === 5) pent++; else assert.equal(d, 6);
      assert.ok(Math.abs(Math.hypot(m.xyz[3 * i], m.xyz[3 * i + 1], m.xyz[3 * i + 2]) - 1) < 1e-12);
      for (let k = m.nbrStart[i]; k < m.nbrStart[i + 1]; k++) {
        const j = m.nbr[k];
        let back = -1;
        for (let q = m.nbrStart[j]; q < m.nbrStart[j + 1]; q++) if (m.nbr[q] === i) back = q;
        assert.ok(back >= 0, 'neighbours are mutual');
        assert.ok(Math.abs(m.edgeLen[back] - m.edgeLen[k]) < 1e-12 && Math.abs(m.edgeDist[back] - m.edgeDist[k]) < 1e-12, 'shared edges agree');
      }
      // Counter-clockwise: consecutive neighbours turn left around the cell.
      const s = m.nbrStart[i], P = (c: number) => [m.xyz[3 * c], m.xyz[3 * c + 1], m.xyz[3 * c + 2]] as [number, number, number];
      const a = P(m.nbr[s]), b = P(m.nbr[s + 1]), o = P(i);
      const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      assert.ok(cr[0] * o[0] + cr[1] * o[1] + cr[2] * o[2] > 0, 'neighbours counter-clockwise');
    }
    assert.ok(Math.abs(total - 4 * Math.PI) < 1e-10, `areas sum to 4π at level ${L}`);
    assert.equal(pent, 12, 'twelve pentagons');
    // The levels nest: the coarser level's cells are the first cells, at the same places.
    if (L > 0) {
      const c = meshAt(L - 1);
      for (let i = 0; i < c.n; i += 7) for (let k = 0; k < 3; k++) assert.equal(m.xyz[3 * i + k], c.xyz[3 * i + k]);
    }
  }
  // Areas are even: the largest cell at most 1.4 times the smallest.
  const m = meshAt(6);
  assert.ok(Math.max(...m.area) / Math.min(...m.area) < 1.4);
  assert.ok(Math.abs(triArea([1, 0, 0], [0, 1, 0], [0, 0, 1]) - Math.PI / 2) < 1e-12, 'an octant');
});

test('point location is exact against brute force, and its weights interpolate linearly', () => {
  const m = meshAt(5), rnd = random(11);
  for (let k = 0; k < 3000; k++) {
    const lon = rnd() * 360 - 180, lat = (Math.asin(rnd() * 2 - 1) * 180) / Math.PI;
    const p = unitOf(lon, lat), r = locate(m, p);
    const b = nearestBrute(m, p), dot = (c: number) => p[0] * m.xyz[3 * c] + p[1] * m.xyz[3 * c + 1] + p[2] * m.xyz[3 * c + 2];
    assert.ok(Math.abs(dot(r.nearest) - dot(b)) < 1e-12, 'the nearest cell');
    assert.ok(Math.abs(r.weights[0] + r.weights[1] + r.weights[2] - 1) < 1e-12 && Math.min(...r.weights) >= 0);
    // A linear function of position is interpolated to within the face's flatness.
    const f = (c: number) => 2 * m.xyz[3 * c] - m.xyz[3 * c + 2];
    const v = r.weights[0] * f(r.cells[0]) + r.weights[1] * f(r.cells[1]) + r.weights[2] * f(r.cells[2]);
    assert.ok(Math.abs(v - (2 * p[0] - p[2])) < 2e-3);
  }
  // The poles and the antimeridian.
  for (const [lon, lat] of [[0, 90], [0, -90], [180, 0], [-180, 12], [179.999, -45]]) {
    const p = unitOf(lon, lat);
    assert.equal(locate(m, p).nearest, nearestBrute(m, p));
  }
});

test('the operators: Laplacian of spherical harmonics, gradient, conservation', () => {
  for (const L of [4, 5, 6]) {
    const m = meshAt(L);
    const f = new Float64Array(m.n), z = new Float64Array(m.n);
    for (let i = 0; i < m.n; i++) { z[i] = m.xyz[3 * i + 2]; f[i] = 3 * z[i] * z[i] - 1; }
    const lap = laplacian(m, f);
    let rms = 0, over = 0;
    for (let i = 0; i < m.n; i++) { const e = (lap[i] + 6 * f[i]) / 6; rms += e * e; if (Math.abs(e) > 0.05) over++; }
    rms = Math.sqrt(rms / m.n);
    // First-order accurate on this mesh (bisection icosahedra): the mean error halves at each level, the worst stays
    // near 4 per cent at a few cells along the icosahedron's seams.
    assert.ok(rms < 0.08 / 2 ** L, `Laplacian rms error ${rms} at level ${L}`);
    assert.equal(over, 0, 'no cell over 5 per cent');
    assert.ok(Math.abs(integral(m, lap)) < 1e-12, 'the Laplacian conserves (fluxes cancel)');
    const g = gradient(m, z);
    let gr = 0;
    for (let i = 0; i < m.n; i++) {
      const x = m.xyz[3 * i], y = m.xyz[3 * i + 1], zz = m.xyz[3 * i + 2];
      gr += (g[3 * i] + zz * x) ** 2 + (g[3 * i + 1] + zz * y) ** 2 + (g[3 * i + 2] - (1 - zz * zz)) ** 2;
      assert.ok(Math.abs(g[3 * i] * x + g[3 * i + 1] * y + g[3 * i + 2] * zz) < 1e-12, 'gradients are tangent');
    }
    assert.ok(Math.sqrt(gr / m.n) < 0.2 / 2 ** L, 'gradient of z');
  }
  // Transport by a solid-body rotation keeps the total exactly; diffusion keeps it and smooths.
  const m = meshAt(5), f = new Float64Array(m.n), u = new Float64Array(3 * m.n);
  for (let i = 0; i < m.n; i++) {
    f[i] = Math.exp(-((m.lat[i] - 0.3) ** 2 + (m.lon[i] - 1) ** 2) * 20);
    u[3 * i] = -m.xyz[3 * i + 1]; u[3 * i + 1] = m.xyz[3 * i];
  }
  const before = integral(m, f);
  let g: Float64Array = f;
  for (let s = 0; s < 20; s++) g = advectUpwind(m, g, u, 0.01);
  assert.ok(Math.abs(integral(m, g) - before) < 1e-12 * Math.max(1, before));
  assert.ok(Math.min(...g) >= -1e-12, 'upwind keeps positive values positive');
  const h = diffuse(m, f, 1e-5);
  assert.ok(Math.abs(integral(m, h) - before) < 1e-12 && Math.max(...h) < Math.max(...f));
  assert.ok(Math.abs(mean(m, new Float64Array(m.n).fill(2)) - 2) < 1e-12);
});

test('moving fields between levels keeps constants and totals', () => {
  const fine = meshAt(6), coarse = meshAt(5);
  const c = new Float64Array(coarse.n).fill(3.25);
  assert.ok(prolong(fine, c).every((v) => v === 3.25));
  assert.ok(restrict(fine, new Float64Array(fine.n).fill(-2)).every((v) => Math.abs(v + 2) < 1e-12));
  const f = new Float64Array(fine.n);
  for (let i = 0; i < fine.n; i++) f[i] = 1 + fine.xyz[3 * i + 2] + 0.5 * Math.sin(3 * fine.lon[i]) * Math.cos(fine.lat[i]);
  const r = restrict(fine, f);
  assert.ok(Math.abs(integral(coarse, r) - integral(fine, f)) < 1e-3 * integral(fine, f), 'the total is kept closely');
  // Down and up again stays close for smooth fields; levels further apart work step by step.
  const back = prolong(fine, r);
  let e = 0;
  for (let i = 0; i < fine.n; i++) e = Math.max(e, Math.abs(back[i] - f[i]));
  assert.ok(e < 0.02, `restrict then prolong: ${e}`);
  assert.equal(toLevel(c, 5, 3).length, cellsAt(3));
  assert.equal(toLevel(new Float64Array(cellsAt(3)), 3, 6).length, fine.n);
});

test('fields drawn on grids, and grids read back onto the mesh', () => {
  const m = meshAt(5);
  const f = new Float64Array(m.n);
  for (let i = 0; i < m.n; i++) f[i] = 10 * m.xyz[3 * i + 2] + 3 * m.xyz[3 * i];
  for (const [w, h] of [[360, 180], [256, 128], [97, 41]]) {
    const map = rasterMap(m, w, h);
    assert.ok(map.face.every((x) => x >= 0), 'every pixel has its face');
    const ras = rasterize(m, f, w, h);
    // Every pixel holds the linear function at its centre, closely.
    for (let j = 0; j < h; j += 7) for (let i = 0; i < w; i += 5) {
      const lat = (Math.PI / 2) - ((j + 0.5) * Math.PI) / h, lon = -Math.PI + ((i + 0.5) * 2 * Math.PI) / w;
      const want = 10 * Math.sin(lat) + 3 * Math.cos(lat) * Math.cos(lon);
      assert.ok(Math.abs(ras[j * w + i] - want) < 0.02, `pixel ${i},${j}: ${ras[j * w + i]} for ${want}`);
    }
    const back = sampleGrid(m, ras, w, h);
    let e = 0;
    for (let i = 0; i < m.n; i++) if (Math.abs(m.lat[i]) < 1.4) e = Math.max(e, Math.abs(back[i] - f[i]));
    assert.ok(e < 0.6 * (360 / w) * 0.2 + 0.02, `round trip ${e}`);
  }
  // Categories take the nearest cell's value, unblended.
  const cat = new Uint8Array(m.n);
  for (let i = 0; i < m.n; i++) cat[i] = m.lat[i] > 0 ? 1 : 2;
  const out = rasterizeNearest(m, cat, 64, 32, new Uint8Array(64 * 32));
  assert.ok(out.every((v) => v === 1 || v === 2));
  assert.equal(out[0], 1);
  assert.equal(out[64 * 31], 2);
});
