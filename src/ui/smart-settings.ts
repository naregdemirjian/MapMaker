// The smart brushes' settings (Stage 12, D148): on or off, geography-aware or strategic, the search radius and
// how strongly each feature draws the line. Chosen in the drawing tools' options and kept on this computer.
import { NO_WEIGHTS, type SmartWeights } from '../render-engine/smart-brush.ts';

export type SmartMode = 'geography' | 'strategic';
export interface SmartSettings {
  /** Whether lines drawn with the brush, the pen, the Split tool and the features tool are adjusted. */
  on: boolean;
  mode: SmartMode;
  /** The search radius: how far (screen pixels) either side of the stroke the line may go. */
  radius: number;
  weights: SmartWeights;
}

export const SMART_MIN_RADIUS = 6, SMART_MAX_RADIUS = 60;
export const DEFAULT_WEIGHTS: SmartWeights = { ...NO_WEIGHTS, rivers: 0.8, coasts: 0.6, ridges: 0.5, valleys: 0, borders: 0.4, today: 0, lines: 0.4, rough: 0.2, towns: 0.7, points: 0.7, passes: 0.6 };
export const DEFAULT_SMART: SmartSettings = { on: false, mode: 'geography', radius: 18, weights: DEFAULT_WEIGHTS };

const KEY = 'mapmaker.smartBrush';
export function loadSmart(): SmartSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SmartSettings> | null;
    if (!v) return DEFAULT_SMART;
    const unit = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
    const w = (v.weights ?? {}) as Partial<SmartWeights>;
    const weights = Object.fromEntries((Object.keys(DEFAULT_WEIGHTS) as Array<keyof SmartWeights>).map((k) => [k, unit(w[k], DEFAULT_WEIGHTS[k])])) as unknown as SmartWeights;
    const radius = typeof v.radius === 'number' && Number.isFinite(v.radius) ? Math.round(Math.min(SMART_MAX_RADIUS, Math.max(SMART_MIN_RADIUS, v.radius))) : DEFAULT_SMART.radius;
    return { on: v.on === true, mode: v.mode === 'strategic' ? 'strategic' : 'geography', radius, weights };
  } catch { return DEFAULT_SMART; }
}
export function saveSmart(s: SmartSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage may be unavailable */ }
}

/** The features a smart brush can draw a line to, as named in the options, and which brush each belongs to. */
export const SMART_FEATURES: Array<{ key: keyof SmartWeights; name: string; hint: string; brush: 'both' | 'geography' | 'strategic'; needs: 'rivers' | 'coasts' | 'today' | 'heights' | 'any' }> = [
  { key: 'rivers', name: 'Rivers', hint: 'Rivers and canals: the line takes their course (the strategic brush: along the far bank, the river kept on your side)', brush: 'both', needs: 'rivers' },
  { key: 'coasts', name: 'Coasts and lakes', hint: 'Coastlines and lake shores', brush: 'both', needs: 'coasts' },
  { key: 'ridges', name: 'Ridges', hint: 'Mountain crests, from the heights', brush: 'both', needs: 'heights' },
  { key: 'valleys', name: 'Valleys', hint: 'Valley floors, from the heights', brush: 'geography', needs: 'heights' },
  { key: 'borders', name: 'Borders on the map', hint: 'The borders of this map as they are at the date viewed', brush: 'both', needs: 'any' },
  { key: 'today', name: "Today's borders", hint: "Today's country borders (Natural Earth)", brush: 'both', needs: 'today' },
  { key: 'lines', name: 'Lines on your layers', hint: 'Roads, railways, canals and other lines drawn on the map\'s layers, as they are at the date viewed', brush: 'both', needs: 'any' },
  { key: 'rough', name: 'Rough ground', hint: 'Steep, broken ground draws the line into it (a buffer)', brush: 'strategic', needs: 'heights' },
  { key: 'towns', name: 'Towns onto your side', hint: 'Cities near the line are pulled inside your side', brush: 'strategic', needs: 'any' },
  { key: 'points', name: 'Your points onto your side', hint: 'Objectives and installations placed on the map\'s layers of points are pulled inside your side', brush: 'strategic', needs: 'any' },
  { key: 'passes', name: 'Passes onto your side', hint: 'Mountain passes within reach (found from the heights) are pulled inside your side', brush: 'strategic', needs: 'heights' },
];
