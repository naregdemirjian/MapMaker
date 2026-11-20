// Edits' consequences in numbers (Stage 15.2, D164): estimates from the engine's own rules (a crater's size under
// the planet's gravity, a flood basalt's volume, a hotspot's chain from the plate's speed at the checkpoint, the
// land a higher sea floods) and measurements of what a re-run made, around the place and over the planet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionFromPreset, type GeoEvent } from '../src/planet/model/definition.ts';
import { derive } from '../src/planet/model/physics.ts';
import { tectonicParams } from '../src/planet/pipeline/stages.ts';
import { runHistory } from '../src/planet/tectonics/history.ts';
import { meshAt } from '../src/planet/mesh/icosphere.ts';
import { estimateEdit, measureEdits, plateSpeedAt, frameAt, big, type PlanetFacts } from '../src/planet/consequences.ts';
import { cellAt } from '../src/planet/explain.ts';
import { followCrust, distanceKm } from '../src/planet/reconstruct.ts';
import { CRUST, TAG } from '../src/planet/tectonics/plates.ts';

const value = (figs: Array<{ label: string; value: string }>, label: RegExp) => figs.find((f) => label.test(f.label))?.value ?? '';

test('estimates follow the rules the history uses', () => {
  const def = definitionFromPreset('earthlike', 3);
  const p = tectonicParams(def, 4, 200);
  const h = runHistory(p, { durationMyr: 200, frameEveryMyr: 25 });
  const facts: PlanetFacts = { mesh: meshAt(4), radiusKm: def.body.radiusKm, gravity: derive(def).gravity, vigor: p.vigor, spanMyr: 200 };
  // A crater: 300 km in radius under the Earth's gravity, 3 km deep, holding π·300²·3/2 km³.
  const crater = estimateEdit({ id: 'k', kind: 'impact', startMa: 50, durationMyr: 0, strength: 1, at: [10, 10] }, h, { ...facts, gravity: 9.81 });
  assert.match(value(crater.figures, /^A basin/), /about 600 km across and 3,000 m deep/);
  assert.match(value(crater.figures, /^It would hold/), /about 424,000 km³/);
  assert.equal(crater.radiusKm, 1.4 * 300);
  // Under a third of the gravity, larger.
  const mars = estimateEdit({ id: 'k', kind: 'impact', startMa: 50, durationMyr: 0, strength: 1, at: [10, 10] }, h, { ...facts, gravity: 3.71 });
  assert.match(value(mars.figures, /^A basin/), /about 770 km across/);
  // A flood basalt: 8 km at the centre, over 1 km within 800·√ln 8 km, about 14 million km³.
  const lip = estimateEdit({ id: 'l', kind: 'lip', startMa: 120, durationMyr: 2, strength: 1, at: [40, -20] }, h, facts);
  assert.match(value(lip.figures, /^Basalt/), /up to 8\.0 km thick at the centre, more than 1 km thick within 1,200 km/);
  assert.match(value(lip.figures, /^Its volume/), /about 14 million km³/);
  // A hotspot: the chain is the plate's speed at the checkpoint before it times how long it lasts.
  const at: [number, number] = [-150, 0];
  const c = cellAt(facts.mesh, at[0], at[1]);
  const v = plateSpeedAt(h, facts, c, 100)!;
  assert.ok(v > 0 && v < 300, `the plate's speed, ${v} km/Myr`);
  const hot = estimateEdit({ id: 'h', kind: 'hotspot', startMa: 100, durationMyr: 100, strength: 1, at }, h, facts);
  if (v >= 2) assert.match(value(hot.figures, /^The chain/), new RegExp(`about ${big(v * 100).replace(/[.,]/g, '.')} km long`));
  assert.match(value(hot.figures, /^The plate there moves/), /cm a year|hardly/);
  assert.match(value(hot.figures, /^The place 100 million years ago/), /m (above|under) the sea/);
  // A higher sea: the land within 50 m of the sea at the moment, flooded.
  const sea = estimateEdit({ id: 's', kind: 'sea-level', startMa: 60, durationMyr: 20, strength: 2, at: undefined }, h, facts);
  assert.match(value(sea.figures, /^The sea rises/), /^100 m from 60 million years ago for 20 million years/);
  assert.match(value(sea.figures, /^Land flooded/), /km² \(\d/);
  assert.equal(sea.radiusKm, Infinity);
  assert.equal(sea.atMa, h.times[frameAt(h.times, 50)]);
});

test('a re-run is measured around each edit and over the planet', () => {
  const def = definitionFromPreset('earthlike', 3);
  const opts = { durationMyr: 200, frameEveryMyr: 25 };
  const before = runHistory(tectonicParams(def, 4, 200), opts);
  const p = tectonicParams(def, 4, 200);
  const facts: PlanetFacts = { mesh: meshAt(4), radiusKm: def.body.radiusKm, gravity: derive(def).gravity, vigor: p.vigor, spanMyr: 200 };
  // The crater on a continent then (sea floor struck may have gone down a trench by today).
  const n = facts.mesh.n, f = Array.from(before.times).indexOf(25);
  let c = 0;
  while (before.kinds[f * n + c] !== CRUST.continental) c++;
  const at: [number, number] = [(facts.mesh.lon[c] * 180) / Math.PI, (facts.mesh.lat[c] * 180) / Math.PI];
  const edits: GeoEvent[] = [
    { id: 'k', kind: 'impact', startMa: 20, durationMyr: 0, strength: 2, at },
    { id: 'i', kind: 'ice-age', startMa: 60, durationMyr: 30, strength: 1.5 },
  ];
  const estimates = edits.map((e) => ({ event: e, estimate: estimateEdit(e, before, facts) }));
  def.history.events.push(...edits);
  const after = runHistory(tectonicParams(def, 4, 200), { ...opts, base: before });
  const m = measureEdits(estimates, { history: before }, { history: after }, facts);
  const crater = m.edits[0].figures;
  assert.match(value(crater, /^Highest ground within/), /m → /);
  assert.match(value(crater, /^Land within/), /km²$/);
  // The ice age: while it lasted, colder than the history without it.
  const ice = m.edits[1].figures;
  const temps = value(ice, /^Mean temperature/).match(/(-?[\d.]+) → (-?[\d.]+) °C/);
  assert.ok(temps && Number(temps[2]) < Number(temps[1]), `colder during the ice age: ${value(ice, /^Mean temperature/)}`);
  // Over the planet: the crust the edits made.
  const made = value(m.planet, /^Crust the edits made/).match(/^([\d,.]+)( million)? km²$/);
  assert.ok(made && Number(made[1].replace(/,/g, '')) > 0, value(m.planet, /^Crust the edits made/));
  assert.match(value(m.planet, /^Land today/), /% of the surface$/);
});

test('crust clicked on today\'s map is followed back with its plate, and an edit made there ends up where it was clicked', () => {
  const def = definitionFromPreset('earthlike', 3);
  const opts = { durationMyr: 200, frameEveryMyr: 25 };
  const base = runHistory(tectonicParams(def, 4, 200), opts);
  const mesh = meshAt(4), n = mesh.n, F = base.times.length, R = def.body.radiusKm;
  const deg = (r: number) => (r * 180) / Math.PI;
  // A continental place today whose plate has moved far since 60 Ma.
  let here: [number, number] | null = null, then: [number, number] | null = null;
  for (let c = 0; c < n && !here; c++) {
    if (base.kinds[(F - 1) * n + c] !== CRUST.continental) continue;
    const p: [number, number] = [deg(mesh.lon[c]), deg(mesh.lat[c])];
    const q = followCrust(base, mesh, p, 0, 60);
    if (q && distanceKm(p, q, R) > 1500) { here = p; then = q; }
  }
  assert.ok(here && then, 'a place carried more than 1,500 km in 60 million years');
  // There and back again.
  assert.ok(distanceKm(followCrust(base, mesh, then, 60, 0)!, here, R) < 100, 'followed back to the place clicked');
  // A crater made where that crust was 60 Ma is, today, where it was clicked (within a cell of this coarse grid).
  def.history.events.push({ id: 'k', kind: 'impact', startMa: 60, durationMyr: 0, strength: 1, at: then });
  const after = runHistory(tectonicParams(def, 4, 200), { ...opts, base });
  let x = 0, y = 0, z = 0;
  for (let c = 0; c < n; c++) {
    if (!(after.tags[c] & TAG.impact) || !(after.tags[c] & TAG.edited)) continue;
    x += mesh.xyz[3 * c] * mesh.area[c]; y += mesh.xyz[3 * c + 1] * mesh.area[c]; z += mesh.xyz[3 * c + 2] * mesh.area[c];
  }
  const centre: [number, number] = [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))];
  assert.ok(distanceKm(centre, here, R) < 600, `the crater today ${distanceKm(centre, here, R).toFixed(0)} km from the place clicked`);
});
