// Shots (sequences): presentation recipes that point at the world and never copy it.
// A shot maps screen time (frames) to historical time through its time-remap keys, and to a camera
// through its camera keys. Shot data lives in the `sequence` table, apart from the world data.
import { graphicStyleOf, drawPanel, writeText, animState, lineProgress, accentInset, ANIMS_IN, ANIMS_OUT, type GraphicStyle, type AnimIn, type AnimOut } from './graphic-style.ts';
import { type Instant, type Calendar, lerp, fromJSONValue, toJSONValue, gregorian, compare, diffMs, MONTHS as MONTH_NAMES, type Precision } from '../core-time/index.ts';
import { type Camera, interpolateCamera } from '../render-engine/camera.ts';
import { fillStatistics, type Statistic } from './statistics.ts';

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
  /** Its look (D184): the panel's shape, gradient, glass, grain, shadow, glow and accent; the text's shadow, gradient, spacing; lines coming in one after another. Absent: as before. */
  style?: GraphicStyle;
}

/** When a text box shows: seconds into the shot (to null: until the end), or while history is between two dates (to null: from then on). */
export type TextTiming = { by: 'shot'; from: number; to: number | null } | { by: 'history'; from: [number, number]; to: [number, number] | null };
export type TextEnter = AnimIn;
export type TextExit = AnimOut;

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
    enter: (ANIMS_IN as readonly string[]).includes(o.enter as string) ? (o.enter as TextEnter) : d.enter,
    exit: (ANIMS_OUT as readonly string[]).includes(o.exit as string) ? (o.exit as TextExit) : d.exit,
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

/** A shot's audio reference track (D151): see ui/audio-track.ts. */
export interface ShotAudio {
  /** The project's asset file (content hash + extension). */
  asset: string;
  /** The file's own name, as chosen. */
  name: string;
  /** The second of the track heard at the shot's first frame. */
  offset: number;
  /** 0 to 1. */
  volume: number;
}

export interface ShotSettings {
  spaceId: string;
  /** Music or a narration the shot is timed to (D151): heard while it plays here, copied beside its exports. */
  audio?: ShotAudio;
  /** The timeline the shot shows (D150): a branch's id; absent (or a branch no longer there): the main timeline. */
  branch?: string;
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
  /** Where trails start (D176): 'shot', the shot's first moment (only the way travelled during the shot); absent, each route's beginning. */
  trailsFrom?: 'shot';
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
  /** The files written (D109): PNG (absent), or TIFF uncompressed or ZIP-compressed; or one video file (D121). */
  format?: ExportFormat;
  /** A video's quality (D121; absent: good). */
  videoQuality?: import('../export/video-codecs.ts').VideoQuality;
  /** Motion blur in exports (D185): several pictures averaged into each frame; absent, one. See motion-blur.ts. */
  motionBlur?: import('./motion-blur.ts').MotionBlur;
  /**
   * A globe turning on its own (D127): degrees a second, as the Earth turns (west to east: the middle of the
   * view moves west); negative the other way. Absent or 0: still. Only for the globe.
   */
  spin?: number;
}

export type ExportFormat = 'png' | 'tiff' | 'tiff-zip' | 'mp4' | 'webm';
export const EXPORT_FORMATS: Array<{ id: ExportFormat; name: string; note: string; video?: boolean }> = [
  { id: 'png', name: 'PNG', note: 'PNG image sequences, 8-bit with transparency: small, read by every editor.' },
  { id: 'tiff', name: 'TIFF, uncompressed', note: 'TIFF image sequences, 8-bit with straight alpha, uncompressed: large (4 bytes a pixel), read by everything, quick to play in an editor.' },
  { id: 'tiff-zip', name: 'TIFF, ZIP-compressed', note: 'TIFF image sequences, 8-bit with straight alpha, compressed with ZIP (Deflate, as Photoshop writes it): about as small as PNG.' },
  { id: 'mp4', name: 'Video, MP4 (H.264)', video: true, note: 'One video file of the whole picture, ready to play and share: H.264 in MP4 plays on every computer, phone and website, and goes straight into Premiere. No transparency or layers.' },
  { id: 'webm', name: 'Video, WebM (VP9)', video: true, note: 'One video file of the whole picture: VP9 in WebM, sharper than H.264 for its size, for the web and players such as VLC (not every editor reads it). No transparency or layers.' },
];

/** Whether a shot exports a video file rather than image sequences (D121). */
export const isVideoFormat = (f: ExportFormat | undefined): f is 'mp4' | 'webm' => f === 'mp4' || f === 'webm';

