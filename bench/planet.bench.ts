// The planetary engine's benchmarks and Earth-like validation (Stage 14.11, D162; plan 11.2 and 11.4).
//
//   node --experimental-strip-types bench/planet.bench.ts            timings of every stage at preview and standard
//   node --experimental-strip-types bench/planet.bench.ts --validate  the validation report (docs/PLANET_VALIDATION.md)
//
// Timings run each stage once on one thread (the interface shares parts of some among its workers), for the
// Earth-like preset over 500 Myr, and an edit of the air after it (only today's climate, water and life again).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { decodeTerrain } from '../src/terrain/grid.ts';
import { definitionFromPreset, climateSnapshot, type PlanetDefinition } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { STAGES, type ProductData } from '../src/planet/pipeline/stages.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { sampleGrid } from '../src/planet/mesh/transfer.ts';
import { seasonalClimate } from '../src/planet/climate/ebm.ts';
import { hydroclimate } from '../src/planet/climate/hydroclimate.ts';
import { insolationCells, sunlightOf } from '../src/planet/climate/insolation.ts';
import { hydrology } from '../src/planet/water/hydrology.ts';
import { koppen, biomeOf, BIOME_IDS } from '../src/planet/life/biomes.ts';
import { oceanDepth } from '../src/planet/tectonics/isostasy.ts';

type Products = Record<string, ProductData>;
const ctx = { progress() {} };
async function runAll(def: PlanetDefinition, level: number, times?: Record<string, number>, have: Products = {}): Promise<Products> {
  const p = { level, durationMyr: 500, frameEveryMyr: 25, width: 1024, height: 512 };
  const out: Products = { ...have };
  const go = async (id: string, deps: string[]) => {
    if (out[id]) return;
    const t0 = performance.now();
    const d: Products = {};
    for (const k of deps) d[k] = out[k];
    out[id] = await STAGES[id].run(STAGES[id].inputs(def, p), d, ctx);
    if (times) times[id] = performance.now() - t0;
  };
  await go('tectonics', []);
  await go('insolation', []);
  await go('climate', ['tectonics']);
  await go('water', ['tectonics', 'climate', 'insolation']);
  await go('biomes', ['tectonics', 'climate', 'water', 'insolation']);
  await go('cover', ['biomes']);
  return out;
}

async function bench() {
  const rows: string[] = ['| Level | History (500 Myr) | Sunlight | Climate | Water and ice | Biomes | Cover (1024 × 512) | An edit of the air | An earlier moment |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const level of [5, 6]) {
    const def = definitionFromPreset('earthlike', 1);
    def.history.climate = climateSnapshot(def);
    const t: Record<string, number> = {};
    const all = await runAll(def, level, t);
    // An edit of the air: the history kept (D161), today's climate, water, biomes and cover again.
    const edited: PlanetDefinition = structuredClone(def);
    edited.atmosphere.co2 *= 2;
    const t0 = performance.now();
    await runAll(edited, level, undefined, { tectonics: all.tectonics, insolation: all.insolation });
    const edit = performance.now() - t0;
    // An earlier moment's own climate and life, and its land seen from space (D167): the picture 250 Myr ago.
    const t1 = performance.now(), past = { level, durationMyr: 500, frameEveryMyr: 25, width: 1024, height: 512, frame: 10 };
    const moment = await STAGES.moment.run(STAGES.moment.inputs(def, past), { tectonics: all.tectonics }, ctx);
    await STAGES.cover.run(STAGES.cover.inputs(def, past), { moment }, ctx);
    const earlier = performance.now() - t1;
    const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
    rows.push(`| ${level} (${level === 5 ? 'preview' : 'standard'}) | ${s(t.tectonics)} | ${s(t.insolation)} | ${s(t.climate)} | ${s(t.water)} | ${s(t.biomes)} | ${s(t.cover)} | ${s(edit)} | ${s(earlier)} |`);
  }
  console.log(rows.join('\n'));
}

