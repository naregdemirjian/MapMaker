// A uniform hash grid over 3D unit-vector space, used to find nearby vertices and segments quickly.
// Works identically everywhere on the sphere (no seams at the poles or the 180° meridian).
// Very large items are kept in a separate list that every query returns; very large queries scan the
// occupied cells instead of enumerating empty ones.
import type { Vec3 } from './vec.ts';

const K = 1024;
const MAX_ITEM_CELLS = 4096;

export class SpatialGrid {
  readonly cell: number;
  private cells = new Map<number, Set<number>>();
  private keysOf = new Map<number, number[]>();
  private big = new Set<number>();

  constructor(cellSize = 1 / 128) {
    this.cell = cellSize;
  }

  private key(ix: number, iy: number, iz: number): number {
    return ((ix + K) * 2048 + (iy + K)) * 2048 + (iz + K);
  }

  private range(min: Vec3, max: Vec3) {
    const c = this.cell;
    const r = {
      x0: Math.floor(min[0] / c), x1: Math.floor(max[0] / c),
      y0: Math.floor(min[1] / c), y1: Math.floor(max[1] / c),
      z0: Math.floor(min[2] / c), z1: Math.floor(max[2] / c),
    };
    const count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) * (r.z1 - r.z0 + 1);
    return { ...r, count };
  }

  insert(id: number, min: Vec3, max: Vec3): void {
    this.remove(id);
    const r = this.range(min, max);
    if (r.count > MAX_ITEM_CELLS) {
      this.big.add(id);
      return;
    }
    const keys: number[] = [];
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) for (let z = r.z0; z <= r.z1; z++) {
      const k = this.key(x, y, z);
      keys.push(k);
      let s = this.cells.get(k);
      if (!s) this.cells.set(k, (s = new Set()));
      s.add(id);
    }
    this.keysOf.set(id, keys);
  }

  remove(id: number): void {
    this.big.delete(id);
    const keys = this.keysOf.get(id);
    if (!keys) return;
    for (const k of keys) {
      const s = this.cells.get(k);
      if (s) {
        s.delete(id);
        if (s.size === 0) this.cells.delete(k);
      }
    }
    this.keysOf.delete(id);
  }

  query(min: Vec3, max: Vec3): Set<number> {
    return this.queryInto(new Set<number>(), min, max);
  }

  /** As query, adding to a set the caller keeps (many small queries along a path share one set). */
  queryInto(out: Set<number>, min: Vec3, max: Vec3): Set<number> {
    for (const id of this.big) out.add(id);
    const r = this.range(min, max);
    if (r.count > this.cells.size) {
      for (const [k, s] of this.cells) {
        const iz = (k % 2048) - K;
        const iy = (Math.floor(k / 2048) % 2048) - K;
        const ix = Math.floor(k / (2048 * 2048)) - K;
        if (ix < r.x0 || ix > r.x1 || iy < r.y0 || iy > r.y1 || iz < r.z0 || iz > r.z1) continue;
        for (const id of s) out.add(id);
      }
      return out;
    }
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) for (let z = r.z0; z <= r.z1; z++) {
      const s = this.cells.get(this.key(x, y, z));
      if (s) for (const id of s) out.add(id);
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
