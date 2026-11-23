// Characters on the map: points that move over time, never territory. The panel lists a character's
// places (from which date, travelling there or appearing), and offers placing it and taking it off
// the map; the map itself places (Characters tool) and moves (drag with Select) them.
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { fromStore, compare } from '../../core-time/index.ts';
import { fmt } from '../inputs.tsx';
import { CharacterIconSection, UnitSection } from './CharacterIcons.tsx';
import { isBaseEvent } from '../../world-model/schema.ts';
import { placeMetaOf } from '../../domain/places.ts';
import { cityImportance, CITY_RANKS } from '../../render-engine/label-style.ts';

/** How a character placement is recorded: into the event being recorded, or as a change without an event. */
export function placementMode(): cmd.EditMode {
  const s = store;
  const rec = s.recordEventId ? s.world?.get('event', s.recordEventId) : null;
  if (rec) { const start = fromStore(rec.start_day, rec.start_ms); return { kind: 'new', eventId: rec.id, at: compare(s.time, start) > 0 ? s.time : null }; }
  return { kind: 'change', t: s.time };
}

export function CharacterSection({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const ent = w.get('entity', id);
  if (!ent) return null;
  const city = ent.type_id === 'settlement';
  const track = e.characterTrack(s.spaceId, id);
  const now = e.charactersAt(s.spaceId, s.time).find((c) => c.entity === id) ?? null;
  const when = (t: (typeof track)[number]['t']) => (t.day === -Infinity ? 'From the beginning' : fmt(t));
  return (
    <div className="character-section" data-testid="character-panel">
      <h4>On the map</h4>
      <div className="stat" data-testid="character-where">
        On {fmt(s.time)}: {now ? <>{Math.abs(now.lat).toFixed(2)}°{now.lat >= 0 ? 'N' : 'S'}, {Math.abs(now.lon).toFixed(2)}°{now.lon >= 0 ? 'E' : 'W'}{now.moving ? ' (travelling)' : ''}</> : 'not on the map'}
      </div>
      <div className="buttons">
        <button onClick={() => s.set({ tool: 'place', placeValue: id })} data-testid="place-character-button">Place on the map…</button>
        {now && <button onClick={() => s.execute((wd) => cmd.characterLeaves(wd, { spaceId: s.spaceId, entity: id, mode: placementMode() }))} data-testid="character-leaves">{city ? 'Abandoned' : 'Leaves the map'} on {fmt(s.time)}</button>}
      </div>
      <p className="muted">{city
        ? <>A city is a point, with no borders. Click the map with the Characters &amp; cities tool to found {ent.name} there on the date being viewed, or use “From the beginning” below; with Select, drag it to move it from that date.</>
        : <>A character is a point, with no borders. Click the map with the Characters &amp; cities tool to put {ent.name} there from the date being viewed; with Select, drag the marker to move it. Between two places {ent.name} travels, unless set to appear.</>}</p>
      {city && <CityImportance id={id} />}
      <h4>Places</h4>
      {track.map((wp, i) => {
        const prev = track[i - 1];
        return (
          <div key={wp.effectId} className="effect" data-testid="character-place">
            <div><span className="date">{when(wp.t)}</span> · {wp.off ? (city ? 'abandoned' : 'leaves the map') : <>{Math.abs(wp.lat).toFixed(2)}°{wp.lat >= 0 ? 'N' : 'S'}, {Math.abs(wp.lon).toFixed(2)}°{wp.lon >= 0 ? 'E' : 'W'}</>}{wp.eventId !== 'evt_base' ? <span className="muted"> · {w.get('event', wp.eventId)?.name}</span> : null}</div>
            <div className="effect-tools">
              {!city && !wp.off && prev && !prev.off && (
                <select value={wp.arrive} onChange={(ev) => s.execute((wd) => cmd.setPlacementArrival(wd, wp.effectId, ev.target.value as 'travel' | 'jump'))} data-testid="character-arrive">
                  <option value="travel">Travels here</option>
                  <option value="jump">Appears here</option>
                </select>
              )}
              {i === 0 && wp.t.day !== -Infinity && isBaseEvent(wp.eventId) && <button className="small" onClick={() => s.execute((wd) => cmd.placementFromBeginning(wd, wp.effectId))} title="On the starting map: there before any history" data-testid="place-from-beginning">From the beginning</button>}
              {wp.t.day !== -Infinity && <button className="small" onClick={() => s.setTime(wp.t)}>Go to</button>}
              <button className="small danger" onClick={() => s.execute((wd) => cmd.deleteEffect(wd, wp.effectId))}>Remove</button>
            </div>
          </div>
        );
      })}
      {!track.length && <div className="muted">Not placed on this map yet.</div>}
      {!city && <CharacterIconSection id={id} />}
      {!city && <UnitSection id={id} />}
    </div>
  );
}

/** A rank's name for an importance (the nearest). */
const rankName = (imp: number) => CITY_RANKS.reduce((a, r) => (Math.abs(r.importance - imp) < Math.abs(a.importance - imp) ? r : a)).name.toLowerCase();

/**
 * How important a city is (D219): from its people (today's cities), or rated (a capital, a large city, …): it decides
 * from how far out it is shown and how large. A city of one's own not rated keeps its dot at every scale.
 */
function CityImportance({ id }: { id: string }) {
  const s = useStore();
  const ent = s.world!.get('entity', id);
  if (!ent) return null;
  const meta = placeMetaOf(ent.style);
  const rated = cmd.entityStyle(ent).importance;
  const fromPeople = cityImportance(meta);
  const value = typeof rated === 'number' ? (CITY_RANKS.find((r) => Math.abs(r.importance - rated) < 0.05)?.id ?? 'rated') : 'auto';
  const choose = (v: string) => { const r = CITY_RANKS.find((x) => x.id === v); s.execute((wd) => cmd.setCityImportance(wd, id, r ? r.importance : null)); };
  return (
    <label className="city-rank" title="How important the city is: the more important, the further out it is still shown, and the larger and bolder its name">Importance
      <select value={value} onChange={(e) => choose(e.target.value)} data-testid="city-importance-rank">
        <option value="auto">{fromPeople !== null ? `From its people (${rankName(fromPeople)})` : 'Not rated (its dot always shown)'}</option>
        {CITY_RANKS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        {value === 'rated' && <option value="rated">As rated</option>}
      </select>
    </label>
  );
}
