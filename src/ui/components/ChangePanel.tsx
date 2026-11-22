// One change of an event selected (D210): what it is and when, and in groups of Properties its animation (how it
// happens, how long it takes, where it spreads from) and its border shifts. Chosen from the event's list of
// changes or by clicking its tick in the timeline's strip of changes; "← event" goes back to the event.
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { parseJSON, leafDescendants, effectTime, isUntracked, type Resolution, type TransitionSpec } from '../../temporal-engine/engine.ts';
import { compare, fromStore, type Instant } from '../../core-time/index.ts';
import { isBaseEvent, type EffectRow } from '../../world-model/schema.ts';
import type { World } from '../../world-model/world.ts';
import { PropGroup } from '../shell/Group.tsx';
import { InlineDialog } from '../shell/DialogFrame.tsx';
import { BorderShiftsDialog } from './BorderShifts.tsx';
import { ChangeLength } from './RecordLength.tsx';
import { fmt } from './Panels.tsx';

type S = ReturnType<typeof useStore>;

/** How a change can happen, as offered in its Animation group. */
export const ANIMATIONS: Array<[string, string]> = [
  ['instant', 'Instant'],
  ['border', 'Advancing front (through the land from the border)'],
  ['advance', 'Expansion (from where it was drawn)'],
  ['dissolve', 'Dissolve (in patches)'],
  ['fade', 'Fade'],
];

/** How a change happens, in a word or two ("Fade", "Advancing front"). */
export function animationName(style: string | undefined): string {
  return (ANIMATIONS.find(([v]) => v === (style ?? 'instant'))?.[1] ?? 'Instant').replace(/ \(.*$/, '');
}

/** One line saying what a change does. */
export function describeEffect(s: S, f: EffectRow): string {
  const w = s.world!;
  const name = (v: string | null) => (v ? w.get('entity', v)?.name ?? '(deleted)' : 'nobody');
  if (f.kind === 'annex') {
    const i = parseJSON<{ from: string; to: string }>(f.intent, { from: '', to: '' });
    return `${name(i.to)} annexes everything ${name(i.from)} holds`;
  }
  if (f.kind === 'rename') {
    const i = parseJSON<{ entity: string; name: string }>(f.intent, { entity: '', name: '' });
    return `${name(i.entity)} is called ${i.name}`;
  }
  if (f.kind === 'relate') {
    const i = parseJSON<{ relation: string; on?: boolean }>(f.intent, { relation: '' });
    const r = w.get('relation', i.relation);
    const what = r ? cmd.describeRelation(w, r) : '(a deleted relationship)';
    return `${i.on ? 'Begins' : 'Ends'}: ${what}${f.at_day !== null ? ` (at ${fmt(fromStore(f.at_day, f.at_ms ?? 0), 'minute')})` : ''}`;
  }
  if (f.kind === 'shape') {
    const i = parseJSON<{ feature: string; off?: boolean }>(f.intent, { feature: '' });
    const ft = w.get('feature', i.feature);
    const what = ft ? `"${ft.name}"` : '(deleted)';
    const layer = f.layer_id ? w.get('layer', f.layer_id)?.name ?? '' : '';
    return `${layer ? `${layer}: ` : ''}${i.off ? `${what} ends` : `${what} takes its shape`}${f.at_day !== null ? ` (at ${fmt(fromStore(f.at_day, f.at_ms ?? 0), 'minute')})` : ''}`;
  }
  if (f.kind === 'place') {
    const i = parseJSON<{ entity: string; lon?: number; lat?: number; off?: boolean }>(f.intent, { entity: '' });
    return i.off ? `${name(i.entity)} leaves the map` : `${name(i.entity)} is at ${Math.abs(i.lat ?? 0).toFixed(2)}°${(i.lat ?? 0) >= 0 ? 'N' : 'S'}, ${Math.abs(i.lon ?? 0).toFixed(2)}°${(i.lon ?? 0) >= 0 ? 'E' : 'W'}`;
  }
  const res = parseJSON<Resolution>(f.resolution, { set: [] });
  const arr = f.space_id ? w.arrangements.get(f.space_id) : undefined;
  const parts = res.set.map(([faces, v]) => {
    const n = arr ? leafDescendants(arr, faces).size : faces.length;
    return `${n} parcel${n === 1 ? '' : 's'} → ${name(v)}`;
  });
  const layer = f.layer_id ? w.get('layer', f.layer_id)?.name : '';
  return `${layer}: ${parts.join('; ')}${f.at_day !== null ? ` (at ${fmt(fromStore(f.at_day, f.at_ms ?? 0), 'minute')})` : ''}`;
}

/** The middle of the land a change gives, as longitude and latitude (where an expansion starts from at first). */
export function regionCentre(s: S, f: EffectRow): [number, number] {
  const w = s.world!;
  if (!f.space_id) return [0, 0];
  const arr = w.arrangement(f.space_id);
  const res = parseJSON<Resolution>(f.resolution, { set: [] });
  let x = 0, y = 0, z = 0;
  for (const [faces] of res.set) for (const leaf of leafDescendants(arr, faces)) for (const cyc of arr.faceCycles(leaf)) for (const vid of cyc) {
    const v = arr.v(vid); x += v[0]; y += v[1]; z += v[2];
  }
  const n = Math.hypot(x, y, z) || 1;
  return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(z / n) * 180 / Math.PI];
}

