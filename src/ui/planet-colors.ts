// How the Planet Studio colours its layers (Stage 14.5, D156): a picture of a layer's values on an
// equirectangular grid turned into pixels, with a short legend.
import type { LayerId } from '../planet/pipeline/stages.ts';

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** A colour along a ramp of stops (value, colour). */
function ramp(stops: Array<[number, RGB]>, v: number): RGB {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  return stops[stops.length - 1][1];
}

const RELIEF: Array<[number, RGB]> = [
  [-8000, [8, 22, 54]], [-5000, [16, 48, 102]], [-3000, [30, 84, 150]], [-1000, [58, 128, 188]], [-150, [112, 176, 214]], [-1, [150, 204, 226]],
  [0, [64, 120, 64]], [300, [104, 150, 78]], [800, [168, 170, 102]], [1500, [158, 128, 84]], [2500, [132, 104, 86]], [4000, [196, 190, 186]], [6000, [250, 250, 252]],
];
const AGE: Array<[number, RGB]> = [[0, [214, 48, 49]], [20, [240, 160, 50]], [60, [236, 220, 90]], [120, [90, 180, 120]], [200, [60, 110, 190]], [400, [40, 50, 120]]];
const HEAT: Array<[number, RGB]> = [[0, [30, 40, 110]], [0.33, [70, 150, 200]], [0.66, [240, 200, 80]], [1, [214, 60, 40]]];
const BOUNDARY: RGB[] = [[34, 44, 56], [232, 93, 74], [74, 144, 232], [94, 194, 106]];
const CRUST: RGB[] = [[20, 20, 20], [45, 95, 138], [184, 154, 106], [192, 80, 77]];
/** Crust history bits, the most telling first: impact, flood basalt, suture, hotspot, accreted, rift, arc. */
const TAGS: Array<[number, RGB]> = [[64, [240, 240, 240]], [4, [150, 40, 40]], [1, [150, 90, 200]], [8, [240, 210, 60]], [2, [230, 140, 50]], [16, [60, 200, 210]], [32, [210, 80, 80]]];

export interface Legend { text: string }

