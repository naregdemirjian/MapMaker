// The events of the timeline being viewed (D150): the main timeline's, or a branch's own with those of the history
// it shares, begun by the time it split off. The starting maps (and branches' places for changes without an
// event) are never listed.
import { store } from './store.ts';
import { isBaseEvent, type EventRow } from '../world-model/schema.ts';

/** Whether an event is listed in the timeline being viewed. */
export function listedHere(e: EventRow): boolean {
  return !isBaseEvent(e.id) && (!store.engine || store.engine.lists(e));
}

/** The events listed in the timeline being viewed, in order of their start. */
export function eventsHere(): EventRow[] {
  const w = store.world;
  if (!w) return [];
  return w.all('event').filter(listedHere).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms);
}
