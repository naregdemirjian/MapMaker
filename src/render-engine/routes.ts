// Routes (Stage 10, D106): a line drawn as a broad campaign arrow that grows along its path, and marks
// that flow along a line in its direction (dashes, chevrons, dots) as a shot plays. Pure geometry on
// screen points (x and y in turn), so that it can be tested apart from the renderer.

/** A line with its corners rounded off (Chaikin's corner cutting, `rounds` times); its ends stay where they are. */
export function smoothLine(l: Float32Array, rounds = 2): Float32Array {
  let cur = l;
  for (let r = 0; r < rounds; r++) {
    const n = cur.length >> 1;
    if (n < 3) return cur;
    const out = new Float32Array(2 * (2 * n - 2));
    let o = 0;
    out[o++] = cur[0]; out[o++] = cur[1];
    for (let i = 0; i < n - 1; i++) {
      const x0 = cur[2 * i], y0 = cur[2 * i + 1], x1 = cur[2 * i + 2], y1 = cur[2 * i + 3];
      if (i > 0) { out[o++] = 0.75 * x0 + 0.25 * x1; out[o++] = 0.75 * y0 + 0.25 * y1; }
      if (i < n - 2) { out[o++] = 0.25 * x0 + 0.75 * x1; out[o++] = 0.25 * y0 + 0.75 * y1; }
    }
    out[o++] = cur[2 * n - 2]; out[o++] = cur[2 * n - 1];
    cur = out;
  }
  return cur;
}

/** The length of a line (pixels). */
export function lineLength(l: Float32Array): number {
  let len = 0;
  for (let i = 2; i + 1 < l.length; i += 2) len += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
  return len;
}

