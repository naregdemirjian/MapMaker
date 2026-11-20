// The sea's currents (Stage 14.7, D158; 15.3, D165): wind-driven gyres in every basin (Stommel 1948; Munk 1950).
// Their geometry, from each basin's shores: warm currents along the western sides of oceans in the subtropics and
// mid-latitudes, cold ones along the eastern sides; at high latitudes the warm drift arriving on the eastern side and
// cold water coming down the western; and the heat they carry, as a source in the energy balance.
import type { Mesh } from '../mesh/icosphere.ts';
import type { Derived } from '../model/physics.ts';

/**
 * The sea surface's change from the currents (K): warm along each basin's western side, cool along its eastern side
 * (between about 10° and 45°), warm on the eastern side at high latitudes where the warm drift arrives, fading with
 * distance from the shore (about 1,000 km); on land a little of it, fading inland.
 */
export function currentAnomaly(mesh: Mesh, land: ArrayLike<number>, x: Derived): Float64Array {
  const n = mesh.n, W = 180, H = 90, grid = new Uint8Array(W * H);
  // A raster of the land (2° cells), from the mesh.
  for (let c = 0; c < n; c++) {
    if (land[c] < 0.5) continue;
    const i = Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * W) % W, j = Math.min(H - 1, Math.floor(((Math.PI / 2 - mesh.lat[c]) / Math.PI) * H));
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const jj = j + dj, ii = (i + di + W) % W;
      if (jj >= 0 && jj < H && Math.hypot(di, dj) < 1.2) grid[jj * W + ii] = 1;
    }
  }
  const out = new Float64Array(n);
  if (!(x.cellsPerHemisphere >= 2) || x.tidallyLocked) return out;
  const R = x.radiusM / 1000, L = 1000;
  for (let c = 0; c < n; c++) {
    if (land[c] >= 0.5) continue;
    const lat = (mesh.lat[c] * 180) / Math.PI, a = Math.abs(lat);
    const i0 = Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * W) % W, j = Math.min(H - 1, Math.floor(((Math.PI / 2 - mesh.lat[c]) / Math.PI) * H));
    const kmPerCell = ((2 * Math.PI * R) / W) * Math.cos(mesh.lat[c]);
    // Distance to the shore to the west and to the east, along the parallel (within half the world).
    let dw = Infinity, de = Infinity;
    for (let s = 1; s < W / 2; s++) { if (grid[j * W + ((i0 - s + W) % W)]) { dw = s * kmPerCell; break; } }
    for (let s = 1; s < W / 2; s++) { if (grid[j * W + ((i0 + s) % W)]) { de = s * kmPerCell; break; } }
    const west = Math.exp(-dw / L), eastSide = Math.exp(-de / L);
    const edge = x.hadleyEdgeDeg;
    // Warm western boundary currents in the subtropics and mid-latitudes, cold eastern ones; at high latitudes the
    // subpolar gyre turns the other way: the warm drift reaches the east, cold water comes down the west (the
    // Labrador and Oyashio currents, D165).
    const sub = Math.exp(-(((a - (edge - 5)) / 15) ** 2));
    const high = Math.exp(-(((a - (edge + 25)) / 10) ** 2));
    out[c] = 4 * sub * west - 4 * sub * eastSide + 5 * high * eastSide - 4 * high * west;
  }
  return out;
}

/**
 * The scale of the sea's poleward heat transport per unit area (W/m²; 4.1 PW on the Earth, so 1.2 PW at its peak
 * near 27°) and the overturning's share of it carried across the equator (0.5 PW): about 1.7 PW northward at the
 * peak in the north and 0.7 southward in the south (measured: about 1.8 and 1.2; Trenberth and Caron 2001).
 * Calibrated with the energy balance's transport by the air (D165).
 */
export const OCEAN_TRANSPORT = 16, OVERTURNING = 0.12;
/** Heat given off (taken up) along the gyres' warm (cold) sides, W/m² per kelvin of their surface pattern. */
export const GYRE = 12;

/**
 * The heat the sea's currents carry (D165), as a steady source in each cell's energy balance (W/m² of the cell's
 * whole area; positive where the sea gives heat to the air). Taken up in the tropics and given off in the mid and
 * high latitudes, as poleward transport F(φ) ∝ sin φ cos⁴ φ (peaking near 27°, about 1.8 PW on the Earth, less with
 * less sea); none across a band of open sea that circles the planet (as the Southern Ocean's circumpolar current: no
 * shores to turn the gyres, so little heat crosses it, and the land beyond stays cold); more given off along the
 * western boundary currents and where the warm drift reaches the high latitudes' eastern shores, less (taken up) on
 * the cold eastern sides of the subtropics. Sums to zero over the planet.
 */
