// Rivers that flow downhill (Stage 8, D99): worked out from a world's heights, for generated planets
// (Earth's come from Natural Earth). Every cell of land drains to one of its eight neighbours, the one
// the water reaches the sea by; hollows are filled first (priority flood: from the coast inland, in
// order of height), so water never gets stuck and every river reaches the sea. Water gathers
// downstream (each cell adds the rain on it, by its area); where enough has gathered there is a river.
// Rivers are traced from their sources to the sea or to the river they join, and ranked by how much
// water they carry where they end (0 the greatest, as Natural Earth's scalerank).
import type { ElevationGrid } from './grid.ts';

export interface RiverLines {
  /** Each river as [longitude, latitude] points, from its source downstream. */
  lines: GeoJSON.MultiLineString;
  /** How great each river is: 0 the greatest to 9 the least (as Natural Earth's ranks). */
  ranks: number[];
}

/** A binary heap of cells by height (a float32 key each), smallest first. */
class Heap {
  private keys: Float32Array; private items: Int32Array; size = 0;
  constructor(capacity: number) { this.keys = new Float32Array(capacity); this.items = new Int32Array(capacity); }
  push(key: number, item: number): void {
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p]; this.items[i] = this.items[p]; i = p;
    }
    this.keys[i] = key; this.items[i] = item;
  }
  pop(): number {
    const top = this.items[0], key = this.keys[--this.size], item = this.items[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= this.size) break;
      const c = r < this.size && this.keys[r] < this.keys[l] ? r : l;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c]; this.items[i] = this.items[c]; i = c;
    }
    this.keys[i] = key; this.items[i] = item;
    return top;
  }
}

/**
 * The water that runs off a world's land (D271), for rivers that follow its rain: millimetres a year on a grid laid
 * like the heights (any size), with the planet's radius and the length of its year, so that the water gathered is a
 * flow in cubic metres a second.
 */
export interface RiverRain { width: number; height: number; data: Float32Array; radiusKm: number; yearSeconds: number; key: string }
/** The least flow (m³/s) drawn as a river where the rain is known (D271): about that of a middling river (the Thames carries 65, the Seine 500). */
export const RIVER_MIN_FLOW = 150;

/**
 * The rivers of a world. `share`: the share of the land that carries a river (by the water gathered
 * there): about 1.5% gives the main rivers of each continent and their larger branches. `rain` (D271): the water
 * that runs off each place; given, each cell adds what runs off it (not the same everywhere), and only a flow of
 * `RIVER_MIN_FLOW` or more is a river: none in a desert, none on a world where nothing rains.
 */
