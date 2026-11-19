// Biomes (Stage 14.9, D160): Köppen-Geiger classes for reference climate records (monthly normals) by the rules of
// Peel, Finlayson and McMahon (2007); biomes by temperature and the aridity index, refined by water, ice and height;
// a planet's own biomes by priority; plant colours under other stars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koppen, biomeOf, customBiomeOf, biomeColour, seasonality, type Place } from '../src/planet/life/biomes.ts';
import { WATER } from '../src/planet/water/hydrology.ts';

/** Monthly normals (°C; mm), January first. */
const STATIONS: Array<[string, string, number[], number[]]> = [
  ['Singapore', 'Af', [26.5, 27.1, 27.6, 28.0, 28.3, 28.3, 27.9, 27.9, 27.6, 27.6, 27.0, 26.4], [234, 113, 175, 154, 171, 162, 158, 176, 169, 194, 256, 288]],
  ['Miami', 'Am', [20.1, 21.0, 22.4, 24.4, 26.5, 27.9, 28.7, 28.8, 28.1, 26.4, 23.6, 21.4], [47, 53, 63, 87, 135, 248, 166, 223, 226, 156, 91, 54]],
  ['Darwin', 'Aw', [28.6, 28.3, 28.4, 28.6, 27.5, 25.8, 25.4, 26.4, 28.0, 29.1, 29.3, 29.2], [427, 374, 317, 102, 21, 2, 1, 5, 15, 70, 142, 249]],
  ['Cairo', 'BWh', [14.0, 15.4, 17.6, 21.3, 24.8, 27.0, 27.9, 27.7, 26.1, 23.6, 19.4, 15.6], [5, 4, 4, 1, 0, 0, 0, 0, 0, 1, 3, 6]],
  ['Khartoum', 'BWh', [23.2, 25.0, 28.7, 31.9, 34.5, 34.3, 32.1, 31.5, 32.5, 31.4, 27.6, 24.1], [0, 0, 0, 0, 4, 5, 46, 75, 25, 5, 0, 0]],
  ['Denver', 'BSk', [-1.3, 0.2, 4.3, 8.3, 13.7, 19.3, 22.8, 21.7, 17.0, 10.6, 4.1, -1.3], [10, 12, 25, 43, 57, 46, 51, 45, 29, 25, 18, 13]],
  ['Rome', 'Csa', [7.5, 8.4, 10.9, 13.6, 17.9, 21.9, 24.7, 24.8, 21.3, 16.9, 11.7, 8.5], [67, 73, 58, 81, 53, 34, 19, 37, 73, 113, 115, 81]],
  ['San Francisco', 'Csb', [10.7, 12.0, 12.8, 13.5, 14.4, 15.4, 15.7, 16.4, 17.3, 16.4, 13.7, 10.9], [114, 113, 78, 37, 18, 4, 0, 1, 4, 26, 75, 105]],
  ['Hong Kong', 'Cwa', [16.3, 16.8, 19.1, 22.6, 25.9, 27.9, 28.8, 28.6, 27.7, 25.5, 21.8, 17.9], [33, 35, 69, 140, 312, 475, 383, 393, 299, 114, 39, 26]],
  ['Shanghai', 'Cfa', [4.8, 6.5, 10.0, 15.6, 20.8, 24.4, 28.6, 28.2, 24.3, 19.1, 13.4, 7.3], [74, 59, 94, 84, 102, 170, 147, 214, 87, 55, 52, 44]],
  ['London', 'Cfb', [5.2, 5.3, 7.6, 9.9, 13.3, 16.5, 18.7, 18.5, 15.7, 12.0, 8.0, 5.5], [55, 41, 42, 44, 49, 45, 45, 50, 49, 69, 59, 55]],
  ['Moscow', 'Dfb', [-6.5, -6.7, -1.0, 6.7, 13.2, 17.0, 19.2, 17.0, 11.3, 5.6, -1.2, -5.2], [52, 41, 35, 37, 49, 80, 85, 82, 68, 71, 55, 52]],
  ['Yakutsk', 'Dfd', [-38.6, -33.8, -20.1, -4.8, 7.5, 16.4, 19.5, 15.2, 6.1, -7.8, -27.0, -37.6], [9, 8, 6, 9, 18, 32, 40, 39, 23, 16, 15, 10]],
  ['Utqiagvik', 'ET', [-25.7, -27.4, -25.8, -17.9, -6.6, 2.0, 5.0, 3.7, -0.6, -9.6, -18.1, -23.4], [5, 4, 4, 4, 5, 9, 25, 27, 17, 11, 6, 5]],
  ['Vostok', 'EF', [-32, -44, -57, -64, -66, -65, -67, -68, -66, -57, -43, -32], [1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1]],
];