async function validate() {
  const lines: string[] = [];
  const say = (s = '') => lines.push(s);
  const fmt = (v: number, d = 0) => v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
  say('# The planetary engine: Earth-like validation');
  say();
  say('Made by `node --experimental-strip-types bench/planet.bench.ts --validate` (Stage 14.11, D162). Distributions, not');
  say('maps: a simulated Earth-like planet is a different planet; where the real Earth is used, its heights are measured');
  say('and everything else is this engine\'s. Measured values are approximate climatologies and references in D157 to D162.');
  say();
  // 1. A simulated Earth-like planet (preview level, 500 Myr).
  const def = definitionFromPreset('earthlike', 1), level = 5, mesh = meshAt(level), n = mesh.n;
  const all = await runAll(def, level);
  const H = all.tectonics.heights as Int16Array, F = H.length / n, h = H.subarray((F - 1) * n);
  const area = (c: number) => mesh.area[c] / (4 * Math.PI);
  let land = 0, high = 0;
  const bins = new Map<number, number>();
  for (let c = 0; c < n; c++) {
    if (h[c] >= 0) land += area(c);
    if (h[c] >= 2000) high += area(c);
    const b = Math.floor(h[c] / 500) * 500;
    bins.set(b, (bins.get(b) ?? 0) + area(c));
  }
  const peak = (above: boolean) => [...bins].filter(([b]) => (above ? b >= -500 : b < -2000)).sort((a, b) => b[1] - a[1])[0][0];
  say('## A simulated Earth-like planet (preset "Earth-like", seed 1, 500 Myr at the preview level)');
  say();
  say('| Measure | This planet | The Earth |');
  say('| --- | --- | --- |');
  say(`| Land share | ${fmt(100 * land)} % | 29 % |`);
  say(`| Hypsometry: the two peaks (500 m bins) | ${fmt(peak(true))} to ${fmt(peak(true) + 500)} m and ${fmt(peak(false))} to ${fmt(peak(false) + 500)} m | 0 to 1,000 m and −4,000 to −5,000 m |`);
  say(`| Surface above 2 km | ${fmt(100 * high, 1)} % | about 3 % (11 % of the land), about 1 % without the ice sheets' surfaces |`);
  // Age-depth: by construction GDH1; the fit says the relation survives the smoothing and trenches.
  const age = all.tectonics.age as Float32Array, kinds = (all.tectonics.kinds as Uint8Array).subarray((F - 1) * n);
  let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
  for (let c = 0; c < n; c++) if (kinds[c] === 1 && age[c] > 2 && age[c] < 80) { const x = Math.sqrt(age[c]), y = -h[c] / 1000; sx += x; sy += y; sxx += x * x; sxy += x * y; k++; }
  const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx);
  say(`| Sea floor deepening with age (younger than 80 Myr) | ${fmt(slope, 2)} km per √Myr | 0.35 (GDH1: ${fmt(oceanDepth(64) - oceanDepth(0), 1)} km over 64 Myr) |`);
  const seaLevels = Array.from(all.tectonics.seaLevels as Float32Array), ice = Array.from(all.tectonics.iceVolumes as Float32Array);
  say(`| The sea's level over the history | ${fmt(Math.min(...seaLevels))} to ${fmt(Math.max(...seaLevels))} m | about −120 to +250 m over the last 500 Myr |`);
  say(`| Ice on land over the history | ${fmt(Math.min(...ice) / 1e6, 1)} to ${fmt(Math.max(...ice) / 1e6, 1)} million km³ | 0 to about 80 (today 30) |`);
  // Climate.
  const T = all.climate.annual as Float32Array, P = all.climate.precipAnnual as Float32Array, cur = all.climate.currents as Float32Array;
  const zonal = (a: number, b: number, f: ArrayLike<number>) => { let s = 0, w = 0; for (let c = 0; c < n; c++) { const lat = Math.abs((mesh.lat[c] * 180) / Math.PI); if (lat >= a && lat < b) { s += f[c] * mesh.area[c]; w += mesh.area[c]; } } return s / w; };
  say(`| Mean temperature at the surface | ${fmt(all.climate.meanK as number - 273.15, 1)} °C | 15 °C |`);
  say(`| Within 10° of the equator / beyond 70° | ${fmt(zonal(0, 10, T), 1)} / ${fmt(zonal(70, 90, T), 1)} °C | 27 / −15 to −30 °C |`);
  say(`| Rain and snow, the planet's mean | ${fmt(all.climate.meanPrecip as number)} mm a year | about 1,000 |`);
  say(`| Rain within 10° of the equator / at 20-30° | ${fmt(zonal(0, 10, P))} / ${fmt(zonal(20, 30, P))} mm | about 2,000 / 700 |`);
  let west = 0, nw = 0, eastSide = 0, ne = 0;
  for (let c = 0; c < n; c++) { if (h[c] >= 0) continue; if (cur[c] > 0.5) { west += cur[c]; nw++; } else if (cur[c] < -0.5) { eastSide += cur[c]; ne++; } }
  say(`| The sea's currents: warm western sides, cool eastern | ${fmt(100 * nw / n, 1)} % of cells warmed (mean +${fmt(west / Math.max(1, nw), 1)} K), ${fmt(100 * ne / n, 1)} % cooled (${fmt(eastSide / Math.max(1, ne), 1)} K) | as the Gulf Stream and Kuroshio, the Canary and Humboldt |`);
  // Biome belts.
  const biome = all.biomes.biome as Uint8Array, bands = new Map<string, Map<string, number>>();
  for (let c = 0; c < n; c++) {
    if (h[c] < 0) continue;
    const lat = Math.abs((mesh.lat[c] * 180) / Math.PI), band = lat < 10 ? '0-10' : lat < 35 && lat >= 15 ? '15-35' : lat >= 50 && lat < 65 ? '50-65' : lat >= 65 ? '65-90' : 'other';
    if (!bands.has(band)) bands.set(band, new Map());
    const id = BIOME_IDS[biome[c]];
    bands.get(band)!.set(id, (bands.get(band)!.get(id) ?? 0) + mesh.area[c]);
  }
  const share = (band: string, ids: string[]) => { const m = bands.get(band); if (!m) return NaN; let s = 0, t = 0; for (const [id, v] of m) { t += v; if (ids.includes(id)) s += v; } return (100 * s) / t; };
  say(`| Deserts and steppe: land at 15-35° / within 10° | ${fmt(share('15-35', ['desert', 'steppe', 'saltFlat']))} / ${fmt(share('0-10', ['desert', 'steppe', 'saltFlat']))} % | the subtropical belts / few |`);
  say(`| Tropical forest within 10° | ${fmt(share('0-10', ['rainforest', 'tropicalSeasonal', 'swamp']))} % | most |`);
  say(`| Boreal forest at 50-65°; tundra, polar desert and ice beyond 65° | ${fmt(share('50-65', ['boreal']))} %; ${fmt(share('65-90', ['tundra', 'polarDesert', 'ice']))} % | most; most |`);
  // Earlier moments' own biomes (D167): the quick picture of today against the full stages.
  const now = await STAGES.moment.run(STAGES.moment.inputs(def, { level, durationMyr: 500, frameEveryMyr: 25, frame: F - 1 }), { tectonics: all.tectonics }, ctx);
  const pic = now.biome as Uint8Array, WET = ['wetland', 'swamp', 'lake', 'saltFlat'];
  let landA = 0, sameA = 0, dryA = 0, sameDry = 0, desertFull = 0, desertPic = 0;
  for (let c = 0; c < n; c++) {
    const id = BIOME_IDS[biome[c]];
    if (id === 'sea') continue;
    landA += mesh.area[c];
    if (biome[c] === pic[c]) sameA += mesh.area[c];
    if (!WET.includes(id)) { dryA += mesh.area[c]; if (biome[c] === pic[c]) sameDry += mesh.area[c]; }
    if (id === 'desert') desertFull += mesh.area[c];
    if (BIOME_IDS[pic[c]] === 'desert') desertPic += mesh.area[c];
  }
  say(`| An earlier moment's biomes (worked out quickly from its own climate, D167), tried on today | the same biome on ${fmt(100 * sameA / landA)} % of the land, ${fmt(100 * sameDry / dryA)} % besides lakes and wetlands; deserts ${fmt(100 * desertPic / landA, 1)} % of the land (the full stages: ${fmt(100 * desertFull / landA, 1)} %) | — |`);
  // Hack's law from the rivers: main stream length against drainage area.
  const w = hydrology({ mesh, radiusKm: def.body.radiusKm, height: h, temp: all.climate.monthly as Float32Array, precip: all.climate.precipMonthly as Float32Array, sun: all.insolation.monthly as Float32Array, yearDays: derive(def).yearDays });
  const R = def.body.radiusKm, areaKm = new Float64Array(n), longest = new Float64Array(n), up = new Map<number, number[]>();
  for (let c = 0; c < n; c++) { areaKm[c] = mesh.area[c] * R * R; const r = w.receiver[c]; if (r !== c) { if (!up.has(r)) up.set(r, []); up.get(r)!.push(c); } }
  // Upstream first: cells in order of how far they lie from their outlet... a simple repeated relaxation suffices here.
  const acc = Float64Array.from(areaKm);
  const order: number[] = [];
  const seen = new Uint8Array(n);
  const visit = (c: number) => { const stack = [c]; while (stack.length) { const k2 = stack[stack.length - 1]; const kids = (up.get(k2) ?? []).filter((j) => !seen[j]); if (kids.length) { for (const j of kids) { seen[j] = 1; stack.push(j); } } else { stack.pop(); order.push(k2); } } };
  for (let c = 0; c < n; c++) if (w.receiver[c] === c) { seen[c] = 1; visit(c); }
  for (const c of order) {
    const r = w.receiver[c];
    if (r === c) continue;
    acc[r] += acc[c];
    const step = Math.acos(Math.max(-1, Math.min(1, mesh.xyz[3 * c] * mesh.xyz[3 * r] + mesh.xyz[3 * c + 1] * mesh.xyz[3 * r + 1] + mesh.xyz[3 * c + 2] * mesh.xyz[3 * r + 2]))) * R;
    longest[r] = Math.max(longest[r], longest[c] + step);
  }
  let hx = 0, hy2 = 0, hxx = 0, hxy = 0, hk = 0;
  for (let c = 0; c < n; c++) if (!w.ocean[c] && acc[c] > 20 * areaKm[c] && longest[c] > 0) { const x = Math.log(acc[c]), y = Math.log(longest[c]); hx += x; hy2 += y; hxx += x * x; hxy += x * y; hk++; }
  const hack = (hk * hxy - hx * hy2) / (hk * hxx - hx * hx);
  say(`| Hack's law: main stream length ∝ area^h | h = ${fmt(hack, 2)} (${hk} cells draining over 20 cells) | 0.5 to 0.6 |`);
  say();
  // 2. The real Earth's heights with this engine's climate.
  const terrain = await decodeTerrain(new Uint8Array(readFileSync(new URL('../data/terrain/earth-4096.bin', import.meta.url))), (b) => new Uint8Array(inflateSync(b)));
  const m5 = meshAt(5), n5 = m5.n, eh = sampleGrid(m5, terrain.data, 4096, 2048, 1);
  const earth = definitionFromPreset('earthlike'), ex = derive(earth);
  const cl = seasonalClimate(m5, earth, ex, eh);
  const hy = hydroclimate(m5, earth, ex, eh, cl.monthly, 4, cl.dryWarm);
  const sun = insolationCells(m5, sunlightOf(earth, ex), 0, n5);
  const ew = hydrology({ mesh: m5, radiusKm: 6371, height: eh, temp: hy.tempMonthly, precip: hy.precipMonthly, sun: sun.monthly, yearDays: ex.yearDays });
  const near = (lon: number, lat: number) => { const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, q = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; let b = 0, bd = -2; for (let c = 0; c < n5; c++) { const d = q[0] * m5.xyz[3 * c] + q[1] * m5.xyz[3 * c + 1] + q[2] * m5.xyz[3 * c + 2]; if (d > bd) { bd = d; b = c; } } return b; };
  const stations: Array<[string, number, number, number, number]> = [['Singapore', 103.8, 1.3, 27.5, 2300], ['Manaus', -60, -3, 27, 2300], ['Lagos', 3.4, 6.5, 27, 1500], ['Kinshasa', 15.3, -4.3, 25.5, 1400], ['Mumbai', 72.8, 19.1, 27, 2200], ['Delhi', 77.2, 28.6, 25, 800], ['Riyadh', 46.7, 24.7, 26, 100], ['Cairo', 31.2, 30, 22, 25], ['Khartoum', 32.5, 15.6, 30, 160], ['Phoenix', -112, 33.4, 24, 200], ['Atlanta', -84.4, 33.7, 17, 1250], ['Chicago', -88, 42, 10, 940], ['Beijing', 116.4, 39.9, 13, 570], ['Shanghai', 121.5, 31.2, 17, 1150], ['Madrid', -3.7, 40.4, 15, 420], ['Paris', 2.3, 48.8, 12, 640], ['Moscow', 37.6, 55.7, 6, 700], ['Yakutsk', 129.7, 62, -9, 240], ['Buenos Aires', -58.4, -34.6, 18, 1200], ['Sydney', 151.2, -33.9, 18, 1200], ['Alice Springs', 133.9, -23.7, 21, 280], ['Cape Town', 18.4, -33.9, 17, 520]];
  say('## The real Earth\'s heights with this engine\'s climate, water and biomes (level 5)');
  say();
  say('| Place | Temperature, model (measured) | Rain and snow, model (measured) |');
  say('| --- | --- | --- |');
  let te = 0, pe = 0;
  for (const [name, lon, lat, tm, pm] of stations) {
    const c = near(lon, lat);
    let t = 0;
    for (let m = 0; m < 12; m++) t += hy.tempMonthly[m * n5 + c] / 12;
    const p = hy.precipAnnual[c];
    te += (t - tm) ** 2; pe += Math.log((p + 50) / (pm + 50)) ** 2;
    say(`| ${name} | ${fmt(t, 1)} °C (${tm}) | ${fmt(p)} mm (${fmt(pm)}) |`);
  }
  say();
  say(`Over these ${stations.length} places the yearly temperature's error is ${fmt(Math.sqrt(te / stations.length), 1)} K (root mean square) and rain's ${fmt(Math.sqrt(pe / stations.length), 2)} in natural logarithms (0.69 is a factor of two).`);
  say();
  const b = ew.budget;
  say(`Water on land: rain and snow ${fmt(b.precip)} km³ a year (measured about 113,000), evaporated ${fmt(b.landEvaporation)} (73,000), running off ${fmt(b.runoff)} (40,000), reaching the sea ${fmt(b.toSea)}; lakes ${fmt(b.lakes)} km³ and salt lakes ${fmt(b.saltLakes)} km³ (91,000 and 85,000).`);
  const classes = new Map<string, number>();
  let la = 0;
  const Tm = new Float64Array(12), Pm = new Float64Array(12);
  for (let c = 0; c < n5; c++) {
    if (ew.ocean[c]) continue;
    let most = 0;
    for (let m = 0; m < 12; m++) { Tm[m] = hy.tempMonthly[m * n5 + c]; Pm[m] = hy.precipMonthly[m * n5 + c]; if (sun.monthly[m * n5 + c] > sun.monthly[most * n5 + c]) most = m; }
    const k2 = koppen(Tm, Pm, (most - 2 + 12) % 12)[0];
    classes.set(k2, (classes.get(k2) ?? 0) + m5.area[c]); la += m5.area[c];
    void biomeOf;
  }
  say();
  say(`Köppen-Geiger's main classes as shares of the land: ${['A', 'B', 'C', 'D', 'E'].map((k2) => `${k2} ${fmt((100 * (classes.get(k2) ?? 0)) / la)} %`).join(', ')} (measured A 19, B 30, C 13, D 25, E 12 per cent).`);
  say();
  say('## Where it differs, and why');
  say();
  say('- Since D165 the energy balance carries the sea\'s heat (taken up in the tropics, given off further poleward, none');
  say('  across the Southern Ocean\'s circumpolar channel, 0.5 PW carried north across the equator), the winds carry the');
  say('  air\'s heat along the parallels (westerlies, trades, stronger in winter), each cell\'s land has its own temperature,');
  say('  ice sheets keep their snow all year and the sea is cloudier than the land: the zonal means come within about 1 K');
  say('  of the Earth\'s from 80° N to 60° S and Antarctica\'s plateau nearly as cold as measured. Still missing: winds');
  say('  that follow the pressure (the winter\'s northerlies down eastern North America and Asia), so east coasts\' winters');
  say('  are too mild and western Europe\'s summers too cool.');
  say('- Rain (D165): the deep tropics too wet and the planet\'s mean too high; northern India\'s monsoon too dry (its');
  say('  moisture does not reach 1,000 km inland); a city in a climate cell that is mostly sea takes the sea\'s rain (Cairo\'s');
  say('  480 km cell is three-quarters Mediterranean).');
  say('- Narrow ranges are blurred at the climate\'s 480 km cells: rain shadows are weaker than measured (D158).');
  say('- Lakes (D166): at the preview level a cell\'s mean height hides gorges and straits. Deep basins behind low sills');
  say('  join the sea (the Black and Red Seas) and outlets are cut by most of their hollows\' depth, but plateau basins');
  say('  whose gorges lie further off keep shallow lakes (British Columbia\'s, the Congo\'s, Lake Chad\'s much larger than');
  say('  its own), the deep lakes that hold most of the measured water (Baikal, Tanganyika, Superior) are narrower than a');
  say('  cell, and the Caspian fills to the sea\'s level and joins it.');
  say('- The deep sea floor (D166): old floor now founders as on the Earth (the floor\'s mean age 47 to 67 Myr over four');
  say('  seeds against 64), so its depths\' peak lies between 3 and 5.5 km by planet (the Earth\'s 4 to 5 km).');
  say('- A simulated planet is a different planet: its numbers are to be read as plausible, not as the Earth\'s.');
  console.log(lines.join('\n'));
}

if (process.argv.includes('--validate')) await validate();
else await bench();
