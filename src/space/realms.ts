// Realms on space maps (Stage 11, D111): who holds each star at a moment, as the renderer draws it
// (the holder's name as it is then, and its colour).
import type { World } from '../world-model/world.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import type { Instant } from '../core-time/index.ts';
import type { Holding, Lane } from './space-renderer.ts';
import { compare } from '../core-time/index.ts';

/**
 * Who holds each star at instant t. In a shot (`secondsSince`: screen seconds since a moment), a star
 * newly held grows into its realm over REALM_GROW_SECONDS (`fresh` 0 to 1); elsewhere it is whole.
 */
export function holdingsAt(world: World, engine: Engine, spaceId: string, t: Instant, secondsSince?: (t0: Instant) => number): Map<number, Holding> {
  const out = new Map<number, Holding>();
  for (const [star, id] of engine.systemsAt(spaceId, t)) {
    const e = world.get('entity', id);
    if (!e) continue;
    let fresh = 1;
    if (secondsSince) {
      const steps = engine.systemSteps(spaceId, star);
      let since = null as Instant | null;
      for (const st of steps) if (compare(st.t, t) <= 0) since = st.t;
      // (Only when it passed from someone else, or nobody, to this holder.)
      if (since && since.day !== -Infinity) fresh = Math.max(0, Math.min(1, secondsSince(since) / REALM_GROW_SECONDS));
    }
    out.set(star, { owner: id, name: engine.nameAt(id, t) ?? e.name, color: e.color, fresh });
  }
  return out;
}

/** How long a star newly held takes to grow into its realm in a shot (screen seconds). */
export const REALM_GROW_SECONDS = 1.2;

/** The lanes open at instant t (D112), in their owners' colours (a pale blue for lanes of nobody). */
export function lanesFor(world: World, engine: Engine, spaceId: string, t: Instant): Lane[] {
  return engine.lanesAt(spaceId, t).map((l) => ({ a: l.a, b: l.b, color: (l.entity && world.get('entity', l.entity)?.color) || '#9fb8d6', progress: l.progress }));
}
