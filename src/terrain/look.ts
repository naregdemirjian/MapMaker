// How terrain is drawn (Stage 8, D95): colours by height, relief shading, and relief over the
// territories; the palettes; and, for tests and for anything drawn without the graphics card, the
// same arithmetic the terrain shader does (src/render-engine/terrain-gl.ts).
import type { ProjectionName } from '../render-engine/camera.ts';

export type TerrainPalette = 'natural' | 'atlas' | 'satellite' | 'desert' | 'ice' | 'volcanic' | 'moon' | 'gas';

export interface TerrainLook {
  /** Land coloured by height (lowlands to peaks) and the sea by depth. Off: the map's plain land and sea. */
  colours: boolean;
  /** Hill shading: slopes facing away from the light (north-west) darker, those facing it lighter. */
  relief: boolean;
  /** The relief also shades the territories' fills (not only the land beneath them). */
  overTerritories: boolean;
  /** The relief of the sea floor too (ridges, trenches, seamounts). */
  seaFloor: boolean;
  /** How strongly relief shows: 1 is the usual; 0.25 to 4. */
  strength: number;
  palette: TerrainPalette;
  /** Close in on the Earth, finer heights downloaded as needed (D101: Terrain Tiles, kept on this computer). */
  detail: boolean;
  /**
   * The satellite look of the Earth as photographed (D138: Sentinel-2 cloudless; the whole planet bundled, close
   * in downloaded as needed and kept on this computer). Off: the land's colours by its cover (D100).
   */
  photo: boolean;
  /**
   * A generated planet's land coloured by the simulated planets' climate, water and biome models on its own heights
   * (D169) rather than by its latitude and height alone (D100).
   */
  climate: boolean;
}

export const DEFAULT_TERRAIN_LOOK: TerrainLook = { colours: true, relief: true, overTerritories: false, seaFloor: true, strength: 1, palette: 'natural', detail: true, photo: true, climate: false };
export const STRENGTH_MIN = 0.25, STRENGTH_MAX = 4;

/** A stored look, completed and checked (anything unknown takes its default); null when there is none. */
export function terrainLookOf(raw: unknown): TerrainLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof TerrainLook, unknown>>, d = DEFAULT_TERRAIN_LOOK;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const strength = typeof r.strength === 'number' && Number.isFinite(r.strength) ? Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, r.strength)) : d.strength;
  return {
    colours: bool(r.colours, d.colours), relief: bool(r.relief, d.relief), overTerritories: bool(r.overTerritories, d.overTerritories),
    seaFloor: bool(r.seaFloor, d.seaFloor), strength, palette: typeof r.palette === 'string' && r.palette in PALETTES ? (r.palette as TerrainPalette) : d.palette,
    detail: bool(r.detail, d.detail), photo: bool(r.photo, d.photo), climate: bool(r.climate, d.climate),
  };
}

/** A colour stop: metres, and the colour from there. */
export type Stop = [number, string];

/**
 * The palettes, each a ramp for the sea (deepest first) and one for land (lowest first). "Natural"
 * goes with the map's own dark style (its sea is the map's ocean colour at 3,000 m); "Atlas" is the
 * light green-to-brown of printed atlases; "Satellite" takes the land's colours from its land cover
 * (`cover`, D100: Earth's from Natural Earth I, a planet's from its biomes), its ramp standing in
 * until the cover is there.
 */
