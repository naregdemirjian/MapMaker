// "The Galactic Ages" (D180): a future history on four maps at four scales, built from its script: the Earth, the
// Solar System side by side, the stars within fifty light-years, the Milky Way; over a hundred events whose history is
// whole (no conflicts); planets, stars and star systems held by the realms the story gives them; lanes opened and
// closed; wars where the story has them; a sea in the African Rift ten million years on; eleven shots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectRegistry } from '../src/server/projects.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import { EXAMPLES } from '../src/examples/index.ts';
import { Y, EVENTS } from '../src/examples/galactic.ts';
import { statisticsOf, worldSettings, spaceSettingsOf } from '../src/world-model/world-settings.ts';
import { fillStatistics } from '../src/presentation/statistics.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { SYSTEM_ID_BASE } from '../src/space/galaxy.ts';
import type { Instant } from '../src/core-time/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the Galactic Ages build into a future history on four maps, from the Earth to the Large Magellanic Cloud', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mapmaker-example-'));
  try {
    const reg = new ProjectRegistry(dir);
    const info = EXAMPLES.find((e) => e.id === 'galactic-ages')!.build(reg, join(ROOT, 'data'));
    const world = World.fromSnapshot(reg.get(info.id).snapshot());
    const maps = world.all('map_space');
    const byName = (n: string) => maps.find((m) => m.name === n)!;
    const earth = byName('Earth'), solar = byName('The Solar System'), near = byName('The Near Stars'), galaxy = byName('The Milky Way');
    assert.deepEqual([earth.kind, spaceSettingsOf(solar)?.catalogue, spaceSettingsOf(near)?.catalogue, spaceSettingsOf(galaxy)?.catalogue], ['sphere', 'solar', 'nearby', 'galaxy']);
    const engine = new Engine(world);
    assert.deepEqual(engine.conflicts.map((c) => c.message), [], 'no conflicts');
    assert.equal(world.all('event').length - 1, EVENTS.length);
    assert.ok(EVENTS.length >= 100, `${EVENTS.length} events`);
    const name = (id: string | null | undefined, t: Instant) => (id ? engine.nameAt(id, t) ?? world.get('entity', id)?.name ?? id : null);
    const wrong: string[] = [];
    const holder = (space: string, what: string, star: number, story: Array<[Instant, string | null]>) => {
      for (const [t, who] of story) { const got = name(engine.systemsAt(space, t).get(star), t); if (got !== who) wrong.push(`${what} in ${t.day}: ${got}, not ${who}`); }
    };
    // The Solar System: Mars a republic after its revolution; Rhea taken in the Ring War.
    holder(solar.id, 'Mars', 4, [[Y(2080), null], [Y(2100), 'Terran Union'], [Y(2190), 'Martian Republic']]);
    holder(solar.id, 'Rhea', 63, [[Y(2200), 'Free Habitats of Saturn'], [Y(2240), 'Jovian League']]);
    holder(solar.id, 'Enceladus', 62, [[Y(2235), 'Jovian League'], [Y(2240), 'Free Habitats of Saturn']]);
    // The near stars: Alpha Centauri settled, free, then of the Hearth; Vega of the Lyran Combine.
    holder(near.id, 'Rigil Kentaurus', 71456, [[Y(2300), null], [Y(2400), 'Terran Commonwealth'], [Y(3000), 'Centauri Republic'], [Y(10000), 'The Hearth']]);
    holder(near.id, 'Vega', 90979, [[Y(2900), null], [Y(3000), 'Lyran Combine']]);
    holder(near.id, 'Sirius', 32263, [[Y(2500), 'Terran Commonwealth'], [Y(2700), 'Sirian Directorate']]);
    // The galaxy: the Orion Nebula seceding; Sagittarius A* the Synod's, then the Synthesis's; the Large Magellanic
    // Cloud reached at the end; Betelgeuse lost to its supernova.
    holder(galaxy.id, 'the Orion Nebula', 2, [[Y(50000), 'The Hearth'], [Y(70000), 'Orion Hegemony'], [Y(4000000), 'The Galactic Concord']]);
    holder(galaxy.id, 'Sagittarius A*', 1, [[Y(1000000), null], [Y(2000000), 'The Core Synod'], [Y(9500000), 'The Synthesis']]);
    holder(galaxy.id, 'the Large Magellanic Cloud', 31, [[Y(11900000), null], [Y(12000000), 'The Synthesis']]);
    holder(galaxy.id, 'Betelgeuse', 11, [[Y(50000), 'The Hearth'], [Y(80000), null]]);
    assert.deepEqual(wrong, [], 'each held by the realm the story gives it');
    // How much of the galaxy is held, and by how many.
    const systems = (t: Instant) => [...engine.systemsAt(galaxy.id, t)].filter(([s]) => s >= SYSTEM_ID_BASE);
    const held = (t: Instant, who?: string) => systems(t).filter(([, e]) => !who || name(e, t) === who).length;
    assert.ok(held(Y(400000)) < 150, `a corner of the galaxy in 400,000 (${held(Y(400000))})`);
    assert.ok(held(Y(5500000)) > 2500, `nearly all of it in 5.5 million (${held(Y(5500000))})`);
    assert.ok(held(Y(8500000), 'The Grey Tide') > 500 && held(Y(8700000), 'The Grey Tide') === 0, 'the Tide, then its unmaking');
    assert.equal(new Set(systems(Y(11500000)).map(([, e]) => e)).size, 1, 'one realm after the Last Accession');
    // Lanes: the great lanes open, all closed at the Severing; the voyage to the Large Magellanic Cloud.
    assert.ok(engine.lanesAt(galaxy.id, Y(5000000)).length > 20, 'the Great Lanes');
    assert.equal(engine.lanesAt(galaxy.id, Y(6000001)).length, 0, 'none after the Severing');
    assert.ok(engine.lanesAt(galaxy.id, Y(11500000)).some((l) => l.b === 31 || l.a === 31), 'the Cloudward voyage under way');
    // Wars: the Core War between the Synod and the arms; the Tide against everyone.
    const wars = (t: Instant) => engine.relationsAt(t).map((id) => world.get('relation', id)!).filter((r) => r.kind === 'war').map((r) => [name(r.a, t), name(r.b, t)].sort().join(' / '));
    assert.ok(wars(Y(2500000)).includes('Sagittarius Thrones / The Core Synod'), wars(Y(2500000)).join('; '));
    assert.ok(wars(Y(7000000)).filter((w) => w.includes('The Grey Tide')).length >= 8);
    assert.deepEqual(wars(Y(9000000)), []);
    // The Earth: today's countries, one union from the Charter on; ten million years later, a sea in the rift.
    const layer = world.all('layer').find((l) => l.space_id === earth.id && l.kind === 'partition')!.id;
    const owner = (lon: number, lat: number, t: Instant) => name(engine.valueAtPoint(earth.id, layer, lonLatToVec(lon, lat), t), t);
    assert.equal(owner(2.35, 48.85, Y(2030)), 'France');
    assert.equal(owner(2.35, 48.85, Y(2100)), 'Terran Union');
    assert.equal(owner(39.2, 8.1, Y(9000000)), 'The Hearth');
    assert.equal(owner(39.2, 8.1, Y(10100000)), null, 'the rift under the sea');
    assert.equal(owner(38.74, 9.03, Y(10100000)), 'The Hearth', 'Addis Ababa above it');
    const stamps = (worldSettings(earth).sculpt ?? []) as Array<{ tool: string; from: { day: number } | null }>;
    assert.ok(stamps.some((s) => s.tool === 'sea' && s.from?.day === Y(10000000).day), 'the sea from ten million years on');
    // Statistics: the galaxy's people in quintillions at the Concord's height; shots on every map.
    assert.match(fillStatistics('{People}', statisticsOf(galaxy), Y(5500000)), /quintillion$/);
    assert.equal(fillStatistics('{Settled stars}', statisticsOf(near), Y(9900)), String(near && engine.systemsAt(near.id, Y(9900)).size));
    const shots = world.all('sequence').map((q) => JSON.parse(q.settings).spaceId as string);
    assert.equal(shots.length, 11);
    assert.deepEqual([earth.id, solar.id, near.id, galaxy.id].map((id) => shots.filter((s) => s === id).length), [1, 1, 1, 8]);
    reg.closeAll();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
