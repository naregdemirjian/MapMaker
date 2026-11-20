// Camera and projections. The map is always flat; the camera chooses the projection, the centre,
// the zoom and a 2D rotation. Layouts are defined for a 1920-pixel-wide design frame and scale with
// the output size, so a preview and an 8K export show exactly the same picture.
import { geoEquirectangular, geoEqualEarth, geoMercator, geoNaturalEarth1, geoGnomonic, geoOrthographic, type GeoProjection } from 'd3-geo';

/**
 * Projections for round maps; 'flat' is the plan view of a flat map (a city, a region); 'globe' is the
 * planet seen as a ball from afar (orthographic, D127): drawn from a flat picture of the part in view.
 */
export type ProjectionName = 'equirectangular' | 'equalEarth' | 'naturalEarth' | 'mercator' | 'flat' | 'globe';
export interface Camera {
  lon: number; lat: number; zoom: number; rotation: number; projection: ProjectionName;
  /**
   * The meridian a round map is laid out around, when it is not the camera's own longitude. Equal
   * Earth and Natural Earth change the shape of everything with their middle meridian, so the
   * working view keeps the meridian it had while the map is being moved (the picture then only
   * shifts, and can be carried along) and takes the camera's again once the map rests (see MapView).
   * Never stored: shots, exports and a view at rest are laid out around the camera.
   */
  meridian?: number;
  /** Space maps (D110): the point the camera circles, in light-years (the Sun when absent). */
  target?: [number, number, number];
}

/** Does the shape of the map depend on its middle meridian (so that moving east or west is more than a shift)? */
export const shapedByMeridian = (kind: ProjectionName): boolean => kind === 'equalEarth' || kind === 'naturalEarth';
/** The meridian a camera's map is laid out around: its own longitude, or the one it holds (only maps shaped by it hold one). */
export const meridianOf = (cam: Camera): number => (cam.meridian !== undefined && shapedByMeridian(cam.projection) ? cam.meridian : cam.lon);

export const DESIGN_WIDTH = 1920;
export const PROJECTIONS: Array<{ id: ProjectionName; name: string }> = [
  { id: 'equirectangular', name: 'Equirectangular (whole planet, poles included)' },
  { id: 'equalEarth', name: 'Equal Earth (world overview)' },
  { id: 'naturalEarth', name: 'Natural Earth (world overview)' },
  { id: 'mercator', name: 'Mercator (regional shapes; poles cut off)' },
  { id: 'globe', name: 'Globe (the planet as a ball, turning)' },
];

export const defaultCamera = (): Camera => ({ lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'equirectangular' });

const factories = { equirectangular: geoEquirectangular, equalEarth: geoEqualEarth, naturalEarth: geoNaturalEarth1, mercator: geoMercator, flat: geoGnomonic };

/**
 * A flat map is a small part of a large sphere: a square FLAT_EXTENT_DEG either side of (0, 0), drawn
 * with the gnomonic projection, which shows every border as a straight line. Within 5 degrees the
 * plan is true to scale to within 1%, and positions keep their fixed-point precision (about a
 * millimetre on a city map). The geometry kernel is the same: flat maps cost nothing extra.
 */
export const FLAT_EXTENT_DEG = 5;

/** The radius of the sphere a flat map of this width (km) lies on. */
export function flatRadiusKm(widthKm: number): number {
  return widthKm / 2 / ((FLAT_EXTENT_DEG * Math.PI) / 180);
}

export const flatCamera = (): Camera => ({ lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'flat' });

export interface View {
  projection: GeoProjection;
  width: number;
  height: number;
  rotation: number; // degrees, applied around the centre on the canvas
  /** Pixels per design pixel (1 at 1920 wide). */
  unit: number;
  camera: Camera;
  key: string;
}

/** What a view is of: the camera (without a held meridian) and the size of the frame. */
export const cameraKey = (cam: Camera, width: number, height: number): string => `${cam.projection}|${cam.lon}|${cam.lat}|${cam.zoom}|${cam.rotation}|${width}x${height}`;

/** The globe's radius (pixels) at zoom 0: it fills most of the frame's height. */
export const GLOBE_FILL = 0.46;

/**
 * A projection that gives no point for places on the far side of the globe (d3's orthographic
 * projection gives one for every place; its clipping applies to shapes only).
 */
