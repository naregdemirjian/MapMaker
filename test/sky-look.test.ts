// How space maps look (D130), seen as flat charts (D131), and realms as territories (D132).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SKY, SKY_PRESETS, presetLook, randomLook, skyLookOf, starColourIn, hexRgb, warmth, hsl } from '../src/space/sky-look.ts';
import { territoryField, territoryBorders, paintTerritory, realmLabels, type TerritorySite } from '../src/space/territory.ts';
import { makeSpaceView, spaceCamera, turnChart, panSpaceCamera } from '../src/space/space-view.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { spaceSettingsOf } from '../src/world-model/world-settings.ts';

// (ImageData, as browsers have it, for painting territories.)
(globalThis as unknown as { ImageData: unknown }).ImageData ??= class { width: number; height: number; data: Uint8ClampedArray; constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('a look as kept is made whole and kept within bounds; every preset is a whole look of its own', () => {
  assert.deepEqual(skyLookOf(undefined), DEFAULT_SKY);
  assert.deepEqual(skyLookOf(null), DEFAULT_SKY);
  const odd = skyLookOf({ size: 99, glow: -3, spikes: 5, shape: 'blob', background: 'red', backgroundGlow: null, chart: 'yes', chartGrid: 'hexes', realms: 'glow', twinkle: 2 });
  assert.equal(odd.size, 5);
  assert.equal(odd.glow, 0);
  assert.equal(odd.spikes, DEFAULT_SKY.spikes, 'only 0, 2, 4, 6 or 8 spikes');
  assert.equal(odd.shape, 'disc');
  assert.equal(odd.background, DEFAULT_SKY.background);
  assert.equal(odd.backgroundGlow, null);
  assert.equal(odd.chart, false, 'only true makes a chart');
  assert.equal(odd.chartGrid, 'hexes');
  assert.equal(odd.realms, 'glow');
  assert.equal(odd.twinkle, 1);
  // Made whole twice: the same.
  assert.deepEqual(skyLookOf(JSON.parse(JSON.stringify(odd))), odd);
  const ids = new Set<string>();
  for (const p of SKY_PRESETS) {
    assert.ok(!ids.has(p.id), `${p.id} once`);
    ids.add(p.id);
    const look = presetLook(p.id);
    assert.equal(look.preset, p.id);
    assert.deepEqual(skyLookOf(look), look, `${p.id} within bounds as it is`);
    for (const [k, v] of Object.entries(p.look)) assert.deepEqual(look[k as keyof typeof look], v, `${p.id}: ${k}`);
  }
  assert.ok(SKY_PRESETS.filter((p) => p.look.chart).length >= 3, 'charts among them');
  assert.equal(presetLook('no such').preset, 'natural');
});

test('a look by chance is a whole look within bounds, a chart when asked, different each time', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const chart = i % 2 === 0, look = randomLook(rnd, chart);
    assert.deepEqual(skyLookOf(look), look, 'within bounds as it is');
    assert.equal(look.chart, chart);
    assert.equal(look.preset, 'surprise');
    seen.add(JSON.stringify(look));
  }
  assert.equal(seen.size, 40);
  assert.equal(hsl(0, 1, 0.5), '#ff0000');
  assert.equal(hsl(120, 1, 0.5), '#00ff00');
  assert.equal(hsl(240, 1, 0.25), '#000080');
});

