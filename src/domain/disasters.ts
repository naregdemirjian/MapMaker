// Disasters (Stage 9, D104): one click places a whole disaster, from a template and a size: the
// conditions it leaves (on field layers of their kinds, D102 and D103), and for an impact the crater it
// leaves in the terrain for good (sculpting, D98), all in an event of its own (or the one being
// recorded), undone in one step. Temporary conditions and permanent changes stay apart: the conditions
// fade by themselves, the crater stays. The sizes are rough rules for a map, not physics.
import type { FieldSource, FieldType } from './fields.ts';

export type DisasterId = 'nuclear' | 'earthquake' | 'volcano' | 'flood' | 'wildfire' | 'meteor' | 'drought';

export interface DisasterTemplate {
  id: DisasterId; name: string; hint: string;
  /** Its size: what is asked, its unit, usual value and range; whether it has a plume carried by the wind. */
  size: { label: string; unit: string; value: number; min: number; max: number; step: number };
  wind: boolean;
}

export const DISASTERS: DisasterTemplate[] = [
  { id: 'nuclear', name: 'Nuclear strike', hint: 'Blast and burning around ground zero, and radioactive fallout carried downwind', size: { label: 'Yield', unit: 'kilotons', value: 1000, min: 1, max: 100000, step: 100 }, wind: true },
  { id: 'earthquake', name: 'Earthquake', hint: 'Destruction around the epicentre, lasting for years', size: { label: 'Magnitude', unit: '', value: 7, min: 4.5, max: 9.5, step: 0.1 }, wind: false },
  { id: 'volcano', name: 'Volcanic eruption', hint: 'Lava running downhill, an ash plume carried downwind, and the ground ruined around the vent', size: { label: 'Explosivity (VEI)', unit: '', value: 4, min: 1, max: 8, step: 1 }, wind: true },
  { id: 'flood', name: 'Flood', hint: 'Water rising and filling the low ground around, then receding', size: { label: 'Water rises by', unit: 'm', value: 5, min: 0.5, max: 50, step: 0.5 }, wind: false },
  { id: 'wildfire', name: 'Wildfire', hint: 'A fire spreading over the land, faster uphill and downwind, with its smoke', size: { label: 'Spreads up to', unit: 'km', value: 60, min: 2, max: 1000, step: 5 }, wind: true },
  { id: 'meteor', name: 'Meteor impact', hint: 'A crater left in the terrain for good, the land around it flattened and burnt, and dust carried downwind', size: { label: 'Meteor across', unit: 'm', value: 500, min: 10, max: 15000, step: 50 }, wind: true },
  { id: 'drought', name: 'Drought and desertification', hint: 'Land drying out over months and staying dry for years', size: { label: 'Reaches', unit: 'km', value: 500, min: 10, max: 5000, step: 50 }, wind: false },
];
export const isDisasterId = (v: unknown): v is DisasterId => DISASTERS.some((d) => d.id === v);

/** What a disaster leaves: its conditions (each on a layer of its kind) and, for an impact, a crater. */
export interface DisasterPlan {
  name: string;
  sources: Array<{ type: FieldType; name: string; source: Partial<FieldSource> }>;
  crater: { radiusKm: number; depthM: number } | null;
}

const fmt = (v: number) => (v >= 1000 && v % 1000 === 0 ? `${v / 1000} Mt` : `${v} kt`);