export function riversOf(grid: ElevationGrid, share = 0.015, rain: RiverRain | null = null): RiverLines {
  const { width: W, height: H, data, step } = grid, n = W * H;
  const receiver = new Int32Array(n).fill(-1);
  const filled = new Float32Array(n);
  const done = new Uint8Array(n);
  const order = new Int32Array(n);
  let count = 0;
  const heap = new Heap(n);
  // The sea is where the water goes: every sea cell next to land starts the flood.
  let land = 0;
  for (let k = 0; k < n; k++) {
    const e = data[k] * step;
    if (e <= 0) { done[k] = 1; continue; }
    land++;
  }
  if (!land || land === n) return { lines: { type: 'MultiLineString', coordinates: [] }, ranks: [] };
  const neighbours = (k: number, out: Int32Array): number => {
    const j = (k / W) | 0, i = k - j * W;
    let m = 0;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj;
      if (jj < 0 || jj >= H) continue;
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        out[m++] = jj * W + ((i + di + W) % W);
      }
    }
    return m;
  };
  const nb = new Int32Array(8);
  for (let k = 0; k < n; k++) {
    if (!done[k]) continue;
    const m = neighbours(k, nb);
    for (let q = 0; q < m; q++) if (!done[nb[q]]) { heap.push(0, k); break; }
  }
  // Priority flood: the lowest cell reached so far lets the water of its unreached neighbours out.
  while (heap.size) {
    const k = heap.pop();
    const m = neighbours(k, nb);
    for (let q = 0; q < m; q++) {
      const a = nb[q];
      if (done[a]) continue;
      done[a] = 1;
      receiver[a] = k;
      filled[a] = Math.max(data[a] * step, filled[k] + 1e-3);
      order[count++] = a;
      heap.push(filled[a], a);
    }
  }
  // Water gathers downstream: from the last cell reached (the highest) to the first.
  const water = new Float32Array(n);
  if (rain) {
    // (Each cell's own run-off as a flow: mm a year over its area, in m³/s.)
    const R = rain.radiusKm * 1000, cell = ((Math.PI / H) * R) * (((2 * Math.PI) / W) * R) / rain.yearSeconds / 1000;
    for (let k = 0; k < n; k++) {
      if (receiver[k] < 0) continue;
      const j = (k / W) | 0, i = k - j * W;
      const rj = Math.min(rain.height - 1, Math.floor(((j + 0.5) / H) * rain.height)), ri = Math.min(rain.width - 1, Math.floor(((i + 0.5) / W) * rain.width));
      water[k] = Math.max(0, rain.data[rj * rain.width + ri]) * cell * Math.cos(Math.PI / 2 - ((j + 0.5) / H) * Math.PI);
    }
  } else for (let k = 0; k < n; k++) if (receiver[k] >= 0) water[k] = Math.cos(Math.PI / 2 - (((k / W) | 0) + 0.5) / H * Math.PI);
  for (let c = count - 1; c >= 0; c--) { const a = order[c], r = receiver[a]; if (r >= 0 && receiver[r] >= 0) water[r] += water[a]; }
  // A river where the water gathered is among the most of all land.
  const sorted = Float32Array.from(order.subarray(0, count), (a) => water[a]).sort();
  const threshold = Math.max(rain ? RIVER_MIN_FLOW : 0, sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - share) * sorted.length)))]);
  const isRiver = (k: number) => receiver[k] >= 0 && water[k] >= threshold;
  // Sources: river cells no river cell flows into.
  const fed = new Uint8Array(n);
  for (let c = 0; c < count; c++) { const a = order[c]; if (isRiver(a) && receiver[a] >= 0) fed[receiver[a]] = 1; }
  const traced = new Uint8Array(n);
  const lonOf = (k: number) => -180 + ((k % W) + 0.5) * (360 / W), latOf = (k: number) => 90 - (((k / W) | 0) + 0.5) * (180 / H);
  const lines: GeoJSON.Position[][] = [], ranks: number[] = [];
  const most = sorted[sorted.length - 1];
  for (let c = count - 1; c >= 0; c--) {
    const s = order[c];
    if (!isRiver(s) || fed[s] || traced[s]) continue;
    // Down from the source, until the sea or a river already traced (which it joins).
    const pts: GeoJSON.Position[] = [];
    // (`mouth`: its last cell of its own, before the sea or the river it joins.)
    let k = s, mouth = s, prevLon = lonOf(s);
    while (k >= 0) {
      let lon = lonOf(k);
      // (Longitudes kept continuous across the 180th meridian.)
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
      pts.push([lon, latOf(k)]);
      prevLon = lon;
      if (traced[k] || receiver[k] < 0) break;
      traced[k] = 1;
      mouth = k;
      k = receiver[k];
    }
    if (pts.length < 3) continue;
    lines.push(pts);
    // Ranked by the water it carries at its mouth: the greatest 0, a tenth of that 3, a hundredth 6.
    ranks.push(Math.max(0, Math.min(9, Math.round(-3 * Math.log10(Math.max(1e-9, water[mouth] / most))))));
  }
  return { lines: { type: 'MultiLineString', coordinates: lines }, ranks };
}