test('stars\' colours in a look: natural, one colour, by temperature, by holder, tinted', () => {
  const look = (o: object) => skyLookOf({ ...DEFAULT_SKY, ...o });
  assert.equal(starColourIn(look({}), '#ffd2a1', 'K5V'), '#ffd2a1');
  assert.equal(starColourIn(look({ colours: 'mono', tint: '#5ef2ff' }), '#ffd2a1', 'K5V'), '#5ef2ff');
  // By temperature: the coolest (M) as the cool colour, the hottest (O) as the hot one, the Sun between.
  const t = look({ colours: 'temperature', cool: '#ff0000', hot: '#0000ff' });
  assert.ok(warmth('M9V') < warmth('K5V') && warmth('K5V') < warmth('G2V') && warmth('G2V') < warmth('B1V') && warmth('B1V') < warmth('O5V'));
  const m = hexRgb(starColourIn(t, '#ffad6a', 'M9V')), o = hexRgb(starColourIn(t, '#9bb0ff', 'O0V')), g = hexRgb(starColourIn(t, '#fff4ea', 'G2V'));
  assert.ok(m[0] > 240 && m[2] < 15, `M cool ${m}`);
  assert.ok(o[2] > 240 && o[0] < 15, `O hot ${o}`);
  assert.ok(g[0] > 40 && g[2] > 40, `the Sun between ${g}`);
  // By holder: held stars in their holder's colour, the others greyed.
  const h = look({ colours: 'owner', tint: '#6c7a8c' });
  assert.equal(starColourIn(h, '#ffd2a1', 'K5V', '#ff0000'), '#ff0000');
  assert.equal(starColourIn(h, '#ffd2a1', 'K5V', null), '#515c69');
  // Tinted half way.
  assert.equal(starColourIn(look({ tint: '#000000', tintAmount: 0.5 }), '#ffffff', 'G2V'), '#808080');
  // Vivid: further from grey; pastel: nearer white.
  const v = hexRgb(starColourIn(look({ colours: 'vivid' }), '#ffd2a1', 'K5V')), p = hexRgb(starColourIn(look({ colours: 'pastel' }), '#ffd2a1', 'K5V'));
  assert.ok(v[0] - v[2] > 0xff - 0xa1, `vivid ${v}`);
  assert.ok(p[2] > 0xa1, `pastel ${p}`);
});

test('a map\'s look kept with it: set in one step (undone at once), made whole when read', async () => {
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const w = new World();
  cmd.seedProject(w, 'Stars');
  const id = cmd.createSpaceMap(w, 'Nearby stars').result;
  assert.deepEqual(spaceSettingsOf(w.get('map_space', id))?.look, DEFAULT_SKY, 'the natural look at first');
  const r = cmd.setSkyLook(w, id, { ...presetLook('chart-paper'), size: 40 });
  const look = spaceSettingsOf(w.get('map_space', id))!.look!;
  assert.equal(look.preset, 'chart-paper');
  assert.equal(look.chart, true);
  assert.equal(look.size, 5, 'kept within bounds');
  assert.equal(spaceSettingsOf(World.fromSnapshot(w.snapshot()).get('map_space', id))!.look!.preset, 'chart-paper', 'kept when opened again');
  w.applyDiffs(invertDiffs(r.diffs));
  assert.deepEqual(spaceSettingsOf(w.get('map_space', id))?.look, DEFAULT_SKY);
  assert.throws(() => cmd.setSkyLook(w, w.all('map_space').find((s) => s.kind !== 'space')!.id, DEFAULT_SKY), /not a map of space/);
});

test('a flat chart: seen straight down, every star as large wherever it stands, the galactic centre to the right; turned and moved', () => {
  const cam = { ...spaceCamera(), lon: 37, lat: 12 };
  const v = makeSpaceView(cam, 1000, 800, 50, true);
  assert.equal(v.chart, true);
  const sun = v.project([0, 0, 0])!, east = v.project([10, 0, 0])!, north = v.project([0, 10, 0])!, high = v.project([0, 0, 30])!;
  assert.deepEqual(sun.slice(0, 2), [500, 400]);
  assert.ok(east[0] > 500 && Math.abs(east[1] - 400) < 1e-9, 'toward the galactic centre: right');
  assert.ok(north[1] < 400 && Math.abs(north[0] - 500) < 1e-9, '+y: up');
  assert.deepEqual(high, [500, 400, 1], 'height above the plane does not move a star on the chart, nor make it larger');
  assert.ok(Math.abs(east[0] - 500 - (north[1] - 400) * -1) < 1e-9, 'the same scale both ways');
  // The camera's longitude and latitude are not used.
  assert.deepEqual(makeSpaceView({ ...cam, lon: -100, lat: 80 }, 1000, 800, 50, true).project([10, 0, 0]), east);
  // Turned: a drag a quarter of the way round the middle turns it a quarter of the way.
  const turned = turnChart(cam, v, 700, 400, 500, 600);
  assert.ok(Math.abs(turned.rotation - 90) < 1e-9, `turned ${turned.rotation}`);
  const t = makeSpaceView(turned, 1000, 800, 50, true).project([10, 0, 0])!;
  assert.ok(Math.abs(t[0] - 500) < 1e-9 && t[1] > 400, 'the galactic centre now down');
  // Moved: what was under the pointer stays under it.
  const moved = makeSpaceView(panSpaceCamera(turned, makeSpaceView(turned, 1000, 800, 50, true), 30, -20), 1000, 800, 50, true).project([10, 0, 0])!;
  assert.ok(Math.abs(moved[0] - (t[0] + 30)) < 1e-9 && Math.abs(moved[1] - (t[1] - 20)) < 1e-9, `moved with the pointer ${moved}`);
});

