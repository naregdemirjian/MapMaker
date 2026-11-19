// Builds the large projects the performance benchmarks run on, through the real commands and storage:
//   earth242   today's 242 countries on Earth (98,000 border points), cities, characters, a shot
//   heavy      the same, plus hundreds of dated border changes (many parcels, long history)
//   random1000 1,000 random overlapping territories (24,500 parcels), no basemap geography under them
//   massive    as heavy, with 3,000 border changes (only when named)
// Usage: node --disable-warning=ExperimentalWarning bench/make-fixtures.ts <folder> [earth242 heavy random1000 massive]
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectRegistry } from '../src/server/projects.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { decodeCountries, COUNTRY_GROUP_COLORS, type CountriesFile } from '../src/domain/countries.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { defaultShot, DEFAULT_TRANSITIONS, withTransitionLook } from '../src/presentation/sequence.ts';
import { defaultCamera } from '../src/render-engine/camera.ts';
import { rng, ring } from '../test/helpers.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = process.argv[2];
if (!folder) { console.error('Give the folder to build the projects in.'); process.exit(1); }
const which = process.argv.slice(3);
const wants = (n: string) => !which.length || which.includes(n);
mkdirSync(folder, { recursive: true });
const Y = (y: number) => gregorian.fromCivil({ year: y });
const all = decodeCountries(JSON.parse(readFileSync(join(root, 'data', 'natural-earth', 'countries-50m.json'), 'utf8')) as CountriesFile);

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

function open(name: string) {
  const reg = new ProjectRegistry(folder);
  const info = reg.create(name);
  const db = reg.get(info.id);
  const world = World.fromSnapshot(db.snapshot());
  const engine = new Engine(world);
  const space = world.all('map_space')[0].id, layer = world.all('layer')[0].id;
  const commit = <T>(r: cmd.CommandResult<T>): T => { db.commit(r.label, r.diffs, db.journalState().head); return r.result; };
  return { reg, info, db, world, engine, space, layer, commit };
}

function addShots(p: ReturnType<typeof open>, from: number, to: number) {
  const still = defaultShot(p.space, { ...defaultCamera(), lon: 15, lat: 48, zoom: 2.2 }, Y(from), Y(to), 24, 10);
  p.commit(cmd.createSequence(p.world, 'Europe, still camera', still));
  const moving = defaultShot(p.space, { ...defaultCamera(), lon: 15, lat: 48, zoom: 2.2 }, Y(from), Y(to), 24, 10);
  moving.camera[1].camera = { ...defaultCamera(), lon: 70, lat: 35, zoom: 1.4 };
  p.commit(cmd.createSequence(p.world, 'Europe to Asia, moving camera', moving));
  // Every change animated, in the clean look and in an intense one (D137): many fronts under way at once.
  for (const look of ['clean', 'blitz']) {
    const shot = defaultShot(p.space, { ...defaultCamera(), lon: 15, lat: 48, zoom: 2.2 }, Y(from), Y(to), 24, 10);
    shot.transitions = withTransitionLook({ ...DEFAULT_TRANSITIONS, mode: 'all', restyleRecorded: true, seconds: 1.5 }, look);
    p.commit(cmd.createSequence(p.world, `Europe, every change animated (${look})`, shot));
  }
}

function earth(p: ReturnType<typeof open>) {
  const t0 = performance.now();
  p.commit(cmd.addCountries(p.world, p.engine, {
    spaceId: p.space, layerId: p.layer, mode: { kind: 'correct', t: NEG_INF },
    countries: all.map((c) => ({ name: c.name, polygons: c.polygons, color: COUNTRY_GROUP_COLORS[c.colorGroup - 1] })),
  }));
  const r = rng(7);
  for (let i = 0; i < 80; i++) {
    const id = p.commit(cmd.createEntity(p.world, { type_id: 'settlement', name: `City ${i + 1}` }));
    p.commit(cmd.placeCharacter(p.world, { spaceId: p.space, entity: id, lon: r.float(-10, 120), lat: r.float(10, 60), mode: { kind: 'correct', t: NEG_INF } }));
  }
  for (let i = 0; i < 12; i++) {
    const id = p.commit(cmd.createEntity(p.world, { type_id: 'character', name: `Traveller ${i + 1}` }));
    for (const y of [1500, 1600, 1700, 1800]) p.commit(cmd.placeCharacter(p.world, { spaceId: p.space, entity: id, lon: r.float(-10, 120), lat: r.float(10, 60), mode: { kind: 'correct', t: Y(y) } }));
  }
  return performance.now() - t0;
}

