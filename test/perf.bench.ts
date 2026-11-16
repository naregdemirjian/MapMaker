// Performance benchmark: builds increasingly large projects through the real commands and storage,
// and times each part of the pipeline. Usage:
//   node --disable-warning=ExperimentalWarning test/perf.bench.ts [sizes...] [--keep <folder>]
// With --keep, the largest project is left in <folder> for the browser rendering benchmark.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry } from '../src/server/projects.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { rng, ring } from './helpers.ts';

const args = process.argv.slice(2);
const keepIdx = args.indexOf('--keep');
const keep = keepIdx >= 0 ? args[keepIdx + 1] : null;
const sizes = args.filter((a, i) => !a.startsWith('--') && (keepIdx < 0 || i !== keepIdx + 1)).map(Number);
if (!sizes.length) sizes.push(100, 300, 1000);
const Y = (y: number) => gregorian.fromCivil({ year: y });
const ms = (t0: number) => performance.now() - t0;
const mem = () => Math.round(process.memoryUsage().heapUsed / 1e6);

/** An irregular blob of about `n` points, the way a freehand outline arrives. */
function blob(r: ReturnType<typeof rng>, cx: number, cy: number, rad: number, n = 60): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const ph = r.float(0, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = rad * (1 + 0.18 * Math.sin(3 * a + ph) + 0.08 * Math.cos(7 * a));
    pts.push([cx + k * Math.cos(a) / Math.cos((cy * Math.PI) / 180), cy + k * Math.sin(a)]);
  }
  return pts;
}

for (const n of sizes) {
  const root = keep && n === Math.max(...sizes) ? keep : mkdtempSync(join(tmpdir(), 'mapmaker-bench-'));
  const reg = new ProjectRegistry(root);
  const info = reg.create(`Benchmark ${n}`);
  const db = reg.get(info.id);
  const world = World.fromSnapshot(db.snapshot());
  const engine = new Engine(world);
  const space = world.all('map_space')[0].id, layer = world.all('layer')[0].id;
  const r = rng(n);
  const owners: string[] = [];
  for (let i = 0; i < 40; i++) {
    const c = cmd.createEntity(world, { type_id: 'polity', name: `Country ${i + 1}` });
    db.commit(c.label, c.diffs, db.journalState().head);
    owners.push(c.result);
  }
  let paintMs = 0, commitMs = 0, slowest = 0, refused = 0;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const ev = cmd.createEvent(world, { name: `Event ${i + 1}`, start: Y(r.int(-3000, 2500)), end: r.bool(0.3) ? Y(2600) : null });
    db.commit(ev.label, ev.diffs, db.journalState().head);
    const t1 = performance.now();
    let res: cmd.CommandResult<unknown>;
    try {
      res = cmd.paintTerritory(world, engine, {
        spaceId: space, layerId: layer, ring: ring(blob(r, r.float(-160, 160), r.float(-60, 60), r.float(2, 12)), 1),
        value: r.pick(owners), snap: 1e-7, mode: { kind: 'new', eventId: ev.result }, transition: r.bool(0.3) ? { style: 'fade' } : null,
      });
    } catch { refused++; continue; }
    const dt = ms(t1);
    paintMs += dt; slowest = Math.max(slowest, dt);
    const t2 = performance.now();
    db.commit(res.label, res.diffs, db.journalState().head);
    commitMs += ms(t2);
  }
  const buildMs = ms(t0);
  const arr = world.arrangement(space);

  let t = performance.now(); engine.ensure(); const compileFirst = ms(t);
  const anyEvent = world.all('event').find((e) => e.name === 'Event 1')!;
  t = performance.now(); cmd.updateEvent(world, anyEvent.id, { start: Y(1234) }); engine.ensure(); const recompile = ms(t);
  t = performance.now(); const st = engine.partitionState(space, layer, Y(1900)); const partition = ms(t);
  t = performance.now();
  for (let i = 0; i < 1000; i++) engine.valueAtPoint(space, layer, lonLatToVec(r.float(-170, 170), r.float(-70, 70)), Y(r.int(-3000, 2500)));
  const point = ms(t) / 1000;
  t = performance.now(); const conflicts = engine.conflicts.length; const conflictMs = ms(t);
  reg.closeAll();

  const file = join(root, `${info.id}.mapmaker`, 'project.db');
  t = performance.now();
  const reg2 = new ProjectRegistry(root);
  const snap = reg2.get(info.id).snapshot();
  const openMs = ms(t);
  t = performance.now(); const w2 = World.fromSnapshot(snap); const loadMs = ms(t);
  t = performance.now(); new Engine(w2).ensure(); const compileAfterOpen = ms(t);
  t = performance.now(); const valid = w2.arrangement(space).validate().length; const validateMs = ms(t);
  reg2.closeAll();

  console.log(JSON.stringify({
    territories: n, refused, events: world.all('event').length - 1, vertices: arr.vertices.size, segments: arr.segments.size, parcels: [...arr.faces.values()].filter((f) => f.is_leaf).length,
    buildSeconds: +(buildMs / 1000).toFixed(1), paintAvgMs: +(paintMs / (n - refused)).toFixed(1), paintSlowestMs: +slowest.toFixed(0), saveAvgMs: +(commitMs / (n - refused)).toFixed(1),
    compileMs: +compileFirst.toFixed(0), recompileAfterEditMs: +recompile.toFixed(0), partitionStateMs: +partition.toFixed(1), parcelsShown: st.size,
    pointQueryMs: +point.toFixed(3), conflicts, conflictCheckMs: +conflictMs.toFixed(1),
    openMs: +openMs.toFixed(0), loadMs: +loadMs.toFixed(0), compileAfterOpenMs: +compileAfterOpen.toFixed(0), validateMs: +validateMs.toFixed(0), validationProblems: valid,
    fileMB: +(statSync(file).size / 1e6).toFixed(1), heapMB: mem(),
  }));
  if (root !== keep) rmSync(root, { recursive: true, force: true });
}
