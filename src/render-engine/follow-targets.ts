// The lines a smart brush can draw a line to (Stage 12, D148), near where it is drawn, on screen: rivers (the
// Earth's from Natural Earth at the detail shown, a planet's worked out from its heights), coasts and lake
// shores, and today's borders. Lines are looked at only where their box comes near the drawing.
import { lonLatToScreen, type View } from './camera.ts';
import type { BasemapScale } from './basemap.ts';
import type { SmartFeature, SmartLineKind } from './smart-brush.ts';
import type { Pt } from './stroke.ts';

/** West, south, east, north in degrees. */
export type LonLatBox = [number, number, number, number];

const boxes = new WeakMap<object, LonLatBox[]>();
/** The box of each line of a set (kept with the set). */
function boxesOf(lines: number[][][]): LonLatBox[] {
  let b = boxes.get(lines);
  if (!b) {
    b = lines.map((l) => {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of l) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
      return [w, s, e, n];
    });
    boxes.set(lines, b);
  }
  return b;
}

/** Whether two boxes meet (longitudes compared also a turn either way). */
export function boxesMeet(a: LonLatBox, b: LonLatBox): boolean {
  if (a[3] < b[1] || a[1] > b[3]) return false;
  for (const turn of [0, 360, -360]) if (!(a[2] + turn < b[0] || a[0] + turn > b[2])) return true;
  return false;
}

/**
 * The lines of a set that come near `near`, on screen. A line is cut where it leaves the map or jumps across it
 * (round the back of the planet); a loop (first point repeated at its end) stays a loop when it is whole.
 */
export function linesOnScreen(view: View, lines: number[][][], kind: SmartLineKind, near: LonLatBox, out: SmartFeature[]): void {
  const bx = boxesOf(lines);
  const jump = Math.max(view.width, view.height) / 2;
  for (let i = 0; i < lines.length; i++) {
    if (!boxesMeet(bx[i], near)) continue;
    const l = lines[i];
    const loop = l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];
    const pts = loop ? l.slice(0, -1) : l;
    let piece: Pt[] = [];
    let cut = false;
    const flush = () => { if (piece.length >= 2) out.push({ pts: piece, kind }); piece = []; };
    for (const q of pts) {
      const p = lonLatToScreen(view, q[0], q[1]);
      const last = piece[piece.length - 1];
      if (!p || (last && Math.hypot(p[0] - last[0], p[1] - last[1]) > jump)) { cut = true; flush(); if (p) piece.push(p); continue; }
      piece.push(p);
    }
    if (loop && !cut && piece.length >= 3) { out.push({ pts: piece, kind, closed: true }); continue; }
    flush();
  }
}

/** Every lake's shores as lines (kept with the lakes). */
const lakeShores = new WeakMap<object, number[][][]>();

/** What a map offers a smart brush: the Earth of today its rivers, coasts and lakes, and today's borders; a planet its rivers; any map with heights its ridges and valleys. */
export function followOffered(earthToday: boolean, heights: 'earth' | 'planet' | 'paleo' | 'sim' | null): { rivers: boolean; coasts: boolean; today: boolean; heights: boolean } {
  return { rivers: earthToday || heights === 'planet', coasts: earthToday, today: earthToday, heights: heights !== null };
}

/** The lines near a box, on screen: from the Earth's geography at the detail shown, and a planet's rivers. */
export function followTargets(view: View, near: LonLatBox, want: { rivers: boolean; coasts: boolean; today: boolean }, earth: BasemapScale | null, planetRivers: { lines: GeoJSON.MultiLineString } | null): SmartFeature[] {
  const out: SmartFeature[] = [];
  if (want.rivers) {
    const r = earth?.rivers ?? planetRivers;
    if (r) linesOnScreen(view, r.lines.coordinates, 'river', near, out);
  }
  if (want.coasts && earth) {
    linesOnScreen(view, earth.coastline.coordinates, 'coast', near, out);
    let shores = lakeShores.get(earth.lakes);
    if (!shores) lakeShores.set(earth.lakes, (shores = earth.lakes.coordinates.flat()));
    linesOnScreen(view, shores, 'coast', near, out);
  }
  if (want.today && earth) linesOnScreen(view, earth.borders.coordinates, 'today', near, out);
  return out;
}