function nearSideOnly(p: GeoProjection, lon0: number, lat0: number): GeoProjection {
  const r = Math.PI / 180, c0 = Math.cos(lat0 * r), s0 = Math.sin(lat0 * r);
  const f = ((pt: [number, number]) => {
    const la = pt[1] * r, dl = (pt[0] - lon0) * r;
    if (s0 * Math.sin(la) + c0 * Math.cos(la) * Math.cos(dl) < 0) return null;
    return p(pt);
  }) as unknown as GeoProjection;
  Object.assign(f, p);
  return f;
}

export function makeView(cam: Camera, width: number, height: number): View {
  if (cam.projection === 'globe') {
    const lat = Math.max(-89.9, Math.min(89.9, cam.lat));
    const R = GLOBE_FILL * Math.min(width, height) * Math.pow(2, cam.zoom);
    const p = geoOrthographic().rotate([-cam.lon, -lat, 0]).clipAngle(90).precision(0.25).scale(R).translate([width / 2, height / 2]);
    return { projection: nearSideOnly(p, cam.lon, lat), width, height, rotation: cam.rotation, unit: width / DESIGN_WIDTH, camera: cam, key: cameraKey(cam, width, height) };
  }
  const flat = cam.projection === 'flat';
  // A flat map's plan is centred on (0, 0) and never turned; round maps turn to the camera's
  // longitude (or to the meridian it holds, see Camera.meridian).
  const mid = flat ? 0 : meridianOf(cam);
  const p = (factories[cam.projection] ?? geoEquirectangular)().precision(flat ? 0.05 : 0.25).rotate([-mid, 0]).scale(1).translate([0, 0]);
  if (cam.projection === 'mercator') p.clipExtent(null);
  let worldWidthAtUnit: number;
  if (flat) worldWidthAtUnit = 2 * Math.tan((FLAT_EXTENT_DEG * Math.PI) / 180);
  else {
    const a = p([mid - 179.999, 0]), b = p([mid + 179.999, 0]);
    worldWidthAtUnit = Math.abs((b?.[0] ?? 3.14) - (a?.[0] ?? -3.14));
  }
  const base = (width * 0.96) / worldWidthAtUnit;
  const scale = base * Math.pow(2, cam.zoom);
  p.scale(scale).translate([width / 2, height / 2]);
  const c = p([cam.lon, Math.max(-89.9, Math.min(89.9, cam.lat))]) ?? [width / 2, height / 2];
  p.translate([width / 2 + (width / 2 - c[0]), height / 2 + (height / 2 - c[1])]);
  const unit = width / DESIGN_WIDTH;
  return { projection: p, width, height, rotation: cam.rotation, unit, camera: cam, key: cameraKey(cam, width, height) + (!flat && mid !== cam.lon ? `|m${mid}` : '') };
}

/** Screen pixel -> [lon, lat] (or null when outside the map). */
export function screenToLonLat(v: View, x: number, y: number): [number, number] | null {
  const [ux, uy] = rotatePoint(x, y, v.width / 2, v.height / 2, -v.rotation);
  const r = v.projection.invert?.([ux, uy]);
  if (!r || !Number.isFinite(r[0]) || !Number.isFinite(r[1]) || Math.abs(r[1]) > 90.0001) return null;
  // reject points outside the projected sphere (pseudo-cylindrical projections have curved edges)
  const back = v.projection(r);
  if (!back || Math.hypot(back[0] - ux, back[1] - uy) > 1) return null;
  return [r[0], r[1]];
}

export function lonLatToScreen(v: View, lon: number, lat: number): [number, number] | null {
  const p = v.projection([lon, lat]);
  if (!p) return null;
  return rotatePoint(p[0], p[1], v.width / 2, v.height / 2, v.rotation);
}

export function rotatePoint(x: number, y: number, cx: number, cy: number, deg: number): [number, number] {
  if (!deg) return [x, y];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/** Radians on the sphere covered by one screen pixel near the centre (for snapping tolerances). */
export function radiansPerPixel(v: View): number {
  return 1 / v.projection.scale();
}

/**
 * The longitudes and latitudes a view shows, with `margin` of its size around it on each side: read
 * at points across it (longitudes run on from the camera's, so `east` may pass 180). Null when none
 * of it is on the planet.
 */
export function viewBounds(v: View, margin = 0): { west: number; south: number; east: number; north: number } | null {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  const N = 10, lon0 = v.camera.lon;
  for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) {
    const x = (a / N - 0.5) * v.width * (1 + 2 * margin) + v.width / 2, y = (b / N - 0.5) * v.height * (1 + 2 * margin) + v.height / 2;
    const ll = screenToLonLat(v, x, y);
    if (!ll) continue;
    const lon = lon0 + ((((ll[0] - lon0 + 180) % 360) + 360) % 360) - 180;
    west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, ll[1]); north = Math.max(north, ll[1]);
  }
  return west <= east ? { west, south, east, north } : null;
}

