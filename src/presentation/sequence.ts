// Shots (sequences): presentation recipes that point at the world and never copy it.
// A shot maps screen time (frames) to historical time through its time-remap keys, and to a camera
// through its camera keys. Shot data lives in the `sequence` table, apart from the world data.
import { type Instant, lerp, fromJSONValue, toJSONValue, gregorian, compare, diffMs, type Precision } from '../core-time/index.ts';
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
  /** A text box of the user's own (D107): its look, when it shows, how it comes and goes, a place it points to. Absent on the date and the title. */
  box?: TextBox;
}

/** When a text box shows: seconds into the shot (to null: until the end), or while history is between two dates (to null: from then on). */
export type TextTiming = { by: 'shot'; from: number; to: number | null } | { by: 'history'; from: [number, number]; to: [number, number] | null };
export type TextEnter = 'none' | 'fade' | 'rise' | 'pop' | 'type';
export type TextExit = 'none' | 'fade' | 'sink';

/** A text box (D107). Its text, size, colour, background, place and alignment are the overlay's own. */
export interface TextBox {
  /** Font family (one of LABEL_FONTS, or any installed font), weight (400 to 800) and slant. */
  font: string; weight: number; italic: boolean;
  /** Lines wrap at this width (design pixels; 0: only where a new line is written). */
  wrap: number;
  /** A line around the letters for reading over the map (null: none) and its width (design pixels). */
  outline: string | null; outlineWidth: number;
  /** The background box (the overlay's `background` colour): inner spacing and corner rounding (design pixels). */
  padding: number; radius: number;
  timing: TextTiming;
  /** How it comes in and goes, and how long each takes (seconds of the shot). */
  enter: TextEnter; exit: TextExit; seconds: number;
  /** A callout: the place it points to (longitude, latitude), with a line from the box to a dot there. */
  anchor: [number, number] | null;
  /** The colour of the line and the dot (empty: the text's). */
  pointer: string;
}

export const DEFAULT_TEXT_BOX: TextBox = {
  font: 'Segoe UI', weight: 600, italic: false, wrap: 640, outline: null, outlineWidth: 3, padding: 14, radius: 8,
  timing: { by: 'shot', from: 0, to: null }, enter: 'fade', exit: 'fade', seconds: 0.5, anchor: null, pointer: '',
};

/** A text box's settings from what is stored (missing or broken values from the defaults). */
export function textBoxOf(b: Partial<TextBox> | null | undefined): TextBox {
  const d = DEFAULT_TEXT_BOX, o = b ?? {};
  const num = (v: unknown, lo: number, hi: number, dv: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dv);
  const day = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1]] : null);
  let timing: TextTiming = d.timing;
  const t = o.timing as Partial<TextTiming> | undefined;
  if (t?.by === 'history' && day(t.from)) timing = { by: 'history', from: day(t.from)!, to: day(t.to) };
  else if (t?.by === 'shot') timing = { by: 'shot', from: num(t.from, 0, 1e6, 0), to: typeof t.to === 'number' && Number.isFinite(t.to) ? Math.max(0, t.to) : null };
  return {
    font: typeof o.font === 'string' && o.font.trim() ? o.font : d.font, weight: num(o.weight, 100, 900, d.weight), italic: o.italic === true,
    wrap: num(o.wrap, 0, 20000, d.wrap), outline: typeof o.outline === 'string' && o.outline ? o.outline : null, outlineWidth: num(o.outlineWidth, 0, 60, d.outlineWidth),
    padding: num(o.padding, 0, 400, d.padding), radius: num(o.radius, 0, 400, d.radius), timing,
    enter: (['none', 'fade', 'rise', 'pop', 'type'] as const).includes(o.enter as TextEnter) ? (o.enter as TextEnter) : d.enter,
    exit: (['none', 'fade', 'sink'] as const).includes(o.exit as TextExit) ? (o.exit as TextExit) : d.exit,
    seconds: num(o.seconds, 0, 60, d.seconds),
    anchor: Array.isArray(o.anchor) && o.anchor.length === 2 && o.anchor.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [o.anchor[0], o.anchor[1]] : null,
    pointer: typeof o.pointer === 'string' ? o.pointer : '',
  };
}

/** A new text box in a shot: in the middle of the frame (a callout: pointing at `anchor`, the box above and to its right). */
export function newTextBox(shot: ShotSettings, text: string, anchor: [number, number] | null = null): Overlay {
  const n = shot.overlays.filter((o) => o.box).length;
  return {
    id: `text-${Date.now().toString(36)}-${n}`, kind: 'text', text, x: anchor ? 0.62 : 0.5, y: anchor ? 0.3 : 0.5 + ((n % 5) - 2) * 0.08, size: 40,
    color: '#f4efe6', background: 'rgba(8,14,22,0.7)', align: anchor ? 'left' : 'center', inFrame: 0, outFrame: shot.frames - 1, fade: 0, datePrecision: 'day',
    box: { ...DEFAULT_TEXT_BOX, anchor },
  };
}

