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
  const who = (id: string | null | undefined) => { const e = id ? world.get('entity', id) : null; return e ? { owner: e.id, name: engine.nameAt(e.id, t) ?? e.name, color: e.color } : null; };
  for (const [star, id] of engine.systemsAt(spaceId, t)) {
    const now = who(id);
    if (!now) continue;
    let fresh = 1, from: Holding['from'] = null;
    if (secondsSince) {
      const steps = engine.systemSteps(spaceId, star);
      let k = -1;
      for (let i = 0; i < steps.length; i++) if (compare(steps[i].t, t) <= 0) k = i;
      // (Only when it passed from someone else, or nobody, to this holder: the one before shrinks as it grows.)
      if (k >= 0 && steps[k].t.day !== -Infinity) {
        fresh = Math.max(0, Math.min(1, secondsSince(steps[k].t) / REALM_GROW_SECONDS));
        if (fresh < 1 && k > 0) from = who(steps[k - 1].entity);
      }
    }
    out.set(star, { ...now, fresh, from });
  }
  // In a shot, stars just given up to nobody: their holder's space shrinks away (no holder now).
  if (secondsSince) {
    for (const star of engine.systemStars(spaceId)) {
      if (out.has(star)) continue;
      const steps = engine.systemSteps(spaceId, star);
      let k = -1;
      for (let i = 0; i < steps.length; i++) if (compare(steps[i].t, t) <= 0) k = i;
      if (k <= 0 || steps[k].entity || steps[k].t.day === -Infinity) continue;
      const fresh = Math.max(0, Math.min(1, secondsSince(steps[k].t) / REALM_GROW_SECONDS));
      const from = fresh < 1 ? who(steps[k - 1].entity) : null;
      if (from) out.set(star, { owner: '', name: '', color: '', fresh, from });
    }
  }
  return out;
}

/** The holders at war with each other at instant t (D132: where their realms meet, the border is a front). */
export function warsAmong(world: World, engine: Engine, t: Instant): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const id of engine.relationsAt(t)) {
    const r = world.get('relation', id);
    if (r && r.kind === 'war' && r.a !== r.b) out.push([r.a, r.b]);
  }
  return out;
}

/** How long a star newly held takes to grow into its realm in a shot (screen seconds). */
export const REALM_GROW_SECONDS = 1.2;

/** The lanes open at instant t (D112), in their owners' colours (a pale blue for lanes of nobody). */
export function lanesFor(world: World, engine: Engine, spaceId: string, t: Instant): Lane[] {
  return engine.lanesAt(spaceId, t).map((l) => ({ a: l.a, b: l.b, color: (l.entity && world.get('entity', l.entity)?.color) || '#9fb8d6', progress: l.progress }));
}
