// Biomes and the satellite look (Stage 8, D100): a planet's land cover worked out from its heights
// (warmth from latitude and height, moisture from the belts of rain and the air that reaches a place,
// rain shadows behind mountains, ice caps); Earth's land cover shipped as a picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { biomeOf, warmthAt, rainBelt, seaDistance, airMoisture, biomeColours, climateColour, climateOf, BIOMES, EARTH_CLIMATE } from '../src/terrain/biomes.ts';
import { planetParamsOf, PLANET_PRESETS } from '../src/terrain/planet.ts';
import { planetPreview } from '../src/terrain/planet-preview.ts';
import { PALETTES, rampAt } from '../src/terrain/look.ts';
import type { ElevationGrid } from '../src/terrain/grid.ts';

const W = 360, H = 180, R = 6371;
const world = (f: (lon: number, lat: number) => number): ElevationGrid => {
  const data = new Int16Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) data[j * W + i] = Math.round(f(-179.5 + i, 89.5 - j));
  return { width: W, height: H, step: 1, data };
};
const cell = (lon: number, lat: number) => Math.floor(90 - lat) * W + ((Math.floor(lon + 180) % W) + W) % W;
const colourAt = (c: Uint8Array, lon: number, lat: number) => Array.from(c.subarray(cell(lon, lat) * 4, cell(lon, lat) * 4 + 3));
const near = (a: number[], b: readonly number[], d: number) => a.every((v, q) => Math.abs(v - b[q]) <= d);

test('warmth by latitude and height, moisture by belt; the biome of warmth and moisture', () => {
  assert.equal(warmthAt(0, 0), 28);
  assert.ok(Math.abs(warmthAt(60, 0) - 1) < 0.01 && warmthAt(80, 0) < -17, 'cold towards the poles');
  assert.ok(Math.abs(warmthAt(0, 2000) - (28 - 13)) < 1e-9, '6.5 °C colder for every kilometre up');
  assert.ok(rainBelt(0) === 1 && rainBelt(23) < 0.45 && rainBelt(50) > 0.8 && rainBelt(85) < 0.4, 'wet at the equator and in the middle latitudes');
  assert.equal(rainBelt(-23), rainBelt(23));
  assert.equal(biomeOf(-25, 0.5), 'ice');
  assert.equal(biomeOf(-10, 0.5), 'tundra');
  assert.equal(biomeOf(0, 0.5), 'boreal');
  assert.equal(biomeOf(0, 0.1), 'tundra');
  assert.equal(biomeOf(12, 0.6), 'forest');
  assert.equal(biomeOf(12, 0.3), 'grass');
  assert.equal(biomeOf(25, 0.9), 'rainforest');
  assert.equal(biomeOf(25, 0.45), 'savanna');
  assert.equal(biomeOf(25, 0.1), 'desert');
});

test('distance from the sea grows inland, in every direction and across the 180th meridian', () => {
  // A continent from 30° W to 30° E and 40° S to 40° N, and an island across the 180th meridian.
  const g = world((lon, lat) => (Math.abs(lon) < 30 && Math.abs(lat) < 40) || (Math.abs(lon) > 175 && Math.abs(lat) < 5) ? 200 : -3000);
  const d = seaDistance(g, R), km = (lon: number, lat: number) => d[cell(lon, lat)];
  assert.equal(km(100.5, 0.5), 0, 'the sea is at the sea');
  const perDegree = (Math.PI * R) / 180;
  assert.ok(Math.abs(km(0.5, 0.5) - 29.5 * perDegree) < 0.1 * 29.5 * perDegree, `the middle about 30° in (${Math.round(km(0.5, 0.5))} km)`);
  assert.ok(km(10.5, 0.5) < km(0.5, 0.5) && km(0.5, 30.5) < km(0.5, 0.5), 'nearer the coasts, nearer the sea');
  assert.ok(Math.abs(km(-10.5, 0.5) - km(10.5, 0.5)) < 1, 'the same both ways');
  assert.ok(km(179.5, 0.5) > 0 && Math.abs(km(179.5, 0.5) - km(-179.5, 0.5)) < 1, 'the island across the 180th meridian');
});

