// The calendar the map being viewed counts its time in (D149): its own, or the Gregorian.
import { store } from './store.ts';
import { calendarOfSpace } from '../world-model/world-settings.ts';
import type { Calendar } from '../core-time/index.ts';

export function calendarNow(): Calendar {
  return calendarOfSpace(store.world?.get('map_space', store.spaceId));
}
