// Generated border shifts (D195). A change drawn in an event says what the map looks like before and after:
// land that one country gains. Where there is no time to draw every shift of the border in between, they are
// generated: at each step of time chosen, the land the gainer holds by then, as real changes of who holds
// what (not a picture of a border moving).
//
// How far the gainer has come at each place is the change's field of arrival times (render-engine/front-field.ts:
// the front travels through the land itself from the border with the gainer's own land, round bays and down
// arms). To that a field of smooth chance is added that drifts from step to step: where it runs ahead the
// gainer has pushed on, where it falls behind it has been held, and where it falls behind what was reached a
// step before, the other side has pushed back and holds that land again. The front's own level rises evenly
// from step to step, so on the whole the gainer gains: every step leaves it more land than the last (a step
// that would not is given less chance until it does), and after the last step it holds all of the change.
import type { FrontField } from '../render-engine/front-field.ts';
import { seeded } from '../presentation/looks.ts';

export interface ShiftSettings {
  /** How many steps before the last (at which the gainer holds everything): 1 to 60. */
  steps: number;
  /** How much the other side pushes back, 0 (never: the border only advances) to 1 (often and far). */
  pushBack: number;
  /** A number for the pattern of chance: the same settings and number, the same shifts. */
  seed: number;
}

/** A step of the shifts: the field as it stands then, and the level reached (the land held: cells of the change with `field.at` up to `level`). */
export interface ShiftStep { field: FrontField; level: number; cells: number }

export const MAX_SHIFT_STEPS = 60;

/** Smooth chance over a grid and through the steps: -1 to 1, smooth in each direction. */
function chance(seed: number): (x: number, y: number, z: number) => number {
  const rnd = seeded(seed * 2654435761 + 1013904223);
  const p = new Uint8Array(512), g = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    p[i] = i;
    // (A direction on the sphere for each corner.)
    const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
    g[i * 3] = r * Math.cos(a); g[i * 3 + 1] = r * Math.sin(a); g[i * 3 + 2] = z;
  }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 256; i++) p[256 + i] = p[i];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = x - X, fy = y - Y, fz = z - Z;
    const u = fade(fx), v = fade(fy), w = fade(fz);
    let sum = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2;
      const h = p[p[p[(X + dx) & 255] + ((Y + dy) & 255)] + ((Z + dz) & 255)] * 3;
      const dot = g[h] * (fx - dx) + g[h + 1] * (fy - dy) + g[h + 2] * (fz - dz);
      sum += dot * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return Math.max(-1, Math.min(1, sum * 1.9));
  };
}

/**
 * The steps of a change's border shifts: for each, the field of arrival times as chance has moved it and the
 * level reached. The land held at a step is the change's cells whose time is up to the level; step by step
 * it grows on the whole, giving back a piece here and there when `pushBack` is above 0. (The last step of
 * all, the gainer holding the whole change, is not among them: it needs no field.)
 */
export function borderShiftSteps(field: FrontField, o: ShiftSettings): ShiftStep[] {
  const steps = Math.max(1, Math.min(MAX_SHIFT_STEPS, Math.round(o.steps)));
  const pushBack = Math.max(0, Math.min(1, o.pushBack));
  const { nx, ny, at, inside } = field, n = nx * ny;
  const noise = chance(o.seed);
  // Chance in patches about a seventh of the change across, changing by most of itself from a step to the next;
  // strong enough at full push-back to undo a few steps' gains where it turns against the gainer.
  const size = Math.max(4, Math.max(nx, ny) / 7), drift = 0.7;
  const amp = pushBack * Math.min(0.42, 4 / (steps + 1));
  const out: ShiftStep[] = [];
  let before: Float32Array | null = null, beforeCells = 0;
  const held = (a: Float32Array, level: number) => { let c = 0; for (let k = 0; k < n; k++) if (inside[k] && a[k] <= level) c++; return c; };
  // No specks: a patch of land held or not held that is smaller than about a two-hundredth of the change, and is
  // not the largest of its kind, goes with the land around it (no enclave of a few kilometres left behind the front,
  // no island of the gainer's far ahead of it).
  let all = 0;
  for (let k = 0; k < n; k++) if (inside[k]) all++;
  const least = Math.max(6, Math.round(all / 200));
  const seen = new Int32Array(n), stack = new Int32Array(n);
  let mark = 0;
  const tidy = (a: Float32Array, level: number) => {
    const groups: Array<{ reached: boolean; cells: number[] }> = [];
    mark++;
    for (let k0 = 0; k0 < n; k0++) {
      if (!inside[k0] || seen[k0] === mark) continue;
      const reached = a[k0] <= level, cells: number[] = [];
      let top = 0;
      stack[top++] = k0; seen[k0] = mark;
      while (top) {
        const k = stack[--top], i = k % nx;
        cells.push(k);
        for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) {
          if (q < 0 || q >= n || !inside[q] || seen[q] === mark || (a[q] <= level) !== reached) continue;
          seen[q] = mark; stack[top++] = q;
        }
      }
      groups.push({ reached, cells });
    }
    for (const kind of [true, false]) {
      const mine = groups.filter((g) => g.reached === kind);
      const largest = Math.max(0, ...mine.map((g) => g.cells.length));
      for (const g of mine) {
        if (g.cells.length >= least || g.cells.length === largest) continue;
        for (const k of g.cells) a[k] = kind ? level + 0.02 : level - 0.02;
      }
    }
  };
  for (let s = 0; s < steps; s++) {
    const level = (s + 1) / (steps + 1);
    const moved = new Float32Array(n), shift = new Float32Array(n);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      // (Two sizes of patch: salients and, within them, smaller gains and losses.)
      shift[k] = amp * (0.7 * noise(i / size, j / size, s * drift) + 0.3 * noise((i / size) * 2.3 + 40, (j / size) * 2.3 + 17, s * drift * 1.7 + 9));
    }
    // With all of this step's chance, or less of it until the gainer holds more than a step before.
    let cells = 0;
    for (const share of [1, 0.6, 0.3, 0]) {
      for (let k = 0; k < n; k++) {
        const b: number = before ? before[k] - at[k] : 0;
        moved[k] = Number.isFinite(at[k]) ? at[k] + b + share * (shift[k] - b) : at[k];
      }
      tidy(moved, level);
      cells = held(moved, level);
      if (cells > beforeCells || share === 0) break;
    }
    out.push({ field: { ...field, at: moved }, level, cells });
    before = moved; beforeCells = cells;
  }
  return out;
}

/** How much of the change's land (0 to 1) is held at a step. */
export function shareHeld(field: FrontField, step: ShiftStep): number {
  let all = 0;
  for (let k = 0; k < field.inside.length; k++) if (field.inside[k]) all++;
  return all ? step.cells / all : 0;
}

/** The dates of the steps: from `start` every `every`, while before `until` (at most MAX_SHIFT_STEPS; the last step of all is at `until`). */
export function shiftDates<T>(start: T, until: T, next: (t: T) => T, before: (a: T, b: T) => boolean): T[] {
  const out: T[] = [];
  for (let t = start; before(t, until) && out.length <= MAX_SHIFT_STEPS; t = next(t)) out.push(t);
  return out;
}