/** The conditions (and crater) of a disaster of a size, the wind carrying its plumes towards `windDeg`. */
export function planDisaster(id: DisasterId, size: number, windDeg = 90): DisasterPlan {
  const t = DISASTERS.find((d) => d.id === id)!;
  const x = Math.max(t.size.min, Math.min(t.size.max, Number.isFinite(size) ? size : t.size.value));
  switch (id) {
    case 'nuclear': {
      const rb = 0.9 * Math.cbrt(x);
      return {
        name: `Nuclear strike (${fmt(x)})`, crater: null,
        sources: [
          { type: 'damage', name: 'Blast', source: { shape: 'circle', radiusKm: rb, intensity: 95, rise: 0, hold: 3650, decay: 3650, grow: 0, noise: 0.2 } },
          { type: 'fire', name: 'Firestorm', source: { shape: 'circle', radiusKm: 1.6 * rb, intensity: 1, rise: 0.05, hold: 1, decay: 0.5, grow: 0.1, noise: 0.4 } },
          { type: 'radiation', name: 'Fallout', source: { shape: 'plume', radiusKm: rb, intensity: 300 + 30 * Math.cbrt(x), rise: 0.05, hold: 0.5, decay: 3, windDeg, windKmPerDay: 300 } },
        ],
      };
    }
    case 'earthquake': {
      const r = 10 ** (0.5 * x - 1.8);
      return { name: `Earthquake (magnitude ${x})`, crater: null, sources: [{ type: 'damage', name: 'Destruction', source: { shape: 'circle', radiusKm: r, intensity: Math.max(10, Math.min(100, (x - 4.5) * 25)), rise: 0, hold: 365, decay: 365, grow: 0, noise: 0.5 } }] };
    }
    case 'volcano':
      return {
        name: `Volcanic eruption (VEI ${x})`, crater: null,
        sources: [
          { type: 'fire', name: 'Lava', source: { shape: 'spread', spread: 'lava', radiusKm: 4 + 3 * x, intensity: 1, rise: 0.2, hold: 10, decay: 5, grow: 3 + x } },
          { type: 'smoke', name: 'Ash', source: { shape: 'plume', radiusKm: 5 * x, intensity: 5 * 2 ** (x - 2), rise: 0.2, hold: 2 + x, decay: 10, windDeg, windKmPerDay: 400 } },
          { type: 'damage', name: 'Pyroclastic flows', source: { shape: 'circle', radiusKm: 2 * x, intensity: 90, rise: 0, hold: 3650, decay: 3650, grow: 0.2, noise: 0.5 } },
        ],
      };
    case 'flood':
      return { name: `Flood (${x} m)`, crater: null, sources: [{ type: 'flood', name: 'Floodwater', source: { shape: 'spread', spread: 'flood', radiusKm: 50 + 20 * x, intensity: x, rise: 2, hold: 5, decay: 6 } }] };
    case 'wildfire':
      return {
        name: `Wildfire (${x} km)`, crater: null,
        sources: [
          { type: 'fire', name: 'Fire', source: { shape: 'spread', spread: 'fire', radiusKm: x, intensity: 0.9, rise: 0.3, hold: 1, decay: 2, grow: Math.max(1, x / 10), windDeg, windKmPerDay: 150 } },
          { type: 'smoke', name: 'Smoke', source: { shape: 'plume', radiusKm: Math.max(2, x / 6), intensity: 4, rise: 0.3, hold: Math.max(1, x / 10), decay: 2, windDeg, windKmPerDay: 250 } },
        ],
      };
    case 'meteor': {
      // A crater about twenty times as wide as the meteor, a fifth as deep (shallower when larger).
      const rc = (10 * x) / 1000;
      return {
        name: `Meteor impact (${x >= 1000 ? `${x / 1000} km` : `${x} m`} across)`,
        crater: { radiusKm: rc, depthM: Math.min(4000, 400 * rc) },
        sources: [
          { type: 'damage', name: 'Blast', source: { shape: 'circle', radiusKm: 15 * rc, intensity: 100, rise: 0, hold: 3650, decay: 3650, grow: 0, noise: 0.3 } },
          { type: 'fire', name: 'Fires', source: { shape: 'circle', radiusKm: 25 * rc, intensity: 0.8, rise: 0.05, hold: 2, decay: 3, grow: 0.1, noise: 0.5 } },
          { type: 'smoke', name: 'Dust', source: { shape: 'plume', radiusKm: 5 * rc, intensity: 30, rise: 0.05, hold: 5, decay: 20, windDeg, windKmPerDay: 500 } },
        ],
      };
    }
    case 'drought':
      return { name: `Drought (${x} km)`, crater: null, sources: [{ type: 'drought', name: 'Drought', source: { shape: 'circle', radiusKm: x, intensity: 0.8, rise: 180, hold: 3650, decay: 3650, grow: 365, noise: 0.6 } }] };
  }
}