export const PALETTES: Record<TerrainPalette, { name: string; sea: Stop[]; land: Stop[]; cover?: true }> = {
  natural: {
    name: 'Natural (goes with the dark map)',
    sea: [[-11000, '#071624'], [-6000, '#0c2335'], [-3000, '#14324a'], [-1000, '#1a3f5b'], [-200, '#22506f'], [0, '#2d6283']],
    land: [[0, '#3c4d3a'], [300, '#4a5a3e'], [1000, '#5e6144'], [2000, '#6f664c'], [3000, '#7d7464'], [4500, '#968f86'], [6000, '#bdbab4'], [8000, '#e4e3e0']],
  },
  atlas: {
    name: 'Atlas (light, as in printed atlases)',
    sea: [[-11000, '#2f5f92'], [-6000, '#4a80b5'], [-3000, '#6ea2d0'], [-1000, '#8cbbe0'], [-200, '#a9d2ec'], [0, '#c8e6f6']],
    land: [[0, '#9fc58b'], [200, '#c3d99b'], [500, '#e6e0a8'], [1000, '#ddc58b'], [2000, '#c49c6e'], [3000, '#a7826a'], [4500, '#b9aea8'], [6500, '#f6f4f2']],
  },
  satellite: {
    name: 'Satellite (forests, grassland, deserts and ice)',
    sea: [[-11000, '#050c1c'], [-6000, '#08142a'], [-3000, '#0b1b36'], [-1000, '#102846'], [-200, '#183b5e'], [0, '#245074']],
    land: [[0, '#5a6a3c'], [500, '#6c7146'], [1500, '#857a58'], [3000, '#76695e'], [4500, '#a9a39c'], [6000, '#e8eaec']],
    cover: true,
  },
  desert: {
    name: 'Desert (sand and rock, turquoise shallows)',
    sea: [[-11000, '#0d2a3a'], [-3000, '#174a5e'], [-500, '#2a6b78'], [0, '#4f9a96']],
    land: [[0, '#c9a66b'], [300, '#d6b47a'], [1000, '#c79a5e'], [2000, '#a8774a'], [3000, '#8a5e3c'], [4500, '#a08a78'], [6500, '#e8e0d6']],
  },
  ice: {
    name: 'Ice (a frozen world)',
    sea: [[-11000, '#10243a'], [-3000, '#1d3d5c'], [-500, '#3c6a8c'], [0, '#7fa8c4']],
    land: [[0, '#c9d6de'], [500, '#dde7ee'], [1500, '#eaf1f6'], [3000, '#f6f9fc'], [5000, '#ffffff']],
  },
  volcanic: {
    name: 'Volcanic (dark rock, glowing peaks)',
    sea: [[-11000, '#06080c'], [-3000, '#0d1720'], [-300, '#1a2a33'], [0, '#2b3d42']],
    land: [[0, '#2a2522'], [500, '#3a302a'], [1500, '#4a3a30'], [3000, '#5c463a'], [4500, '#6e3a2a'], [6000, '#8a3a22'], [7500, '#c0502a']],
  },
  moon: {
    name: 'Barren (greys of a moon)',
    sea: [[-11000, '#202022'], [0, '#3a3a3c']],
    land: [[0, '#3d3d3f'], [500, '#555557'], [1500, '#707072'], [2500, '#8b8b8d'], [3500, '#a7a7a9'], [5000, '#c4c4c6']],
  },
  gas: {
    name: 'Gas giant (bands of cloud)',
    sea: [[-11000, '#3a2414'], [0, '#8a5a3c']],
    land: [[0, '#8a5a3c'], [1000, '#c49a6c'], [2000, '#e8d2b0'], [3000, '#d9b48a'], [4000, '#b07850'], [5000, '#f0e4cc'], [6000, '#a86a44']],
  },
};

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** The colour of a ramp at a height (0-255 each), as the shader works it out. */
export function rampAt(stops: Stop[], metres: number): [number, number, number] {
  if (metres <= stops[0][0]) return hex(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (metres <= stops[i][0]) {
      const t = (metres - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]), a = hex(stops[i - 1][1]), b = hex(stops[i][1]);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return hex(stops[stops.length - 1][1]);
}

/** A ramp as the shader takes it: up to 8 stops of (metres, red, green, blue) with colours from 0 to 1. */
export function rampUniform(stops: Stop[]): Float32Array {
  const out = new Float32Array(32);
  stops.slice(0, 8).forEach(([m, c], i) => { const [r, g, b] = hex(c); out.set([m, r / 255, g / 255, b / 255], i * 4); });
  return out;
}

const EE_A1 = 1.340264, EE_A2 = -0.081106, EE_A3 = 0.000893, EE_A4 = 0.003796, EE_M = Math.sqrt(3) / 2;

/**
 * The point of the planet at a point of a projection's plane (unit scale, y up, longitude relative to
 * the middle meridian), in radians; null outside the planet. d3-geo's inverses, as the shader has them.
 */
export function invertPlane(kind: ProjectionName, x: number, y: number): [number, number] | null {
  let lam: number, phi: number;
  switch (kind) {
    case 'mercator': lam = x; phi = 2 * Math.atan(Math.exp(y)) - Math.PI / 2; break;
    case 'equalEarth': {
      let l = y, l2 = l * l, l6 = l2 * l2 * l2;
      for (let i = 0; i < 12; i++) {
        const fy = l * (EE_A1 + EE_A2 * l2 + l6 * (EE_A3 + EE_A4 * l2)) - y, fpy = EE_A1 + 3 * EE_A2 * l2 + l6 * (7 * EE_A3 + 9 * EE_A4 * l2);
        l -= fy / fpy; l2 = l * l; l6 = l2 * l2 * l2;
      }
      const s = Math.sin(l) / EE_M;
      if (!(Math.abs(s) <= 1)) return null;
      lam = (EE_M * x * (EE_A1 + 3 * EE_A2 * l2 + l6 * (7 * EE_A3 + 9 * EE_A4 * l2))) / Math.cos(l);
      phi = Math.asin(s);
      break;
    }
    case 'naturalEarth': {
      phi = y;
      for (let i = 0; i < 25; i++) {
        const p2 = phi * phi, p4 = p2 * p2;
        phi -= (phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))) - y) / (1.007226 + p2 * (0.015085 * 3 + p4 * (-0.044475 * 7 + 0.028874 * 9 * p2 - 0.005916 * 11 * p4)));
      }
      const p2 = phi * phi;
      lam = x / (0.8707 + p2 * (-0.131979 + p2 * (-0.013791 + p2 * p2 * p2 * (0.003971 - 0.001529 * p2))));
      break;
    }
    case 'flat': return null;
    default: lam = x; phi = y;
  }
  if (!(Math.abs(phi) <= Math.PI / 2 + 1e-6)) return null;
  if (kind !== 'equirectangular' && kind !== 'mercator' && !(Math.abs(lam) <= Math.PI + 1e-4)) return null;
  return [lam, phi];
}

