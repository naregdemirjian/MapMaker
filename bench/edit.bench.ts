// Times the editing commands on a large project (in memory, no storage): strokes, deleting, restyling.
// Usage: node --disable-warning=ExperimentalWarning bench/edit.bench.ts <folder> "<project name>"
import { ProjectRegistry } from '../src/server/projects.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { rng, ring } from '../test/helpers.ts';

const [folder, name] = process.argv.slice(2);
const reg = new ProjectRegistry(folder);
const info = reg.list().find((p) => p.name === name);
if (!info) { console.error(`No project "${name}" in ${folder}`); process.exit(1); }
const Y = (y: number) => gregorian.fromCivil({ year: y });
const time = <T>(fn: () => T): [T, number] => { const t = performance.now(); const r = fn(); return [r, performance.now() - t]; };
const [snap, openMs] = time(() => reg.get(info.id).snapshot());
const [world, loadMs] = time(() => World.fromSnapshot(snap));
const engine = new Engine(world);
const [, compileMs] = time(() => engine.ensure());
const space = world.all('map_space')[0].id, layer = world.all('layer')[0].id;
const arr = world.arrangement(space);
const out: Record<string, unknown> = { project: name, segments: arr.segments.size, parcels: arr.leafFaces().length, events: world.all('event').length, openMs: +openMs.toFixed(0), loadMs: +loadMs.toFixed(0), compileMs: +compileMs.toFixed(0) };
const r = rng(5);
const owners = world.all('entity').filter((e) => e.type_id === 'polity').map((e) => e.id);
const circle = (cx: number, cy: number, rad: number, n = 60): Array<[number, number]> => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + rad * Math.cos(a) * 1.4, cy + rad * Math.sin(a)] as [number, number]; });
const paints: number[] = [], recompiles: number[] = [], states: number[] = [];
for (let i = 0; i < 12; i++) {
  const ev = cmd.createEvent(world, { name: `Bench ${i}`, start: Y(1900 + i) }).result;
  const [, ms] = time(() => cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(circle(r.float(0, 40), r.float(40, 55), r.float(0.5, 2)), 1), value: r.pick(owners), snap: 1e-7, mode: { kind: 'new', eventId: ev } }));
  paints.push(ms);
  recompiles.push(time(() => engine.ensure())[1]);
  states.push(time(() => engine.partitionState(space, layer, Y(1950)))[1]);
}
const med = (a: number[]) => +[...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(1);
out.paintFirstMs = +paints[0].toFixed(0); out.paintMedianMs = med(paints.slice(1)); out.recompileMedianMs = med(recompiles); out.partitionStateMs = med(states);
// A change that does not touch history (a colour): how long until the map could be redrawn.
{ const [, a] = time(() => cmd.updateEntity(world, owners[0], { color: '#123456' })); const [, b] = time(() => engine.ensure()); out.recolourMs = +a.toFixed(1); out.recompileAfterRecolourMs = +b.toFixed(1); }
{ const evs = world.all('event').filter((e) => e.name.startsWith('Bench')).map((e) => e.id); const [res, a] = time(() => cmd.deleteEvents(world, evs)); const [, b] = time(() => engine.ensure()); out.delete12EventsMs = +a.toFixed(1); out.recompileAfterDeleteMs = +b.toFixed(1); world.applyDiffs(invertDiffs(res.diffs)); }
{ const [res, a] = time(() => cmd.deleteEntities(world, owners.slice(0, 5))); const [, b] = time(() => engine.ensure()); out.delete5CountriesMs = +a.toFixed(1); out.recompileAfterDeleteCountriesMs = +b.toFixed(1); world.applyDiffs(invertDiffs(res.diffs)); }
console.log(JSON.stringify(out));
reg.closeAll();
