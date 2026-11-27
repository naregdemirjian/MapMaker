// The Looks studio's Parts panel (S7, D248), as agreed in the drawing of the studio: the thing being designed and its
// parts, top to bottom as they are drawn (a country's effects over its label over its border over its fill), each
// with what it holds now; a part chosen brings its settings forward in the Looks panel, opened and lit. Under them,
// the way to design something else: the thing's group, the layer viewed, a city, a person, an area, an event.
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { countryLookOf, EFFECT_NAMES } from '../../render-engine/country-look.ts';
import { groupStyle, groupMembers } from '../../domain/group-looks.ts';
import type { World } from '../../world-model/world.ts';

/** A part of a thing's design: its Looks panel group (and the place in it), and what it holds now. */
export interface Part { id: string; name: string; group: string; inner?: string; holds: string }

const on = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What is designed, and its parts top to bottom (null: nothing chosen that has looks). */
export function partsOf(w: World, sel: ReturnType<typeof useStore>['selection']): { name: string; kind: string; parts: Part[] } | null {
  if (sel?.kind === 'entity') {
    const e = w.get('entity', sel.id);
    if (!e) return null;
    const st = cmd.entityStyle(e);
    if (e.type_id === 'polity' || e.type_id === 'faction') {
      const look = countryLookOf(st.look);
      const fx = (look?.effects ?? []).filter((x) => x.on);
      return {
        name: e.name, kind: e.type_id === 'faction' ? 'Faction' : 'Country',
        parts: [
          { id: 'effects', name: 'Effects', group: 'entity:look', inner: '.country-look', holds: fx.length ? fx.map((x) => EFFECT_NAMES[x.kind]).join(', ') : look ? 'none' : 'as its layer' },
          { id: 'label', name: 'Label', group: 'entity:label', holds: st.label ? 'its own' : 'as every country' },
          { id: 'border', name: 'Border', group: 'entity:look', inner: '.country-borders', holds: 'between it and each neighbour' },
          { id: 'fill', name: 'Fill', group: 'entity:fill', holds: st.fill && st.fill.kind !== 'color' ? (st.fill.kind === 'image' ? 'a picture' : 'a video') : `its colour, ${e.color}` },
        ],
      };
    }
    if (e.type_id === 'character') return { name: e.name, kind: 'Person', parts: [{ id: 'marker', name: 'Marker', group: 'entity:marker', holds: st.icon ? 'its own' : 'a dot' }, { id: 'colour', name: 'Colour', group: 'entity:fill', holds: e.color }] };
    if (e.type_id === 'settlement') return { name: e.name, kind: 'City', parts: [{ id: 'showing', name: 'Showing', group: 'entity:showing', holds: st.alwaysShown ? 'at every scale' : 'by its importance' }, { id: 'colour', name: 'Colour', group: 'entity:fill', holds: e.color }] };
    return { name: e.name, kind: 'Thing', parts: [{ id: 'colour', name: 'Colour', group: 'entity:fill', holds: e.color }] };
  }
  if (sel?.kind === 'group') {
    const g = w.get('entity_group', sel.id);
    if (!g) return null;
    const gs = groupStyle(g), fx = (gs.look?.effects ?? []).filter((x) => x.on);
    const members = groupMembers(w, g.id).length;
    return {
      name: g.name, kind: `Group of ${on(members, 'member', 'members')}`,
      parts: [
        { id: 'effects', name: 'Effects', group: 'group:look', holds: fx.length ? fx.map((x) => EFFECT_NAMES[x.kind]).join(', ') : 'none' },
        { id: 'labels', name: 'Labels', group: 'group:label', holds: 'over its members’' },
      ],
    };
  }
  if (sel?.kind === 'layer') {
    const l = w.get('layer', sel.id);
    if (!l) return null;
    return { name: l.name, kind: 'Layer', parts: [{ id: 'borders', name: 'Borders and front lines', group: 'layer:borders', holds: 'of its countries' }, { id: 'fill', name: 'Fill and look', group: 'layer:fill', holds: 'of its countries' }] };
  }
  if (sel?.kind === 'feature') {
    const f = w.get('feature', sel.id);
    if (!f) return null;
    return { name: f.name || 'An area, a line or a point', kind: 'Drawn on a layer', parts: [{ id: 'look', name: 'Look', group: 'feature:look', holds: 'its stroke, fill and marker' }] };
  }
  if (sel?.kind === 'event') {
    const ev = w.get('event', sel.id);
    if (!ev) return null;
    return { name: ev.name, kind: 'Event', parts: [{ id: 'changes', name: 'Its changes as they animate', group: 'event:look', holds: 'as the shot’s look, or its own' }] };
  }
  return null;
}

