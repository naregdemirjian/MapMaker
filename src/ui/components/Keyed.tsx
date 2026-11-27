// Keys in the Looks panel (D240, S5 of the studios plan). In Presentation, with a shot open and the Looks panel's changes
// going to this shot only, each number and colour of a thing's looks has a diamond beside it, as a video editor's effect
// controls have: pressed, the setting is keyed at the frame shown with its value now (◇ hollow: not keyed; outlined in
// blue: keyed, no key at this frame; ◆: a key here, pressed again it goes). Once keyed, changing the setting in its
// field puts a key at the frame shown (store.executeLooks). Each keyed setting is a track of the shot's timeline (ShotKeys).
import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from '../store.ts';
import { isKeyValue, tracksOf, trackIdOf, withKey, withoutKey, writeRow, type PathStep, type RestyleTable, type TrackAt } from '../../presentation/shot-looks.ts';

/** The row whose looks the fields inside set, the way from it to them, and the name of that part ("Drop shadow"). */
export interface KeyPlace { table: RestyleTable; id: string; base: PathStep[]; label: string; make?: boolean }
const Place = createContext<KeyPlace | null>(null);

/** The fields inside set the looks of a row (from its colour, or its style: `base` is where they are). */
export function KeyThing({ table, id, base = [], label = '', make, children }: { table: RestyleTable; id: string; base?: PathStep[]; label?: string; make?: boolean; children: ReactNode }) {
  return <Place.Provider value={{ table, id, base, label, make }}>{children}</Place.Provider>;
}

/** The fields inside are a part of those looks: the way on to it, its name, and whether missing objects are made. */
export function KeyPart({ path, label, make, children }: { path: PathStep[]; label?: string; make?: boolean; children: ReactNode }) {
  const up = useContext(Place);
  if (!up) return <>{children}</>;
  return <Place.Provider value={{ ...up, base: [...up.base, ...path], label: [up.label, label].filter(Boolean).join(' · '), make: make ?? up.make }}>{children}</Place.Provider>;
}

/** A name for a test to find a key's diamond by: the way to its setting. */
const pathName = (p: PathStep[]) => p.map((s) => (typeof s === 'string' ? s : `${Object.values(s.where).join('-')}${s.nth}`)).join('-');

/**
 * A field of looks with its key: `path` the way on from its part to the setting, `value` the setting as shown now (a
 * number or a colour as stored), `label` its name. Outside a shot's own looks, the field alone.
 */
export function Keyed({ path, value, label, testId, children }: { path: PathStep[]; value: unknown; label: string; testId?: string; children: ReactNode }) {
  const s = useStore();
  const place = useContext(Place);
  const sh = place ? s.looksShot() : null;
  if (!place || !sh || !isKeyValue(value)) return <>{children}</>;
  const full = [...place.base, ...path];
  const row = s.lookWorld?.get(place.table, place.id);
  // (Only a setting the thing has, or can have here: no key for a look it does not have of its own.)
  if (!row || !writeRow(row, full, value, !!place.make)) return <>{children}</>;
  const tracks = tracksOf(sh.settings.keys);
  const at: TrackAt = { table: place.table, id: place.id, path: full, label: [place.label, label].filter(Boolean).join(' · '), ...(place.make ? { make: true } : {}) };
  const id = trackIdOf(at);
  const track = tracks.find((t) => trackIdOf(t) === id);
  const frame = s.shotFrame;
  const here = !!track?.keys.some((k) => k.frame === frame);
  const name = row && 'name' in row ? `${(row as { name: string }).name} · ${at.label}` : at.label;
  const press = () => {
    if (here) s.setShotKeys(withoutKey(tracks, id, frame), `Remove the key of ${name} at frame ${frame + 1}`);
    else s.setShotKeys(withKey(tracks, at, frame, value), track ? `A key for ${name} at frame ${frame + 1}` : `Animate ${name} in this shot`);
  };
  const title = here ? `A key at this frame (${frame + 1}): press to remove it`
    : track ? `Animated in this shot (${track.keys.length} key${track.keys.length === 1 ? '' : 's'}): press for a key at this frame (${frame + 1}) with its value now; or change it here`
    : `Animate it in this shot: a key at this frame (${frame + 1}) with its value now; then change it at other frames`;
  // (The field being edited: a change made in it, once it is keyed, puts a key at the frame, store.executeLooks.)
  const mark = () => { s.keyEditing = id; };
  return (
    <span className="keyed" onFocusCapture={mark} onPointerDownCapture={mark} onChangeCapture={mark} onKeyDownCapture={mark} onBlur={() => { if (s.keyEditing === id) s.keyEditing = null; }}>
      {children}
      <button type="button" className={`key-button ${track ? 'animated' : ''} ${here ? 'here' : ''}`} onClick={press} title={title} aria-label={title} data-testid={`${testId ?? `key-${pathName(full)}`}-key`}>{here ? '◆' : '◇'}</button>
    </span>
  );
}