const site = (x: number, y: number, owner: number, r = 40, extra: Partial<TerritorySite> = {}): TerritorySite => ({ x, y, r, owner, ...extra });
const ownerAt = (f: ReturnType<typeof territoryField>, x: number, y: number) => f.owner[Math.floor(y / f.cell) * f.cols + Math.floor(x / f.cell)];
const edgeAt = (f: ReturnType<typeof territoryField>, x: number, y: number) => f.edge[Math.floor(y / f.cell) * f.cols + Math.floor(x / f.cell)];

test('territory: a lone star holds a disc of about its reach; its edge distance grows inward; its name at its middle', () => {
  const f = territoryField(400, 300, 2, [site(200, 150, 0, 40)]);
  assert.equal(ownerAt(f, 200, 150), 0);
  assert.equal(ownerAt(f, 200 + 36, 150), 0, 'held just inside its reach');
  assert.equal(ownerAt(f, 200 + 44, 150), -1, 'free just beyond it');
  assert.equal(ownerAt(f, 200, 150 - 44), -1);
  assert.ok(Math.abs(edgeAt(f, 200, 150) - 39.6) < 1.5, `the middle ${edgeAt(f, 200, 150)} from the edge`);
  assert.ok(Math.abs(edgeAt(f, 220, 150) - 19.6) < 1.5, `half way ${edgeAt(f, 220, 150)}`);
  assert.ok(edgeAt(f, 241, 150) < 0, 'beyond: negative');
  assert.equal(f.other[Math.floor(150 / 2) * f.cols + 100], -1, 'free space beyond its edge');
  const [l] = realmLabels(f, 1);
  assert.ok(l && Math.hypot(l.x - 200, l.y - 150) < 3 && Math.abs(l.room - 39.6) < 1.5, `its name at the middle ${JSON.stringify(l)}`);
  // Its border: one closed line round it, about its reach from the star.
  const b = territoryBorders(f);
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].a, b[0].b], [0, -1]);
  for (let i = 0; i < b[0].segs.length; i += 2) {
    const r = Math.hypot(b[0].segs[i] - 200, b[0].segs[i + 1] - 150);
    assert.ok(Math.abs(r - 39.6) < 1.2, `the border ${r.toFixed(2)} from the star`);
  }
  // Nothing held: nothing.
  const none = territoryField(100, 100, 2, []);
  assert.ok(none.owner.every((o) => o === -1) && territoryBorders(none).length === 0);
});

test('territory: one realm\'s stars near each other merge into one space; far apart, two', () => {
  const near = territoryField(500, 200, 2, [site(200, 100, 0), site(270, 100, 0)]);
  assert.equal(ownerAt(near, 235, 100), 0, 'held between them');
  assert.equal(ownerAt(near, 235, 100 - 20), 0, 'and round the waist');
  const far = territoryField(600, 200, 2, [site(150, 100, 0), site(400, 100, 0)]);
  assert.equal(ownerAt(far, 275, 100), -1, 'free between them');
  // (Its name where it has most room: in one of the two round ends, not at the waist.)
  const [l] = realmLabels(near, 1);
  assert.ok(l && (Math.abs(l.x - 200) < 8 || Math.abs(l.x - 270) < 8) && l.room > 30, `the name at ${l?.x}, room ${l?.room}`);
});

