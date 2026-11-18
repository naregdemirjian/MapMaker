// Conditions that spread over the terrain (Stage 9, D103): a fire, a flow of lava, a flood. Each is
// worked out once, on a grid of the ground around its source (its heights read from the world's
// terrain, sculpting included), and drawn at any moment from that grid:
//
// - a fire spreads from its source across the land at its pace (its size over the days it spreads,
//   after which it is held), faster uphill and downwind, unevenly (in tongues and lobes), never over
//   water or bare high mountains; each place burns from when the fire reaches it, with the source's
//   life (rising, lasting, fading) counted from then;
// - lava flows from its source downhill (only a little way up, to fill small hollows), faster on steep
//   ground, for the days it flows, and stops at the sea; each place glows from when it arrives and
//   cools with the source's life;
// - a flood raises the water at its source by its strength (metres) over the days it rises, and the
//   water fills the low ground around as it rises: a place floods once the water stands higher than
//   the lowest ridge between it and the source (its spill height), as deep as the water stands above
//   it; it recedes as the source fades. Towards the edge of its reach the ground counts as rising, so
//   the water stops along the lie of the land, not on a circle. The sea is never drawn as flooded.
import { heightAt, type ElevationGrid } from '../terrain/grid.ts';
import type { FieldSource } from './fields.ts';

export type SpreadKind = 'fire' | 'lava' | 'flood';
export const isSpreadKind = (v: unknown): v is SpreadKind => v === 'fire' || v === 'lava' || v === 'flood';

/**
 * A spread worked out: a grid of cells from its north-west corner (degrees), and two numbers a cell:
 * a fire's or lava's arrival (days from the source's start; NEVER where it does not reach), or a
 * flood's spill height and ground (metres above the ground at the source; NEVER for the sea).
 */
export interface SpreadRaster { kind: SpreadKind; west: number; north: number; dLon: number; dLat: number; width: number; height: number; data: Float32Array; key: string }
export const NEVER = 1e9;

/** A binary heap of cells by a float key, smallest first. */
class Heap {
  keys: Float64Array; items: Int32Array; size = 0;
  constructor(n: number) { this.keys = new Float64Array(n); this.items = new Int32Array(n); }
  push(key: number, item: number): void {
    if (this.size === this.keys.length) { const k = new Float64Array(this.size * 2), it = new Int32Array(this.size * 2); k.set(this.keys); it.set(this.items); this.keys = k; this.items = it; }
    let i = this.size++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.keys[p] <= key) break; this.keys[i] = this.keys[p]; this.items[i] = this.items[p]; i = p; }
    this.keys[i] = key; this.items[i] = item;
  }
  pop(): [number, number] {
    const topK = this.keys[0], topI = this.items[0], key = this.keys[--this.size], item = this.items[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= this.size) break;
      const c = r < this.size && this.keys[r] < this.keys[l] ? r : l;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c]; this.items[i] = this.items[c]; i = c;
    }
    this.keys[i] = key; this.items[i] = item;
    return [topK, topI];
  }
}

