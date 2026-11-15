// Unit-vector maths for sphere map spaces. Every vertex is stored as fixed-point longitude/latitude
// (one ten-millionth of a degree) and converted once to a 3D unit vector. All topology decisions are
// made on those vectors, so the 180° meridian and the poles are ordinary places with no special cases.

export type Vec3 = [number, number, number];

/** Fixed-point scale: 1e-7 degree is about 1.1 cm on Earth and 3 mm on the Moon. */
export const E7 = 1e7;
export const DEG = Math.PI / 180;

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  if (n === 0) throw new RangeError('Cannot normalise a zero vector');
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** Angle between two unit vectors, accurate for tiny and near-antipodal angles. */
export function angle(a: Vec3, b: Vec3): number {
  return Math.atan2(norm(cross(a, b)), dot(a, b));
}

/** Normalise fixed-point coordinates: longitude in (-180°, 180°], latitude in [-90°, 90°], longitude 0 at the poles. */
export function normalizeE7(lonE7: number, latE7: number): [number, number] {
  let lat = Math.round(latE7);
  let lon = Math.round(lonE7);
  if (lat > 90 * E7) lat = 90 * E7;
  if (lat < -90 * E7) lat = -90 * E7;
  if (lat === 90 * E7 || lat === -90 * E7) return [0, lat];
  const full = 360 * E7;
  lon = ((lon % full) + full) % full; // [0, 360)
  if (lon > 180 * E7) lon -= full; // (-180, 180]
  if (lon === -180 * E7) lon = 180 * E7;
  return [lon, lat];
}

export function quantize(lonDeg: number, latDeg: number): [number, number] {
  return normalizeE7(Math.round(lonDeg * E7), Math.round(latDeg * E7));
}

export function e7ToVec(lonE7: number, latE7: number): Vec3 {
  const lon = (lonE7 / E7) * DEG;
  const lat = (latE7 / E7) * DEG;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

export function lonLatToVec(lonDeg: number, latDeg: number): Vec3 {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

export function vecToLonLat(v: Vec3): [number, number] {
  const n = normalize(v);
  const lat = Math.asin(Math.max(-1, Math.min(1, n[2]))) / DEG;
  const lon = Math.atan2(n[1], n[0]) / DEG;
  return [lon, lat];
}

export function vecToE7(v: Vec3): [number, number] {
  const [lon, lat] = vecToLonLat(v);
  return quantize(lon, lat);
}

/** A local east/north basis at a point (any consistent basis works at the poles). */
export function tangentBasis(v: Vec3): { east: Vec3; north: Vec3 } {
  const c = cross([0, 0, 1], v);
  const east: Vec3 = norm(c) < 1e-12 ? [0, 1, 0] : normalize(c);
  return { east, north: cross(v, east) };
}

/** Forward direction of the great-circle arc a->b, measured at its start a. */
export function arcDirectionAtStart(a: Vec3, b: Vec3): Vec3 {
  return normalize(cross(cross(a, b), a));
}

/** Forward direction of the great-circle arc a->b, measured at its end b. */
export function arcDirectionAtEnd(a: Vec3, b: Vec3): Vec3 {
  return normalize(cross(cross(a, b), b));
}

/** Point a fraction f along the minor arc from a to b. */
export function slerp(a: Vec3, b: Vec3, f: number): Vec3 {
  const theta = angle(a, b);
  if (theta < 1e-12) return a;
  const s = Math.sin(theta);
  const wa = Math.sin((1 - f) * theta) / s;
  const wb = Math.sin(f * theta) / s;
  return normalize([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
}