/** The light: from the north-west, 35° above the horizon (east, north, up). */
export const LIGHT: [number, number, number] = (() => {
  const az = (315 * Math.PI) / 180, alt = (35 * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
})();

/** The relief's exaggeration at strength 1 where slopes are measured across twenty kilometres. */
export const EXAGGERATION = 6;

/**
 * How much slopes are exaggerated for shading (D194), as the terrain shader has it. Seen from afar slopes are
 * measured across long distances (`baseline`, metres: what two pixels cover, at least two cells of the heights)
 * and come out gentle: they are exaggerated more, so mountains read at every zoom. Close in, measured across
 * about half a kilometre or less, they are the ground's own and drawn as they are (times the look's strength).
 */
export function reliefExaggeration(strength: number, baseline: number): number {
  return EXAGGERATION * strength * Math.max(1 / 6, Math.sqrt(baseline / 20000));
}

/**
 * How much of the relief is drawn when one cell of the heights is `pixelsPerCell` pixels wide (D194): all of it up
 * to 32, none from 160. Closer than that the heights have nothing more to say, and shading them would only spread
 * one slope across the screen.
 */
export function reliefFade(pixelsPerCell: number): number {
  const t = Math.min(1, Math.max(0, (pixelsPerCell - 32) / (160 - 32)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The shading of a slope: 0 on level ground, up to about +0.6 facing the light and down to -0.6 facing
 * away. `dzEast` and `dzNorth` are the rises (metres per metre) towards the east and the north;
 * `exaggeration` multiplies them.
 */
export function slopeShade(dzEast: number, dzNorth: number, exaggeration: number): number {
  const nx = -dzEast * exaggeration, ny = -dzNorth * exaggeration, nz = 1, len = Math.hypot(nx, ny, nz);
  return (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / len - LIGHT[2];
}
