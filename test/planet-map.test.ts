// The map uses the foundation (D271): a planet of the second calculation is seen as from space by default; its
// frozen seas are drawn as ice over the sea; its rivers follow the water that runs off its land, and there are none
// where nothing rains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { terrainLook } from '../src/world-model/world-settings.ts';
import { PALETTES } from '../src/terrain/look.ts';
import { definitionFromPreset, newDefinition } from '../src/planet/model/definition.ts';
import { Pipeline } from '../src/planet/pipeline/scheduler.ts';
import { frozenWater, shoreHeights, STRAIT_DEPTH_M } from '../src/planet/pipeline/stages.ts';
import { WATER } from '../src/planet/water/hydrology.ts';
import { noSeaAt } from '../src/terrain/grid.ts';
import { applyStamps } from '../src/terrain/sculpt.ts';
import { paleoGridAt } from '../src/terrain/paleo.ts';
import { LocalExecutor } from '../src/planet/worker/pool.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { BIOME, BIOME_IDS } from '../src/planet/life/biomes.ts';
import { RIVER_MIN_FLOW, riversOf, type RiverRain } from '../src/terrain/rivers.ts';
import { riversNow } from '../src/terrain/river-cache.ts';
import type { ElevationGrid } from '../src/terrain/grid.ts';

const P = { level: 4, durationMyr: 200, frameEveryMyr: 25, sea: true } as const;

test('a new planet\'s map: seen as from space where the sea follows from the water; by its heights for the first calculation', () => {
  const world = new World();
  cmd.seedProject(world, 'Planets');
  const second = world.get('map_space', cmd.createSimPlanet(world, 'New', newDefinition('earthlike', 4)).result)!;
  assert.equal(terrainLook(second)!.palette, 'satellite');
  assert.equal(PALETTES[terrainLook(second)!.palette].cover, true, 'its land by what covers it');
  assert.equal(terrainLook(second)!.relief, true);
  const first = world.get('map_space', cmd.createSimPlanet(world, 'Old', definitionFromPreset('earthlike', 4)).result)!;
  assert.equal(terrainLook(first)!.palette, 'natural', 'as its maps were made');
});

