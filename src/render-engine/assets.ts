// Pictures (and later videos) used when drawing: loaded once from the project's assets, kept in
// memory. Drawing never waits: an image that is not loaded yet is skipped and a redraw is
// requested when it arrives. Exports call `preloadImages` first, so every frame has every image.

let base = '';
let onLoaded: () => void = () => {};

/** Where the open project's assets are served from, and what to do when an image arrives. */
export function setAssetBase(url: string, loaded: () => void = () => {}): void {
  base = url.endsWith('/') ? url : `${url}/`;
  onLoaded = loaded;
}

/** The address of a project asset, or of a file shipped with the app (paths starting with 'data/'). */
export function assetUrl(file: string): string {
  return file.startsWith('data/') || file.includes('/') ? file : `${base}${file}`;
}

const images = new Map<string, { img: HTMLImageElement; ready: boolean; failed: boolean; promise: Promise<void> }>();

function entry(file: string) {
  const url = assetUrl(file);
  let e = images.get(url);
  if (!e) {
    const img = new Image();
    img.decoding = 'async';
    const rec = { img, ready: false, failed: false, promise: Promise.resolve() };
    rec.promise = new Promise<void>((resolve) => {
      img.onload = () => { rec.ready = true; resolve(); onLoaded(); };
      img.onerror = () => { rec.failed = true; resolve(); };
    });
    img.src = url;
    images.set(url, rec);
    e = rec;
  }
  return e;
}

/** The image if it is loaded (otherwise starts loading it and returns null). */
export function imageNow(file: string | null | undefined): HTMLImageElement | null {
  if (!file) return null;
  const e = entry(file);
  return e.ready ? e.img : null;
}

/** Load images before drawing (exports). Missing files are skipped, not fatal. */
export async function preloadImages(files: Array<string | null | undefined>): Promise<void> {
  await Promise.all(files.filter((f): f is string => !!f).map((f) => entry(f).promise));
}

/** Draw an image into a box: stretched, covering it (cropped) or contained in it (letterboxed). */
export function drawImageFit(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, fit: 'stretch' | 'cover' | 'contain'): void {
  const iw = (img as HTMLVideoElement).videoWidth || img.width, ih = (img as HTMLVideoElement).videoHeight || img.height;
  if (!iw || !ih || fit === 'stretch') { ctx.drawImage(img, x, y, w, h); return; }
  const s = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ---------------------------------------------------------------- videos
// A video fill shows the frame for a moment of screen time. The live preview seeks and redraws
// when the frame is ready; exports seek every video and wait before drawing each frame.

export interface VideoPlay { play?: 'loop' | 'once'; speed?: number; start?: number }

/**
 * Who is using a video: the live preview and an export each get their own video element, so the
 * preview redrawing during an export never moves the export's video to another frame.
 */
export type MediaChannel = 'live' | 'export';

const videos = new Map<string, { v: HTMLVideoElement; meta: Promise<void> }>();

function videoEntry(file: string, channel: MediaChannel) {
  const url = assetUrl(file);
  const key = `${channel}|${url}`;
  let e = videos.get(key);
  if (!e) {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const meta = new Promise<void>((resolve) => {
      v.addEventListener('error', () => resolve(), { once: true });
      v.addEventListener('loadeddata', () => {
        if (Number.isFinite(v.duration)) { resolve(); return; }
        // Some files (for example browser recordings) do not state their length and cannot be
        // seeked until it is known: seeking far ahead makes the browser work it out.
        const known = () => {
          if (!Number.isFinite(v.duration)) return;
          v.removeEventListener('durationchange', known);
          v.addEventListener('seeked', () => resolve(), { once: true });
          v.currentTime = 0;
        };
        v.addEventListener('durationchange', known);
        v.currentTime = 1e101;
        setTimeout(resolve, 5000);
      }, { once: true });
    });
    v.addEventListener('seeked', () => onLoaded());
    v.addEventListener('loadeddata', () => onLoaded());
    v.src = url;
    e = { v, meta };
    videos.set(key, e);
  }
  return e;
}

/** The time in the video shown `seconds` of screen time into a shot. */
export function videoTime(duration: number, seconds: number, p: VideoPlay): number {
  if (!(duration > 0)) return 0;
  const t = (p.start ?? 0) + Math.max(0, seconds) * (p.speed ?? 1);
  if ((p.play ?? 'loop') === 'once') return Math.min(t, Math.max(0, duration - 0.04));
  return ((t % duration) + duration) % duration;
}

/** The video, showing (or about to show) the right frame; null until it can be drawn. */
export function videoNow(file: string | null | undefined, seconds: number, p: VideoPlay, channel: MediaChannel = 'live'): HTMLVideoElement | null {
  if (!file) return null;
  const { v } = videoEntry(file, channel);
  if (v.readyState < 2 || !Number.isFinite(v.duration)) return null;
  const target = videoTime(v.duration, seconds, p);
  // The preview seeks and redraws when the frame is ready; an export has already sought (prepareVideos).
  if (channel === 'live' && Math.abs(v.currentTime - target) > 0.02 && !v.seeking) v.currentTime = target;
  return v;
}

/** Seek every video to its frame for this moment and wait until all are ready (exports). */
export async function prepareVideos(items: Array<{ file: string; play: VideoPlay }>, seconds: number): Promise<void> {
  await Promise.all(items.map(async ({ file, play }) => {
    const e = videoEntry(file, 'export');
    await e.meta;
    const v = e.v;
    if (v.readyState < 1) return;
    const target = videoTime(v.duration, seconds, play);
    if (Math.abs(v.currentTime - target) <= 1e-3 && !v.seeking && v.readyState >= 2) return;
    await new Promise<void>((resolve) => {
      const done = () => { v.removeEventListener('seeked', done); resolve(); };
      v.addEventListener('seeked', done);
      v.currentTime = target;
      setTimeout(done, 5000); // never hang an export on a broken file
    });
  }));
}
