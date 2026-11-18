// Data export (Stage 4): the map at a date as GeoJSON (territories joined owner by owner, areas,
// lines and points, cities and characters), and the project's record as CSV (events, countries and
// others, relationships, the shapes of features over time). For GIS tools, spreadsheets and other
// software; the project file stays the authoritative copy.
import type { World } from '../world-model/world.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import { BASE_EVENT_ID } from '../world-model/schema.ts';
import { type Instant, gregorian, fromStore } from '../core-time/index.ts';
import { parcelGeometry } from '../render-engine/parcel-geometry.ts';
import type { Arrangement } from '../geo-kernel/arrangement.ts';
import { isFeatureKind } from '../render-engine/feature-style.ts';
import { relationKind } from './relations.ts';
import { groupsOfEvent, featureKind } from './commands.ts';

type Position = [number, number];
interface GeoFeature { type: 'Feature'; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> }

/** A date as text a spreadsheet sorts: 1850-03-01, -0043-03-15 (astronomical years), with the time when it is not midnight. */
export function isoDate(t: Instant): string {
  if (t.day === -Infinity) return 'beginning';
  if (t.day === Infinity) return 'end';
  const c = gregorian.toCivil(t);
  const y = c.year < 0 ? `-${String(-c.year).padStart(4, '0')}` : String(c.year).padStart(4, '0');
  const d = `${y}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
  if (!c.hour && !c.minute && !c.second && !c.millisecond) return d;
  return `${d}T${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}:${String(c.second).padStart(2, '0')}`;
}

/** Twice the signed area of a ring in longitude/latitude (positive: anticlockwise). */
function ringArea2(r: Position[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a;
}

function inside(p: Position, r: Position[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}

/**
 * Rings (even-odd: a ring inside another is a hole, inside that an island again) as GeoJSON polygons:
 * outer rings anticlockwise, holes clockwise, every ring closed. Longitudes stay continuous along a
 * ring, so a shape across the 180° meridian may run past ±180°.
 */
export function ringsToPolygons(rings: Position[][]): Position[][][] {
  const list = rings.filter((r) => r.length >= 3).map((r) => ({ r, area: Math.abs(ringArea2(r)) })).sort((a, b) => b.area - a.area);
  const polys: Array<{ outer: Position[]; holes: Position[][] }> = [];
  const placed: Array<{ r: Position[]; depth: number; poly: number }> = [];
  for (const { r } of list) {
    // The smallest ring already placed that holds this one (rings are taken largest first).
    let parent: (typeof placed)[number] | null = null;
    for (let i = placed.length - 1; i >= 0; i--) if (inside(r[0], placed[i].r)) { parent = placed[i]; break; }
    const depth = parent ? parent.depth + 1 : 0;
    const ccw = ringArea2(r) > 0;
    if (depth % 2 === 0) {
      polys.push({ outer: ccw ? r : [...r].reverse(), holes: [] });
      placed.push({ r, depth, poly: polys.length - 1 });
    } else {
      polys[parent!.poly].holes.push(ccw ? [...r].reverse() : r);
      placed.push({ r, depth, poly: parent!.poly });
    }
  }
  const close = (r: Position[]) => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]);
  return polys.map((p) => [close(p.outer), ...p.holes.map(close)]);
}

const round = (v: number) => Math.round(v * 1e7) / 1e7;

/**
 * Each owner's territory on a partition layer at t: its parcels joined into GeoJSON polygons (outer
 * rings anticlockwise, see ringsToPolygons), owners in the order they are first met.
 */
export function territoryPolygons(world: World, engine: Engine, spaceId: string, layerId: string, t: Instant): Map<string, Position[][][]> {
  const out = new Map<string, Position[][][]>();
  const arr = world.arrangements.get(spaceId);
  if (!arr) return out;
  const byOwner = new Map<string, number[]>();
  for (const [face, st] of engine.partitionState(spaceId, layerId, t)) if (st.value) { const l = byOwner.get(st.value); if (l) l.push(face); else byOwner.set(st.value, [face]); }
  for (const [owner, faces] of byOwner) {
    const polys = facesPolygons(arr, faces);
    if (polys.length) out.set(owner, polys);
  }
  return out;
}

/** Parcels joined into GeoJSON polygons (outer rings anticlockwise, see ringsToPolygons). */
export function facesPolygons(arr: Arrangement, faces: number[]): Position[][][] {
  const rings: Position[][] = [];
  const dissolved = parcelGeometry(arr).dissolve(faces);
  if (dissolved) {
    for (const ring of dissolved) {
      const pts: Position[] = [];
      const put = (x: number, y: number) => { const q: Position = [round(x), round(y)]; const l = pts[pts.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); };
      for (const p of ring.parts) {
        // (A part's turn is in degrees; consecutive parts share their meeting point.)
        const c = p.cycle;
        for (let i = p.from; i < p.to; i++) put(c.lon[i] + p.turn, c.lat[i]);
        if (p.toFirst) put(c.lon[0] + p.turn + 360 * c.wind, c.lat[0]);
      }
      // (The last chain ends where the ring began.)
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      rings.push(pts);
    }
  } else for (const f of faces) for (const r of arr.faceRingsLonLat(f)) rings.push(r.map(([x, y]) => [round(x), round(y)] as Position));
  return ringsToPolygons(rings);
}

/** The map of one world at instant t as a GeoJSON FeatureCollection. */
export function mapGeoJSON(world: World, engine: Engine, spaceId: string, t: Instant): { type: 'FeatureCollection'; features: GeoFeature[]; properties: Record<string, unknown> } {
  const features: GeoFeature[] = [];
  const space = world.get('map_space', spaceId);
  const name = (id: string) => engine.nameAt(id, t) ?? world.get('entity', id)?.name ?? id;
  const arr = world.arrangements.get(spaceId);
  const layers = world.all('layer').filter((l) => l.space_id === spaceId).sort((a, b) => a.sort_order - b.sort_order);
  for (const layer of layers) {
    if (layer.kind === 'partition' && arr) {
      // Territory, owner by owner: the parcels joined into the owner's outline.
      for (const [owner, polys] of territoryPolygons(world, engine, spaceId, layer.id, t)) {
        const e = world.get('entity', owner);
        features.push({
          type: 'Feature',
          geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
          properties: { layer: layer.name, kind: 'territory', id: owner, name: name(owner), type: e?.type_id ?? '', color: e?.color ?? '' },
        });
      }
    } else if (isFeatureKind(layer.kind)) {
      for (const fa of engine.featuresAt(layer.id, t)) {
        const f = world.get('feature', fa.feature);
        if (!f) continue;
        const parts = fa.parts.map((p) => { const out: Position[] = []; for (let i = 0; i + 1 < p.length; i += 2) out.push([round(p[i]), round(p[i + 1])]); return out; });
        let geometry: GeoFeature['geometry'];
        if (layer.kind === 'point') geometry = { type: 'Point', coordinates: parts[0][0] };
        else if (layer.kind === 'line') geometry = parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
        else { const polys = ringsToPolygons(parts); geometry = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }; }
        features.push({ type: 'Feature', geometry, properties: { layer: layer.name, kind: layer.kind, id: f.id, name: f.name, belongs_to: f.entity_id ? name(f.entity_id) : '', since: isoDate(fa.since) } });
      }
    }
  }
  // Cities and characters where they are at t.
  for (const c of engine.charactersAt(spaceId, t)) {
    const e = world.get('entity', c.entity);
    if (!e) continue;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [round(c.lon), round(c.lat)] }, properties: { layer: e.type_id === 'settlement' ? 'Cities' : 'Characters', kind: e.type_id === 'settlement' ? 'city' : 'character', id: e.id, name: name(e.id), travelling: c.moving } });
  }
  return { type: 'FeatureCollection', features, properties: { map: space?.name ?? '', date: isoDate(t), radius_km: space?.radius_m ? space.radius_m / 1000 : null, made_by: 'Map Maker' } };
}

/** A CSV cell: quoted when it holds a comma, a quote or a line break; a formula-like start is defused. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function eventsCSV(world: World): string {
  const groups = new Map(world.all('event_group').map((g) => [g.id, g.name]));
  const types = new Map(world.all('event_type').map((t) => [t.id, t.name]));
  const rows: unknown[][] = [['id', 'name', 'type', 'start', 'end', 'groups', 'alternative_of', 'active', 'description']];
  const events = world.all('event').filter((e) => e.id !== BASE_EVENT_ID).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms);
  for (const e of events) {
    rows.push([e.id, e.name, types.get(e.type_id) ?? e.type_id, isoDate(fromStore(e.start_day, e.start_ms)), e.end_day !== null ? isoDate(fromStore(e.end_day, e.end_ms ?? 0)) : '',
      groupsOfEvent(world, e.id).map((g) => groups.get(g) ?? '').filter(Boolean).join('; '), e.variant_group ?? '', e.variant_group ? (e.variant_active ? 'yes' : 'no') : 'yes', e.description]);
  }
  return csv(rows);
}

export function entitiesCSV(world: World, engine: Engine): string {
  const groups = new Map(world.all('entity_group').map((g) => [g.id, g.name]));
  const rows: unknown[][] = [['id', 'name', 'type', 'colour', 'group', 'other_names', 'notes']];
  for (const e of world.all('entity').sort((a, b) => a.created_seq - b.created_seq)) {
    const names = engine.namesOf(e.id).map((n) => `${n.name} (from ${isoDate(n.t)})`).join('; ');
    rows.push([e.id, e.name, e.type_id, e.color, groups.get(e.group_id) ?? '', names, e.notes]);
  }
  return csv(rows);
}

/** One row per period in which a relationship holds. */
export function relationsCSV(world: World, engine: Engine): string {
  const name = (id: string) => world.get('entity', id)?.name ?? id;
  const rows: unknown[][] = [['id', 'kind', 'first', 'relationship', 'second', 'from', 'until', 'notes']];
  for (const r of world.all('relation').sort((a, b) => a.created_seq - b.created_seq)) {
    for (const p of engine.relationPeriods(r.id)) rows.push([r.id, r.kind, name(r.a), relationKind(r.kind)?.sentence ?? r.kind, name(r.b), isoDate(p.from), p.to ? isoDate(p.to) : '', r.notes]);
  }
  return csv(rows);
}

/** One row per shape step of every area, line and point (its shape itself is in the GeoJSON). */
export function featuresCSV(world: World, engine: Engine): string {
  const rows: unknown[][] = [['id', 'name', 'layer', 'kind', 'belongs_to', 'from', 'change', 'event', 'notes']];
  for (const f of world.all('feature').sort((a, b) => a.created_seq - b.created_seq)) {
    const layer = world.get('layer', f.layer_id);
    for (const st of engine.featureHistory(f.id)) {
      const ev = world.get('event', st.eventId);
      rows.push([f.id, f.name, layer?.name ?? '', featureKind(world, f) ?? '', f.entity_id ? world.get('entity', f.entity_id)?.name ?? '' : '', isoDate(st.t), st.parts ? 'shape' : 'ends', ev && ev.id !== BASE_EVENT_ID ? ev.name : '', f.notes]);
    }
  }
  return csv(rows);
}
