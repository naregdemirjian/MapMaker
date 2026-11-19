// A shot's audio reference track (Stage 13 refinement, D151): music or a narration the shot is timed to. Heard
// while the shot plays in the preview, its clock then moving the frames; its waveform drawn under the frames;
// copied beside every export for lining up in the editor. Never mixed into exported videos.
import { assetUrl } from '../render-engine/assets.ts';
export type { ShotAudio } from '../presentation/sequence.ts';

/** One audio element per track, kept while the project is open. */
const players = new Map<string, HTMLAudioElement>();
export function audioPlayer(asset: string): HTMLAudioElement {
  let a = players.get(asset);
  if (!a) {
    a = new Audio(assetUrl(asset));
    a.preload = 'auto';
    players.set(asset, a);
  }
  return a;
}

/** A track's loudness, worked out once: the highest level in each of `buckets` stretches of `seconds`. */
const peaks = new Map<string, Promise<{ duration: number; data: Float32Array } | null>>();
export function audioPeaks(asset: string): Promise<{ duration: number; data: Float32Array } | null> {
  let p = peaks.get(asset);
  if (!p) {
    p = (async () => {
      try {
        const bytes = await (await fetch(assetUrl(asset))).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 8000);
        const buf = await ctx.decodeAudioData(bytes);
        // 100 levels a second, from every channel.
        const n = Math.max(1, Math.ceil(buf.duration * 100));
        const data = new Float32Array(n);
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch), per = d.length / n;
          for (let i = 0; i < n; i++) {
            let m = 0;
            const a = Math.floor(i * per), b = Math.min(d.length, Math.floor((i + 1) * per));
            for (let j = a; j < b; j++) { const v = Math.abs(d[j]); if (v > m) m = v; }
            if (m > data[i]) data[i] = m;
          }
        }
        return { duration: buf.duration, data };
      } catch {
        return null;
      }
    })();
    peaks.set(asset, p);
  }
  return p;
}

/** The waveform of the part of a track a shot covers, drawn into a canvas (its own size). */
export function drawWaveform(canvas: HTMLCanvasElement, wave: { duration: number; data: Float32Array }, from: number, seconds: number, at: number | null): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(126, 200, 227, 0.75)';
  const perPx = seconds / w;
  for (let x = 0; x < w; x++) {
    const t0 = from + x * perPx, t1 = t0 + perPx;
    if (t1 < 0 || t0 > wave.duration) continue;
    let m = 0;
    for (let i = Math.max(0, Math.floor(t0 * 100)); i <= Math.min(wave.data.length - 1, Math.floor(t1 * 100)); i++) m = Math.max(m, wave.data[i]);
    const bar = Math.max(1, m * h);
    ctx.fillRect(x, (h - bar) / 2, 1, bar);
  }
  if (at !== null) {
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(Math.round(((at - from) / seconds) * w), 0, Math.max(1, Math.round(dpr)), h);
  }
}
