// A uniform hash grid over 3D unit-vector space, used to find nearby vertices and segments quickly.
// Works identically everywhere on the sphere (no seams at the poles or the 180° meridian).
// Very large items are kept in a separate list that every query returns; very large queries scan the
// occupied cells instead of enumerating empty ones.
import type { Vec3 } from './vec.ts';

const K = 1024;
const MAX_ITEM_CELLS = 4096;

export class SpatialGrid {
  readonly cell: number;
  /**
   * The items of each occupied cell, in the order they were put there (a cell holds a handful: a
   * list is quicker to make and to go through than a set, and opening a large map makes a hundred
   * thousand of them).
   */
  private cells = new Map<number, number[]>();
  /** The cells of each item: the one key of an item in a single cell (every point, most segments), else their list. */
  private keysOf = new Map<number, number | number[]>();
  private big = new Set<number>();
  // The cells of the box last asked about (kept here rather than in a new object for every question).
  private x0 = 0; private x1 = 0; private y0 = 0; private y1 = 0; private z0 = 0; private z1 = 0;

  constructor(cellSize = 1 / 128) {
    this.cell = cellSize;
  }

  private key(ix: number, iy: number, iz: number): number {
    return ((ix + K) * 2048 + (iy + K)) * 2048 + (iz + K);
  }

  /** Sets x0..z1 to the cells a box reaches into; returns how many there are. */
  private range(min: Vec3, max: Vec3): number {
    const c = this.cell;
    this.x0 = Math.floor(min[0] / c); this.x1 = Math.floor(max[0] / c);
    this.y0 = Math.floor(min[1] / c); this.y1 = Math.floor(max[1] / c);
    this.z0 = Math.floor(min[2] / c); this.z1 = Math.floor(max[2] / c);
    return (this.x1 - this.x0 + 1) * (this.y1 - this.y0 + 1) * (this.z1 - this.z0 + 1);
  }

  private put(k: number, id: number): void {
    const list = this.cells.get(k);
    if (list) list.push(id); else this.cells.set(k, [id]);
  }

  private take(k: number, id: number): void {
    const list = this.cells.get(k);
    if (!list) return;
    const i = list.indexOf(id);
    if (i < 0) return;
    // (The others keep their order, as they would in a set.)
    if (list.length === 1) this.cells.delete(k); else list.splice(i, 1);
  }

  insert(id: number, min: Vec3, max: Vec3): void {
    this.remove(id);
    const count = this.range(min, max);
    if (count > MAX_ITEM_CELLS) {
      this.big.add(id);
      return;
    }
    if (count === 1) {
      const k = this.key(this.x0, this.y0, this.z0);
      this.put(k, id);
      this.keysOf.set(id, k);
      return;
    }
    const keys: number[] = [];
    const { x0, x1, y0, y1, z0, z1 } = this;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = this.key(x, y, z);
      keys.push(k);
      this.put(k, id);
    }
    this.keysOf.set(id, keys);
  }

  remove(id: number): void {
    if (this.big.size) this.big.delete(id);
    const keys = this.keysOf.get(id);
    if (keys === undefined) return;
    if (typeof keys === 'number') this.take(keys, id); else for (const k of keys) this.take(k, id);
    this.keysOf.delete(id);
  }

  query(min: Vec3, max: Vec3): Set<number> {
    return this.queryInto(new Set<number>(), min, max);
  }

  /** As query, adding to a set the caller keeps (many small queries along a path share one set). */
  queryInto(out: Set<number>, min: Vec3, max: Vec3): Set<number> {
    for (const id of this.big) out.add(id);
    const count = this.range(min, max);
    const { x0, x1, y0, y1, z0, z1 } = this;
    if (count > this.cells.size) {
      for (const [k, s] of this.cells) {
        const iz = (k % 2048) - K;
        const iy = (Math.floor(k / 2048) % 2048) - K;
        const ix = Math.floor(k / (2048 * 2048)) - K;
        if (ix < x0 || ix > x1 || iy < y0 || iy > y1 || iz < z0 || iz > z1) continue;
        for (let i = 0; i < s.length; i++) out.add(s[i]);
      }
      return out;
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const s = this.cells.get(this.key(x, y, z));
      if (s) for (let i = 0; i < s.length; i++) out.add(s[i]);
    }
    return out;
  }

  clear(): void {
    this.cells.clear();
    this.keysOf.clear();
    this.big.clear();
  }
}

/** Bounding box of a great-circle arc, padded for the arc's bulge and an extra margin (radians, approx). */
export function arcBox(a: Vec3, b: Vec3, margin: number): [Vec3, Vec3] {
  const chord = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Every point of the arc lies within 1 - cos(theta/2) of its chord, where sin(theta/2) = chord/2.
  const pad = 1 - Math.sqrt(Math.max(0, 1 - (chord * chord) / 4)) + margin + 1e-12;
  return [
    [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.min(a[2], b[2]) - pad],
    [Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, Math.max(a[2], b[2]) + pad],
  ];
}

export function pointBox(p: Vec3, margin: number): [Vec3, Vec3] {
  return [
    [p[0] - margin, p[1] - margin, p[2] - margin],
    [p[0] + margin, p[1] + margin, p[2] + margin],
  ];
}
