// The pictures of galaxies, made and kept (D193). A galaxy map draws its galaxy as one picture laid on the
// galactic plane. While working that picture is a draft: small, made in a second or so (a rough one first,
// at once). Baked, it is painted at full detail by the workers, row by row, and kept on this computer
// (IndexedDB), so that it is made once and is from then on just a picture to draw. Exports always use the
// baked picture. The picture depends only on the galaxy's shape (never on its star systems), so the Milky
// Way's is the same in every project.
import { galaxyModel, type GalaxySettings } from './galaxy.ts';
import { galaxyPainter, pictureExtent, type GalaxyPictureSpec } from './galaxy-picture.ts';

/** Raised whenever the painter paints differently: pictures kept from before are made again. */
export const PAINTER_VERSION = 1;
/** Pixels across: the rough picture shown at once, the draft worked with, the baked picture. */
export const QUICK_SIZE = 256, DRAFT_SIZE = 1024, BAKE_SIZE = 4096;

export interface GalaxyImage {
  /** The picture, largest first, then halves of it (for drawing it small without flicker). */
  levels: Array<{ image: CanvasImageSource; size: number }>;
  /** Half its width, and the size of the galaxy's bulge, light-years. */
  extent: number;
  bulge: number;
  size: number;
  baked: boolean;
  /** Changes whenever the picture does (for whoever keeps something drawn from it). */
  version: number;
}

/** Paints rows of a picture somewhere (in a worker, or here). */
export type RowsRunner = (spec: GalaxyPictureSpec, y0: number, y1: number) => Promise<Uint8ClampedArray>;

const here: RowsRunner = async (spec, y0, y1) => {
  // (A breath between bands, so the interface answers while a picture is painted in its own thread.)
  await new Promise((r) => setTimeout(r, 0));
  return galaxyPainter(spec).rows(y0, y1);
};
let runner: RowsRunner = here;
/** Paint in workers (the interface gives its pool); a worker that fails is made up for here. */
export function paintGalaxiesWith(run: RowsRunner | null): void {
  runner = run ? (spec, y0, y1) => run(spec, y0, y1).catch(() => here(spec, y0, y1)) : here;
}

interface Entry {
  key: string;
  settings: GalaxySettings;
  quick: GalaxyImage | null;
  draft: GalaxyImage | null;
  baked: GalaxyImage | null;
  drafting: Promise<GalaxyImage> | null;
  baking: Promise<GalaxyImage> | null;
  /** How far the bake has come, 0 to 1. */
  progress: number;
  failed: string | null;
}
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let versions = 1;

/** Told whenever a picture is ready or a bake moves on (to draw again). Returns how to stop listening. */
export function onGalaxyPictures(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
const tell = (): void => { for (const f of [...listeners]) f(); };

/** What a galaxy's picture depends on: its shape, not its star systems. */
export function pictureKey(g: GalaxySettings): string {
  return `v${PAINTER_VERSION}|${g.kind === 'milkyway' ? 'milkyway' : `own|${g.seed}|${g.arms}|${g.pitch}|${g.radiusLy}|${g.bar ? 1 : 0}`}`;
}
export function pictureSpec(g: GalaxySettings, size: number): GalaxyPictureSpec {
  return { model: galaxyModel(g), seed: g.kind === 'milkyway' ? 11 : g.seed + 11, size };
}

const canDraw = (): boolean => typeof OffscreenCanvas !== 'undefined' && typeof ImageData !== 'undefined';

function entryOf(g: GalaxySettings): Entry {
  const key = pictureKey(g);
  let e = entries.get(key);
  if (!e) {
    e = { key, settings: g, quick: null, draft: null, baked: null, drafting: null, baking: null, progress: 0, failed: null };
    entries.set(key, e);
    // (A few galaxies' pictures kept at once: the oldest not being made goes.)
    for (const [k, old] of entries) { if (entries.size <= 4) break; if (old !== e && !old.baking && !old.drafting) entries.delete(k); }
  }
  return e;
}

/** A picture with its smaller copies. */
function imageOf(g: GalaxySettings, source: CanvasImageSource, size: number, baked: boolean): GalaxyImage {
  const levels: GalaxyImage['levels'] = [{ image: source, size }];
  for (let s = size >> 1; s >= 512; s >>= 1) {
    const c = new OffscreenCanvas(s, s), x = c.getContext('2d')!;
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(levels[levels.length - 1].image, 0, 0, s, s);
    levels.push({ image: c, size: s });
  }
  const m = galaxyModel(g);
  return { levels, extent: pictureExtent(m), bulge: m.bulge, size, baked, version: versions++ };
}

/** Paints a whole picture in bands, telling how far it has come. */
async function paint(g: GalaxySettings, size: number, band: number, progress?: (done: number) => void): Promise<OffscreenCanvas> {
  const spec = pictureSpec(g, size);
  const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d')!;
  const jobs: Array<Promise<void>> = [];
  let done = 0;
  for (let y0 = 0; y0 < size; y0 += band) {
    const y1 = Math.min(size, y0 + band);
    jobs.push(runner(spec, y0, y1).then((rows) => {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rows.buffer as ArrayBuffer, rows.byteOffset, rows.length), size, y1 - y0), 0, y0);
      done += y1 - y0;
      progress?.(done / size);
    }));
  }
  await Promise.all(jobs);
  return canvas;
}