test('mountains cast rain shadows downwind: dry behind a range, moist before it', () => {
  // A long continent in the westerlies (45° N) with a range running north to south near its west coast.
  const g = world((lon, lat) => {
    if (lat < 25 || lat > 65 || lon < -60 || lon > 60) return -3000;
    return Math.abs(lon + 45) < 3 ? 4000 : 300;
  });
  const air = airMoisture(g, R);
  const before = air[cell(-55.5, 45.5)], behind = air[cell(-35.5, 45.5)];
  assert.ok(before > 0.7 && behind < before / 3, `moist before the range (${before.toFixed(2)}), dry behind it (${behind.toFixed(2)})`);
  // In the tropics the wind blows from the east: the shadow lies to the west of the range.
  const t = world((lon, lat) => (Math.abs(lat) > 20 || lon < -60 || lon > 60 ? -3000 : Math.abs(lon - 45) < 3 ? 4000 : 300));
  const ta = airMoisture(t, R);
  assert.ok(ta[cell(55.5, 10.5)] > 2 * ta[cell(35.5, 10.5)], 'the trade winds: moist east of the range, dry west of it');
});

test('biome colours: rainforest at the equator, desert inland in the subtropics, ice and rock; the sea takes coastal colours', () => {
  const g = world((lon, lat) => {
    if (Math.abs(lon) > 60) return -3000;
    if (Math.abs(lon - 20) < 2 && Math.abs(lat - 50) < 2) return 6000; // a high peak
    return 200;
  });
  const c = biomeColours(g, R);
  const a = biomeColours(g, R);
  assert.deepEqual(a, c, 'the same heights, the same colours');
  assert.ok(near(colourAt(c, -40.5, 0.5), BIOMES.rainforest, 25), `rainforest at the equator (${colourAt(c, -40.5, 0.5)})`);
  assert.ok(near(colourAt(c, 0.5, 24.5), BIOMES.desert, 25), `desert in the middle of the continent at 25° N (${colourAt(c, 0.5, 24.5)})`);
  assert.ok(near(colourAt(c, 0.5, 84.5), BIOMES.ice, 12), `ice near the pole (${colourAt(c, 0.5, 84.5)})`);
  assert.ok(near(colourAt(c, 20.5, 50.5), BIOMES.ice, 30) || near(colourAt(c, 20.5, 50.5), BIOMES.rock, 30), `ice or rock on the peak (${colourAt(c, 20.5, 50.5)})`);
  for (let k = 0; k < W * H; k++) assert.equal(c[k * 4 + 3], 255, 'every cell has a colour');
  // The sea's colour: the cover it would have as low land (for when the sea falls).
  assert.ok(near(colourAt(c, 100.5, 0.5), BIOMES.rainforest, 30), `the sea at the equator as coastal lowland (${colourAt(c, 100.5, 0.5)})`);
});

test('a world\'s climate: ice caps from its settings, a desert world dry, barren worlds in their own colours', () => {
  const flat = world((lon, lat) => (Math.abs(lat) < 80 ? 300 : 300));
  const capped = planetParamsOf({ seed: 1, preset: 'earthlike', ice: 0.5 })!;
  const climate = climateOf(capped);
  assert.equal(climate.iceFrom, 55);
  const c = biomeColours(flat, R, climate);
  assert.ok(near(colourAt(c, 0.5, 70.5), BIOMES.ice, 12), 'ice from 55° on, as the generator lays its caps');
  assert.ok(!near(colourAt(c, 0.5, 40.5), BIOMES.ice, 40), 'none at 40°');
  assert.equal(climateOf(planetParamsOf({ seed: 1, preset: 'earthlike', ice: 0 })!).iceFrom, 90);
  const dry = biomeColours(flat, R, climateOf(planetParamsOf({ seed: 1, preset: 'desert' })!));
  assert.ok(near(colourAt(dry, 0.5, 45.5), BIOMES.desert, 40) || near(colourAt(dry, 0.5, 45.5), BIOMES.steppe, 30), `a desert world is dry even at 45° (${colourAt(dry, 0.5, 45.5)})`);
  const moon = biomeColours(flat, R, climateOf(planetParamsOf({ seed: 1, preset: 'moon' })!));
  assert.deepEqual(colourAt(moon, 0.5, 0.5), rampAt(PALETTES.moon.land, 300).map(Math.round), 'a moon in its greys');
  assert.equal(EARTH_CLIMATE.wetness, 1);
});

