// Draws the app icon (build/icon.png, 512 x 512) without any image tools: a dark tile with the
// globe, a painted territory and its border, in the app's own colours. electron-builder turns it
// into the Windows .ico.   node --disable-warning=ExperimentalWarning scripts/make-icon.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/export/png.ts';

const S = 512, SS = 4; // size and supersampling per axis
type RGBA = [number, number, number, number];
const hex = (h: string, a = 1): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];

// Colour of one sub-pixel at (x, y) in 0..1 coordinates; null is transparent.
function shade(x: number, y: number): RGBA | null {
  // rounded tile
  const r = 0.2, m = 0.03;
  const qx = Math.max(Math.abs(x - 0.5) - (0.5 - m - r), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - m - r), 0);
  if (Math.hypot(qx, qy) > r) return null;
  const tile = hex('#0e141a');
  // globe (orthographic, centred slightly west of Africa)
  const cx = 0.5, cy = 0.5, R = 0.34;
  const dx = (x - cx) / R, dy = (y - cy) / R, d2 = dx * dx + dy * dy;
  if (d2 > 1) return d2 < 1.06 * 1.06 ? hex('#4f9bd9', 0.9) : tile; // a thin blue rim
  const z = Math.sqrt(1 - d2);
  const lat = Math.asin(-dy) * 180 / Math.PI, lon = Math.atan2(dx, z) * 180 / Math.PI + 10;
  // land: a few soft continents in lon/lat
  const blob = (lo: number, la: number, rx: number, ry: number) => ((lon - lo) / rx) ** 2 + ((lat - la) / ry) ** 2;
  const land = Math.min(blob(15, 5, 26, 36), blob(-55, 0, 18, 30), blob(30, 45, 40, 14), blob(-20, 62, 14, 8));
  const territory = blob(5, 22, 22, 16);
  let c: RGBA;
  if (land < 1) c = territory < 1 ? hex('#c8553d') : hex('#3b4a3f');
  else c = hex('#14324a');
  if (land < 1 && Math.abs(territory - 1) < 0.07) c = hex('#ffd166'); // the border
  // grid
  if (land >= 1 && (Math.abs(((lon % 30) + 30) % 30 - 15) > 14.2 || Math.abs(((lat % 30) + 30) % 30 - 15) > 14.2)) c = hex('#24506f');
  // light from the upper left
  const light = 0.65 + 0.35 * Math.max(0, -0.45 * dx - 0.55 * dy + 0.7 * z);
  return [c[0] * light, c[1] * light, c[2] * light, 1];
}

const px = new Uint8Array(S * S * 4);
for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
  let r = 0, g = 0, b = 0, a = 0;
  for (let v = 0; v < SS; v++) for (let u = 0; u < SS; u++) {
    const c = shade((i + (u + 0.5) / SS) / S, (j + (v + 0.5) / SS) / S);
    if (!c) continue;
    r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
  }
  const k = (j * S + i) * 4, n = SS * SS;
  px[k + 3] = Math.round((255 * a) / n);
  if (a > 0) { px[k] = Math.round(r / a); px[k + 1] = Math.round(g / a); px[k + 2] = Math.round(b / a); }
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon.png'), encodePNG(S, S, px));
console.log(`wrote ${join(out, 'icon.png')}`);