/**
 * A part's settings brought forward (D248): the Looks panel in front, its group opened, scrolled to and lit for a
 * moment; a place within the group (a fold of it) opened too.
 */
export function focusPart(p: Part) {
  store.design();
  const key = `prop:${p.group}`;
  if (store.collapsed.includes(key)) store.toggleCollapsed(key);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const group = document.querySelector<HTMLElement>(`.looks-panel [data-testid="group-${p.group}"]`);
    if (!group) return;
    const el = (p.inner && group.querySelector<HTMLElement>(p.inner)) || group;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('part-lit');
    void el.offsetWidth;
    el.classList.add('part-lit');
  }));
}

export function LookPartsPanel() {
  const s = useStore();
  const w = s.lookWorld ?? s.world!;
  const what = partsOf(w, s.selection);
  const sel = s.selection;
  // The ways to something else: its group (a member's), the layer viewed, the first city, person, area and event.
  const ent = sel?.kind === 'entity' ? w.get('entity', sel.id) : null;
  const group = ent?.group_id ? w.get('entity_group', ent.group_id) : null;
  const layer = w.get('layer', s.layerId);
  const first = (type: string) => w.all('entity').find((e) => e.type_id === type);
  const city = first('settlement'), person = first('character');
  const area = w.all('feature')[0];
  const event = w.all('event').find((e) => !e.id.startsWith('evt_base'));
  const others: Array<{ label: string; run: () => void; testId: string }> = [
    ...(group ? [{ label: `Its group: ${group.name}`, run: () => s.set({ selection: { kind: 'group', id: group.id }, multi: null }), testId: 'parts-other-group' }] : []),
    ...(layer ? [{ label: `Layer: ${layer.name}`, run: () => s.set({ selection: { kind: 'layer', id: layer.id }, multi: null }), testId: 'parts-other-layer' }] : []),
    ...(city ? [{ label: `A city: ${city.name}`, run: () => s.set({ selection: { kind: 'entity', id: city.id }, multi: null }), testId: 'parts-other-city' }] : []),
    ...(person ? [{ label: `A person: ${person.name}`, run: () => s.set({ selection: { kind: 'entity', id: person.id }, multi: null }), testId: 'parts-other-person' }] : []),
    ...(area ? [{ label: `An area, a line or a point: ${area.name || 'unnamed'}`, run: () => s.set({ selection: { kind: 'feature', id: area.id }, multi: null }), testId: 'parts-other-feature' }] : []),
    ...(event ? [{ label: `An event: ${event.name}`, run: () => s.set({ selection: { kind: 'event', id: event.id }, multi: null }), testId: 'parts-other-event' }] : []),
  ];
  return (
    <div className="panel look-parts" data-testid="parts-panel">
      {what ? (
        <>
          <div className="parts-head">Design</div>
          <div className="parts-title" data-testid="parts-title"><b>{what.name}</b> <span className="muted">{what.kind}</span></div>
          <div className="parts-sub muted">Its parts, top to bottom</div>
          <ul className="parts-list">
            {what.parts.map((p) => (
              <li key={p.id}>
                <button className="part-row" onClick={() => focusPart(p)} title={`${p.name}: its settings in the Looks panel`} data-testid={`part-${p.id}`}>
                  <span className="part-name">{p.name}</span><span className="part-holds muted">{p.holds}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted" data-testid="parts-none">Choose something to design on the map or in the lists: a country, a group of them, a layer, a city or a person, an area, a line or a point, an event. Its parts are listed here, their settings in the Looks panel.</p>
      )}
      <div className="parts-sub muted">Design something else</div>
      <ul className="parts-list">
        {others.map((o) => <li key={o.testId}><button className="part-row" onClick={o.run} data-testid={o.testId}><span className="part-name">{o.label}</span></button></li>)}
      </ul>
    </div>
  );
}