/** A fixed pseudo-random number (0 to 1) for a cell, from a seed. */
const hash = (k: number, seed: number) => { let h = (k * 374761393 + seed * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Cells a spread's grid has along each side. */
export const SPREAD_CELLS = 160;

/**
 * Works out how a source spreads from `centre` ([longitude, latitude]) over `grid` (heights; `gridKey`
 * names them) on a planet of `planetKm`. The grid covers the source's size around it.
 */
export function spreadRaster(kind: SpreadKind, s: FieldSource, centre: [number, number], grid: ElevationGrid, gridKey: string, planetKm: number, cells = SPREAD_CELLS): SpreadRaster {
  // (A fire or lava may outrun its size downwind or downhill: their grids reach twice as far.)
  const r = Math.max(0.05, s.radiusKm), rad = Math.PI / 180, span = kind === 'flood' ? r : 2 * r;
  const dLat = (2 * span / planetKm) / rad / cells, cos = Math.max(0.05, Math.cos(centre[1] * rad));
  const dLon = dLat / cos;
  const west = centre[0] - (cells / 2) * dLon, north = Math.min(90, centre[1] + (cells / 2) * dLat);
  const W = cells, H = cells, n = W * H;
  const ground = new Float32Array(n);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) ground[j * W + i] = heightAt(grid, west + (i + 0.5) * dLon, north - (j + 0.5) * dLat);
  const ci = Math.max(0, Math.min(W - 1, Math.floor((centre[0] - west) / dLon))), cj = Math.max(0, Math.min(H - 1, Math.floor((north - centre[1]) / dLat)));
  const c0 = cj * W + ci, g0 = ground[c0];
  const cellKm = (k: number) => [dLon * rad * planetKm * Math.max(0.05, Math.cos((north - ((k / W | 0) + 0.5) * dLat) * rad)), dLat * rad * planetKm];
  const data = new Float32Array(n * 2).fill(NEVER);
  const within = (k: number) => { const i = k % W, j = (k / W) | 0; return Math.hypot(i - ci, j - cj) <= cells / 2; };
  const heap = new Heap(n);
  const done = new Uint8Array(n);
  const NB: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  if (kind === 'flood') {
    // Spill heights: the lowest ridge between each cell and the source (a priority flood from it).
    const spill = new Float64Array(n).fill(Infinity);
    // The soft edge of its reach: the ground counts as rising over the outer fifth of the circle.
    const wall = (k: number) => { const u = Math.hypot((k % W) - ci, ((k / W) | 0) - cj) / (cells / 2); return u > 0.8 ? 4 * Math.max(10, s.intensity) * ((u - 0.8) / 0.2) ** 2 : 0; };
    spill[c0] = g0;
    heap.push(g0, c0);
    while (heap.size) {
      const [h, k] = heap.pop();
      if (done[k]) continue;
      done[k] = 1;
      const i = k % W, j = (k / W) | 0;
      for (const [di, dj] of NB) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const q = b * W + a;
        if (done[q] || !within(q)) continue;
        const v = Math.max(h, ground[q] + wall(q));
        if (v < spill[q]) { spill[q] = v; heap.push(v, q); }
      }
    }
    for (let k = 0; k < n; k++) {
      // (The sea itself is never drawn as flooded; it still carries the water around.)
      data[2 * k] = Number.isFinite(spill[k]) && ground[k] > 0 ? spill[k] - g0 : NEVER;
      data[2 * k + 1] = ground[k] - g0;
    }
  } else {
    // Arrival times: the quickest way from the source (Dijkstra), at the pace of each step, until it is
    // held (after the days it spreads). The pace varies smoothly from place to place (tongues and lobes).
    const days = Math.max(0.05, s.grow > 0 ? s.grow : 1), pace = r / days; // km a day on flat ground
    const lumpy = (k: number) => {
      const x = (k % W) / 7, y = ((k / W) | 0) / 7, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const at = (a: number, b: number) => hash(b * 4099 + a, s.seed);
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
    const wind = (s.windDeg * Math.PI) / 180, windPull = Math.min(1, s.windKmPerDay / 300);
    const arrival = new Float64Array(n).fill(Infinity);
    arrival[c0] = 0;
    heap.push(0, c0);
    while (heap.size) {
      const [t, k] = heap.pop();
      if (done[k]) continue;
      done[k] = 1;
      const i = k % W, j = (k / W) | 0, [ew, ns] = cellKm(k);
      // Lava runs down the steepest ways: only to the three lowest of the cells around (in tongues).
      let lowest = Infinity;
      if (kind === 'lava') {
        const hs: number[] = [];
        for (const [di, dj] of NB) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < W && b < H) hs.push(ground[b * W + a]); }
        hs.sort((x, y) => x - y);
        lowest = hs[Math.min(2, hs.length - 1)];
      }
      for (const [di, dj] of NB) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const q = b * W + a;
        if (done[q] || !within(q)) continue;
        const gq = ground[q], gk = ground[k];
        if (kind === 'lava' && gq > lowest) continue;
        if (gq <= 0) continue; // water stops it
        const dx = di * ew, dy = -dj * ns, dist = Math.hypot(dx, dy), slope = (gq - gk) / (dist * 1000);
        let speed: number;
        if (kind === 'fire') {
          if (gq > 4500) continue; // bare rock and ice: nothing to burn
          const along = Math.cos(Math.atan2(dx, dy) - wind);
          speed = pace * Math.max(0.3, Math.min(4, 1 + 3 * slope)) * Math.max(0.15, 1 + 2 * windPull * along) * (0.25 + 1.5 * lumpy(q)) * (0.85 + 0.3 * hash(q, s.seed));
          if (speed <= 0.02 * pace) continue;
        } else {
          if (gq > gk + 15) continue; // lava does not climb (beyond filling small hollows)
          speed = pace * (0.4 + Math.min(4, 6 * Math.max(0, -slope))) * (0.5 + lumpy(q)) * (0.85 + 0.3 * hash(q, s.seed));
        }
        const tq = t + dist / speed;
        if (tq <= days && tq < arrival[q]) { arrival[q] = tq; heap.push(tq, q); }
      }
    }
    for (let k = 0; k < n; k++) { data[2 * k] = Number.isFinite(arrival[k]) ? arrival[k] : NEVER; data[2 * k + 1] = 0; }
  }
  const key = `spread:${kind}:${gridKey}:${centre[0]},${centre[1]}:${planetKm}:${cells}:${s.radiusKm}:${s.grow}:${s.windDeg}:${s.windKmPerDay}:${s.seed}`;
  return { kind, west, north, dLon, dLat, width: W, height: H, data, key };
}

