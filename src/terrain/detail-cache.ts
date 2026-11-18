// Close-up terrain in the interface and in exports (D101): Terrain Tiles fetched through the local
// data service (a few at a time), decoded and kept (the last 400; one that could not be had is asked
// for again after a minute); a region's grid built once its tiles are in, and kept (the last 3). A
// region none of whose tiles can be had (offline, with none kept) gets no grid: the bundled heights
// are drawn. The working view draws with the last grid built meanwhile (or without one); an export
// waits for each frame's.
import { terrariumHeights, buildDetail, covers, TILE, type DetailNeed, type DetailGrid } from './detail.ts';
import type { ElevationGrid } from './grid.ts';

type Base = { grid: ElevationGrid; key: string; touched?: Uint8Array | null };

const tiles = new Map<string, Float32Array>();
const failed = new Map<string, number>();
const RETRY_MS = 60_000;
const loading = new Map<string, Promise<Float32Array | null>>();
const KEEP_TILES = 400;
const queue: Array<() => void> = [];
let running = 0;
const AT_ONCE = 6;

function next(): void {
  while (running < AT_ONCE && queue.length) { running++; queue.shift()!(); }
}

/** A tile's heights (null when it cannot be had, e.g. offline), fetched once. */
function loadTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  if (tiles.has(key)) return Promise.resolve(tiles.get(key)!);
  if (Date.now() - (failed.get(key) ?? -Infinity) < RETRY_MS) return Promise.resolve(null);
  let p = loading.get(key);
  if (!p) {
    p = new Promise<Float32Array | null>((resolve) => {
      queue.push(async () => {
        let out: Float32Array | null = null;
        try {
          const res = await fetch(`api/terrain-tile/${z}/${x}/${y}`);
          if (res.ok) {
            const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
            const canvas = new OffscreenCanvas(TILE, TILE), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            out = terrariumHeights(ctx.getImageData(0, 0, TILE, TILE).data);
          }
        } catch { out = null; }
        if (out) { tiles.set(key, out); failed.delete(key); } else failed.set(key, Date.now());
        while (tiles.size > KEEP_TILES) tiles.delete(tiles.keys().next().value!);
        loading.delete(key);
        running--;
        resolve(out);
        next();
      });
      next();
    });
    loading.set(key, p);
  }
  return p;
}

const grids = new Map<string, DetailGrid | 'working' | 'none'>();
let last: DetailGrid | null = null;
function keep(key: string, g: DetailGrid | 'working' | 'none'): void {
  grids.delete(key);
  grids.set(key, g);
  while (grids.size > 3) grids.delete(grids.keys().next().value!);
}

/** A need's grid once its tiles are in; null when none of them can be had. */
async function make(need: DetailNeed, base: Base): Promise<DetailGrid | null> {
  const n = 2 ** need.z, wanted: Array<[number, number]> = [];
  for (let y = need.y0; y <= need.y1; y++) for (let x = need.x0; x <= need.x1; x++) wanted.push([((x % n) + n) % n, y]);
  const got = await Promise.all(wanted.map(([x, y]) => loadTile(need.z, x, y)));
  if (!got.some((t) => t)) return null;
  return buildDetail(need, (x, y) => tiles.get(`${need.z}/${x}/${y}`) ?? null, base);
}

type Bounds = { west: number; south: number; east: number; north: number };
/** The last grid built over `base`, if it covers `view` at the need's zoom (then it will do: no new one is made). */
const reusable = (view: Bounds, need: DetailNeed, base: Base) => (last && last.z === need.z && last.key.endsWith(`:${base.key}`) && covers(last, view) ? last : null);

/**
 * A grid of finer heights for a view (`view`: what it shows; `need`: the tiles for it and around it)
 * over `base`: the last one built if it still covers the view at this zoom, else this need's if
 * built; otherwise the last one (or null) while this one is made (`start`: not while the map
 * moves), and `onReady` is called once it is.
 */
export function detailSoon(view: Bounds, need: DetailNeed, base: Base, onReady: () => void, start = true): DetailGrid | null {
  const again = reusable(view, need, base);
  if (again) return again;
  const key = `detail:${need.key}:${base.key}`, have = grids.get(key);
  if (have && have !== 'working' && have !== 'none') { last = have; return have; }
  if (!have && start) {
    keep(key, 'working');
    make(need, base).then((g) => {
      keep(key, g ?? 'none');
      if (g) { last = g; onReady(); }
    }, () => grids.delete(key));
  }
  return last && last.key.endsWith(`:${base.key}`) ? last : null;
}

/** The grid of finer heights for a view, once its tiles are in (for exports; reused while it covers the frames; null when none can be had). */
export async function detailNow(view: Bounds, need: DetailNeed, base: Base): Promise<DetailGrid | null> {
  const again = reusable(view, need, base);
  if (again) return again;
  const key = `detail:${need.key}:${base.key}`, have = grids.get(key);
  if (have === 'none') return null;
  if (have && have !== 'working') { last = have; return have; }
  const g = await make(need, base);
  keep(key, g ?? 'none');
  if (g) last = g;
  return g;
}
