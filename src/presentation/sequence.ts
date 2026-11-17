// Shots (sequences): presentation recipes that point at the world and never copy it.
// A shot maps screen time (frames) to historical time through its time-remap keys, and to a camera
// through its camera keys. Shot data lives in the `sequence` table, apart from the world data.
import { type Instant, lerp, fromJSONValue, toJSONValue, gregorian, type Precision } from '../core-time/index.ts';
import { type Camera, interpolateCamera } from '../render-engine/camera.ts';

export type Ease = 'linear' | 'smooth' | 'hold';

export interface TimeKey { frame: number; at: [number, number] | '-inf' | '+inf'; ease: Ease }
export interface CameraKey { frame: number; camera: Camera; ease: Ease }
export interface Overlay {
  id: string; kind: 'date' | 'text'; text: string;
  x: number; y: number; // 0..1 of the frame
  size: number; // design pixels (1920-wide frame)
  color: string; background: string | null; align: 'left' | 'center' | 'right';
  inFrame: number; outFrame: number; fade: number; datePrecision: Precision;
}

export interface ShotSettings {
  spaceId: string;
  width: number; height: number; fps: number; frames: number;
  time: TimeKey[];
  camera: CameraKey[];
  overlays: Overlay[];
  layers: string[]; // partition layers shown; empty = all visible layers of the world
  graticule: boolean;
  labels: boolean;
  /** Characters' markers and names (absent: shown). */
  characters?: boolean;
  transparent: boolean;
  /** Folder to export into; empty or absent: the project's exports folder. */
  exportDir?: string | null;
  /** What to export (pass names, see export-driver.ts); absent: everything combined ('all') only. */
  exportPasses?: string[];
  /** How border changes animate in this shot (absent: as recorded). */
  transitions?: ShotTransitions;
  /** The 'current events' box (absent: not shown). See events-box.ts. */
  eventsBox?: Partial<import('./events-box.ts').EventsBox>;
}

export type TransitionEasing = 'linear' | 'smooth' | 'in' | 'out';

/** How a shot shows border changes. Applied when drawing; history is never changed. */
export interface ShotTransitions {
  /** recorded: each change as recorded (animated or not); all: every change animates; instant: none do. */
  mode: 'recorded' | 'all' | 'instant';
  /**
   * Style for changes the shot animates. border ("Advancing front"): the new territory grows out of
   * the border it shares with the country's land, or from the side facing the country's nearest land;
   * advance ("Expansion"): a circle growing from where the drawing started (or the middle); fade.
   * 'wipe' is no longer offered; shots saved with it show the advancing front.
   */
  style: 'border' | 'advance' | 'fade' | 'wipe';
  /** No longer used (the direction of the old wipe); kept so older shots load unchanged. */
  angle: number;
  /** seconds: each change takes `seconds` of screen time; event: the event's own length (instant events use seconds). */
  timing: 'seconds' | 'event';
  seconds: number;
  easing: TransitionEasing;
  /** Also give changes recorded with their own animation this style and timing. */
  restyleRecorded: boolean;
  /** The moving front line of advancing fronts and expansions. */
  front: { show: boolean; color: string; width: number; glow: number };
}

export const DEFAULT_TRANSITIONS: ShotTransitions = {
  mode: 'recorded', style: 'border', angle: 0, timing: 'seconds', seconds: 1.5, easing: 'smooth', restyleRecorded: false,
  front: { show: true, color: '#ffe9a6', width: 2.2, glow: 10 },
};

export function shotTransitions(shot: ShotSettings): ShotTransitions {
  const t = shot.transitions;
  const out = { ...DEFAULT_TRANSITIONS, ...(t ?? {}), front: { ...DEFAULT_TRANSITIONS.front, ...(t?.front ?? {}) } };
  if (out.style === 'wipe') out.style = 'border';
  return out;
}

/**
 * Screen seconds between the frame showing instant `t0` and frame `frame`: transitions timed in
 * screen seconds stay the same length whatever the shot's pacing. Infinity when t0 is before the
 * shot starts (that change is over).
 */
export function screenSecondsSince(shot: ShotSettings, frame: number, t0: Instant): number {
  const last = shot.frames - 1;
  const cmp = (f: number) => { const x = timeAt(shot, f); return x.day !== t0.day ? x.day - t0.day : x.ms - t0.ms; };
  if (cmp(0) > 0) return Infinity;
  if (cmp(last) < 0) return -Infinity;
  let lo = 0, hi = last;
  for (let i = 0; i < 40 && hi - lo > 1e-4; i++) { const mid = (lo + hi) / 2; if (cmp(mid) < 0) lo = mid; else hi = mid; }
  return (frame - hi) / shot.fps;
}

export const RESOLUTIONS = [
  { id: '1080p', name: 'HD 1920 x 1080', width: 1920, height: 1080 },
  { id: '4k', name: 'UHD 4K 3840 x 2160', width: 3840, height: 2160 },
  { id: '8k', name: '8K 7680 x 4320', width: 7680, height: 4320 },
  { id: 'dci4k', name: 'DCI 4K 4096 x 2160', width: 4096, height: 2160 },
  { id: 'scope', name: 'Scope 2.39:1 1920 x 804', width: 1920, height: 804 },
];

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 60];