if (wants('earth242')) {
  const p = open('Bench Earth 242');
  const ms = earth(p);
  addShots(p, 1500, 1800);
  const arr = p.world.arrangement(p.space);
  console.log(JSON.stringify({ project: 'earth242', id: p.info.id, buildSeconds: +(ms / 1000).toFixed(1), segments: arr.segments.size, parcels: arr.leafFaces().length }));
  p.reg.closeAll();
}

function heavy(name: string, N: number) {
  const p = open(name);
  let ms = earth(p);
  const owners = p.world.all('entity').filter((e) => e.type_id === 'polity').map((e) => e.id);
  const r = rng(11);
  const t0 = performance.now();
  let refused = 0, slowest = 0;
  for (let i = 0; i < N; i++) {
    const ev = p.commit(cmd.createEvent(p.world, { name: `Border change ${i + 1}`, start: Y(1000 + Math.floor((i / N) * 1000)), end: r.bool(0.3) ? Y(1000 + Math.floor((i / N) * 1000) + 3) : null }));
    const t1 = performance.now();
    try {
      // Mostly over Europe, the Near East and Asia, where the film's history would be densest.
      const res = cmd.paintTerritory(p.world, p.engine, {
        spaceId: p.space, layerId: p.layer, ring: ring(blob(r, r.float(-10, 110), r.float(15, 60), r.float(0.6, 5)), 1),
        value: r.pick(owners), snap: 1e-7, mode: { kind: 'new', eventId: ev }, transition: r.bool(0.3) ? { style: r.bool(0.5) ? (i % 4 === 0 ? 'dissolve' : 'border') : 'fade' } : null,
      });
      p.commit(res);
    } catch { refused++; }
    slowest = Math.max(slowest, performance.now() - t1);
  }
  ms += performance.now() - t0;
  addShots(p, 1000, 2000);
  const arr = p.world.arrangement(p.space);
  console.log(JSON.stringify({ project: name, id: p.info.id, buildSeconds: +(ms / 1000).toFixed(1), events: N, refused, slowestPaintMs: +slowest.toFixed(0), segments: arr.segments.size, parcels: arr.leafFaces().length }));
  p.reg.closeAll();
}

if (wants('heavy')) heavy('Bench Heavy', Number(process.env.HEAVY_EVENTS ?? 500));
// Not made unless asked for by name: several thousand border changes (minutes to build).
if (which.includes('massive')) heavy('Bench Massive', Number(process.env.MASSIVE_EVENTS ?? 3000));

if (wants('random1000')) {
  const p = open('Bench Random 1000');
  const r = rng(1000);
  const owners: string[] = [];
  for (let i = 0; i < 40; i++) owners.push(p.commit(cmd.createEntity(p.world, { type_id: 'polity', name: `Country ${i + 1}` })));
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) {
    const ev = p.commit(cmd.createEvent(p.world, { name: `Event ${i + 1}`, start: Y(r.int(-3000, 2500)), end: r.bool(0.3) ? Y(2600) : null }));
    try {
      p.commit(cmd.paintTerritory(p.world, p.engine, {
        spaceId: p.space, layerId: p.layer, ring: ring(blob(r, r.float(-160, 160), r.float(-60, 60), r.float(2, 12)), 1),
        value: r.pick(owners), snap: 1e-7, mode: { kind: 'new', eventId: ev }, transition: r.bool(0.3) ? { style: 'fade' } : null,
      }));
    } catch { /* refused */ }
  }
  addShots(p, 1000, 2000);
  const arr = p.world.arrangement(p.space);
  console.log(JSON.stringify({ project: 'random1000', id: p.info.id, buildSeconds: +((performance.now() - t0) / 1000).toFixed(1), segments: arr.segments.size, parcels: arr.leafFaces().length }));
  p.reg.closeAll();
}