test('the map\'s cover of a planet: the land\'s colours alone, and in its alpha where the sea lies frozen', async () => {
  const p = new Pipeline(new LocalExecutor()), mesh = meshAt(4), W = 256, H = 128;
  const at = (c: number) => { const x = Math.min(W - 1, Math.floor(((mesh.lon[c] + Math.PI) / (2 * Math.PI)) * W)), y = Math.min(H - 1, Math.floor(((Math.PI / 2 - mesh.lat[c]) / Math.PI) * H)); return 4 * (y * W + x); };
  // (A cell with only its own kind around it: every neighbour the same, so that the picture there is that kind's.)
  const inside = (biome: Uint8Array, kind: string, also: (c: number) => boolean = () => true) => {
    const id = BIOME_IDS.indexOf(kind as keyof typeof BIOME);
    for (let c = 0; c < mesh.n; c++) {
      if (biome[c] !== id || !also(c)) continue;
      let all = true;
      for (let k = mesh.nbrStart[c]; k < mesh.nbrStart[c + 1] && all; k++) { const j = mesh.nbr[k]; if (biome[j] !== id) all = false; for (let q = mesh.nbrStart[j]; q < mesh.nbrStart[j + 1] && all; q++) if (biome[mesh.nbr[q]] !== id) all = false; }
      if (all) return c;
    }
    return -1;
  };
  // An ice age: open sea in the tropics, sea ice towards the poles.
  const d = newDefinition('ice-age', 4);
  const biome = (await p.product('biomes', d, P)).data.biome as Uint8Array;
  const map = (await p.product('cover', d, { ...P, width: W, height: H, ice: true })).data.pixels as Uint8Array;
  const open = inside(biome, 'sea', (c) => Math.abs(mesh.lat[c]) < 0.5), frozen = inside(biome, 'seaIce'), land = [...biome].findIndex((b, c) => BIOME[BIOME_IDS[b]].plants > 0.5 && Math.abs(mesh.lat[c]) < 0.6);
  assert.ok(open >= 0 && frozen >= 0 && land >= 0);
  assert.equal(map[at(open) + 3], 0, 'open sea: no ice');
  assert.ok(map[at(frozen) + 3] > 230, `frozen sea: ice (${map[at(frozen) + 3]})`);
  assert.ok(map[at(land) + 3] < 40, 'land by an open sea: water standing there would be open too');
  // (The colours are the land's alone: far out at sea the sea's own; over land not the ice's white.)
  assert.deepEqual([...map.subarray(at(open), at(open) + 3)], [...BIOME.sea.colour]);
  assert.ok(map[at(land) + 1] > map[at(land) + 2] + 5, `green land (${[...map.subarray(at(land), at(land) + 3)]})`);
  // The plain cover is as it was: opaque everywhere; and the land-alone cover keeps the land's share in its alpha
  // (sea ice counted with the land there, as the Studio's picture has it).
  const plain = (await p.product('cover', d, { ...P, width: W, height: H })).data.pixels as Uint8Array;
  assert.equal(plain[at(open) + 3], 255);
  assert.equal(plain[at(frozen) + 3], 255);
  const alone = (await p.product('cover', d, { ...P, width: W, height: H, land: true })).data.pixels as Uint8Array;
  assert.equal(alone[at(open) + 3], 0);
  assert.ok(alone[at(frozen) + 3] > 230 && alone[at(land) + 3] > 230);
  // A snowball: ice over all its sea. A scorched world: no sea, no ice.
  const ball = newDefinition('frozen', 4), ballBiome = (await p.product('biomes', ball, P)).data.biome as Uint8Array;
  const ballMap = (await p.product('cover', ball, { ...P, width: W, height: H, ice: true })).data.pixels as Uint8Array;
  let icy = 0, seaCells = 0;
  for (let c = 0; c < mesh.n; c++) if (ballBiome[c] === BIOME_IDS.indexOf('seaIce')) { seaCells++; if (ballMap[at(c) + 3] > 128) icy++; }
  assert.ok(seaCells > 1000 && icy > 0.97 * seaCells, `${icy} of ${seaCells} frozen sea cells drawn as ice`);
  // (Its land too: a hollow below the sea's level inland, which a map draws as water, is ice as its seas are.)
  let least = 255;
  for (let i = 3; i < ballMap.length; i += 4) least = Math.min(least, ballMap[i]);
  assert.equal(least, 255, 'a planet frozen over: no open water anywhere on its map');
  // (And where no land is around, the colour is the ice's, not the open sea's: a strait narrower than a cell is
  // sea to the planet and ground to its map, which would draw it in this colour.)
  let dark = 0;
  for (let i = 0; i < ballMap.length; i += 4) if (ballMap[i] === BIOME.sea.colour[0] && ballMap[i + 1] === BIOME.sea.colour[1] && ballMap[i + 2] === BIOME.sea.colour[2]) dark++;
  assert.equal(dark, 0);
  assert.deepEqual([...ballMap.subarray(at(inside(ballBiome, 'seaIce')), at(inside(ballBiome, 'seaIce')) + 3)], [...BIOME.seaIce.colour]);
  const dry = (await p.product('cover', newDefinition('scorched', 4), { ...P, width: W, height: H, ice: true })).data.pixels as Uint8Array;
  let any = 0;
  for (let i = 3; i < dry.length; i += 4) any = Math.max(any, dry[i]);
  assert.equal(any, 0);
});

/**
 * Land sloping to a sea on its west, 64 by 32 cells, in four valleys running west (eight rows each, their floors
 * between the fourth and fifth row); a wall along its east side keeps its water from the sea beyond the map's edge.
 */
function slope(): ElevationGrid {
  const width = 64, height = 32, data = new Int16Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) data[j * width + i] = i < 8 ? -500 : i === width - 1 ? 9000 : 20 * (i - 7) + Math.round(60 * Math.abs((j % 8) - 3.5));
  return { width, height, step: 1, data };
}
const rainOf = (f: (i: number, j: number) => number, key: string): RiverRain => {
  const width = 64, height = 32, data = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) data[j * width + i] = f(i, j);
  return { width, height, data, radiusKm: 6371, yearSeconds: 365.25 * 86_400, key };
};

