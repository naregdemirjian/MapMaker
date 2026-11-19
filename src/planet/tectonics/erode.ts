// The landscape on the moving crust (Stage 14.4, D155): every 5 million years of a history, rivers, creep and
// sediment (surface/erosion.ts) act on the world's surface, and what they do goes back into the plates' crust:
// rock removed thins the crust (sediment first), which then rises isostatically, so mountains wear down slowly
// while their roots come up; sediment laid down rests on the crust where it settled (on a sinking plate it goes
// down at the trench, a share scraped off). Mountains and the valleys cut into them grow together.
import { landscapeStep, zonalRain, EARTH_K } from '../surface/erosion.ts';
import { heights } from './step.ts';
import type { TectonicState } from './state.ts';

/** Rivers cut bedrock only where steeper than this (about the regional slope of old cratons). */
export let SLOPE_THRESHOLD = 0.001;
export const setSlopeThreshold = (v: number) => { SLOPE_THRESHOLD = v; };

export function erodeCrust(state: TectonicState, dt: number) {
  const { mesh, plates, owner, ref, params } = state;
  const n = mesh.n, R = params.radiusKm;
  // Rain where the moment's climate puts it (D159), or belts by latitude without a climate.
  let rain: Float64Array;
  if (state.paleo) rain = state.paleo.rain;
  else {
    rain = new Float64Array(n);
    let mean = 0;
    for (let c = 0; c < n; c++) {
      rain[c] = zonalRain((mesh.lat[c] * 180) / Math.PI, params.hadleyDeg ?? 30);
      mean += rain[c] * mesh.area[c];
    }
    mean /= 4 * Math.PI;
    for (let c = 0; c < n; c++) rain[c] /= mean;
  }
  // Creep at the scale of a cell: relief a cell across relaxes in a few hundred million years by creep alone.
  const spacing = Math.sqrt((4 * Math.PI) / n) * R;
  const res = landscapeStep(mesh, state.height, {
    dt, K: EARTH_K * (params.erodibility ?? 1), m: 0.5, kappa: (spacing * spacing) / 400, beta: 0.15, radiusKm: R, threshold: SLOPE_THRESHOLD,
    seaLevel: state.seaLevel, rain,
  });
  for (let c = 0; c < n; c++) {
    const p = plates[owner[c]], r = ref[c];
    if (!p || r < 0 || !p.member[r]) continue;
    const removed = res.incision[c] - res.creep[c];
    if (removed > 0) {
      const s = Math.min(p.sediment[r], removed);
      p.sediment[r] -= s;
      p.thickness[r] = Math.max(3, p.thickness[r] - (removed - s));
    } else p.thickness[r] -= removed;
    p.sediment[r] += res.deposit[c];
  }
  state.totals.eroded += res.eroded;
  state.totals.deposited += res.deposited;
  state.discharge = Float32Array.from(res.discharge);
  heights(state);
}
