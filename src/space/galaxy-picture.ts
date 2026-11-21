// A galaxy as a picture (D193): the Milky Way, or a galaxy of one's own, painted from its model as it
// would look from far above its plane. A bright bar and bulge of old yellow stars; spiral arms of young
// blue-white ones, broken into clouds and feathers; brown lanes of dust along the arms' inner edges and in
// threads between them; pink clouds where stars are being born, strung along the arms; and a grain of
// single stars. Everything is worked out from the place in the galaxy (light-years), never from the
// pixel, so the same galaxy painted small (while working) and large (baked) is the same picture, only
// with more or less of its fine detail. Pure arithmetic: the same bytes in Node, the browser and a worker.
import { seeded } from '../presentation/looks.ts';
import { samplePoint, type GalaxyArm, type GalaxyModel } from './galaxy.ts';

const RAD = Math.PI / 180;

/** Half the width of a galaxy's picture, light-years: its disc and some dark around it. */
export const pictureExtent = (m: GalaxyModel): number => m.radiusLy * 1.2;

/** What to paint: the galaxy, the seed of its clouds, and how many pixels across (square). */
export interface GalaxyPictureSpec { model: GalaxyModel; seed: number; size: number }

function grad3(h: number, a: number, b: number, c: number): number {
  h &= 15;
  const s = h < 8 ? a : b, t = h < 4 ? b : h === 12 || h === 14 ? a : c;
  return ((h & 1) === 0 ? s : -s) + ((h & 2) === 0 ? t : -t);
}
function grad2(h: number, a: number, b: number): number {
  h &= 7;
  const s = h < 4 ? a : b, t = h < 4 ? b : a;
  return ((h & 1) === 0 ? s : -s) + ((h & 2) === 0 ? 0.5 * t : -0.5 * t);
}

/** Gradient noise in two and three dimensions from a seed (Perlin's improved noise), about -1..1. */
class Noise {
  private p = new Uint8Array(512);
  constructor(seed: number) {
    const rnd = seeded(seed * 2654435761 + 97);
    const q = new Uint8Array(256);
    for (let i = 0; i < 256; i++) q[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = q[i]; q[i] = q[j]; q[j] = t; }
    for (let i = 0; i < 512; i++) this.p[i] = q[i & 255];
  }
  n3(x: number, y: number, z: number): number {
    const p = this.p;
    const X0 = Math.floor(x), Y0 = Math.floor(y), Z0 = Math.floor(z);
    x -= X0; y -= Y0; z -= Z0;
    const X = X0 & 255, Y = Y0 & 255, Z = Z0 & 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const g = grad3;
    const x1 = x - 1, y1 = y - 1, z1 = z - 1;
    const a0 = g(p[AA], x, y, z), a1 = g(p[BA], x1, y, z), a2 = g(p[AB], x, y1, z), a3 = g(p[BB], x1, y1, z);
    const b0 = g(p[AA + 1], x, y, z1), b1 = g(p[BA + 1], x1, y, z1), b2 = g(p[AB + 1], x, y1, z1), b3 = g(p[BB + 1], x1, y1, z1);
    const l0 = a0 + u * (a1 - a0), l1 = a2 + u * (a3 - a2), l2 = b0 + u * (b1 - b0), l3 = b2 + u * (b3 - b2);
    const m0 = l0 + v * (l1 - l0), m1 = l2 + v * (l3 - l2);
    return m0 + w * (m1 - m0);
  }
  n2(x: number, y: number): number {
    const p = this.p;
    const X0 = Math.floor(x), Y0 = Math.floor(y);
    x -= X0; y -= Y0;
    const X = X0 & 255, Y = Y0 & 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10);
    const g = grad2;
    const a = p[p[X] + Y], b = p[p[X + 1] + Y], c = p[p[X] + Y + 1], d = p[p[X + 1] + Y + 1];
    const l0 = g(a, x, y), l1 = g(b, x - 1, y), l2 = g(c, x, y - 1), l3 = g(d, x - 1, y - 1);
    const m0 = l0 + u * (l1 - l0), m1 = l2 + u * (l3 - l2);
    return (m0 + v * (m1 - m0)) * 1.2;
  }
}