export type TransitionEasing = 'linear' | 'smooth' | 'in' | 'out';

/** How a shot shows border changes. Applied when drawing; history is never changed. */
export interface ShotTransitions {
  /** recorded: each change as recorded (animated or not); all: every change animates; instant: none do. */
  mode: 'recorded' | 'all' | 'instant';
  /**
   * Style for changes the shot animates. border ("Advancing front"): the new territory is reached through the
   * land from the border it shares with the country's land (D136), or from the side facing the country's
   * nearest land; advance ("Expansion"): from where the drawing started (or the middle); dissolve: in patches;
   * fade. 'wipe' is no longer offered; shots saved with it show the advancing front.
   */
  style: 'border' | 'advance' | 'fade' | 'wipe' | 'dissolve';
  /** No longer used (the direction of the old wipe); kept so older shots load unchanged. */
  angle: number;
  /** seconds: each change takes `seconds` of screen time; event: the event's own length (instant events use seconds). */
  timing: 'seconds' | 'event';
  seconds: number;
  easing: TransitionEasing;
  /** Also give changes recorded with their own animation this style and timing. */
  restyleRecorded: boolean;
  /** The moving front line of advancing fronts and expansions; its colour 'auto': the new owner's, lightened. */
  front: { show: boolean; color: string; width: number; glow: number };
  /** The look chosen (D137): a preset's id, or 'custom' once any part is changed by hand. */
  look?: string;
  /** How ragged fronts are (0: clean; 1: long fingers). */
  roughness?: number;
  /** The new owner's colour running softly ahead of the front (0: a sharp edge; 1: a quarter of the way). */
  soft?: number;
  /** A glow over the land just taken, fading behind the front (0: none; 1: a third of the way back). */
  wake?: number;
  /** How much fronts mind the land (D142; 0: not at all; 1: mountains up to four times slower, water to cross three and a half). */
  terrain?: number;
}

/** Transition looks to start from (D137): each a style and how its fronts look; any part can then be changed. */
export const TRANSITION_LOOKS: Array<{ id: string; name: string; note: string; set: Partial<ShotTransitions> }> = [
  { id: 'clean', name: 'Clean', note: 'A crisp front through the land with a fine glowing line: the default.', set: { style: 'border', roughness: 0, soft: 0, wake: 0, terrain: 0, easing: 'smooth', front: { show: true, color: '#ffe9a6', width: 2.2, glow: 10 } } },
  { id: 'minimal', name: 'Minimal', note: 'Only the territory moving: no line, no glow.', set: { style: 'border', roughness: 0, soft: 0, wake: 0, terrain: 0, easing: 'smooth', front: { show: false, color: '#ffe9a6', width: 2.2, glow: 10 } } },
  { id: 'soft', name: 'Soft tide', note: 'The colour comes in softly, with a gentle glow over the land just taken.', set: { style: 'border', roughness: 0.15, soft: 0.45, wake: 0.3, terrain: 0, easing: 'smooth', front: { show: false, color: 'auto', width: 1.6, glow: 8 } } },
  { id: 'ink', name: 'Ink', note: 'Spreading like ink: a ragged, soft edge and no line.', set: { style: 'border', roughness: 0.65, soft: 0.6, wake: 0, terrain: 0, easing: 'out', front: { show: false, color: 'auto', width: 1.6, glow: 6 } } },
  { id: 'campaign', name: 'Campaign', note: 'A ragged front line of fire, the land behind it glowing as it falls.', set: { style: 'border', roughness: 0.35, soft: 0.1, wake: 0.45, terrain: 0, easing: 'smooth', front: { show: true, color: '#ff7a45', width: 2.6, glow: 16 } } },
  { id: 'blitz', name: 'Blitz', note: 'Fast thrusts that slow as they go, a hot white edge and a bright wake.', set: { style: 'border', roughness: 0.5, soft: 0.05, wake: 0.7, terrain: 0, easing: 'out', front: { show: true, color: '#fff4cc', width: 3, glow: 26 } } },
  { id: 'overland', name: 'Overland', note: 'A front that minds the land: quick over plains, slowed by mountains and by water to cross (where the map has heights).', set: { style: 'border', roughness: 0.2, soft: 0.1, wake: 0.3, terrain: 0.8, easing: 'smooth', front: { show: true, color: '#ffe9a6', width: 2.4, glow: 12 } } },
  { id: 'owner', name: 'In their colours', note: 'The front line and glow in the new owner\'s own colour.', set: { style: 'border', roughness: 0.1, soft: 0.2, wake: 0.35, terrain: 0, easing: 'smooth', front: { show: true, color: 'auto', width: 2.4, glow: 14 } } },
  { id: 'dissolve', name: 'Dissolve', note: 'No front: the land changes hands in soft patches.', set: { style: 'dissolve', roughness: 0, soft: 0.5, wake: 0.2, terrain: 0, easing: 'smooth', front: { show: false, color: '#ffe9a6', width: 2.2, glow: 10 } } },
  { id: 'fade', name: 'Fade', note: 'The new colour fades in over the old.', set: { style: 'fade', roughness: 0, soft: 0, wake: 0, terrain: 0, easing: 'smooth', front: { show: false, color: '#ffe9a6', width: 2.2, glow: 10 } } },
];