// Baked pictures kept on this computer.
const DB = 'mapmaker-galaxies', STORE = 'pictures';
function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function kept(key: string): Promise<Blob | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result instanceof Blob ? r.result : null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function keep(key: string, blob: Blob): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite'), s = tx.objectStore(STORE);
      // (Pictures from an older painter are of no use any more; and no more than a few galaxies' are kept.)
      const keys = s.getAllKeys();
      keys.onsuccess = () => {
        const others = (keys.result as string[]).filter((k) => k !== key);
        const stale = others.filter((k) => !k.startsWith(`v${PAINTER_VERSION}|`));
        const fresh = others.filter((k) => k.startsWith(`v${PAINTER_VERSION}|`));
        for (const k of [...stale, ...fresh.slice(0, Math.max(0, fresh.length - 5))]) s.delete(k);
        s.put(blob, key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}
/** Forgets the baked pictures kept on this computer (for tests). */
export async function forgetBakedGalaxies(): Promise<void> {
  for (const e of entries.values()) { e.baked = null; e.progress = 0; }
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); } catch { resolve(); }
  });
  tell();
}

function startDraft(e: Entry): Promise<GalaxyImage> {
  e.drafting ??= (async () => {
    const g = e.settings;
    if (!e.quick) {
      e.quick = imageOf(g, await paint(g, QUICK_SIZE, QUICK_SIZE), QUICK_SIZE, false);
      tell();
    }
    e.draft = imageOf(g, await paint(g, DRAFT_SIZE, 64), DRAFT_SIZE, false);
    tell();
    return e.draft;
  })().catch((err) => { e.drafting = null; e.failed = err instanceof Error ? err.message : String(err); tell(); throw err; });
  return e.drafting;
}

function startBake(e: Entry): Promise<GalaxyImage> {
  e.baking ??= (async () => {
    const g = e.settings;
    e.failed = null;
    // Baked before on this computer: only read back.
    const blob = await kept(e.key);
    if (blob && typeof createImageBitmap !== 'undefined') {
      try {
        const bmp = await createImageBitmap(blob);
        if (bmp.width === BAKE_SIZE) { e.baked = imageOf(g, bmp, BAKE_SIZE, true); e.progress = 1; tell(); return e.baked; }
      } catch { /* (unreadable: baked again) */ }
    }
    let last = 0;
    const canvas = await paint(g, BAKE_SIZE, 32, (p) => { e.progress = p * 0.97; if (p - last > 0.02 || p === 1) { last = p; tell(); } });
    e.baked = imageOf(g, canvas, BAKE_SIZE, true);
    e.progress = 1;
    tell();
    // (Kept for the next time, without holding the picture back for it.)
    void canvas.convertToBlob({ type: 'image/png' }).then((b) => keep(e.key, b)).catch(() => undefined);
    return e.baked;
  })().catch((err) => { e.baking = null; e.progress = 0; e.failed = err instanceof Error ? err.message : String(err); tell(); throw err; });
  return e.baking;
}

/**
 * A galaxy's picture as it is now, or null while there is none yet (its making is begun: listen with
 * onGalaxyPictures). The baked picture when the map says baked (or `best`: whenever there is one), else
 * the draft, else the rough picture. A map that says baked has its bake begun.
 */
export function galaxyImageNow(g: GalaxySettings, best = false): GalaxyImage | null {
  if (!canDraw()) return null;
  const e = entryOf(g);
  if (!e.draft && !e.drafting && !(e.baked && (g.baked || best))) void startDraft(e).catch(() => undefined);
  if (g.baked && !e.baked && !e.baking && !e.failed) void startBake(e).catch(() => undefined);
  if ((g.baked || best) && e.baked) return e.baked;
  return e.draft ?? e.quick;
}

/** How a galaxy's bake stands: not begun, being made (how far), or there. */
export function galaxyBakeState(g: GalaxySettings): { state: 'none' | 'baking' | 'done' | 'failed'; progress: number } {
  const e = entries.get(pictureKey(g));
  if (!e) return { state: 'none', progress: 0 };
  return { state: e.baked ? 'done' : e.baking ? 'baking' : e.failed ? 'failed' : 'none', progress: e.baked ? 1 : e.progress };
}

/** A galaxy's picture once made: the baked one (made now if need be), or the draft. For exports, before the first frame. */
export function galaxyImageReady(g: GalaxySettings, baked: boolean): Promise<GalaxyImage | null> {
  if (!canDraw()) return Promise.resolve(null);
  const e = entryOf(g);
  if (baked) return e.baked ? Promise.resolve(e.baked) : startBake(e);
  return e.draft ? Promise.resolve(e.draft) : startDraft(e);
}