/**
 * A spread's two numbers at a place, between the four nearest cells' middles of those it reaches, and
 * how much of the four it reaches (0 to 1; its edge fades out across that). NEVER where it reaches none.
 */
function sample(g: SpreadRaster, lon: number, lat: number): { a: number; b: number; reach: number } {
  let l = lon;
  while (l < g.west - 180) l += 360;
  while (l > g.west + 180) l -= 360;
  const fx = (l - g.west) / g.dLon - 0.5, fy = (g.north - lat) / g.dLat - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > g.width - 0.5 || fy > g.height - 0.5) return { a: NEVER, b: 0, reach: 0 };
  const x0 = Math.max(0, Math.min(g.width - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(g.height - 1, Math.floor(fy)));
  const x1 = Math.min(g.width - 1, x0 + 1), y1 = Math.min(g.height - 1, y0 + 1), tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
  const v = (x: number, y: number, c: number) => g.data[2 * (y * g.width + x) + c];
  let w = 0, a = 0, b = 0;
  for (const [x, y, k] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]]) {
    if (v(x, y, 0) < NEVER / 2) { w += k; a += k * v(x, y, 0); b += k * v(x, y, 1); }
  }
  return w > 0 ? { a: a / w, b: b / w, reach: w } : { a: NEVER, b: 0, reach: 0 };
}

/** A spread's two numbers at a place (see SpreadRaster; NEVER where it does not reach). */
export function rasterAt(g: SpreadRaster, lon: number, lat: number): [number, number] {
  const { a, b } = sample(g, lon, lat);
  return [a, b];
}

/** A spread's value at a place `age` days after its source started (`strength`: the source's own life, see fields.ts). */
export function spreadValue(g: SpreadRaster, s: FieldSource, lon: number, lat: number, age: number, strength: (s: FieldSource, age: number) => number): number {
  const { a, b, reach } = sample(g, lon, lat);
  if (a >= NEVER / 2) return 0;
  const x = Math.max(0, Math.min(1, (reach - 0.2) / 0.6)), edge = x * x * (3 - 2 * x);
  if (g.kind === 'flood') {
    const level = s.intensity * strength(s, age);
    return a <= level ? Math.max(0, level - b) * edge : 0;
  }
  return s.intensity * strength(s, age - a) * edge;
}
