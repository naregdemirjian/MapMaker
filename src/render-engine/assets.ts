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