/** A whole number scrambled into 0..1 (for a pixel's own stars). */
function hash2(i: number, j: number, s: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A cloud where stars are being born (pink) or a cluster of young stars (blue-white): where, how wide, how bright. */
interface Cloud { x: number; y: number; r: number; lum: number; kind: 0 | 1; turn: number }

/** An arm as the painter uses it. */
interface PaintArm { a: GalaxyArm; tan: number; cos: number; lnRef: number }

/** What is worked out once for a galaxy's picture (the same for every band of it). */
export interface GalaxyPainter {
  spec: GalaxyPictureSpec;
  /** Paints rows y0 (inclusive) to y1 (exclusive): RGBA, opaque, the light of the galaxy on black. */
  rows(y0: number, y1: number): Uint8ClampedArray;
}

/**
 * The clouds of a galaxy: star-forming regions and young clusters along its arms (most just outside the
 * arms' dust lanes, the brightest on the strongest arms), a few between them, and a crowd round the ends of the bar.
 */
function cloudsOf(m: GalaxyModel, seed: number): Cloud[] {
  const rnd = seeded(seed * 7919 + 13);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const S = m.radiusLy / 60000;
  const out: Cloud[] = [];
  const all = [...m.arms, ...(m.paintArms ?? [])];
  let total = 0;
  for (const a of all) total += a.weight * (a.to - a.from);
  const inner = m.bar ? m.bar.half * 0.85 : m.bulge * 2.5;
  const count = Math.round(430 * Math.min(2, Math.max(0.5, total / 1100)));
  for (let i = 0; i < count; i++) {
    let pick = rnd() * total, arm = all[0];
    for (const a of all) { pick -= a.weight * (a.to - a.from); if (pick <= 0) { arm = a; break; } }
    // (In clumps along the arm: several clouds near one another.)
    const beta = arm.from + rnd() * (arm.to - arm.from);
    const R = arm.rRef * Math.exp(-(beta - arm.betaRef) * RAD * Math.tan(arm.pitch * RAD));
    if (R < inner || R > m.radiusLy * 0.97) continue;
    const w = arm.width * (0.6 + 0.5 * Math.min(1, R / (m.radiusLy * 0.5)));
    const members = 1 + Math.floor(rnd() * rnd() * 4);
    const off = (-0.2 + gauss() * 0.42) * w;
    for (let k = 0; k < members; k++) {
      const th = Math.PI - (beta + gauss() * (0.7 * w / R / RAD)) * RAD, rr = R + off + gauss() * w * 0.18;
      const kind: 0 | 1 = rnd() < 0.62 ? 0 : 1;
      const big = rnd();
      const r = S * (kind === 0 ? 90 + 800 * big * big * big : 110 + 380 * big * big);
      const fade = 1 - smooth(0.62, 0.97, rr / m.radiusLy);
      out.push({ x: rr * Math.cos(th), y: rr * Math.sin(th), r, lum: (0.35 + 0.9 * rnd()) * (0.55 + 0.45 * arm.weight) * (0.25 + 0.75 * fade), kind, turn: rnd() * 100 });
    }
  }
  // Between the arms: a few, small and faint.
  for (let i = 0; i < count * 0.25; i++) {
    const r = m.radiusLy * (0.14 + 0.72 * Math.sqrt(rnd())), th = rnd() * Math.PI * 2;
    out.push({ x: r * Math.cos(th), y: r * Math.sin(th), r: S * (60 + 130 * rnd()), lum: 0.2 + 0.35 * rnd(), kind: rnd() < 0.5 ? 0 : 1, turn: rnd() * 100 });
  }
  // Round the ends of the bar, where the arms begin.
  if (m.bar) {
    const th0 = Math.PI - m.bar.angle * RAD;
    for (let i = 0; i < 90; i++) {
      const side = i % 2 ? 0 : Math.PI, th = th0 + side + gauss() * 0.55, r = m.bar.half * (0.95 + gauss() * 0.16);
      out.push({ x: r * Math.cos(th), y: r * Math.sin(th), r: S * (80 + 260 * rnd() * rnd()), lum: 0.4 + 0.7 * rnd(), kind: rnd() < 0.7 ? 0 : 1, turn: rnd() * 100 });
    }
  }
  return out;
}

/**
 * The galaxy's brightest single stars, where its stars lie: x, y, how wide its light spreads (light-years) and its
 * red, green and blue, six numbers each. Blue-white giants, white and yellow stars, a few orange and red ones.
 */
function brightStars(m: GalaxyModel, seed: number): Float32Array {
  const rnd = seeded(seed * 15485863 + 29);
  const S = m.radiusLy / 60000, count = 60000;
  const out = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const { p, part } = samplePoint(m, rnd, { bulge: 0.08, arms: 0.6 });
    const b = Math.pow(rnd(), 7) * 1.5 + 0.06, t = rnd();
    // (Arms: mostly blue-white; the middle: yellow and orange; anywhere: now and then a red giant.)
    const warm = part === 0 ? 0.75 : part === 1 ? 0.18 : 0.4;
    const col = t < warm * 0.25 ? [1, 0.55, 0.38] : t < warm ? [1, 0.86, 0.62] : t < warm + 0.25 ? [1, 0.98, 0.95] : [0.72, 0.82, 1];
    out.set([p[0], p[1], S * (20 + 26 * rnd()), b * col[0], b * col[1], b * col[2]], i * 6);
  }
  return out;
}

