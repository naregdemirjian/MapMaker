// Camera and projections. The map is always flat; the camera chooses the projection, the centre,
// the zoom and a 2D rotation. Layouts are defined for a 1920-pixel-wide design frame and scale with
// the output size, so a preview and an 8K export show exactly the same picture.
import { geoEquirectangular, geoEqualEarth, geoMercator, geoNaturalEarth1, geoGnomonic, type GeoProjection } from 'd3-geo';

/** Projections for round maps; 'flat' is the plan view of a flat map (a city, a region). */
export type ProjectionName = 'equirectangular' | 'equalEarth' | 'naturalEarth' | 'mercator' | 'flat';
export interface Camera { lon: number; lat: number; zoom: number; rotation: number; projection: ProjectionName }

export const DESIGN_WIDTH = 1920;
export const PROJECTIONS: Array<{ id: ProjectionName; name: string }> = [
  { id: 'equirectangular', name: 'Equirectangular (whole planet, poles included)' },
  { id: 'equalEarth', name: 'Equal Earth (world overview)' },
  { id: 'naturalEarth', name: 'Natural Earth (world overview)' },
  { id: 'mercator', name: 'Mercator (regional shapes; poles cut off)' },
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

export function makeView(cam: Camera, width: number, height: number): View {
  const flat = cam.projection === 'flat';
  // A flat map's plan is centred on (0, 0) and never turned; round maps turn to the camera's longitude.
  const p = (factories[cam.projection] ?? geoEquirectangular)().precision(flat ? 0.05 : 0.25).rotate([flat ? 0 : -cam.lon, 0]).scale(1).translate([0, 0]);
  if (cam.projection === 'mercator') p.clipExtent(null);
  let worldWidthAtUnit: number;
  if (flat) worldWidthAtUnit = 2 * Math.tan((FLAT_EXTENT_DEG * Math.PI) / 180);
  else {
    const a = p([cam.lon - 179.999, 0]), b = p([cam.lon + 179.999, 0]);
    worldWidthAtUnit = Math.abs((b?.[0] ?? 3.14) - (a?.[0] ?? -3.14));
  }
  const base = (width * 0.96) / worldWidthAtUnit;
  const scale = base * Math.pow(2, cam.zoom);
  p.scale(scale).translate([width / 2, height / 2]);
  const c = p([cam.lon, Math.max(-89.9, Math.min(89.9, cam.lat))]) ?? [width / 2, height / 2];
  p.translate([width / 2 + (width / 2 - c[0]), height / 2 + (height / 2 - c[1])]);
  const unit = width / DESIGN_WIDTH;
  return { projection: p, width, height, rotation: cam.rotation, unit, camera: cam, key: `${cam.projection}|${cam.lon}|${cam.lat}|${cam.zoom}|${cam.rotation}|${width}x${height}` };
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

export function panCamera(cam: Camera, v: View, dx: number, dy: number): Camera {
  const [ux, uy] = rotatePoint(dx, dy, 0, 0, -cam.rotation);
  const degPerPx = (180 / Math.PI) / v.projection.scale();
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
  return {
    lon,
    lat: a.lat + (b.lat - a.lat) * f,
    zoom: a.zoom + (b.zoom - a.zoom) * f, // zoom is already logarithmic
    rotation: a.rotation + (b.rotation - a.rotation) * f,
    projection: f < 0.5 ? a.projection : b.projection,
  };
}
