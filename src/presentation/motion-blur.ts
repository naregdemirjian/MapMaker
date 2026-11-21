// Motion blur for exports (D185): each frame the average of several pictures drawn at moments spread over a part of
// the time to the next frame (the shutter, as a film camera's is open for half of it), so what moves (a border
// advancing, the camera, a light sweep) is smeared along its way as on film. Averaged with their transparency, so
// passes laid over others in an editor blur as the whole picture does.

/** How a shot's frames are blurred: `samples` pictures over `shutter` of the time between frames (0.5: half). */
export interface MotionBlur { samples: number; shutter: number }

/** A shot's motion blur as stored, checked; null for none (one picture a frame). */
export function motionBlurOf(v: unknown): MotionBlur | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const samples = Math.round(typeof o.samples === 'number' && Number.isFinite(o.samples) ? o.samples : 0);
  if (samples < 2) return null;
  const shutter = typeof o.shutter === 'number' && Number.isFinite(o.shutter) ? Math.max(0.05, Math.min(1, o.shutter)) : 0.5;
  return { samples: Math.min(32, samples), shutter };
}

/**
 * The moments (in frames, with their fractions) a frame's pictures are drawn at: `samples` of them spread evenly over
 * `shutter` of a frame centred on it, kept within the shot (0 to `frames` - 1).
 */
export function blurMoments(frame: number, blur: MotionBlur, frames: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < blur.samples; k++) {
    const at = frame + (k / (blur.samples - 1) - 0.5) * blur.shutter;
    out.push(Math.max(0, Math.min(Math.max(0, frames - 1), at)));
  }
  return out;
}

/**
 * Pictures added up and averaged, pixel by pixel: colours weighted by their opacity (a transparent pixel adds no
 * colour), so the average of a red pixel and a clear one is red at half strength, not a darker red.
 */
export class FrameAverage {
  private readonly sum: Float32Array;
  private n = 0;
  readonly length: number;
  constructor(length: number) { this.length = length; this.sum = new Float32Array(length); }
  add(px: Uint8ClampedArray): void {
    const s = this.sum;
    for (let i = 0; i < this.length; i += 4) {
      const a = px[i + 3];
      s[i] += px[i] * a; s[i + 1] += px[i + 1] * a; s[i + 2] += px[i + 2] * a; s[i + 3] += a;
    }
    this.n++;
  }
  /** The average so far, into `out` (RGBA, not premultiplied, as canvases give and take them). */
  write(out: Uint8ClampedArray): void {
    const s = this.sum, n = Math.max(1, this.n);
    for (let i = 0; i < this.length; i += 4) {
      const a = s[i + 3];
      if (a <= 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
      out[i] = s[i] / a; out[i + 1] = s[i + 1] / a; out[i + 2] = s[i + 2] / a; out[i + 3] = a / n;
    }
  }
}