/** Pixels for a layer's picture (RGBA), and a line saying what the colours mean. */
export function colourLayer(layer: LayerId, values: Float32Array, width: number, height: number, range: { min: number; max: number }): { pixels: Uint8ClampedArray; legend: string } {
  const out = new Uint8ClampedArray(width * height * 4);
  const put = (k: number, c: RGB) => { out[4 * k] = c[0]; out[4 * k + 1] = c[1]; out[4 * k + 2] = c[2]; out[4 * k + 3] = 255; };
  let legend = '';
  if (layer === 'elevation') {
    // Relief with light from the north-west.
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const k = j * width + i, v = values[k];
      const e = values[j * width + ((i + 1) % width)], s = values[Math.min(height - 1, j + 1) * width + i];
      const shade = Math.max(0.6, Math.min(1.25, 1 + ((v - e) - (s - v)) * 0.0004));
      const c = ramp(RELIEF, v);
      put(k, [c[0] * shade, c[1] * shade, c[2] * shade]);
    }
    legend = `Height above the sea: ${Math.round(range.min).toLocaleString('en')} m to ${Math.round(range.max).toLocaleString('en')} m`;
  } else if (layer === 'plates') {
    for (let k = 0; k < values.length; k++) {
      const id = values[k], h = (id * 137.508) % 360;
      put(k, hsl(h, 0.55, 0.55));
    }
    legend = 'Each plate in its own colour';
  } else if (layer === 'crust') {
    for (let k = 0; k < values.length; k++) put(k, CRUST[values[k] | 0] ?? CRUST[0]);
    legend = 'Blue: oceanic crust · tan: continental · red: volcanic arcs';
  } else if (layer === 'crustAge') {
    for (let k = 0; k < values.length; k++) put(k, ramp(AGE, values[k]));
    legend = 'Age of the crust: red young (at ridges) to blue old; continents (billions of years) darkest';
  } else if (layer === 'crustThickness') {
    for (let k = 0; k < values.length; k++) put(k, ramp(HEAT, Math.min(1, values[k] / 70)));
    legend = `Thickness of the crust: ${Math.round(range.min)} km (blue) to ${Math.round(range.max)} km (red)`;
  } else if (layer === 'boundaries') {
    for (let k = 0; k < values.length; k++) put(k, BOUNDARY[values[k] | 0] ?? BOUNDARY[0]);
    legend = 'Plates parting (red: ridges, rifts) · closing (blue: trenches, collisions) · sliding past (green: transforms)';
  } else if (layer === 'history') {
    for (let k = 0; k < values.length; k++) {
      const t = values[k] | 0;
      const hit = TAGS.find(([bit]) => t & bit);
      put(k, hit ? hit[1] : [40, 52, 64]);
    }
    legend = 'What made the crust: white impacts · dark red flood basalts · purple sutures · yellow hotspot tracks · orange accreted · cyan rifts · red arcs';
  } else if (layer === 'sediment') {
    for (let k = 0; k < values.length; k++) put(k, ramp([[0, [30, 34, 40]], [0.5, [120, 100, 70]], [3, [220, 190, 130]], [10, [255, 240, 200]]], values[k]));
    legend = `Sediment laid down: up to ${range.max.toFixed(1)} km`;
  } else if (layer === 'drainage') {
    const top = Math.log10(Math.max(10, range.max));
    for (let k = 0; k < values.length; k++) {
      const t = Math.max(0, Math.log10(Math.max(1, values[k])) - 4) / Math.max(0.1, top - 4);
      put(k, ramp([[0, [18, 24, 32]], [0.4, [30, 70, 120]], [0.8, [70, 150, 230]], [1, [200, 240, 255]]], t));
    }
    legend = 'Water draining through: the brighter, the larger the river (where rain falls, by latitude)';
  } else if (layer === 'temperature' || layer === 'temperatureMonth') {
    const TEMP: Array<[number, RGB]> = [[-50, [60, 20, 110]], [-25, [40, 80, 190]], [-5, [120, 190, 230]], [5, [210, 235, 220]], [15, [150, 210, 90]], [25, [240, 200, 60]], [35, [230, 110, 40]], [50, [170, 30, 30]]];
    for (let k = 0; k < values.length; k++) put(k, ramp(TEMP, values[k]));
    legend = `Temperature at the surface: ${Math.round(range.min)} °C to ${Math.round(range.max)} °C`;
  } else if (layer === 'precipitation' || layer === 'precipitationMonth') {
    const yearly = layer === 'precipitation';
    const RAIN: Array<[number, RGB]> = yearly
      ? [[0, [196, 160, 110]], [150, [214, 196, 140]], [400, [190, 210, 140]], [800, [110, 180, 110]], [1500, [40, 140, 120]], [2500, [30, 90, 150]], [4000, [40, 40, 120]]]
      : [[0, [196, 160, 110]], [10, [214, 196, 140]], [35, [190, 210, 140]], [70, [110, 180, 110]], [130, [40, 140, 120]], [220, [30, 90, 150]], [350, [40, 40, 120]]];
    for (let k = 0; k < values.length; k++) put(k, ramp(RAIN, values[k]));
    legend = `Rain and snow ${yearly ? 'over the year' : 'in the month'}: ${Math.round(range.min)} to ${Math.round(range.max).toLocaleString('en')} mm (brown dry, green, blue wet)`;
  } else if (layer === 'currents') {
    for (let k = 0; k < values.length; k++) put(k, ramp([[-5, [40, 90, 200]], [-1, [120, 150, 190]], [0, [60, 66, 74]], [1, [200, 150, 110]], [5, [220, 70, 40]]], values[k]));
    legend = 'The sea\'s currents: red where they warm the surface (western sides of oceans, the high-latitude drift), blue where they cool it (eastern sides)';
  } else if (layer === 'runoff') {
    for (let k = 0; k < values.length; k++) put(k, ramp([[0, [190, 170, 130]], [50, [200, 200, 150]], [200, [120, 180, 150]], [600, [50, 140, 190]], [1500, [30, 70, 160]], [3000, [20, 30, 110]]], values[k]));
    legend = `Water running off the land: up to ${Math.round(range.max).toLocaleString('en')} mm a year (what the rain leaves after evaporation)`;
  } else if (layer === 'rivers') {
    const top = Math.log10(Math.max(10, range.max));
    for (let k = 0; k < values.length; k++) {
      const t = Math.max(0, Math.log10(Math.max(1, values[k])) - 1) / Math.max(0.1, top - 1);
      put(k, ramp([[0, [24, 28, 34]], [0.35, [40, 70, 110]], [0.7, [70, 150, 230]], [1, [210, 245, 255]]], t));
    }
    legend = `Rivers by how much water they carry: up to ${Math.round(range.max).toLocaleString('en')} m³/s`;
  } else if (layer === 'water') {
    // Kinds of water (hydrology.ts WATER): land, sea, lake, salt lake, salt flat, river, floodplain, wetland, delta, ice.
    const KIND: RGB[] = [[58, 62, 56], [18, 46, 92], [70, 140, 210], [150, 210, 210], [226, 214, 176], [60, 120, 230], [90, 170, 150], [70, 150, 110], [200, 190, 90], [245, 248, 252]];
    for (let k = 0; k < values.length; k++) put(k, KIND[values[k] | 0] ?? KIND[0]);
    legend = 'Blue lakes and rivers · pale teal salt lakes · sand salt flats · green wetlands and floodplains · gold deltas · white ice sheets';
  } else if (layer === 'iceThickness') {
    for (let k = 0; k < values.length; k++) put(k, values[k] < 1 ? [40, 48, 56] : ramp([[1, [170, 200, 225]], [500, [205, 225, 242]], [2000, [235, 244, 252]], [4000, [255, 255, 255]]], values[k]));
    legend = `Ice sheets: up to ${Math.round(range.max).toLocaleString('en')} m thick`;
  } else if (layer === 'ice') {
    for (let k = 0; k < values.length; k++) put(k, ramp([[0, [40, 60, 50]], [0.3, [120, 150, 170]], [0.7, [200, 220, 235]], [1, [250, 252, 255]]], values[k]));
    legend = 'Ice and snow: the share of the year a place lies under them';
  } else {
    const span = range.max - range.min || 1;
    for (let k = 0; k < values.length; k++) put(k, ramp(HEAT, (values[k] - range.min) / span));
    legend = `Sunlight over the year: ${Math.round(range.min)} to ${Math.round(range.max)} W/m²`;
  }
  return { pixels: out, legend };
}

function hsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