/** A look applied to transition settings: its parts set, the rest (when, how long) kept. */
export function withTransitionLook(t: ShotTransitions, id: string): ShotTransitions {
  const look = TRANSITION_LOOKS.find((l) => l.id === id);
  if (!look) return t;
  return { ...t, ...look.set, front: { ...t.front, ...(look.set.front ?? {}) }, look: id };
}

export const DEFAULT_TRANSITIONS: ShotTransitions = {
  mode: 'recorded', style: 'border', angle: 0, timing: 'seconds', seconds: 1.5, easing: 'smooth', restyleRecorded: false,
  front: { show: true, color: '#ffe9a6', width: 2.2, glow: 10 }, look: 'clean', roughness: 0, soft: 0, wake: 0, terrain: 0,
};

export function shotTransitions(shot: ShotSettings): ShotTransitions {
  const t = shot.transitions;
  const out = { ...DEFAULT_TRANSITIONS, ...(t ?? {}), front: { ...DEFAULT_TRANSITIONS.front, ...(t?.front ?? {}) } };
  if (out.style === 'wipe') out.style = 'border';
  const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  out.roughness = unit(out.roughness); out.soft = unit(out.soft); out.wake = unit(out.wake); out.terrain = unit(out.terrain);
  // A shot saved before looks (D137): the clean look if its settings are the clean look's, its own otherwise.
  if (t && t.look === undefined) {
    const clean = TRANSITION_LOOKS[0].set, f = clean.front!;
    const same = out.style === clean.style && out.easing === clean.easing && out.front.show === f.show && out.front.color === f.color && out.front.width === f.width && out.front.glow === f.glow;
    out.look = same ? 'clean' : 'custom';
  }
  return out;
}