test('territory: between two realms the border runs half way between their stars, each side knowing who is across', () => {
  const f = territoryField(400, 200, 1, [site(170, 100, 0), site(230, 100, 1)]);
  assert.equal(ownerAt(f, 190, 100), 0);
  assert.equal(ownerAt(f, 210, 100), 1);
  const at = (x: number, y: number) => Math.floor(y) * f.cols + Math.floor(x);
  assert.equal(f.other[at(195, 100)], 1, 'across from the first: the second');
  assert.equal(f.other[at(205, 100)], 0);
  assert.ok(Math.abs(f.edge[at(190, 100)] - 9.5) < 1, `the edge between them half way (${f.edge[at(190, 100)]})`);
  const pairs = territoryBorders(f).map((b) => `${b.a}|${b.b}`).sort();
  assert.deepEqual(pairs, ['0|-1', '1|-1', '1|0']);
  const between = territoryBorders(f).find((b) => b.a === 1 && b.b === 0)!;
  for (let i = 0; i < between.segs.length; i += 2) assert.ok(Math.abs(between.segs[i] - 200) < 1, `the border at x ${between.segs[i]}`);
  assert.ok(between.segs.length / 4 > 40, `the border along the whole of where they meet (${between.segs.length / 4} pieces)`);
  // A stronger realm (more stars behind it) pushes the border back.
  assert.equal(ownerAt(f, 205, 100), 1);
  const g = territoryField(400, 200, 1, [site(170, 100, 0), site(185, 100, 0), site(230, 100, 1)]);
  assert.equal(ownerAt(g, 205, 100), 0);
});

test('territory changing hands in a shot: the new holder grows out from the star over the old; given up, the old shrinks back to it', () => {
  // A star of realm 1 taken by realm 0, a third of the way: realm 0 holds round the star, realm 1 beyond.
  const f = territoryField(400, 200, 1, [site(200, 100, 0, 40, { from: 1, grow: 1 / 3 })]);
  assert.equal(ownerAt(f, 200, 100), 0);
  assert.equal(ownerAt(f, 200 + 15, 100), 0, 'inside the growing disc (a third of 56)');
  assert.equal(ownerAt(f, 200 + 24, 100), 1, 'the old holder beyond it');
  assert.equal(ownerAt(f, 200 + 45, 100), -1, 'free beyond the reach');
  // Newly held from nobody: only the growing disc.
  const g = territoryField(400, 200, 1, [site(200, 100, 0, 40, { from: -1, grow: 0.25 })]);
  assert.equal(ownerAt(g, 200 + 10, 100), 0);
  assert.equal(ownerAt(g, 200 + 18, 100), -1);
  // Given up to nobody, half way: the old holder's space shrunk back toward the star (to half of 56).
  const h = territoryField(400, 200, 1, [site(200, 100, -1, 40, { from: 1, grow: 0.5 })]);
  assert.equal(ownerAt(h, 200 + 20, 100), 1);
  assert.equal(ownerAt(h, 200 + 31, 100), -1, 'already given up beyond it');
  // Whole: as if held all along.
  const whole = territoryField(400, 200, 1, [site(200, 100, 0, 40, { from: 1, grow: 1 })]);
  assert.deepEqual(whole.owner, territoryField(400, 200, 1, [site(200, 100, 0, 40)]).owner);
});

test('territory painted: filled with a glow toward its edges, its edge smoothed, nothing beyond', () => {
  const f = territoryField(400, 300, 2, [site(200, 150, 0, 60)]);
  const img = paintTerritory(f, { colours: [[255, 0, 0]], fill: 0.2, glow: 1, unit: 1 });
  const alpha = (x: number, y: number) => img.data[(Math.floor(y / 2) * f.cols + Math.floor(x / 2)) * 4 + 3];
  const red = (x: number, y: number) => img.data[(Math.floor(y / 2) * f.cols + Math.floor(x / 2)) * 4];
  assert.equal(red(200, 150), 255);
  assert.ok(Math.abs(alpha(200, 150) - 0.2 * 255) < 3, `the fill in the middle (${alpha(200, 150)})`);
  assert.ok(alpha(200 + 56, 150) > alpha(200 + 30, 150), 'more toward the edge (the glow)');
  assert.equal(alpha(200 + 70, 150), 0, 'nothing beyond');
  assert.equal(alpha(10, 10), 0);
});

test('territory field quick enough to follow a moving view: a large realm at full HD in cells of two', () => {
  const sites: TerritorySite[] = Array.from({ length: 400 }, () => { const x = 300 + rnd() * 1320, y = 150 + rnd() * 780; return site(x, y, x < 800 ? 0 : x < 1300 ? 1 : 2, 32); });
  territoryField(1920, 1080, 2, sites, 3);
  const t0 = performance.now();
  const f = territoryField(1920, 1080, 2, sites, 3);
  territoryBorders(f);
  const ms = performance.now() - t0;
  assert.ok(ms < 400, `${ms.toFixed(0)} ms`);
});