/** The painter of a galaxy's picture. */
export function galaxyPainter(spec: GalaxyPictureSpec): GalaxyPainter {
  const { model: m, size } = spec;
  const E = pictureExtent(m), px = (2 * E) / size;
  const S = m.radiusLy / 60000;
  const warp = new Noise(spec.seed + 1), streak = new Noise(spec.seed + 2), dustN = new Noise(spec.seed + 3), fine = new Noise(spec.seed + 4);
  const arms: PaintArm[] = [...m.arms, ...(m.paintArms ?? [])].map((a) => ({ a, tan: Math.tan(a.pitch * RAD), cos: Math.cos(a.pitch * RAD), lnRef: Math.log(a.rRef) }));
  const meanPitch = m.arms.length ? m.arms.reduce((s, a) => s + a.pitch * a.weight, 0) / m.arms.reduce((s, a) => s + a.weight, 0) : 14;
  // Streaks follow spirals: one set wound as the arms are (the arms' own clouds), one more open (feathers and dust).
  const cotA = 1 / Math.tan(Math.max(6, meanPitch) * RAD), cotF = 1 / Math.tan(Math.min(40, meanPitch * 2 + 4) * RAD);
  const bar = m.bar, barC = bar ? Math.cos(Math.PI - bar.angle * RAD) : 1, barS = bar ? Math.sin(Math.PI - bar.angle * RAD) : 0;
  const inner = bar ? bar.half * 0.8 : m.bulge * 2.2;
  const clouds = cloudsOf(m, spec.seed), stars = brightStars(m, spec.seed);
  const R = m.radiusLy, lnR0 = Math.log(R * 0.1);

  /** Octaves of noise drawn out along spirals: at the place whose spiral phase has cosine c and sine s, `around` cells round the galaxy, `along` per e-fold of radius. */
  const streaks = (n: Noise, c: number, s: number, lr: number, around: number, along: number, oct: number, ridged: boolean): number => {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      const v = n.n3(c * around * f + o * 17.3, s * around * f - o * 9.1, lr * along * f + o * 31.7);
      sum += amp * (ridged ? 1 - Math.abs(v) * 2 : v);
      norm += amp; amp *= 0.55; f *= 2;
    }
    return sum / norm;
  };
  /** Octaves of plain noise over the plane, the first `len` light-years across, none finer than the pixel. */
  const cloudy = (n: Noise, x: number, y: number, len: number, oct: number, ridged: boolean): number => {
    let sum = 0, amp = 1, norm = 0, l = len * S;
    for (let o = 0; o < oct && l > px * 2.2; o++) {
      const v = n.n2(x / l + o * 13.7, y / l - o * 7.9);
      sum += amp * (ridged ? 1 - Math.abs(v) * 2 : v);
      norm += amp; amp *= 0.55; l *= 0.5;
    }
    return norm ? sum / norm : 0;
  };

  const rows = (y0: number, y1: number): Uint8ClampedArray => {
    const h = y1 - y0, n = size * h;
    const lum = new Float32Array(n * 3), tauOf = new Float32Array(n);
    for (let j = y0; j < y1; j++) {
      const y = E - (j + 0.5) * px;
      for (let i = 0; i < size; i++) {
        const x = (i + 0.5) * px - E;
        const k = (j - y0) * size + i;
        const r0 = Math.hypot(x, y);
        // Single stars far outside the galaxy: few and faint.
        const hs = hash2(i + 7919, j - 104729, spec.seed + 5);
        if (r0 > R * 1.17) {
          if (hs < 0.0012 * Math.min(4, px / (35 * S))) { const b = Math.pow(hash2(i - 31, j + 57, spec.seed + 9), 4) * 0.5 + 0.03; lum[k * 3] = b; lum[k * 3 + 1] = b; lum[k * 3 + 2] = b * 1.1; }
          continue;
        }
        // The place, pushed about a little so that nothing is a perfect spiral.
        const w1x = warp.n2(x / (13000 * S), y / (13000 * S)), w1y = warp.n2(x / (13000 * S) + 37.7, y / (13000 * S) - 11.3);
        const w2x = warp.n2(x / (2600 * S) + 5.1, y / (2600 * S) + 8.7), w2y = warp.n2(x / (2600 * S) - 21.4, y / (2600 * S) + 44.2);
        const push = smooth(0.05, 0.3, r0 / R);
        const wx = x + (w1x * 2300 + w2x * 260) * S * push, wy = y + (w1y * 2300 + w2y * 260) * S * push;
        const r = Math.max(1, Math.hypot(wx, wy)), lnr = Math.log(r), rho = r / R, lr = lnr - lnR0;
        const betaRad = Math.PI - Math.atan2(wy, wx), beta = betaRad / RAD;
        // How much fine detail this pixel can hold at this radius (finer octaves would only flicker).
        const octA = Math.max(1, Math.min(5, Math.floor(Math.log2(r * 0.11 / px)) + 1));
        const octF = Math.max(1, Math.min(5, Math.floor(Math.log2(r * 0.055 / px)) + 1));

        // The arms: how near each is, on its inner side (toward the middle) or its outer.
        let armLight = 0, armBroad = 0, lane = 0, glowBand = 0;
        for (const pa of arms) {
          const a = pa.a;
          for (let turn = -1; turn <= 1; turn++) {
            const b = beta + 360 * turn;
            if (b < a.from - 25 || b > a.to + 25) continue;
            const lnRa = pa.lnRef - (b - a.betaRef) * RAD * pa.tan;
            const d = r * (lnr - lnRa) * pa.cos;
            const w = a.width * (0.6 + 0.5 * Math.min(1, r / (R * 0.5))) * (0.8 + 0.55 * a.weight);
            const strong = Math.pow(a.weight, 1.6);
            if (Math.abs(d) > w * 5) continue;
            const ends = smooth(a.from - 25, a.from + 45, b) * (1 - smooth(a.to - 50, a.to + 25, b));
            const q = d / w;
            const ridge = q < 0 ? Math.exp(-q * q / 0.85) : Math.exp(-q * q / 3.4);
            armLight += strong * ends * ridge;
            armBroad += strong * ends * Math.exp(-q * q / 7);
            const ql = (d + 0.8 * w) / (0.32 * w);
            lane += strong * ends * Math.exp(-ql * ql);
            const qp = (d + 0.45 * w) / (0.5 * w);
            glowBand += strong * ends * Math.exp(-qp * qp);
          }
        }
        const insideBar = smooth(inner * 0.55, inner * 1.7, r);
        armLight = Math.min(1.5, armLight) * insideBar; armBroad = Math.min(1.6, armBroad) * insideBar; lane = Math.min(1.5, lane) * smooth(inner * 0.45, inner * 1.2, r) * (0.15 + 0.85 * smooth(-0.2, 0.3, cloudy(warp, wx + 31000 * S, wy, 6500, 2, false)));

        // Clouds: drawn out along the arms, feathers more open than they are, and round ones of every size.
        const phiA = lr * cotA + betaRad, cA = Math.cos(phiA), sA_ = Math.sin(phiA);
        const phiF = lr * cotF + betaRad, cF = Math.cos(phiF), sF_ = Math.sin(phiF);
        const calm = smooth(0.03, 0.16, rho);
        const sA = streaks(streak, cA, sA_, lr, 2.6, 9, Math.min(3, octA), false) * calm;
        const sF = streaks(streak, cF, sF_, lr + 3.1, 5.2, 5, Math.min(3, octF), false) * calm;
        const puff = cloudy(fine, wx, wy, 3200, 5, false);
        // (Only a large picture holds these: the small clouds inside the clouds, and threads of dust as thin.)
        const mottle = px < 110 * S ? cloudy(fine, wx + 1234 * S, wy + 4321 * S, 420, 4, false) : 0;
        const wisps = px < 110 * S ? cloudy(dustN, wx - 2345 * S, wy + 987 * S, 520, 4, false) : 0;
        const flock = Math.max(0, 0.5 + 0.7 * sA + 0.3 * sF + 0.6 * puff);
        const clump = Math.max(0, 0.5 + 0.45 * sA + 0.25 * sF + 0.8 * puff + 0.4 * mottle);

        // The edge of the disc: ragged, and further out where an arm reaches it.
        const edge = 1 - smooth(0.84, 1.07, r0 / R * (1 + 0.035 * w2x) - 0.05 * Math.min(1, armBroad));
        // Old stars: the bulge, the bar, the disc.
        const bx = x * barC + y * barS, by = -x * barS + y * barC;
        const re = Math.hypot(bx * 0.8, by * 1.15);
        const bulge = Math.exp(-Math.pow(re / (m.bulge * 0.8), 0.9));
        const core = Math.exp(-r0 / (m.bulge * 0.14));
        let barLight = 0;
        if (bar) {
          const mm = Math.pow(Math.pow(Math.abs(bx) / (bar.half * 0.78), 2.2) + Math.pow(Math.abs(by) / (bar.width * 0.95), 2.2), 1 / 2.2);
          barLight = Math.exp(-mm * mm * 1.15);
        }
        const disc = Math.exp(-r / (m.disc * 1.6)) * edge * (bar ? 0.45 + 0.55 * smooth(inner * 0.4, inner * 1.6, r) : 1);
        const mid = Math.exp(-r / (m.disc * 3.5)) * edge;

        // Dust: lanes along the arms' inner edges, threads and blots between and across them, swirls into the middle.
        const dR = streaks(dustN, cF, sF_, lr, 6.5, 8, Math.min(4, octF), true) * calm;
        const dA = streaks(dustN, cA, sA_, lr + 1.7, 4.2, 20, Math.min(4, octA), true) * calm;
        const blot = cloudy(dustN, wx + 7000 * S, wy - 3000 * S, 2400, 5, true);
        const threads = Math.pow(Math.max(0, dR), 3) * 0.6 + Math.pow(Math.max(0, dA), 3) * 0.35 + Math.pow(Math.max(0, blot + 0.05), 4) * 0.4;
        const dustEnv = smooth(0.02, 0.1, rho) * (1 - smooth(0.55, 0.98, rho));
        const swirlN = streaks(dustN, cF, sF_, lr * 0.6 + 9.2, 2.2, 2.4, 3, true);
        const swirl = (1 - smooth(inner * 0.5, inner * 1.5, r)) * smooth(m.bulge * 0.2, m.bulge * 1.3, r0) * Math.pow(Math.max(0, swirlN * 0.8 + blot * 0.5 + 0.1), 2) * 2.4 * (1 - 0.85 * Math.min(1, barLight * 1.6));
        const gap = Math.max(0, 1 - armBroad * 1.3);
        const tau = dustEnv * (lane * (0.5 + 1.1 * Math.max(0, dA) + 0.5 * Math.max(0, dR) + 0.5 * Math.max(0, blot)) * (1.5 + 1.3 * (1 - smooth(0.25, 0.6, rho))) + threads * (0.3 + 0.8 * Math.min(1.2, armBroad)) + gap * 0.5 * (0.75 - 0.5 * puff) + Math.pow(Math.max(0, wisps + 0.05), 2) * 1.6 * (0.12 + Math.min(1, lane) + 0.25 * Math.min(1, armBroad))) + swirl;

        // Light, before the dust: red, green, blue. Old stars warm (bluer far out), young ones blue-white.
        const young = (armLight * (0.42 + 0.8 * clump) + armBroad * 0.1 * flock) * mid * 2.3 + mid * flock * flock * 0.1;
        const old = disc * (0.62 + 0.3 * puff + 0.2 * sA) * 0.95 + armBroad * disc * 0.35;
        const haze = Math.exp(-r / (m.disc * 6)) * (1 - smooth(0.9, 1.17, rho)) * 0.08 * (0.6 + 0.6 * flock);
        // Glowing gas along the arms' inner edges, in ragged patches.
        const pinkN = cloudy(fine, wx - 9100 * S, wy + 4700 * S, 1700, 4, false);
        const pink = Math.min(1.3, glowBand) * insideBar * Math.pow(Math.max(0, pinkN + 0.05), 2) * mid * 9;
        const cool = smooth(0.15, 0.6, rho);
        let cr = old * (1.0 - 0.2 * cool) + young * 0.66 + haze * 0.42 + bulge * 1.2 + barLight * 1.7 + core * 3.4;
        let cg = old * (0.85 - 0.05 * cool) + young * 0.78 + haze * 0.55 + bulge * 1.02 + barLight * 1.42 + core * 3.2;
        let cb = old * (0.64 + 0.24 * cool) + young * 1.0 + haze * 1.0 + bulge * 0.7 + barLight * 0.98 + core * 2.7;
        // The dust dims the light behind it (the blue most: what shows through is browner); some stars stand in front.
        const front = 0.16;
        cr *= front + (1 - front) * Math.exp(-tau * 0.66);
        cg *= front + (1 - front) * Math.exp(-tau * 1.1);
        cb *= front + (1 - front) * Math.exp(-tau * 1.6);
        const through = Math.exp(-tau * 0.3);
        cr += pink * 1.0 * through; cg += pink * 0.3 * through; cb += pink * 0.45 * through;

        // Single stars: a grain over everything, a bright one now and then.
        const density = cr + cg + cb;
        const g = 0.84 + 0.32 * hash2(i, j, spec.seed);
        cr *= g; cg *= g; cb *= g;
        const chance = Math.min(0.12, (0.0012 + density * 0.02) * Math.min(4, px / (35 * S)));
        if (hs < chance) {
          const b = Math.pow(hash2(i - 31, j + 57, spec.seed + 9), 5) * 1.1 + 0.04, t = hash2(i + 3, j + 11, spec.seed + 2);
          cr += b * (0.8 + 0.2 * t); cg += b * 0.85; cb += b * (1 - 0.25 * t);
        }
        lum[k * 3] = cr; lum[k * 3 + 1] = cg; lum[k * 3 + 2] = cb;
        tauOf[k] = tau;
      }
    }

    // The clouds, laid over the band: pink where stars are being born (white-hot at their hearts), blue-white clusters.
    const yTop = E - y0 * px, yBot = E - y1 * px;
    for (const c of clouds) {
      const reach = Math.max(c.r * 2.6, px * 1.5);
      if (c.y - reach > yTop || c.y + reach < yBot) continue;
      const i0 = Math.max(0, Math.floor((c.x - reach + E) / px)), i1 = Math.min(size - 1, Math.ceil((c.x + reach + E) / px));
      const j0 = Math.max(y0, Math.floor((E - c.y - reach) / px)), j1 = Math.min(y1 - 1, Math.ceil((E - c.y + reach) / px));
      // (A cloud smaller than a pixel keeps its light: as bright, spread over the pixel.)
      const rr = Math.max(c.r, px * 0.6), keep = (c.r * c.r) / (rr * rr);
      for (let j = j0; j <= j1; j++) {
        const y = E - (j + 0.5) * px;
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * px - E;
          const dx = x - c.x, dy = y - c.y;
          // (Ragged: its edge pushed in and out.)
          const rag = c.r > px * 1.5 ? 1 + 0.45 * fine.n2(dx / c.r * 1.6 + c.turn, dy / c.r * 1.6 - c.turn) : 1;
          const d2 = (dx * dx + dy * dy) / (rr * rr * rag * rag);
          if (d2 > 6.5) continue;
          const k = (j - y0) * size + i;
          const v = Math.exp(-d2 * 1.1) * c.lum * keep * (0.3 + 0.7 * Math.exp(-tauOf[k] * 0.35));
          const heart = Math.exp(-d2 * 5) * c.lum * keep;
          if (c.kind === 0) {
            lum[k * 3] += v * 1.15 + heart * 1.3; lum[k * 3 + 1] += v * 0.28 + heart * 1.0; lum[k * 3 + 2] += v * 0.48 + heart * 1.05;
          } else {
            lum[k * 3] += v * 0.5 + heart * 0.5; lum[k * 3 + 1] += v * 0.62 + heart * 0.55; lum[k * 3 + 2] += v * 0.9 + heart * 0.6;
          }
        }
      }
    }

    // The brightest single stars: points of their own colours.
    for (let q = 0; q < stars.length; q += 6) {
      const sx = stars[q], sy = stars[q + 1], sr = stars[q + 2];
      const rr = Math.max(sr, px * 0.55), reach = rr * 2.2;
      if (sy - reach > yTop || sy + reach < yBot) continue;
      const keep = (sr * sr) / (rr * rr);
      const i0 = Math.max(0, Math.floor((sx - reach + E) / px)), i1 = Math.min(size - 1, Math.floor((sx + reach + E) / px));
      const j0 = Math.max(y0, Math.floor((E - sy - reach) / px)), j1 = Math.min(y1 - 1, Math.floor((E - sy + reach) / px));
      for (let j = j0; j <= j1; j++) {
        const dy = E - (j + 0.5) * px - sy;
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5) * px - E - sx;
          const k = (j - y0) * size + i;
          const v = Math.exp(-(dx * dx + dy * dy) / (rr * rr) * 2.4) * keep * (0.35 + 0.65 * Math.exp(-tauOf[k] * 0.6));
          lum[k * 3] += v * stars[q + 3]; lum[k * 3 + 1] += v * stars[q + 4]; lum[k * 3 + 2] += v * stars[q + 5];
        }
      }
    }

    // From light to a picture: bright parts roll off softly instead of burning out.
    const out = new Uint8ClampedArray(n * 4);
    const tone = (v: number): number => 255 * Math.pow(1 - Math.exp(-v * 2.1), 0.8);
    for (let k = 0; k < n; k++) {
      out[k * 4] = tone(lum[k * 3]); out[k * 4 + 1] = tone(lum[k * 3 + 1]); out[k * 4 + 2] = tone(lum[k * 3 + 2]); out[k * 4 + 3] = 255;
    }
    return out;
  };
  return { spec, rows };
}

/** A galaxy's whole picture (RGBA, `size` square). */
export function galaxyPicture(spec: GalaxyPictureSpec): Uint8ClampedArray {
  return galaxyPainter(spec).rows(0, spec.size);
}