/** An event's own transition look in presentations (D137): a look's id, from its presentation settings; null: the shot's. */
export function eventTransitionLook(presentation: string | null | undefined): string | null {
  try {
    const v = (presentation ? (JSON.parse(presentation) as { look?: unknown } | null) : null)?.look;
    return typeof v === 'string' && TRANSITION_LOOKS.some((l) => l.id === v) ? v : null;
  } catch { return null; }
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
    // (History at an even pace by default, D190: a year takes as long at the start as in the middle; the camera eases.)
    time: [{ frame: 0, at: toJSONValue(start), ease: 'linear' }, { frame: frames - 1, at: toJSONValue(end), ease: 'linear' }],
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

/** The moment a shot's trails start (D176): its first moment when it asks for that; otherwise null (each route's beginning). */
export const trailsStart = (shot: ShotSettings): Instant | null => (shot.trails && shot.trailsFrom === 'shot' ? shotFirstMoment(shot) : null);

/** The earliest moment a shot shows (its trails can start there, D176). */
export function shotFirstMoment(shot: ShotSettings): Instant {
  let first = fromJSONValue(shot.time[0].at);
  for (const k of shot.time) { const t = fromJSONValue(k.at); if (compare(t, first) < 0) first = t; }
  return first;
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
  const cam = interpolateCamera(a.camera, b.camera, f);
  if (shot.spin && cam.projection === 'globe') cam.lon = wrapLon(cam.lon - spinAt(shot, frame));
  return cam;
}

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
/** How far a turning globe (see ShotSettings.spin) has turned by a frame (degrees). */
const spinAt = (shot: ShotSettings, frame: number) => ((shot.spin ?? 0) * frame) / shot.fps;

/** A camera framed at a frame of a turning globe, as the shot keeps it (before its turn up to that frame). */
export function unspun(shot: ShotSettings, cam: Camera, frame: number): Camera {
  return shot.spin && cam.projection === 'globe' ? { ...cam, lon: wrapLon(cam.lon + spinAt(shot, frame)) } : cam;
}

/** An overlay to draw at a frame; a text box with how far it has come in and is from leaving (see textBoxState). */
export interface OverlayDraw { overlay: Overlay; text: string; alpha: number; enter?: number; exit?: number }

/** The overlays at a frame, their {date} written in `cal` (the calendar of the shot's map, D149). */
export function overlaysAt(shot: ShotSettings, frame: number, t: Instant, cal: Calendar = gregorian, stats: Statistic[] = []): OverlayDraw[] {
  // ({date}, then each statistic's {name}, D171.)
  const write = (text: string, p: Precision) => fillStatistics(text.replace(/\{date\}/g, cal.format(t, p)), stats, t);
  const out: OverlayDraw[] = [];
  for (const o of shot.overlays) {
    if (o.box) {
      const box = textBoxOf(o.box), st = textBoxState(shot, box, frame, t);
      if (st) out.push({ overlay: { ...o, box }, text: write(o.text, o.datePrecision), alpha: 1, enter: st.enter, exit: st.exit });
      continue;
    }
    if (frame < o.inFrame || frame > o.outFrame) continue;
    let alpha = 1;
    if (o.fade > 0) alpha = Math.min(1, (frame - o.inFrame + 1) / o.fade, (o.outFrame - frame + 1) / o.fade);
    out.push({ overlay: o, text: write(o.text, o.datePrecision), alpha });
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
  const gs = o.style ? graphicStyleOf(o.style) : null;
  const family = /[\s,]/.test(b.font) && !b.font.includes('"') ? `"${b.font}"` : b.font;
  ctx.save();
  ctx.font = `${b.italic ? 'italic ' : ''}${Math.round(b.weight)} ${size}px ${family}, "Segoe UI", Arial, sans-serif`;
  if (gs && 'letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${((gs.text.spacing / 100) * size).toFixed(1)}px`;
  const lines = wrapText(gs?.text.upper ? it.text.toLocaleUpperCase() : it.text, b.wrap * unit, (x) => ctx.measureText(x).width);
  const lineH = size * (gs?.text.lineHeight ?? 1.25), pad = b.padding * unit;
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
  // (Slides, growing, blurring and wiping in and out, D184.)
  let dx = 0, blur = 0, wipe = 1;
  for (const [kind, p] of [[b.enter, enter], [b.exit, exit]] as const) {
    if (!['slide-left', 'slide-right', 'slide-up', 'scale', 'blur', 'wipe'].includes(kind) || (gs && gs.stagger > 0 && kind !== 'wipe' && kind !== 'scale')) continue;
    const st = animState(kind, p, size);
    dx += st.dx; dy += st.dy; scale *= st.scale; blur += st.blur; alpha *= st.alpha; wipe = Math.min(wipe, st.wipe);
  }
  const box = { x: left - pad + dx, y: y - h / 2 - pad + dy, w: w + 2 * pad, h: h + 2 * pad };
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
  if (wipe < 1) { ctx.beginPath(); ctx.rect(box.x, box.y - box.h, box.w * wipe, box.h * 3); ctx.clip(); }
  if (blur > 0.05) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  if (gs) drawPanel(ctx, box.x, box.y, box.w, box.h, b.radius * unit, o.background, gs.panel, unit);
  else if (o.background) {
    ctx.fillStyle = o.background;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(b.radius * unit, box.w / 2, box.h / 2));
    ctx.fill();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = o.align;
  ctx.lineJoin = 'round';
  let left0 = shown;
  const inset = gs ? accentInset(gs.panel, unit) : 0;
  lines.forEach((line, i) => {
    let text = line;
    if (Number.isFinite(left0)) { const chars = [...line]; text = chars.slice(0, Math.max(0, left0)).join(''); left0 -= chars.length; }
    if (!text) return;
    const ly = y - h / 2 + dy + lineH * (i + 0.5);
    if (gs) {
      // Line after line (D184): each comes in on its own, a little after the one before.
      let lx = x + dx + (o.align === 'left' ? inset : 0);
      ctx.save();
      if (gs.stagger > 0) {
        const p = lineProgress(enter, i, lines.length, gs.stagger, b.seconds);
        const st = animState(['slide-left', 'slide-right', 'slide-up', 'blur', 'rise', 'fade'].includes(b.enter) ? b.enter : 'fade', p, size);
        ctx.globalAlpha *= st.alpha;
        lx += st.dx;
        if (st.blur > 0.05) ctx.filter = `blur(${st.blur.toFixed(1)}px)`;
        writeText(ctx, text, lx, ly + st.dy, size, o.color, { ...gs.text, upper: false }, unit, b.outline && b.outlineWidth > 0 ? { color: b.outline, width: 2 * b.outlineWidth * unit } : undefined);
      } else writeText(ctx, text, lx, ly, size, o.color, { ...gs.text, upper: false }, unit, b.outline && b.outlineWidth > 0 ? { color: b.outline, width: 2 * b.outlineWidth * unit } : undefined);
      ctx.restore();
      return;
    }
    if (b.outline && b.outlineWidth > 0) { ctx.strokeStyle = b.outline; ctx.lineWidth = 2 * b.outlineWidth * unit; ctx.strokeText(text, x + dx, ly); }
    ctx.fillStyle = o.color;
    ctx.fillText(text, x + dx, ly);
  });
  ctx.restore();
  return { id: o.id, ...box };
}

/**
 * Draw overlays onto a frame. Sizes are design pixels, scaled by `unit` (output width / 1920). Returns
 * where each went. `project` places a callout's point (D107) on the frame.
 */
/**
 * A text laid out steady, so that a date in it keeps its places as it changes from frame to frame:
 * every figure in a cell as wide as the widest figure, every month name centred in a cell as wide as the
 * widest month name; the rest as it is. The width is that of the steady layout (it does not change as the
 * figures and months do), and the runs are where each piece is drawn from the text's left end.
 */
export function steadyLayout(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string): { width: number; runs: Array<{ text: string; x: number; cell: number | null }> } {
  let digit = 0;
  for (const d of '0123456789') digit = Math.max(digit, ctx.measureText(d).width);
  let month = 0;
  for (const m of MONTH_NAMES) month = Math.max(month, ctx.measureText(m).width);
  const runs: Array<{ text: string; x: number; cell: number | null }> = [];
  let x = 0;
  const months = MONTH_NAMES.join('|');
  // (A day of the month, the number before a month's name, always takes two figures' room, set right.)
  const re = new RegExp(`(\\d{1,2})(?=\\s+(?:${months})\\b)|\\d|\\b(?:${months})\\b`, 'g');
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) { const t = text.slice(last, m.index); runs.push({ text: t, x, cell: null }); x += ctx.measureText(t).width; }
    if (m[1] !== undefined) {
      x += (2 - m[1].length) * digit;
      for (const d of m[1]) { runs.push({ text: d, x, cell: digit }); x += digit; }
    } else {
      const cell = /\d/.test(m[0]) ? digit : month;
      runs.push({ text: m[0], x, cell });
      x += cell;
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) { const t = text.slice(last); runs.push({ text: t, x, cell: null }); x += ctx.measureText(t).width; }
  return { width: x, runs };
}

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
    const x = o.x * width, y = o.y * height;
    // (Steady: a date's day and year keep their places, and the box its size, as the date changes. A text that
    // never changes, a title, is written as it is, D178: laid out steady, a month's name in it stood apart.)
    const lay = /\{[^}]+\}/.test(o.text) ? steadyLayout(ctx, it.text) : { width: ctx.measureText(it.text).width, runs: [{ text: it.text, x: 0, cell: null }] };
    const w = lay.width;
    const left = o.align === 'left' ? x : o.align === 'center' ? x - w / 2 : x - w;
    const gs = o.style ? graphicStyleOf(o.style) : null;
    if (gs) {
      // In a style of its own (D184): the date's or the title's panel and letters.
      const pad = size * 0.35, inset = accentInset(gs.panel, unit);
      drawPanel(ctx, left - pad - inset, y - size * 0.75, w + pad * 2 + inset, size * 1.5, size * 0.2, o.background, gs.panel, unit);
      for (const r of lay.runs) {
        ctx.textAlign = r.cell === null ? 'left' : 'center';
        writeText(ctx, r.text, r.cell === null ? left + r.x : left + r.x + r.cell / 2, y, size, o.color, { ...gs.text, upper: gs.text.upper, spacing: 0 }, unit);
      }
      ctx.restore();
      rects.push({ id: o.id, x: left - size * 0.35 - inset, y: y - size * 0.75, w: w + size * 0.7 + inset, h: size * 1.5 });
      continue;
    }
    if (o.background) {
      const pad = size * 0.35;
      ctx.fillStyle = o.background;
      ctx.beginPath();
      ctx.roundRect(left - pad, y - size * 0.75, w + pad * 2, size * 1.5, size * 0.2);
      ctx.fill();
    }
    ctx.fillStyle = o.color;
    for (const r of lay.runs) {
      ctx.textAlign = r.cell === null ? 'left' : 'center';
      ctx.fillText(r.text, r.cell === null ? left + r.x : left + r.x + r.cell / 2, y);
    }
    ctx.restore();
    rects.push({ id: o.id, x: left - size * 0.35, y: y - size * 0.75, w: w + size * 0.7, h: size * 1.5 });
  }
  return rects;
}