test('Earth-like planets take the satellite look, and their picture in New map shows their biomes', () => {
  assert.equal(PLANET_PRESETS.earthlike.palette, 'satellite');
  assert.equal(PLANET_PRESETS.desert.palette, 'desert');
  assert.equal(PALETTES.satellite.cover, true);
  const px = planetPreview(planetParamsOf({ seed: 7, preset: 'earthlike' })!, 128);
  // Some land is green (forest) and some sandy (desert): not the one ramp of heights.
  let green = 0, sand = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 1] > px[i] + 8 && px[i + 1] > px[i + 2] + 8) green++;
    if (px[i] > 150 && px[i] > px[i + 2] + 50) sand++;
  }
  assert.ok(green > 20 && sand > 20, `forests (${green} pixels) and deserts (${sand})`);
});

test('Earth\'s land cover ships as a 4096 × 2048 WebP picture, credited to Natural Earth', () => {
  const b = readFileSync('data/terrain/earth-cover-4096.webp');
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(b.toString('latin1', 8, 12), 'WEBP');
  assert.ok(b.length < 1.5e6, `small enough to ship (${Math.round(b.length / 1024)} KB)`);
  // Its size: in the extended header ("VP8X"), or in the frame header of a plain lossy picture ("VP8 ").
  const kind = b.toString('latin1', 12, 16);
  const size = kind === 'VP8X' ? [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1] : [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  assert.deepEqual(size, [4096, 2048]);
  const ne = (JSON.parse(readFileSync('data/datasets.json', 'utf8')) as Array<{ id: string; usedFor: string; sources: Array<{ file: string }> }>).find((d) => d.id === 'natural-earth')!;
  assert.match(ne.usedFor, /earth-cover-4096\.webp/);
  assert.ok(ne.sources.some((s) => s.file === 'NE1_LR_LC.zip'));
});

test('the colour of a climate (D194): each biome\'s own well inside it, one giving way to the next by degrees', () => {
  const far = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, q) => Math.abs(v - b[q])));
  // Well inside a biome: its own colour.
  for (const [w, m] of [[26, 0.95], [25, 0.05], [10, 0.8], [10, 0.05], [-1, 0.6], [-11, 0.5], [-30, 0.5], [24, 0.44]] as const) {
    assert.ok(far(climateColour(w, m), BIOMES[biomeOf(w, m)]) < 6, `${biomeOf(w, m)} at ${w} °C, ${m}: ${climateColour(w, m).map(Math.round)}`);
  }
  // At the border of forest and grassland (moisture 0.45 at 10 °C): half way between their colours.
  const mid = climateColour(10, 0.45), half = BIOMES.forest.map((v, q) => (v + BIOMES.grass[q]) / 2);
  assert.ok(far(mid, half) < 8, `between forest and grassland (${mid.map(Math.round)} for ${half})`);
  // No step anywhere: a tenth of a degree or a hundredth of moisture changes the colour by a few parts in 255 at most.
  let step = 0;
  for (let w = -40; w < 40; w += 0.1) for (const m of [0.1, 0.3, 0.5, 0.8]) step = Math.max(step, far(climateColour(w, m), climateColour(w + 0.1, m)));
  for (let m = 0; m < 0.99; m += 0.01) for (const w of [-10, 2, 12, 25]) step = Math.max(step, far(climateColour(w, m), climateColour(w, m + 0.01)));
  assert.ok(step < 10, `by degrees (the largest step ${step.toFixed(1)} of 255)`);
  // Beyond the table's ends: the last colours.
  assert.ok(far(climateColour(-80, 0.5), BIOMES.ice) < 2 && far(climateColour(60, 2), BIOMES.rainforest) < 2);
});