test('Köppen-Geiger classes of reference climate records', () => {
  for (const [name, want, t, p] of STATIONS) assert.equal(koppen(t, p), want, name);
  // Summer from the sunlight: the southern hemisphere's half-year from October.
  const southern = STATIONS.find(([n]) => n === 'Rome')!;
  const shift = (a: number[]) => a.map((_, m) => a[(m + 6) % 12]);
  assert.equal(koppen(shift(southern[2]), shift(southern[3]), 9), 'Csa', 'Rome\'s climate six months on');
});

test('biomes: temperature and dryness, refined by water, ice and height; a planet\'s own; plants under other stars', () => {
  const place = (t: number[], p: number[], pet: number, extra: Partial<Place> = {}): Place => ({ temp: t, precip: p, pet, height: 200, water: WATER.land, ice: 0, ...extra });
  const s = (name: string) => STATIONS.find(([n]) => n === name)!;
  assert.equal(biomeOf(place(s('Singapore')[2], s('Singapore')[3], 1500)), 'rainforest');
  assert.equal(biomeOf(place(s('Darwin')[2], s('Darwin')[3], 2000)), 'savanna');
  assert.equal(biomeOf(place(s('Cairo')[2], s('Cairo')[3], 2000)), 'desert');
  assert.equal(biomeOf(place(s('Rome')[2], s('Rome')[3], 1100)), 'mediterranean');
  assert.equal(biomeOf(place(s('London')[2], s('London')[3], 600)), 'temperateForest');
  assert.equal(biomeOf(place(s('Moscow')[2], s('Moscow')[3], 550)), 'temperateForest');
  assert.equal(biomeOf(place(s('Yakutsk')[2], s('Yakutsk')[3], 400)), 'boreal');
  assert.equal(biomeOf(place(s('Utqiagvik')[2], s('Utqiagvik')[3], 150)), 'polarDesert');
  assert.equal(biomeOf(place(s('Denver')[2], s('Denver')[3], 1100)), 'steppe');
  // The water stage's kinds and ice, and high ground.
  assert.equal(biomeOf(place(s('Singapore')[2], s('Singapore')[3], 1500, { water: WATER.wetland })), 'swamp');
  assert.equal(biomeOf(place(s('London')[2], s('London')[3], 600, { ice: 800 })), 'ice');
  assert.equal(biomeOf(place(s('Cairo')[2], s('Cairo')[3], 2000, { water: WATER.saltFlat })), 'saltFlat');
  // A high mountain station (the warmest month under 10 °C, the year near −3 °C): alpine tundra and rock.
  assert.equal(biomeOf(place([-15, -14, -9, -3, 2, 6, 8, 7, 4, -2, -9, -13], [10, 15, 25, 40, 60, 90, 110, 100, 60, 25, 10, 8], 300, { height: 4500 })), 'alpine');
  // A planet's own biomes, earlier priorities first.
  const rules = [
    { id: 'b', name: 'Glass dunes', color: [250, 250, 250] as [number, number, number], tempC: [20, 60] as [number, number], precipMm: [0, 200] as [number, number], priority: 2 },
    { id: 'a', name: 'Ember steppe', color: [200, 60, 30] as [number, number, number], tempC: [22, 60] as [number, number], priority: 1 },
  ];
  assert.equal(customBiomeOf(place(s('Khartoum')[2], s('Khartoum')[3], 2000), rules)?.name, 'Ember steppe');
  assert.equal(customBiomeOf(place(s('London')[2], s('London')[3], 600), rules), null);
  // Rain's seasonality: even at Singapore, sharp at Darwin.
  assert.ok(seasonality(s('Singapore')[3]) < 0.25 && seasonality(s('Darwin')[3]) > 0.45);
  // Plants: green under a Sun-like star; dark red under a red dwarf; yellow-orange under a hot star; bare ground with none.
  const [r, g] = biomeColour('rainforest', { vegetation: 'earth' }), [r2, g2] = biomeColour('rainforest', { vegetation: 'red-dwarf' });
  assert.ok(g > r && r2 > g2, 'green, then red');
  const [r3, g3, b3] = biomeColour('temperateForest', { vegetation: 'blue-star' });
  assert.ok(r3 > b3 && g3 > b3, 'yellow-orange');
  const d1 = biomeColour('desert', { vegetation: 'red-dwarf' }), d0 = biomeColour('desert', { vegetation: 'earth' });
  assert.ok(d1.every((v, i) => Math.abs(v - d0[i]) < 8), 'deserts (a trace of plants) look much the same');
});