export function defaultShot(spaceId: string, camera: Camera, start: Instant, end: Instant, fps = 24, seconds = 6): ShotSettings {
  const frames = Math.max(2, Math.round(fps * seconds));
  return {
    spaceId, width: 1920, height: 1080, fps, frames,
    time: [{ frame: 0, at: toJSONValue(start), ease: 'smooth' }, { frame: frames - 1, at: toJSONValue(end), ease: 'smooth' }],
    camera: [{ frame: 0, camera: { ...camera }, ease: 'smooth' }, { frame: frames - 1, camera: { ...camera }, ease: 'smooth' }],
    overlays: [{
      id: 'date', kind: 'date', text: '{date}', x: 0.05, y: 0.9, size: 44, color: '#f4efe6', background: 'rgba(8,14,22,0.55)',
      align: 'left', inFrame: 0, outFrame: frames - 1, fade: 0, datePrecision: 'day',
    }],
    layers: [], graticule: true, labels: true, transparent: false,
  };
}

const easeFn = (e: Ease, f: number) => (e === 'hold' ? 0 : e === 'smooth' ? f * f * (3 - 2 * f) : f);

function segment<K extends { frame: number; ease: Ease }>(keys: K[], frame: number): { a: K; b: K; f: number } {
  const sorted = [...keys].sort((x, y) => x.frame - y.frame);
  if (frame <= sorted[0].frame) return { a: sorted[0], b: sorted[0], f: 0 };
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (frame <= b.frame) {
      const raw = b.frame === a.frame ? 1 : (frame - a.frame) / (b.frame - a.frame);
      return { a, b, f: easeFn(a.ease, raw) };
    }
  }
  const last = sorted[sorted.length - 1];
  return { a: last, b: last, f: 0 };
}

/** Historical instant shown at a frame (the time remap). */
export function timeAt(shot: ShotSettings, frame: number): Instant {
  const { a, b, f } = segment(shot.time, frame);
  return lerp(fromJSONValue(a.at), fromJSONValue(b.at), f);
}

/** The shot with one camera for its whole length (the view never moves during the shot). */
export function withStillCamera(shot: ShotSettings, camera: Camera): ShotSettings {
  return { ...shot, camera: shot.camera.map((k) => ({ ...k, camera: { ...camera } })) };
}

/** Whether the shot's camera moves (shots made before the camera became still could). */
export function cameraMoves(shot: ShotSettings): boolean {
  const a = shot.camera[0].camera;
  return shot.camera.some((k) => k.camera.lon !== a.lon || k.camera.lat !== a.lat || k.camera.zoom !== a.zoom || k.camera.rotation !== a.rotation);
}

/** The camera a reset gives: the whole map, straight, in the shot's projection. */
export function resetCamera(shot: ShotSettings): Camera {
  return { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: shot.camera[0].camera.projection };
}

export function cameraAt(shot: ShotSettings, frame: number): Camera {
  const { a, b, f } = segment(shot.camera, frame);
  return interpolateCamera(a.camera, b.camera, f);
}

export interface OverlayDraw { overlay: Overlay; text: string; alpha: number }

export function overlaysAt(shot: ShotSettings, frame: number, t: Instant): OverlayDraw[] {
  const out: OverlayDraw[] = [];
  for (const o of shot.overlays) {
    if (frame < o.inFrame || frame > o.outFrame) continue;
    let alpha = 1;
    if (o.fade > 0) alpha = Math.min(1, (frame - o.inFrame + 1) / o.fade, (o.outFrame - frame + 1) / o.fade);
    const text = o.text.replace(/\{date\}/g, gregorian.format(t, o.datePrecision));
    out.push({ overlay: o, text, alpha });
  }
  return out;
}

/** Where something was drawn on a frame (pixels of that frame). */
export interface OverlayRect { id: string; x: number; y: number; w: number; h: number }

/** The id of the current-events box among a shot's overlay rectangles. */
export const EVENTS_BOX_ID = 'events-box';

/**
 * The shot with one overlay moved by (dx, dy), as fractions of the frame. The current-events box is
 * placed where it was dragged (from its drawn top-left corner `from`, fractions of the frame).
 */
export function moveOverlay(shot: ShotSettings, id: string, dx: number, dy: number, from?: { x: number; y: number }): ShotSettings {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (id === EVENTS_BOX_ID) {
    const box = shot.eventsBox ?? {};
    const x0 = from?.x ?? box.x ?? 0, y0 = from?.y ?? box.y ?? 0;
    return { ...shot, eventsBox: { ...box, corner: 'custom', x: clamp(x0 + dx), y: clamp(y0 + dy) } };
  }
  return { ...shot, overlays: shot.overlays.map((o) => (o.id === id ? { ...o, x: clamp(o.x + dx), y: clamp(o.y + dy) } : o)) };
}

/** Draw overlays onto a frame. Sizes are design pixels, scaled by `unit` (output width / 1920). Returns where each went. */
export function drawOverlays(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, items: OverlayDraw[], unit: number, font: string): OverlayRect[] {
  const rects: OverlayRect[] = [];
  for (const it of items) {
    const o = it.overlay;
    const size = o.size * unit;
    ctx.save();
    ctx.globalAlpha = it.alpha;
    ctx.font = `600 ${size}px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = o.align;
    const x = o.x * width, y = o.y * height;
    const w = ctx.measureText(it.text).width;
    if (o.background) {
      const pad = size * 0.35;
      const left = o.align === 'left' ? x : o.align === 'center' ? x - w / 2 : x - w;
      ctx.fillStyle = o.background;
      ctx.beginPath();
      ctx.roundRect(left - pad, y - size * 0.75, w + pad * 2, size * 1.5, size * 0.2);
      ctx.fill();
    }
    ctx.fillStyle = o.color;
    ctx.fillText(it.text, x, y);
    ctx.restore();
    const left = o.align === 'left' ? x : o.align === 'center' ? x - w / 2 : x - w;
    rects.push({ id: o.id, x: left - size * 0.35, y: y - size * 0.75, w: w + size * 0.7, h: size * 1.5 });
  }
  return rects;
}