test('rivers that follow the rain: none where nothing runs off, none below a river\'s flow, only out of the wet part; as they were without it', () => {
  const grid = slope();
  const plain = riversOf(grid);
  assert.ok(plain.lines.coordinates.length > 0, 'by its heights alone: rivers');
  // No water runs off anywhere (a world where nothing rains): no rivers.
  assert.equal(riversOf(grid, undefined, rainOf(() => 0, 'dry')).lines.coordinates.length, 0);
  // Next to nothing (a hundredth of a millimetre a year): even the whole of this slope gathers under a river's
  // flow (each of these cells is 600 km across: a millimetre a year off one is 12 m³/s).
  assert.equal(riversOf(grid, undefined, rainOf(() => 0.01, 'drizzle')).lines.coordinates.length, 0);
  // Plenty everywhere: rivers.
  const wet = riversOf(grid, undefined, rainOf(() => 800, 'wet'));
  assert.ok(wet.lines.coordinates.length > 0);
  // Rain on the northern half only: every river rises there (none starts in the dry south).
  const north = riversOf(grid, undefined, rainOf((_i, j) => (j < 16 ? 800 : 0), 'north'));
  assert.ok(north.lines.coordinates.length > 0);
  // (Each valley keeps its own water: the dry half's valleys have no river at all.)
  for (const line of north.lines.coordinates) for (const pt of line) assert.ok(pt[1] > 0, `a river at ${pt[1]}° in the dry south`);
  const south = riversOf(grid, undefined, rainOf((_i, j) => (j < 16 ? 0 : 800), 'south'));
  assert.ok(south.lines.coordinates.length > 0);
  for (const line of south.lines.coordinates) for (const pt of line) assert.ok(pt[1] < 0, `a river at ${pt[1]}° in the dry north`);
  // (The least flow drawn as a river, in cubic metres a second.)
  assert.equal(RIVER_MIN_FLOW, 150);
  // Kept apart by what rain they followed.
  assert.notEqual(riversNow(grid, 'slope', rainOf(() => 800, 'wet')), riversNow(grid, 'slope'));
  assert.equal(riversNow(grid, 'slope', rainOf(() => 0, 'dry')).lines.coordinates.length, 0);
  assert.equal(riversNow(grid, 'slope').lines.coordinates.length, plain.lines.coordinates.length);
});

test('whether water standing somewhere would be frozen: the sea by its kind, the land as the sea nearest it', () => {
  const mesh = meshAt(3), n = mesh.n, sea = BIOME_IDS.indexOf('sea'), seaIce = BIOME_IDS.indexOf('seaIce'), land = BIOME_IDS.indexOf('grassland');
  // A belt of land round the equator between an open southern sea and a frozen northern one.
  const biome = Uint8Array.from({ length: n }, (_, c) => (Math.abs(mesh.lat[c]) < 0.5 ? land : mesh.lat[c] > 0 ? seaIce : sea));
  const f = frozenWater(mesh, biome);
  for (let c = 0; c < n; c++) {
    if (biome[c] === sea) assert.equal(f[c], 0);
    else if (biome[c] === seaIce) assert.equal(f[c], 1);
    else if (mesh.lat[c] > 0.3) assert.ok(f[c] > 0.9, `land by the frozen sea (${f[c]})`);
    else if (mesh.lat[c] < -0.3) assert.ok(f[c] < 0.1, `land by the open sea (${f[c]})`);
    else assert.ok(f[c] >= 0 && f[c] <= 1);
  }
  // No sea at all: nothing frozen (there is no water to stand). All of it frozen sea but one cell of land: frozen.
  assert.ok(frozenWater(mesh, new Uint8Array(n).fill(land)).every((v) => v === 0));
  const island = new Uint8Array(n).fill(seaIce); island[7] = land;
  assert.ok(frozenWater(mesh, island).every((v) => v === 1));
});

test('a planet\'s run-off for its rivers: none on a world with no rain, none off ice or ground that never thaws; less on a desert world', async () => {
  const p = new Pipeline(new LocalExecutor()), mesh = meshAt(4), n = mesh.n;
  type Id = 'earthlike' | 'scorched' | 'airless' | 'desert' | 'frozen';
  const runoff = async (id: Id, liquid = true) => (await p.product('raster', newDefinition(id, 4), { ...P, width: 128, height: 64, layer: 'runoff', ...(liquid ? { liquid: true } : {}) })).data.raster as Float32Array;
  const sum = (a: Float32Array) => a.reduce((s, v) => s + Math.max(0, v), 0);
  const earth = await runoff('earthlike');
  assert.ok(sum(earth) > 0);
  assert.equal(sum(await runoff('scorched')), 0, 'its seas boiled away: nothing rains');
  assert.equal(sum(await runoff('airless')), 0);
  assert.ok(sum(await runoff('desert')) < sum(earth), 'a desert world: less runs off');
  // A planet frozen over: snow falls on it (the picture of all that runs off has some), and none of it runs.
  assert.ok(sum(await runoff('frozen', false)) > 0);
  assert.equal(sum(await runoff('frozen')), 0, 'no month thaws its ground: no rivers');
  // An Earth: its ice sheets and the ground that never thaws give nothing; everywhere else what runs off, untouched.
  const plain = await runoff('earthlike', false);
  assert.ok(sum(earth) < sum(plain) && sum(earth) > 0.8 * sum(plain), `${sum(earth)} of ${sum(plain)}`);
  const d = newDefinition('earthlike', 4), W = (await p.product('water', d, P)).data, T = (await p.product('climate', d, P)).data.monthly as Float32Array;
  let thawed = 0;
  for (let c = 0; c < n; c++) {
    let warmest = -Infinity;
    for (let m = 0; m < 12; m++) warmest = Math.max(warmest, T[m * n + c]);
    if ((W.ice as Float32Array)[c] <= 50 && warmest > 0 && (W.runoff as Float32Array)[c] > 0) thawed++;
  }
  assert.ok(thawed > 300, `${thawed} cells of land with water running off`);
});

