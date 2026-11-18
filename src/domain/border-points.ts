// Which border points the Border points tool shows (fifth feedback round, D81): only points of
// borders at the date viewed, where the owners on the two sides of a segment differ on one of the
// given territory layers. The parcel map keeps every line ever drawn (an erased border is still the
// border before it was erased), so its other points are not shown or picked.
import type { World } from '../world-model/world.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import type { Instant } from '../core-time/index.ts';

export function bordersAt(world: World, engine: Engine, spaceId: string, layerIds: string[], t: Instant): { vertices: Set<number>; segments: Set<number> } {
  const arr = world.arrangement(spaceId);
  const states = layerIds.map((l) => engine.partitionState(spaceId, l, t));
  const vertices = new Set<number>(), segments = new Set<number>();
  for (const sg of arr.segments.values()) {
    if (states.some((st) => (st.get(sg.left_face)?.value ?? '') !== (st.get(sg.right_face)?.value ?? ''))) { segments.add(sg.id); vertices.add(sg.a); vertices.add(sg.b); }
  }
  return { vertices, segments };
}