/**
 * Whether a text box shows at a frame, and how far it has come in (`enter`, 0 to 1) and how far it is
 * from leaving (`exit`, 1 until its last `seconds`, then down to 0). Null: not shown.
 */
export function textBoxState(shot: ShotSettings, box: TextBox, frame: number, t: Instant): { enter: number; exit: number } | null {
  const k = (x: number) => (box.seconds > 0 ? Math.max(0, Math.min(1, x / box.seconds)) : 1);
  if (box.timing.by === 'shot') {
    const secs = frame / shot.fps, { from, to } = box.timing;
    if (secs < from - 1e-9 || (to !== null && secs > to + 1e-9)) return null;
    return { enter: k(secs - from), exit: to === null ? 1 : k(to - secs) };
  }
  const from = fromJSONValue(box.timing.from), to = box.timing.to ? fromJSONValue(box.timing.to) : null;
  if (compare(t, from) < 0 || (to && compare(t, to) > 0)) return null;
  // (Seconds of the shot since history reached its start, and until it reaches its end.)
  return { enter: k(screenSecondsSince(shot, frame, from)), exit: to ? k(-screenSecondsSince(shot, frame, to)) : 1 };
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
  /** Each character's route so far, drawn behind it. */
  trails?: boolean;
  /** Cities' dots and names (absent: shown). */
  cities?: boolean;
  transparent: boolean;
  /** Folder to export into; empty or absent: the project's exports folder. */
  exportDir?: string | null;
  /** What to export (pass names, see export-driver.ts); absent: everything combined ('all') only. */
  exportPasses?: string[];
  /** How border changes animate in this shot (absent: as recorded). */
  transitions?: ShotTransitions;
  /** The 'current events' box (absent: not shown). See events-box.ts. */
  eventsBox?: Partial<import('./events-box.ts').EventsBox>;
  /** The map's look in this shot (D108; absent: classic, the colours of the working view). See looks.ts. */
  look?: import('./looks.ts').ShotLook;
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
 * An event's own time on screen in presentations (D92), from its presentation settings: its changes then take
 * that many screen seconds from the moment they happen, however fast the shot's clock runs. Null:
 * it follows the clock (the shot's settings).
 */
export function eventScreenSeconds(presentation: string | null | undefined): number | null {
  try {
    const v = (presentation ? (JSON.parse(presentation) as { screen?: { seconds?: unknown } } | null) : null)?.screen?.seconds;
    return typeof v === 'number' && v > 0 && Number.isFinite(v) ? Math.min(600, v) : null;
  } catch { return null; }
}

/**
 * How far a change has come in a shot at instant t (0 to 1; outside: not under way). An event with a
 * time of its own on screen (D92) sets it; otherwise the shot's timing: its seconds of screen time, or the
 * change's own span in history when timed by events.
 */
export function shotProgress(a: { t: Instant; end: Instant }, t: Instant, o: { timing: 'seconds' | 'event'; seconds: number; secondsSince: (x: Instant) => number }, ownSeconds?: number | null): number {
  if (ownSeconds && ownSeconds > 0) return o.secondsSince(a.t) / ownSeconds;
  if (o.timing === 'event' && compare(a.end, a.t) > 0) return diffMs(a.t, t) / Math.max(1, diffMs(a.t, a.end));
  return o.secondsSince(a.t) / Math.max(1e-3, o.seconds);
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

/** An overlay to draw at a frame; a text box with how far it has come in and is from leaving (see textBoxState). */
export interface OverlayDraw { overlay: Overlay; text: string; alpha: number; enter?: number; exit?: number }

export function overlaysAt(shot: ShotSettings, frame: number, t: Instant): OverlayDraw[] {
  const out: OverlayDraw[] = [];
  for (const o of shot.overlays) {
    if (o.box) {
      const box = textBoxOf(o.box), st = textBoxState(shot, box, frame, t);
      if (st) out.push({ overlay: { ...o, box }, text: o.text.replace(/\{date\}/g, gregorian.format(t, o.datePrecision)), alpha: 1, enter: st.enter, exit: st.exit });
      continue;
    }
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

/** The lines of a text: the lines written, each wrapped by words at `wrap` pixels (0: not wrapped); a word longer than that keeps a line of its own. */
export function wrapText(text: string, wrap: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!(wrap > 0) || measure(para) <= wrap) { out.push(para); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (!line || measure(next) <= wrap) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** The point of a rectangle nearest to (x, y) (the point itself when inside). */
export function nearestOnRect(r: { x: number; y: number; w: number; h: number }, x: number, y: number): [number, number] {
  return [Math.min(r.x + r.w, Math.max(r.x, x)), Math.min(r.y + r.h, Math.max(r.y, y))];
}

const easeOut = (p: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3);
const easeOutBack = (p: number) => { const c1 = 1.70158, c3 = c1 + 1, q = Math.max(0, Math.min(1, p)) - 1; return 1 + c3 * q * q * q + c1 * q * q; };

/**
 * A text box (D107): its lines (wrapped), on its background, with a line around the letters if set,
 * coming in and going as set; a callout's pointer drawn from the box to its place (growing as the box
 * comes in), with a dot there. Returns where the box went, or null when it is not seen.
 */
function drawTextBox(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, it: OverlayDraw, width: number, height: number, unit: number, project?: (lon: number, lat: number) => [number, number] | null): OverlayRect | null {
  const o = it.overlay, b = o.box!, size = Math.max(1, o.size * unit);
  const family = /[\s,]/.test(b.font) && !b.font.includes('"') ? `"${b.font}"` : b.font;
  ctx.save();
  ctx.font = `${b.italic ? 'italic ' : ''}${Math.round(b.weight)} ${size}px ${family}, "Segoe UI", Arial, sans-serif`;
  const lines = wrapText(it.text, b.wrap * unit, (x) => ctx.measureText(x).width);
  const lineH = size * 1.25, pad = b.padding * unit;
  const w = Math.max(1, ...lines.map((l) => ctx.measureText(l).width)), h = lines.length * lineH;
  const x = o.x * width, y = o.y * height;
  const left = o.align === 'left' ? x : o.align === 'center' ? x - w / 2 : x - w;
  const enter = it.enter ?? 1, exit = it.exit ?? 1;
  let alpha = it.alpha, dy = 0, scale = 1, shown = Infinity;
  if (b.enter === 'fade') alpha *= enter;
  else if (b.enter === 'rise') { alpha *= enter; dy += (1 - easeOut(enter)) * size * 0.9; }
  else if (b.enter === 'pop') { alpha *= Math.min(1, enter * 2.5); scale = 0.55 + 0.45 * easeOutBack(enter); }
  else if (b.enter === 'type') shown = Math.round(enter * lines.reduce((n, l) => n + [...l].length, 0));
  if (b.exit === 'fade') alpha *= exit;
  else if (b.exit === 'sink') { alpha *= exit; dy += (1 - easeOut(exit)) * size * 0.9; }
  const box = { x: left - pad, y: y - h / 2 - pad + dy, w: w + 2 * pad, h: h + 2 * pad };
  if (alpha <= 0.002) { ctx.restore(); return null; }
  ctx.globalAlpha = Math.min(1, alpha);
  if (b.anchor && project) {
    const a = project(b.anchor[0], b.anchor[1]);
    if (a) {
      const [sx, sy] = nearestOnRect(box, a[0], a[1]);
      const grow = b.enter === 'none' ? 1 : easeOut(enter);
      const ex = sx + (a[0] - sx) * grow, ey = sy + (a[1] - sy) * grow, colour = b.pointer || o.color;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = Math.max(2, 4.5 * unit);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1, 2.5 * unit);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      if (grow > 0.98) {
        ctx.beginPath();
        ctx.arc(a[0], a[1], Math.max(2, 6 * unit), 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.lineWidth = Math.max(1, 1.8 * unit);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
      }
    }
  }
  if (scale !== 1) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
  }
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(b.radius * unit, box.w / 2, box.h / 2));
    ctx.fill();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = o.align;
  ctx.lineJoin = 'round';
  let left0 = shown;
  lines.forEach((line, i) => {
    let text = line;
    if (Number.isFinite(left0)) { const chars = [...line]; text = chars.slice(0, Math.max(0, left0)).join(''); left0 -= chars.length; }
    if (!text) return;
    const ly = y - h / 2 + dy + lineH * (i + 0.5);
    if (b.outline && b.outlineWidth > 0) { ctx.strokeStyle = b.outline; ctx.lineWidth = 2 * b.outlineWidth * unit; ctx.strokeText(text, x, ly); }
    ctx.fillStyle = o.color;
    ctx.fillText(text, x, ly);
  });
  ctx.restore();
  return { id: o.id, ...box };
}

/**
 * Draw overlays onto a frame. Sizes are design pixels, scaled by `unit` (output width / 1920). Returns
 * where each went. `project` places a callout's point (D107) on the frame.
 */
export function drawOverlays(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, items: OverlayDraw[], unit: number, font: string, project?: (lon: number, lat: number) => [number, number] | null): OverlayRect[] {
  const rects: OverlayRect[] = [];
  for (const it of items) {
    const o = it.overlay;
    if (o.box) { const r = drawTextBox(ctx, it, width, height, unit, project); if (r) rects.push(r); continue; }
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