/** Metres on the ground a pixel covers at the middle of a view (on a planet of `radiusKm`). */
export function metresPerPixel(v: View, radiusKm: number): number {
  const a = screenToLonLat(v, v.width / 2 - 5, v.height / 2), b = screenToLonLat(v, v.width / 2 + 5, v.height / 2);
  if (!a || !b) return Infinity;
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return (2 * radiusKm * 1000 * Math.asin(Math.min(1, Math.sqrt(h)))) / 10;
}

export function panCamera(cam: Camera, v: View, dx: number, dy: number): Camera {
  // A map shaped by its middle meridian is not moved by so many degrees a pixel: the place that
  // comes to the middle of the view is read off the map as it is shown (which, while the view
  // holds its meridian, moves the picture by exactly the pixels asked for).
  if (shapedByMeridian(cam.projection)) {
    const ll = screenToLonLat(v, v.width / 2 - dx, v.height / 2 - dy);
    if (ll) return { ...cam, lon: ((ll[0] + 540) % 360) - 180, lat: Math.max(-85, Math.min(85, ll[1])) };
  }
  const [ux, uy] = rotatePoint(dx, dy, 0, 0, -cam.rotation);
  const degPerPx = (180 / Math.PI) / v.projection.scale();
  // A globe turns under the pointer: east and west by the degrees of longitude the move spans at the
  // middle's latitude; it can be turned to look straight down on a pole.
  if (cam.projection === 'globe') {
    const lat = Math.max(-89, Math.min(89, cam.lat + uy * degPerPx));
    const lon = cam.lon - (ux * degPerPx) / Math.max(0.15, Math.cos((cam.lat * Math.PI) / 180));
    return { ...cam, lon: ((lon + 540) % 360) - 180, lat };
  }
  let lon = cam.lon - ux * degPerPx;
  lon = ((lon + 540) % 360) - 180;
  const lat = Math.max(-85, Math.min(85, cam.lat + uy * degPerPx));
  // A flat map's plan does not go on round the sphere.
  if (cam.projection === 'flat') { const m = FLAT_EXTENT_DEG * 1.6; return { ...cam, lon: Math.max(-m, Math.min(m, lon)), lat: Math.max(-m, Math.min(m, lat)) }; }
  return { ...cam, lon, lat };
}

/** Zoom by `delta` (in powers of two) keeping the point under the cursor fixed. */
export function zoomCameraAt(cam: Camera, width: number, height: number, x: number, y: number, delta: number): Camera {
  const v0 = makeView(cam, width, height);
  const anchor = screenToLonLat(v0, x, y);
  const next: Camera = { ...cam, zoom: Math.max(-1, Math.min(22, cam.zoom + delta)) };
  if (!anchor) return next;
  // Move the map so the point that was under the cursor is under it again. Panning is linear in
  // degrees, which is exact for the equirectangular projection and close for the others, so the
  // correction is repeated until the point is within a hundredth of a pixel.
  let cam2 = next;
  for (let i = 0; i < 6; i++) {
    const v1 = makeView(cam2, width, height);
    const p = lonLatToScreen(v1, anchor[0], anchor[1]);
    if (!p) break;
    if (Math.hypot(p[0] - x, p[1] - y) < 0.01) break;
    cam2 = panCamera(cam2, v1, x - p[0], y - p[1]);
  }
  return cam2;
}

export function interpolateCamera(a: Camera, b: Camera, f: number): Camera {
  let dl = b.lon - a.lon;
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  let lon = a.lon + dl * f;
  lon = ((lon + 540) % 360) - 180;
  // A space map's camera circles a point (D180: kept between keys, moving in a straight line from one to the next;
  // a key without one circles the map's middle).
  const target: Camera['target'] = a.target || b.target
    ? [0, 1, 2].map((i) => (a.target?.[i] ?? 0) + ((b.target?.[i] ?? 0) - (a.target?.[i] ?? 0)) * f) as [number, number, number]
    : undefined;
  return {
    lon,
    lat: a.lat + (b.lat - a.lat) * f,
    zoom: a.zoom + (b.zoom - a.zoom) * f, // zoom is already logarithmic
    rotation: a.rotation + (b.rotation - a.rotation) * f,
    projection: f < 0.5 ? a.projection : b.projection,
    ...(target ? { target } : {}),
  };
}