export function oceanHeatTransport(mesh: Mesh, land: ArrayLike<number>, x: Derived, oceanFraction: number, tune: { transport?: number; gyre?: number; overturning?: number } = {}): Float64Array {
  const n = mesh.n, q = new Float64Array(n);
  if (!(oceanFraction > 0) || x.tidallyLocked || !(x.cellsPerHemisphere >= 1)) return q;
  const deg = (r: number) => (r * 180) / Math.PI;
  // Bands of 2°: the sea's share, and whether the sea circles the planet there (almost no land along the parallel).
  const B = 90, ocean = new Float64Array(B), all = new Float64Array(B);
  const band = (c: number) => Math.min(B - 1, Math.floor(((deg(mesh.lat[c]) + 90) / 180) * B));
  for (let c = 0; c < n; c++) { const b = band(c); ocean[b] += (1 - land[c]) * mesh.area[c]; all[b] += mesh.area[c]; }
  const open = (b: number) => {
    // (Over three bands, for the coarse mesh's few cells to a band.)
    let o = 0, a = 0;
    for (let k = Math.max(0, b - 1); k <= Math.min(B - 1, b + 1); k++) { o += ocean[k]; a += all[k]; }
    return a > 0 && o / a > 0.985;
  };
  // The most equatorward circumpolar channel in each hemisphere beyond 35°: sea all round, with land beyond it towards
  // the pole (a polar sea with no land beyond, as the Arctic, is not a channel).
  const landBeyond = (b: number, dir: number) => {
    for (let k = b + dir; k >= 0 && k < B; k += dir) if (all[k] > 0 && 1 - ocean[k] / all[k] > 0.3) return true;
    return false;
  };
  let south = -90, north = 90;
  for (let b = 0; b < B; b++) {
    const lat = -90 + (b + 0.5) * 2;
    if (lat <= -35 && open(b) && landBeyond(b, -1)) south = Math.max(south, lat);
    if (lat >= 35 && open(b) && landBeyond(b, 1) && lat < north) north = lat;
  }
  const block = (lat: number) => {
    if (lat < 0 && south > -90) return Math.max(0, Math.min(1, (lat - south) / 10 + 0.2));
    if (lat > 0 && north < 90) return Math.max(0, Math.min(1, (north - lat) / 10 + 0.2));
    return 1;
  };
  // With a circumpolar channel in one hemisphere only, the winds over it drive an overturning that sinks in the other
  // hemisphere's high latitudes and carries heat across the equator towards them (Toggweiler and Samuels 1995; the
  // Atlantic's, about 0.5 PW on the Earth): northward from the channel's edge to about 70° in the other hemisphere.
  const cross = south > -90 && north === 90 ? 1 : north < 90 && south === -90 ? -1 : 0;
  // Its cold deep water rises in the channel, taking up heat there (the Southern Ocean's uptake), and its heat is
  // given off between 45° and 70° on the other side (the North Atlantic's and Nordic seas').
  const over = (lat: number) => {
    if (!cross) return 0;
    const ch = cross > 0 ? -south : north, a = cross > 0 ? -lat : lat; // latitudes on the channel's side, positive
    const v = a >= 0 ? (ch + 12 - a) / 15 : (70 + a) / 25;
    return cross * (tune.overturning ?? OVERTURNING) * Math.max(0, Math.min(1, v));
  };
  const f = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.sin(r) * Math.cos(r) ** 4 * block(lat) + over(lat); };
  const q0 = (tune.transport ?? OCEAN_TRANSPORT) * Math.min(1, oceanFraction / 0.71);
  const perOcean = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    const a1 = -90 + b * 2, a2 = a1 + 2;
    const s = (-q0 * (f(a2) - f(a1))) / (Math.sin((a2 * Math.PI) / 180) - Math.sin((a1 * Math.PI) / 180));
    const share = all[b] > 0 ? ocean[b] / all[b] : 0;
    perOcean[b] = share > 0.05 ? s / share : 0;
  }
  // The gyres' warm western and cold eastern sides, and the drift (the currents' surface pattern, K, as W/m²).
  const shape = currentAnomaly(mesh, land, x), g = tune.gyre ?? GYRE;
  for (let c = 0; c < n; c++) q[c] = (1 - land[c]) * (perOcean[band(c)] + g * shape[c]);
  // Exactly zero over the planet: what is left over taken evenly from the sea.
  let sum = 0, sea = 0;
  for (let c = 0; c < n; c++) { sum += q[c] * mesh.area[c]; sea += (1 - land[c]) * mesh.area[c]; }
  if (sea > 0) for (let c = 0; c < n; c++) q[c] -= ((1 - land[c]) * sum) / sea;
  return q;
}