/** Make a change happen in this way, keeping how long it takes (D86) and where it spreads from. */
export function setChangeAnimation(s: S, f: EffectRow, style: string): void {
  const ev = s.world!.get('event', f.event_id);
  const old = parseJSON<TransitionSpec | null>(f.transition, null);
  let spec: TransitionSpec | null = null;
  if (style === 'advance') spec = { style: 'advance', origin: old?.origin ?? regionCentre(s, f), easing: 'smooth' };
  else if (style === 'border') spec = { style: 'border', easing: 'smooth' };
  else if (style === 'dissolve') spec = { style: 'dissolve', easing: 'smooth' };
  else if (style === 'fade') spec = { style: 'fade' };
  // (In an event without an end, a change that starts to spread takes a year until chosen otherwise.)
  if (spec) {
    if (old?.until) spec.until = old.until;
    else if (old?.for) spec.for = old.for;
    else if (!ev || ev.end_day === null) spec.for = { n: 1, unit: 'year' };
    if (old?.next) spec.next = true;
    if (spec.style === 'advance' && old?.origins) spec.origins = old.origins;
  }
  s.execute((wd) => cmd.setEffectTransition(wd, f.id, spec));
}

/** Whether a change can be given border shifts (D195): land that one country gains. */
export function shiftable(f: EffectRow): boolean {
  if (f.kind !== 'assign') return false;
  const sets = parseJSON<Resolution>(f.resolution, { set: [] }).set;
  return sets.length === 1 && !!sets[0][1];
}

/** A generated border shift stands for the change it was made from. */
export function changeShown(world: World, f: EffectRow): EffectRow {
  const i = parseJSON<{ op?: string; of?: string }>(f.intent, {});
  return (i.op === 'shift' && i.of && world.get('effect', i.of)) || f;
}

/** An event's changes as its list shows them: in order, without the steps of border shifts. */
export function changesOf(world: World, eventId: string): EffectRow[] {
  return world.all('effect').filter((f) => f.event_id === eventId && parseJSON<{ op?: string }>(f.intent, {}).op !== 'shift').sort((a, b) => a.ordinal - b.ordinal);
}

/** When a change happens: its own date, or its event's. */
export function changeTime(world: World, f: EffectRow): Instant | null {
  if (isUntracked(f) && f.at_day !== null) return fromStore(f.at_day, f.at_ms ?? 0);
  const ev = world.get('event', f.event_id);
  return ev ? effectTime(f, ev) : null;
}

/** The changes happening at a moment (the timeline's strip of changes, clicked): those of the event selected first. */
export function changesAt(world: World, t: Instant, prefer: string | null): EffectRow[] {
  const out: EffectRow[] = [];
  for (const f of world.all('effect')) {
    const at = changeTime(world, f);
    if (!at || compare(at, t) !== 0) continue;
    const g = changeShown(world, f);
    if (!out.includes(g)) out.push(g);
  }
  return out.sort((a, b) => Number(b.event_id === prefer) - Number(a.event_id === prefer) || a.ordinal - b.ordinal);
}