/** The line as points every `step` pixels along it (its last point always included). */
export function resample(l: Float32Array, step: number): Float32Array {
  const n = l.length >> 1;
  if (n < 2) return l;
  const out: number[] = [l[0], l[1]];
  let carry = 0;
  for (let i = 1; i < n; i++) {
    const x0 = l[2 * i - 2], y0 = l[2 * i - 1], x1 = l[2 * i], y1 = l[2 * i + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (!d) continue;
    let s = step - carry;
    while (s < d) { out.push(x0 + ((x1 - x0) * s) / d, y0 + ((y1 - y0) * s) / d); s += step; }
    carry = d - (s - step);
  }
  const lx = out[out.length - 2], ly = out[out.length - 1];
  if (Math.hypot(l[2 * n - 2] - lx, l[2 * n - 1] - ly) > 1e-3) out.push(l[2 * n - 2], l[2 * n - 1]);
  return Float32Array.from(out);
}

/** How wide a campaign arrow's head is and how long, for a body `width` wide. */
export const ARROW_HEAD = { width: 2, length: 1.35 };

/**
 * The outline of a campaign arrow along a line (a closed ring of screen points): a broad body,
 * `width` pixels across where it meets the head, narrowing to `taper` of that at its tail, and a head
 * twice as wide at the line's end. The line is smoothed first. Null for a line too short to show.
 */
export function campaignArrow(l: Float32Array, width: number, taper = 0.35): Float32Array | null {
  const path = resample(smoothLine(l, 3), Math.max(1, width / 6));
  const n = path.length >> 1;
  if (n < 2 || width <= 0) return null;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(path[2 * i] - path[2 * i - 2], path[2 * i + 1] - path[2 * i - 1]);
  const L = s[n - 1];
  if (L < 1) return null;
  const headLen = Math.min(L * 0.5, width * ARROW_HEAD.length), bodyEnd = L - headLen;
  const tipX = path[2 * n - 2], tipY = path[2 * n - 1];
  // Where the head starts (between two points of the path).
  let j = 1;
  while (j < n - 1 && s[j] < bodyEnd) j++;
  const f = s[j] > s[j - 1] ? (bodyEnd - s[j - 1]) / (s[j] - s[j - 1]) : 0;
  const bx = path[2 * j - 2] + (path[2 * j] - path[2 * j - 2]) * f, by = path[2 * j - 1] + (path[2 * j + 1] - path[2 * j - 1]) * f;
  // The head points from where it starts to the tip; the body meets it square.
  let hx = tipX - bx, hy = tipY - by, hl = Math.hypot(hx, hy);
  if (hl < 1e-6) { hx = path[2 * n - 2] - path[2 * n - 4]; hy = path[2 * n - 1] - path[2 * n - 3]; hl = Math.hypot(hx, hy) || 1; }
  hx /= hl; hy /= hl;
  const half = (at: number) => { const x = bodyEnd > 0 ? Math.min(1, at / bodyEnd) : 1; return (width / 2) * (taper + (1 - taper) * (1 - (1 - x) * (1 - x))); };
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i < j; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let tx = path[2 * b] - path[2 * a], ty = path[2 * b + 1] - path[2 * a + 1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    // Close to the head, the body turns to meet it square.
    const blend = bodyEnd > 0 ? Math.max(0, 1 - (bodyEnd - s[i]) / Math.max(1, width)) : 1;
    let nx = -(ty * (1 - blend) + hy * blend), ny = tx * (1 - blend) + hx * blend;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const w = half(s[i]), x = path[2 * i], y = path[2 * i + 1];
    left.push(x + nx * w, y + ny * w);
    right.push(x - nx * w, y - ny * w);
  }
  const wEnd = half(bodyEnd), hw = (width * ARROW_HEAD.width) / 2, nx = -hy, ny = hx;
  left.push(bx + nx * wEnd, by + ny * wEnd);
  right.push(bx - nx * wEnd, by - ny * wEnd);
  const out: number[] = [...left, bx + nx * hw, by + ny * hw, tipX, tipY, bx - nx * hw, by - ny * hw];
  for (let i = right.length - 2; i >= 0; i -= 2) out.push(right[i], right[i + 1]);
  return Float32Array.from(out);
}

/** Where a campaign arrow's body ends along its (smoothed) line, for marks that stay inside it. */
export function arrowBodyLength(length: number, width: number): number {
  return Math.max(0, length - Math.min(length * 0.5, width * ARROW_HEAD.length));
}

/**
 * Marks every `spacing` pixels along a line, all moved `offset` pixels along it (so that a growing
 * offset carries them toward its end), between `from` and `to` pixels along it: where each mark is and
 * the line's direction there (radians).
 */
export function marksAlong(l: Float32Array, spacing: number, offset: number, from = 0, to = Infinity): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const n = l.length >> 1;
  if (n < 2 || !(spacing > 0)) return out;
  const phase = ((offset % spacing) + spacing) % spacing;
  let want = from + phase, at = 0;
  for (let i = 1; i < n && out.length < 100000; i++) {
    const x0 = l[2 * i - 2], y0 = l[2 * i - 1], x1 = l[2 * i], y1 = l[2 * i + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (!d) continue;
    while (want <= at + d && want <= to) {
      const f = (want - at) / d;
      out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, Math.atan2(y1 - y0, x1 - x0)]);
      want += spacing;
    }
    at += d;
    if (want > to) break;
  }
  return out;
}

/** The part of a line between `from` and `to` pixels along it. */
export function cutLineBetween(l: Float32Array, from: number, to: number): Float32Array {
  const n = l.length >> 1;
  const out: number[] = [];
  let at = 0;
  for (let i = 1; i < n; i++) {
    const x0 = l[2 * i - 2], y0 = l[2 * i - 1], x1 = l[2 * i], y1 = l[2 * i + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const a = Math.max(from, at), b = Math.min(to, at + d);
    if (d && b >= a) {
      if (!out.length) out.push(x0 + ((x1 - x0) * (a - at)) / d, y0 + ((y1 - y0) * (a - at)) / d);
      out.push(x0 + ((x1 - x0) * (b - at)) / d, y0 + ((y1 - y0) * (b - at)) / d);
    }
    at += d;
    if (at >= to) break;
  }
  return Float32Array.from(out);
}

/** A colour (#rgb, #rrggbb or rgb()/rgba()) mixed with another by `f` (0: the first, 1: the second); others as given. */
export function mixColor(a: string, b: string, f: number): string {
  const pa = parseRgb(a), pb = parseRgb(b);
  if (!pa || !pb) return a;
  const m = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * f);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

function parseRgb(c: string): [number, number, number] | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
