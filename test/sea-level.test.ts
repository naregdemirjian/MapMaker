// Sea level over time (Stage 8, D96): the levels at dates and between them, the stored points, the
// command, and the height above the sea the coasts follow (land at today's level exactly what the
// coastline encloses; the coast moving steadily as the sea rises or falls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { seaLevelPoints, worldSettings } from '../src/world-model/world-settings.ts';
import { seaLevelAt, cleanSeaLevel, heightAboveSea } from '../src/terrain/sea-level.ts';
import { gregorian, NEG_INF, POS_INF } from '../src/core-time/index.ts';

const year = (y: number) => gregorian.fromCivil({ year: y });
const point = (y: number, m: number) => { const t = year(y); return { day: t.day, ms: t.ms, m }; };

test('the sea level between dates is steady; before the first and after the last it stays', () => {
  assert.equal(seaLevelAt([], year(1000)), 0, "no points: today's sea");
  const pts = cleanSeaLevel([point(-9000, -60), point(-17999, -120), point(-3999, 0)]);
  assert.deepEqual(pts.map((p) => p.m), [-120, -60, 0], 'in time order');
  assert.equal(seaLevelAt(pts, year(-30000)), -120);
  assert.equal(seaLevelAt(pts, year(-17999)), -120);
  assert.equal(seaLevelAt(pts, year(1500)), 0);
  const mid = seaLevelAt(pts, year(-13500));
  assert.ok(Math.abs(mid - -90) < 0.1, `half way between -120 and -60 (${mid})`);
  assert.equal(seaLevelAt(pts, NEG_INF), -120);
  assert.equal(seaLevelAt(pts, POS_INF), 0);
  // One point: that level at every date.
  assert.equal(seaLevelAt([point(100, 25)], year(-5000)), 25);
});

test('stored points are checked: bad ones dropped, heights kept within the deepest sea and the highest peak, one per date', () => {
  const t = year(1200);
  const clean = cleanSeaLevel([{ day: t.day, ms: 0, m: 5 }, { day: t.day, ms: 0, m: 7 }, { day: 'x', m: 3 }, { day: t.day + 1, m: Number.NaN }, null, { day: t.day + 5, ms: 0, m: -99999 }]);
  assert.deepEqual(clean.map((p) => p.m), [7, -11000]);
  assert.deepEqual(cleanSeaLevel('none'), []);
});

test("height above the sea: at today's level land is the coastline's; the coast moves steadily as the sea moves", () => {
  // At today's level: land exactly where the coastline says, whatever the terrain's 10 km cells say.
  assert.ok(heightAboveSea(-3, true, 0) > 0, 'low ground inside the coastline is land');
  assert.ok(heightAboveSea(4, false, 0) < 0, 'a high cell off the coastline is sea');
  // Without a coastline drawn, the terrain's own coast.
  assert.equal(heightAboveSea(4, null, 0), 4);
  // As the sea rises, land goes under from its lowest places; as it falls, the sea floor comes up from its highest.
  for (const onLand of [true, false]) for (let metres = -200; metres <= 200; metres += 7) {
    let wasLand = true;
    for (let s = -300; s <= 300; s += 5) {
      const land = heightAboveSea(metres, onLand, s) > 0;
      assert.ok(wasLand || !land, `once under the sea, a place stays under as the sea rises (${metres} m, ${onLand}, sea at ${s})`);
      wasLand = land;
    }
  }
  assert.ok(heightAboveSea(-40, false, -120) > 0, 'the North Sea floor at 40 m is land with the sea 120 m lower');
  assert.ok(heightAboveSea(30, true, 60) < 0, 'land at 30 m is under a sea 60 m higher');
});

test('a sea level is set, changed and cleared in one step each, and refused on worlds without terrain', () => {
  const world = new World();
  const { spaceId } = cmd.seedProject(world, 'Seas').result;
  const space = () => world.get('map_space', spaceId)!;
  const r = cmd.setWorldSeaLevel(world, spaceId, [point(-18000, -120), point(-4000, 0)]);
  assert.equal(seaLevelPoints(space()).length, 2);
  assert.equal(seaLevelAt(seaLevelPoints(space()), year(-18000)), -120);
  cmd.setWorldTerrain(world, spaceId, {});
  const cleared = cmd.setWorldSeaLevel(world, spaceId, []);
  assert.equal(worldSettings(space()).seaLevel, undefined, 'nothing left behind');
  assert.ok(worldSettings(space()).terrain, 'other settings kept');
  world.applyDiffs(invertDiffs(cleared.diffs));
  assert.equal(seaLevelPoints(space()).length, 2, 'undone in one step');
  assert.ok(r.diffs.length > 0);
  assert.throws(() => cmd.setWorldSeaLevel(world, spaceId, [{ day: Number.NaN, ms: 0, m: 3 }]), /date and a height/);
  const elsewhere = cmd.createWorld(world, 'Elsewhere', 3000).result;
  assert.throws(() => cmd.setWorldSeaLevel(world, elsewhere, [point(0, 10)]), /Only maps of the Earth and generated planets/);
  assert.deepEqual(seaLevelPoints(world.get('map_space', elsewhere)), []);
});
