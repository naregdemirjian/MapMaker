// Child process for the crash test: keeps saving territory changes until it is killed.
import { ProjectDb } from '../../src/server/db.ts';
import { World } from '../../src/world-model/world.ts';
import { Engine } from '../../src/temporal-engine/engine.ts';
import * as cmd from '../../src/domain/commands.ts';
import { gregorian } from '../../src/core-time/index.ts';
import { ring, square, rng } from '../helpers.ts';

const dir = process.argv[2];
const db = ProjectDb.open(dir);
const world = World.fromSnapshot(db.snapshot());
const engine = new Engine(world);
const space = world.all('map_space')[0].id;
const layer = world.all('layer')[0].id;
const r = rng(Number(process.argv[3] ?? 1));
const owners = [cmd.createEntity(world, { type_id: 'polity', name: 'A' }), cmd.createEntity(world, { type_id: 'polity', name: 'B' })];
for (const o of owners) db.commit(o.label, o.diffs, db.journalState().head);
for (let i = 0; ; i++) {
  const ev = cmd.createEvent(world, { name: `E${i}`, start: gregorian.fromCivil({ year: 1000 + i }) });
  db.commit(ev.label, ev.diffs, db.journalState().head);
  const p = cmd.paintTerritory(world, engine, {
    spaceId: space, layerId: layer, ring: ring(square(r.float(-40, 40), r.float(-40, 40), r.float(2, 10))),
    value: r.pick(owners).result, snap: 1e-7, mode: { kind: 'new', eventId: ev.result },
  });
  db.commit(p.label, p.diffs, db.journalState().head);
  process.stdout.write(`${i}\n`);
}
