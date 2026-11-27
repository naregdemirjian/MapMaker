// The looks of a group of countries (D237, S4 of the studios plan): a group works on its members as an adjustment
// layer works on the clips under it in a video editor. What it sets is laid over every member at the same time as the
// member's own looks: its effects are drawn after the member's own, and where a member has a setting of its own (its
// colour chosen for it alone, its own fill, a setting of its own label, its own elevation or fill strength), that
// setting wins, part by part. Choosing one member and changing it changes that member only.
// Pure data and functions here: the renderer, the exports and the interface share them.
import { parseJSON } from '../temporal-engine/engine.ts';
import { countryLookOf, type CountryLook } from '../render-engine/country-look.ts';
import type { CountryLabel } from '../render-engine/label-style.ts';
import type { EntityGroupRow, EntityRow } from '../world-model/schema.ts';
import type { World } from '../world-model/world.ts';
import type { CountryFill, EntityStyle } from './commands.ts';

/** What is stored in entity_group.style (JSON). */
export interface GroupStyle {
  /** Its members drawn in the group's colour (the colour of its row in the lists), but for those with a colour chosen for them alone. */
  colorMembers?: boolean;
  /** A picture or video filling every member without a fill of its own. */
  fill?: CountryFill;
  /** Elevation, fill strength and effects, working with each member's own. */
  look?: CountryLook;
  /** Label settings for every member, each setting a member has of its own winning. */
  label?: CountryLabel;
}

/** A group's looks as stored, checked (unknown parts dropped). */
export function groupStyle(g: { style?: string } | null | undefined): GroupStyle {
  const raw = parseJSON<Record<string, unknown>>(g?.style || '{}', {}) ?? {};
  const out: GroupStyle = {};
  if (raw.colorMembers === true) out.colorMembers = true;
  const fill = raw.fill as CountryFill | undefined;
  if (fill && typeof fill === 'object' && typeof fill.asset === 'string' && fill.asset && (fill.kind === 'image' || fill.kind === 'video')) out.fill = fill;
  const look = raw.look ? countryLookOf(raw.look) : null;
  if (look) out.look = look;
  if (raw.label && typeof raw.label === 'object') {
    const label = Object.fromEntries(Object.entries(raw.label as Record<string, unknown>).filter(([k, v]) => k !== 'text' && v !== undefined && v !== null && v !== '')) as CountryLabel;
    if (Object.keys(label).length) out.label = label;
  }
  return out;
}

/** Whether a group sets anything of its members' looks. */
export const groupLooksPlain = (gs: GroupStyle): boolean => !gs.colorMembers && !gs.fill && !gs.look && !gs.label;

/** A label with the group's settings under the member's own (each of the member's own winning). */
export function labelWithGroup(group: CountryLabel | undefined, own: CountryLabel | undefined): CountryLabel | undefined {
  if (!group) return own;
  const out: CountryLabel = { ...group };
  for (const [k, v] of Object.entries(own ?? {})) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  return out;
}

type Looked = { color: string; style?: string; group_id?: string | null };
const cache = new WeakMap<object, { g: EntityGroupRow | undefined; out: unknown }>();

/**
 * An entity as it is drawn (D237): its colour, fill and label with its group's laid under its own. (Its look, with
 * elevation and effects, is merged where the layer's look is known: country-look.ts lookFor.) The same row when its
 * group sets none of these; kept per row, rows being replaced, never changed.
 */
export function withGroupLooks<E extends Looked>(e: E, g: EntityGroupRow | undefined): E {
  if (!g || !e.group_id) return e;
  const kept = cache.get(e);
  if (kept && kept.g === g) return kept.out as E;
  const gs = groupStyle(g);
  let out: E = e;
  if (gs.colorMembers || gs.fill || gs.label) {
    const own = parseJSON<EntityStyle>(e.style || '{}', {}) ?? {};
    const style: EntityStyle = { ...own };
    if (gs.fill && !own.fill) style.fill = gs.fill;
    if (gs.label) style.label = labelWithGroup(gs.label, own.label);
    out = { ...e, color: gs.colorMembers && !own.ownColor ? g.color : e.color, style: JSON.stringify(style) };
  }
  cache.set(e, { g, out });
  return out;
}

/** An entity of the world as it is drawn: with its group's looks (D237). */
export function lookedEntity<E extends Looked>(world: World, e: E): E {
  return e.group_id ? withGroupLooks(e, world.get('entity_group', e.group_id)) : e;
}

/** The look of an entity's group (D237), if it is in one that has one. */
export function groupLookOf(world: World, e: { group_id?: string | null } | null | undefined): CountryLook | null {
  const g = e?.group_id ? world.get('entity_group', e.group_id) : undefined;
  return g ? groupStyle(g).look ?? null : null;
}

/** The members of a group, in the order of their names. */
export function groupMembers(world: World, groupId: string): EntityRow[] {
  return world.all('entity').filter((e) => e.group_id === groupId).sort((a, b) => a.name.localeCompare(b.name));
}