test('a map\'s heights: land and sea as the planet\'s water has them; a planet with no sea said to have none', async () => {
  const p = new Pipeline(new LocalExecutor()), mesh = meshAt(4), n = mesh.n;
  // A desert world: small seas, and basins joined to them by straits narrower than a cell.
  const d = newDefinition('desert', 4);
  const h = (await p.product('sea', d, P)).data.heights as Int16Array, kind = (await p.product('water', d, P)).data.kind as Uint8Array;
  const sea = Uint8Array.from(kind, (k) => (k === WATER.sea ? 1 : 0));
  const told = shoreHeights(mesh, h, sea);
  let straits = 0, seaCells = 0;
  for (let c = 0; c < n; c++) {
    if (sea[c]) { seaCells++; assert.ok(told[c] < 0, 'sea to the water: below the sea\'s level on the map'); }
    if (told[c] !== h[c]) { straits++; assert.ok(sea[c] && h[c] >= 0 && told[c] === -STRAIT_DEPTH_M); }
  }
  assert.ok(seaCells > 100 && straits > 0 && straits < 0.3 * seaCells, `${straits} cells of strait among ${seaCells} of sea`);
  // Without the water's word (an earlier moment): the sea the heights give the water's way, nothing the water would not say.
  const alone = shoreHeights(mesh, h);
  let lowered = 0;
  for (let c = 0; c < n; c++) if (alone[c] !== h[c]) { lowered++; assert.ok(sea[c] && h[c] >= 0, 'only what the water has as sea'); }
  assert.ok(lowered > 0 && lowered <= straits);
  // The picture of the heights for a map: more of it under the sea than by the heights alone; plain, as it was.
  const pic = async (id: 'desert' | 'airless' | 'scorched' | 'earthlike', more: object = {}) => (await p.product('raster', newDefinition(id, 4), { ...P, width: 256, height: 128, layer: 'elevation', ...more })).data;
  const under = (r: Float32Array) => r.reduce((s, v) => s + (v < 0 ? 1 : 0), 0);
  const plain = await pic('desert'), shore = await pic('desert', { shore: true });
  assert.ok(under(shore.raster as Float32Array) > under(plain.raster as Float32Array));
  assert.equal(shore.noSea, undefined);
  assert.equal(plain.noSea, undefined);
  // (An earlier moment: by the heights alone, nothing of the climate asked for.)
  const before = await pic('desert', { shore: true, frame: 2 });
  assert.ok(under(before.raster as Float32Array) > 0 && before.noSea === undefined);
  // A planet with no sea: said so, and none of it below the level its heights are against.
  for (const id of ['airless', 'scorched'] as const) {
    const dry = await pic(id, { shore: true });
    assert.equal(dry.noSea, true, id);
    assert.ok((dry.min as number) >= 0);
    assert.equal((await pic(id)).noSea, undefined, 'only for a map');
  }
  assert.equal((await pic('earthlike', { shore: true })).noSea, undefined);
});

test('a world with no sea: land everywhere while the map has raised no sea over it; kept through sculpting and between a history\'s pictures', () => {
  const data = new Int16Array(64 * 32).fill(0);
  const grid: ElevationGrid = { width: 64, height: 32, step: 1, data, noSea: true };
  assert.equal(noSeaAt(grid), true);
  assert.equal(noSeaAt(grid, 0), true);
  assert.equal(noSeaAt(grid, 120), false, 'a sea the map itself raised over it is a sea');
  assert.equal(noSeaAt({ width: 64, height: 32, step: 1, data }), false);
  const carved = applyStamps(grid, [{ id: 's', tool: 'raise', path: [[0, 0], [20, 0]], radiusKm: 900, strength: 800, seed: 1, from: null }], 6371);
  assert.ok(carved.touched && carved.grid !== grid);
  assert.equal(carved.grid.noSea, true);
  const older: ElevationGrid = { width: 64, height: 32, step: 1, data: new Int16Array(64 * 32).fill(100), noSea: true };
  const between = paleoGridAt({ ages: [0, 25], labels: ['Today', '25'], grids: [grid, older] }, 10).grid;
  assert.ok(between !== grid && between.data[5] === 40);
  assert.equal(between.noSea, true);
});