test('the real Earth\'s climate classified: desert belts in the subtropics, forest at the equator, boreal and tundra in the north', async () => {
  const { readFileSync } = await import('node:fs');
  const { inflateSync } = await import('node:zlib');
  const { decodeTerrain } = await import('../src/terrain/grid.ts');
  const { meshAt } = await import('../src/planet/mesh/icosphere.ts');
  const { sampleGrid } = await import('../src/planet/mesh/transfer.ts');
  const { definitionFromPreset } = await import('../src/planet/model/definition.ts');
  const { derive } = await import('../src/planet/model/physics.ts');
  const { seasonalClimate } = await import('../src/planet/climate/ebm.ts');
  const { hydroclimate } = await import('../src/planet/climate/hydroclimate.ts');
  const { insolationCells, sunlightOf } = await import('../src/planet/climate/insolation.ts');
  const { hydrology } = await import('../src/planet/water/hydrology.ts');
  const t = await decodeTerrain(new Uint8Array(readFileSync(new URL('../data/terrain/earth-4096.bin', import.meta.url))), (b: Uint8Array) => new Uint8Array(inflateSync(b)));
  const mesh = meshAt(5), n = mesh.n;
  const h = sampleGrid(mesh, t.data, 4096, 2048, 1);
  const def = definitionFromPreset('earthlike'), x = derive(def);
  const cl = seasonalClimate(mesh, def, x, h);
  const hy = hydroclimate(mesh, def, x, h, cl.monthly, 4, cl.dryWarm);
  const sun = insolationCells(mesh, sunlightOf(def, x), 0, n);
  const w = hydrology({ mesh, radiusKm: 6371, height: h, temp: hy.tempMonthly, precip: hy.precipMonthly, sun: sun.monthly, yearDays: x.yearDays });
  const classes = new Map<string, number>(), bands = new Map<string, Map<string, number>>();
  let land = 0;
  const T = new Float64Array(12), P = new Float64Array(12);
  for (let c = 0; c < n; c++) {
    if (w.ocean[c]) continue;
    let most = 0;
    for (let m = 0; m < 12; m++) { T[m] = hy.tempMonthly[m * n + c]; P[m] = hy.precipMonthly[m * n + c]; if (sun.monthly[m * n + c] > sun.monthly[most * n + c]) most = m; }
    const a = mesh.area[c];
    land += a;
    const k = koppen(T, P, (most - 2 + 12) % 12)[0];
    classes.set(k, (classes.get(k) ?? 0) + a);
    const lat = Math.abs((mesh.lat[c] * 180) / Math.PI), band = lat < 10 ? 'equator' : lat < 15 ? 'tropics' : lat < 35 ? 'subtropics' : lat < 50 ? 'mid' : lat < 65 ? 'boreal' : 'polar';
    const b = biomeOf({ temp: T, precip: P, pet: w.balance.pet[c], height: h[c], water: w.kind[c], ice: 0 });
    if (!bands.has(band)) bands.set(band, new Map());
    bands.get(band)!.set(b, (bands.get(band)!.get(b) ?? 0) + a);
  }
  const share = (band: string, ids: string[]) => { const m = bands.get(band)!; let s = 0, all = 0; for (const [k, v] of m) { all += v; if (ids.includes(k)) s += v; } return s / all; };
  const dry = ['desert', 'steppe', 'saltFlat'], wet = ['rainforest', 'tropicalSeasonal', 'swamp'];
  assert.ok(share('subtropics', dry) > 0.45 && share('subtropics', dry) > 2 * share('equator', dry), `deserts and steppe: ${(100 * share('subtropics', dry)).toFixed(0)}% of land at 15-35°, ${(100 * share('equator', dry)).toFixed(0)}% within 10°`);
  for (const band of ['tropics', 'subtropics', 'mid', 'boreal', 'polar']) assert.ok(share('equator', wet) > share(band, wet), `tropical forest most at the equator (${band})`);
  assert.ok(share('boreal', ['boreal']) > 0.35 && share('boreal', ['boreal']) > share('mid', ['boreal']), `boreal forest at 50-65° (${(100 * share('boreal', ['boreal'])).toFixed(0)}%)`);
  assert.ok(share('polar', ['tundra', 'polarDesert', 'ice']) > 0.7, 'tundra, polar desert and ice beyond 65°');
  // Köppen's main classes as shares of the land (measured: A 19, B 30, C 13, D 25, E 12 per cent; the model's dry
  // mid-latitudes make B too wide and D too narrow, D159).
  const of = (k: string) => (classes.get(k) ?? 0) / land;
  assert.ok(of('A') > 0.08 && of('A') < 0.3 && of('B') > 0.2 && of('B') < 0.5 && of('C') > 0.05 && of('D') > 0.08 && of('E') < 0.3, [...classes].map(([k, v]) => `${k} ${(100 * v / land).toFixed(0)}%`).join(' '));
});
