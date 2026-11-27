// The Looks studio's stage (S7, D249): the thing designed drawn alone, the other countries muted (their colours, looks,
// fills and names left out, through the shot-looks view of the world, D239), or on the map as it is; and framed far,
// middle or near. Pure, but for the world it reads.
import type { World } from '../world-model/world.ts';
import { shotWorld, type RestyleRow } from '../presentation/shot-looks.ts';
import * as cmd from '../domain/commands.ts';
import { groupStyle } from '../domain/group-looks.ts';

/** The colour the countries not designed are drawn in, alone. */
export const MUTED = '#3a4652';

const political = (t: string) => t === 'polity' || t === 'faction';

/**
 * The world as the stage draws it alone: every country but those kept muted (its colour, look, fill and name left
 * out), every group none of them is in plain; the kept ones, and everything else, as they are.
 */
export function aloneWorld(world: World, keep: ReadonlySet<string>): World {
  const entity: Record<string, RestyleRow> = {}, entity_group: Record<string, RestyleRow> = {};
  const keptGroups = new Set<string>();
  for (const e of world.all('entity')) if (keep.has(e.id) && e.group_id) keptGroups.add(e.group_id);
  for (const e of world.all('entity')) {
    if (keep.has(e.id) || !political(e.type_id)) continue;
    const st = cmd.entityStyle(e);
    const { look: _look, fill: _fill, ...rest } = st;
    entity[e.id] = { color: MUTED, style: JSON.stringify({ ...rest, label: { ...(st.label ?? {}), hidden: true } }) };
  }
  for (const g of world.all('entity_group')) {
    if (keptGroups.has(g.id) || keep.has(g.id)) continue;
    const gs = groupStyle(g);
    if (gs.colorMembers || gs.look || gs.fill || gs.label) entity_group[g.id] = { color: MUTED, style: '{}' };
  }
  return shotWorld(world, { entity, entity_group });
}

/** Those a thing designed keeps on the stage: a country itself, a group's members, nothing for the rest. */
export function keptBy(world: World, sel: { kind: string; id?: string | number } | null): Set<string> | null {
  if (sel?.kind === 'entity' && typeof sel.id === 'string') {
    const e = world.get('entity', sel.id);
    return e && political(e.type_id) ? new Set([e.id]) : null;
  }
  if (sel?.kind === 'group' && typeof sel.id === 'string') {
    const ids = world.all('entity').filter((e) => e.group_id === sel.id).map((e) => e.id);
    return ids.length ? new Set([sel.id, ...ids]) : null;
  }
  return null;
}

export type Framing = 'far' | 'middle' | 'near';
/** How much of the view the thing takes, far and middle (near: closer than the whole of it, on its middle). */
export const FILL: Record<Framing, number> = { far: 0.3, middle: 0.75, near: 2.2 };

/** Longitude and latitude of a thing's outline as a box: west, south, east, north (west > east: across 180°). */
export function boxOf(polys: Array<Array<Array<[number, number] | number[]>>>): [number, number, number, number] | null {
  const pts: Array<[number, number]> = [];
  for (const p of polys) for (const ring of p) for (const q of ring) pts.push([q[0], q[1]]);
  if (!pts.length) return null;
  let s = Infinity, n = -Infinity;
  for (const [, lat] of pts) { s = Math.min(s, lat); n = Math.max(n, lat); }
  // The narrowest span of longitudes holding every point: the largest gap between them left out.
  const lons = [...new Set(pts.map(([lon]) => lon))].sort((a, b) => a - b);
  let gap = lons[0] + 360 - lons[lons.length - 1], west = lons[0], east = lons[lons.length - 1];
  for (let i = 1; i < lons.length; i++) {
    const g = lons[i] - lons[i - 1];
    if (g > gap) { gap = g; west = lons[i]; east = lons[i - 1]; }
  }
  return [west, s, east, n];
}

/** The middle of a box (its longitude across 180° when it lies across it). */
export function middleOf(box: [number, number, number, number]): [number, number] {
  const [w, s, e, n] = box;
  const width = e >= w ? e - w : e + 360 - w;
  let lon = w + width / 2;
  if (lon > 180) lon -= 360;
  return [lon, (s + n) / 2];
}
