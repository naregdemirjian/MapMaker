// Satellite photographs in the interface and in exports (D138): the bundled picture of the whole Earth, loaded
// once; and picture tiles fetched through the local data service (a few at a time; one that could not be had is
// asked for again after a minute), laid side by side into a picture of a region once they are in, and kept (the
// last 2). A region none of whose tiles can be had (offline, with none kept) gets no picture: the bundled one is
// drawn. The working view draws with the last picture made meanwhile (or without one); an export waits for each
// frame's.
import { photoPlace, photoCovers, PHOTO_TILE, type Bounds, type PhotoNeed, type PhotoRegion } from './photo.ts';

export const EARTH_PHOTO_KEY = 'earth-photo-4096';
let earth: Promise<ImageBitmap | null> | null = null;

/** The bundled picture of the whole Earth, loaded once (decoded as it is, no colour management); null when it cannot be had. */
export function loadEarthPhoto(url = 'data/terrain/earth-photo-4096.webp'): Promise<ImageBitmap | null> {
  if (!earth) {
    earth = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      } catch { return null; }
    })();
  }
  return earth;
}

const failed = new Map<string, number>();
const RETRY_MS = 60_000;
const loading = new Map<string, Promise<ImageBitmap | null>>();
const queue: Array<() => void> = [];
let running = 0;
const AT_ONCE = 6;

function next(): void {
  while (running < AT_ONCE && queue.length) { running++; queue.shift()!(); }
}

/**
 * A tile's picture (null when it cannot be had, e.g. offline). Not kept once handed over: the region's picture
 * holds its pixels, and the browser and the data service keep the file.
 */
function loadTile(level: number, row: number, col: number): Promise<ImageBitmap | null> {
  const key = `${level}/${row}/${col}`;
  if (Date.now() - (failed.get(key) ?? -Infinity) < RETRY_MS) return Promise.resolve(null);
  let p = loading.get(key);
  if (!p) {
    p = new Promise<ImageBitmap | null>((resolve) => {
      queue.push(async () => {
        let out: ImageBitmap | null = null;
        try {
          const res = await fetch(`api/photo-tile/${level}/${row}/${col}`);
          if (res.ok) out = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        } catch { out = null; }
        if (out) failed.delete(key); else failed.set(key, Date.now());
        if (failed.size > 4000) failed.clear();
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

const regions = new Map<string, PhotoRegion | 'working' | 'none'>();
let last: PhotoRegion | null = null;
function keep(key: string, g: PhotoRegion | 'working' | 'none'): void {
  regions.delete(key);
  regions.set(key, g);
  while (regions.size > 2) regions.delete(regions.keys().next().value!);
}

/** A need's picture once its tiles are in; null when none of them can be had. */
async function make(need: PhotoNeed): Promise<PhotoRegion | null> {
  const cols = 2 ** (need.level + 1), place = photoPlace(need);
  const canvas = new OffscreenCanvas(place.width, place.height), ctx = canvas.getContext('2d')!;
  let any = false;
  const jobs: Array<Promise<void>> = [];
  for (let r = need.r0; r <= need.r1; r++) for (let c = need.c0; c <= need.c1; c++) {
    jobs.push(loadTile(need.level, r, ((c % cols) + cols) % cols).then((bitmap) => {
      if (!bitmap) return;
      ctx.drawImage(bitmap, (c - need.c0) * PHOTO_TILE, (r - need.r0) * PHOTO_TILE, PHOTO_TILE, PHOTO_TILE);
      bitmap.close();
      any = true;
    }));
  }
  await Promise.all(jobs);
  if (!any) return null;
  return { ...place, level: need.level, image: canvas, key: `photo:${need.key}` };
}

/** The last picture made, if it covers `view` at the need's level (then it will do: no new one is made). */
const reusable = (view: Bounds, need: PhotoNeed) => (last && last.level === need.level && photoCovers(last, view) ? last : null);

/**
 * The photographs for a view (`view`: what it shows; `need`: the tiles for it and around it): the last picture
 * made if it still covers the view at this level, else this need's if made; otherwise the last one (or null)
 * while this one is made (`start`: not while the map moves), and `onReady` is called once it is.
 */
export function photoSoon(view: Bounds, need: PhotoNeed, onReady: () => void, start = true): PhotoRegion | null {
  const again = reusable(view, need);
  if (again) return again;
  const key = `photo:${need.key}`, have = regions.get(key);
  if (have && have !== 'working' && have !== 'none') { last = have; return have; }
  if (!have && start) {
    keep(key, 'working');
    make(need).then((g) => {
      keep(key, g ?? 'none');
      if (g) { last = g; onReady(); }
    }, () => regions.delete(key));
  }
  return last;
}

/** The photographs for a view, once their tiles are in (for exports; reused while they cover the frames; null when none can be had). */
export async function photoNow(view: Bounds, need: PhotoNeed): Promise<PhotoRegion | null> {
  const again = reusable(view, need);
  if (again) return again;
  const key = `photo:${need.key}`, have = regions.get(key);
  if (have === 'none') return null;
  if (have && have !== 'working') { last = have; return have; }
  const g = await make(need);
  keep(key, g ?? 'none');
  if (g) last = g;
  return g;
}