export function ChangePanel({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const f = w.get('effect', id);
  const ev = f ? w.get('event', f.event_id) : undefined;
  if (!f || !ev) return <div className="panel" data-testid="change-panel"><p className="muted">This change no longer exists.</p></div>;
  const base = isBaseEvent(ev.id);
  const list = changesOf(w, ev.id), i = list.findIndex((x) => x.id === f.id);
  const at = changeTime(w, f);
  const animatable = !base && !!f.layer_id && f.kind !== 'shape';
  const spec = parseJSON<TransitionSpec | null>(f.transition, null);
  const made = cmd.borderShiftsOf(w, f.id);
  const choose = (g: EffectRow | undefined) => g && s.set({ selection: { kind: 'change', id: g.id } });
  return (
    <div className="panel" data-testid="change-panel">
      <button className="link back" onClick={() => s.set({ selection: { kind: 'event', id: ev.id } })} data-testid="change-back">← {base ? 'Starting map and changes without an event' : ev.name}</button>
      <h3 data-testid="change-title">{describeEffect(s, f)}</h3>
      <PropGroup id="change:change" title="Change">
        <div className="muted" data-testid="change-when">{i >= 0 ? `Change ${i + 1} of ${list.length}` : 'A change'}{at ? ` · ${fmt(at)}` : ''}</div>
        <div className="buttons">
          {at && <button onClick={() => s.setTime(at)} data-testid="change-goto">Go to its date</button>}
          <button disabled={i <= 0} onClick={() => choose(list[i - 1])} data-testid="change-prev" title="The change before it in the event">Previous</button>
          <button disabled={i < 0 || i >= list.length - 1} onClick={() => choose(list[i + 1])} data-testid="change-next" title="The change after it in the event">Next</button>
          <button className="danger" onClick={() => { s.execute((wd) => cmd.deleteEffect(wd, f.id)); if (!s.world!.get('effect', f.id)) s.set({ selection: { kind: 'event', id: ev.id } }); }} data-testid="change-remove">Remove</button>
        </div>
      </PropGroup>
      {animatable && (
        <PropGroup id="change:animation" title="Animation">
          <label>How it happens
            <select value={spec?.style ?? 'instant'} onChange={(e) => setChangeAnimation(s, f, e.target.value)} data-testid="transition-style">
              {ANIMATIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          <ChangeLength f={f} ev={ev} />
          {spec?.style === 'advance' && spec.origin && (() => {
            // An expansion's starting points (D91): more of them, and it spreads from all at once.
            const n = 1 + (spec.origins?.length ?? 0);
            return (
              <span className="change-length" data-testid="change-origins">
                <span className="muted">Spreads from {n === 1 ? 'one point' : `${n} points at once`}</span>
                <button className="small" onClick={() => { s.set({ pickOrigin: f.id }); s.toast('Click on the map where it also starts from.'); }} data-testid="add-origin">{s.pickOrigin === f.id ? 'Click the map…' : 'Add a starting point'}</button>
                {n > 1 && <button className="small" onClick={() => s.execute((wd) => cmd.clearTransitionOrigins(wd, f.id))} data-testid="clear-origins">Only the first</button>}
              </span>
            );
          })()}
        </PropGroup>
      )}
      {animatable && shiftable(f) && (
        <PropGroup id="change:shifts" title="Border shifts" folded>
          {made && <div className="muted" data-testid="change-shifts">Border shifts: {cmd.generatedShifts(w, f.id).length} generated, every {made.every.n === 1 ? made.every.unit : `${made.every.n} ${made.every.unit}s`}</div>}
          {s.dialog === 'border-shifts' && s.shiftsFor === f.id
            ? <p className="muted">Open in its own window.</p>
            : <InlineDialog.Provider value={true}><BorderShiftsDialog key={f.id} effectId={f.id} /></InlineDialog.Provider>}
        </PropGroup>
      )}
    </div>
  );
}
