// The Looks panel (S3 of the studios plan, D236): how the thing chosen is drawn, its fundamentals by kind: a country's
// colour, fill, look, borders and label; a person's marker; a city's showing; a group's looks, laid over its members'
// as an adjustment layer (D237); a layer's fill, look, borders and front lines; an area's, a line's or a point's look;
// an event's changes as they animate. The one place looks are set: Properties says what a thing is. "Design" (a button
// in Properties, and Ctrl+D) brings it to the front.
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { isFeatureKind } from '../../render-engine/feature-style.ts';
import { eventTransitionLook, TRANSITION_LOOKS } from '../../presentation/sequence.ts';
import { PropGroup } from '../shell/Group.tsx';
import { NumberField } from '../inputs.tsx';
import { CountryLabelSection, GroupLabelSection } from '../components/LabelStyles.tsx';
import { CountryFillSection, GroupFillSection } from '../components/CountryFill.tsx';
import { CountryLookSection, LayerLookSection, GroupLookSection } from '../components/LookEditor.tsx';
import { groupStyle, groupLooksPlain, groupMembers, lookedEntity } from '../../domain/group-looks.ts';
import { restyleOf, restyled, withoutRestyle, tracksOf, keysRow, withoutRowKeys, type RestyleTable } from '../../presentation/shot-looks.ts';
import { Keyed, KeyThing } from '../components/Keyed.tsx';
import type { ShotSettings } from '../../presentation/sequence.ts';
import { CountryBordersSection, LayerBordersSection } from '../components/BorderEditor.tsx';
import { CharacterIconSection } from '../components/CharacterIcons.tsx';
import { CityAlwaysShown } from '../components/Characters.tsx';
import { FeatureLookSection } from '../components/Features.tsx';
import { DrawingLooks, drawingNow } from './DrawingLooks.tsx';

/** In a panel's heading: its looks, in the Looks panel (brought to the front; Ctrl+D). */
export function DesignButton() {
  return <button className="small design-button" onClick={() => store.design()} title="How it is drawn: in the Looks panel (Ctrl+D)" data-testid="open-looks">Design…</button>;
}

function Hint() {
  return (
    <div className="panel">
      <h3>Looks</h3>
      <p className="muted">Choose a country, a person or a city, a group of them, a layer, an area, a line or a point, or an event: how it is drawn is set here (what it is, in Properties).</p>
    </div>
  );
}

/**
 * A thing's colour, chosen for it alone (D237). In a group drawing its members in the group's colour: the group's,
 * until one is chosen for it here; then its own, with the way back to the group's.
 */
function EntityColour({ id }: { id: string }) {
  const s = useStore();
  const w = s.lookWorld!;
  const e = w.get('entity', id);
  if (!e) return null;
  const g = e.group_id ? w.get('entity_group', e.group_id) : undefined;
  const set = (color: string) => s.executeLooks((wd) => cmd.setEntityColor(wd, id, color));
  if (g && groupStyle(g).colorMembers) {
    const own = cmd.entityStyle(e).ownColor === true;
    return own ? (
      <label>Colour (its own)
        <span className="inline"><Keyed path={['color']} value={e.color} label="Colour" testId="entity-color"><input type="color" value={e.color} onChange={(ev) => set(ev.target.value)} data-testid="entity-color" /></Keyed>
          <button className="small" onClick={() => s.executeLooks((wd) => cmd.setEntityColor(wd, id, null, false))} title={`Drawn in the colour of the group "${g.name}" again (its own is kept for when it leaves)`} data-testid="entity-group-color">The group's colour</button></span>
      </label>
    ) : (
      <label title={`The group "${g.name}" draws its members in its colour; choosing one here gives it a colour of its own`}>Colour (the group's)
        <input type="color" value={g.color} onChange={(ev) => set(ev.target.value)} data-testid="entity-color" />
      </label>
    );
  }
  return <label>Colour<Keyed path={['color']} value={e.color} label="Colour" testId="entity-color"><input type="color" value={e.color} onChange={(ev) => set(ev.target.value)} data-testid="entity-color" /></Keyed></label>;
}

/** A member of a group with looks (D237): those looks are laid over its own; the way to them. */
function GroupNote({ id }: { id: string }) {
  const s = useStore();
  const w = s.lookWorld!;
  const e = w.get('entity', id);
  const g = e?.group_id ? w.get('entity_group', e.group_id) : undefined;
  if (!g || groupLooksPlain(groupStyle(g))) return null;
  return (
    <div className="group-note" data-testid="looks-group-note">
      <span className="swatch" style={{ background: g.color }} /> In the group <b>{g.name}</b>: its looks are laid over these, its effects added to them; a setting of its own wins.
      <button className="small link" onClick={() => s.set({ selection: { kind: 'group', id: g.id }, multi: null })} data-testid="looks-open-group">The group's looks…</button>
    </div>
  );
}

function EntityLooks({ id }: { id: string }) {
  const s = useStore();
  const e = s.lookWorld!.get('entity', id);
  if (!e) return <Hint />;
  const political = e.type_id === 'polity' || e.type_id === 'faction';
  return (
    <KeyThing table="entity" id={id}>
    <div className="panel" data-testid="looks-entity">
      <h3><span className="swatch big" style={{ background: lookedEntity(s.lookWorld!, e).color }} /> {e.name}</h3>
      <GroupNote id={id} />
      <PropGroup id="entity:fill" title={political ? 'Colour and fill' : 'Colour'}>
        <EntityColour id={id} />
        {political && <CountryFillSection id={id} />}
      </PropGroup>
      {political && <PropGroup id="entity:look" title="Look and borders"><CountryLookSection id={id} /><CountryBordersSection id={id} /></PropGroup>}
      {political && <PropGroup id="entity:label" title="Label"><CountryLabelSection id={id} /></PropGroup>}
      {e.type_id === 'character' && <PropGroup id="entity:marker" title="Marker"><CharacterIconSection id={id} /></PropGroup>}
      {e.type_id === 'settlement' && <PropGroup id="entity:showing" title="Showing"><CityAlwaysShown id={id} /></PropGroup>}
    </div>
    </KeyThing>
  );
}

/**
 * A group's looks (D237): laid over its members' as an adjustment layer over the clips under it. Its colour (and its
 * members drawn in it or not), a fill, a look with effects, label settings; each member's own settings winning.
 */
function GroupLooks({ id }: { id: string }) {
  const s = useStore();
  const w = s.lookWorld!;
  const g = w.get('entity_group', id);
  if (!g) return <Hint />;
  const gs = groupStyle(g);
  const members = groupMembers(w, id);
  const political = !members.length || members.some((e) => e.type_id === 'polity' || e.type_id === 'faction');
  return (
    <KeyThing table="entity_group" id={id}>
    <div className="panel" data-testid="looks-group">
      <h3><span className="swatch big" style={{ background: g.color }} /> {g.name}</h3>
      <p className="muted">Laid over the looks of the {members.length === 1 ? 'one' : members.length} in it, as an adjustment layer: its effects are added to each one's own, and where one has a setting of its own, that wins. Choose one of them to change it alone.</p>
      <PropGroup id="group:fill" title={political ? 'Colour and fill' : 'Colour'}>
        <label>Colour<Keyed path={['color']} value={g.color} label="Colour" testId="group-color"><input type="color" value={g.color} onChange={(ev) => s.executeLooks((wd) => cmd.setEntityGroupColor(wd, id, ev.target.value))} data-testid="group-color" /></Keyed></label>
        <label className="check" title="Those given a colour of their own (in their Looks) keep it">
          <input type="checkbox" checked={!!gs.colorMembers} onChange={(ev) => s.executeLooks((wd) => cmd.setGroupStyle(wd, id, { colorMembers: ev.target.checked }))} data-testid="group-color-members" /> Its members drawn in this colour
        </label>
        {political && <GroupFillSection groupId={id} />}
      </PropGroup>
      {political && <PropGroup id="group:look" title="Look"><GroupLookSection groupId={id} /></PropGroup>}
      {political && <PropGroup id="group:label" title="Labels"><GroupLabelSection groupId={id} /></PropGroup>}
    </div>
    </KeyThing>
  );
}

function LayerLooks({ id }: { id: string }) {
  const s = useStore();
  const w = s.lookWorld!;
  const layer = w.get('layer', id);
  if (!layer) return <Hint />;
  if (isFeatureKind(layer.kind) || layer.kind === 'field') {
    return <div className="panel" data-testid="looks-layer"><h3>{layer.name}</h3><p className="muted">Each of its {layer.kind === 'field' ? 'conditions' : 'areas, lines or points'} has its own look: choose one.</p></div>;
  }
  const layers = [layer];
  return (
    <KeyThing table="layer" id={id}>
    <div className="panel" data-testid="looks-layer">
      <h3>{layer.name}</h3>
      {layers.length > 0 && <PropGroup id="layer:fill" title="Fill and look">
        {layers.map((l) => (
          <label key={`fill-${l.id}`} className="inline layer-option" title="Stripes or dots let the layers under this one show through: for occupation, control or influence over the political map">Fill
            <select value={parseJSON<{ fill?: string }>(l.style, {}).fill ?? 'solid'} onChange={(e) => s.executeLooks((wd) => cmd.setLayerFill(wd, l.id, e.target.value as 'solid' | 'hatch' | 'cross' | 'dots'))} data-testid="layer-fill">
              <option value="solid">Solid</option>
              <option value="hatch">Stripes</option>
              <option value="cross">Crossed stripes</option>
              <option value="dots">Dots</option>
            </select>
          </label>
        ))}
        {layers.filter((l) => l.kind === 'partition').map((l) => {
          const st = parseJSON<{ fillOpacity?: number; borderWidth?: number }>(l.style, {});
          return (
            <div key={`look-${l.id}`} className="two layer-option">
              <label title="How strongly the countries' colours cover the map under them, in shots and exports too">Opacity (%)<Keyed path={['style', 'fillOpacity']} value={st.fillOpacity ?? 0.78} label="Opacity (%)" testId="layer-opacity"><NumberField min={0} max={100} step={5} value={Math.round((st.fillOpacity ?? 0.78) * 100)} def={l.export_pass === 'political' ? 78 : 60} onCommit={(n) => s.executeLooks((wd) => cmd.setLayerLook(wd, l.id, { fillOpacity: n / 100 }))} testId="layer-opacity" /></Keyed></label>
              <label title="The width of the borders between countries on this layer (pixels at 1920 wide)">Border width<Keyed path={['style', 'borderWidth']} value={st.borderWidth ?? 1.3} label="Border width" testId="layer-border-width"><NumberField min={0} max={20} step={0.25} value={st.borderWidth ?? 1.3} def={l.export_pass === 'political' ? 1.4 : 1} onCommit={(n) => s.executeLooks((wd) => cmd.setLayerLook(wd, l.id, { borderWidth: n }))} testId="layer-border-width" /></Keyed></label>
            </div>
          );
        })}
        {layers.filter((l) => l.kind === 'partition').map((l) => <LayerLookSection key={`lk-${l.id}`} layerId={l.id} />)}
      </PropGroup>}
      {layers.length > 0 && <PropGroup id="layer:borders" title="Borders and front lines">
        {layers.filter((l) => l.kind === 'partition').map((l) => <LayerBordersSection key={`lb-${l.id}`} layerId={l.id} />)}
        {layers.map((l) => {
          const st = parseJSON<{ fronts?: 'second' | 'first' | 'plain'; frontColor?: string }>(l.style, {});
          return (
            <label key={`fronts-${l.id}`} className="inline layer-option" title="Where two countries are at war (Relationships, in a country's panel), the border between them on this layer is drawn as a front line while the war lasts">Front lines
              <select value={st.fronts ?? 'off'} onChange={(e) => s.executeLooks((wd) => cmd.setLayerFronts(wd, l.id, e.target.value === 'off' ? null : e.target.value as 'second' | 'first' | 'plain'))} data-testid="layer-fronts">
                <option value="off">None</option>
                <option value="second" title="Where two countries are at war: teeth into the second of the war (as entered)">Teeth to the 2nd</option>
                <option value="first" title="Where two countries are at war: teeth into the first of the war">Teeth to the 1st</option>
                <option value="plain">No teeth</option>
              </select>
              {st.fronts && <Keyed path={['style', 'frontColor']} value={st.frontColor ?? '#d62828'} label="Front lines" testId="layer-front-color"><input type="color" value={st.frontColor ?? '#d62828'} onChange={(e) => s.executeLooks((wd) => cmd.setLayerFronts(wd, l.id, st.fronts!, e.target.value))} title="The colour of the front lines" data-testid="layer-front-color" /></Keyed>}
            </label>
          );
        })}
      </PropGroup>}
    </div>
    </KeyThing>
  );
}

function FeatureLooks({ id }: { id: string }) {
  const s = useStore();
  const f = s.lookWorld!.get('feature', id);
  if (!f) return <Hint />;
  return (
    <KeyThing table="feature" id={id}>
    <div className="panel" data-testid="looks-feature">
      <h3>{f.name}</h3>
      <PropGroup id="feature:look" title="Look"><div className="look-grid"><FeatureLookSection id={id} /></div></PropGroup>
    </div>
    </KeyThing>
  );
}

function EventLooks({ id }: { id: string }) {
  const s = useStore();
  const e = s.world!.get('event', id);
  if (!e) return <Hint />;
  return (
    <div className="panel" data-testid="looks-event">
      <h3>{e.name}</h3>
      {s.mode === 'present' && s.looksScope === 'shot' && <p className="muted small-text">An event's look is the same in every shot (a shot's own way of animating changes is in its settings, Transitions).</p>}
      <PropGroup id="event:look" title="Its changes as they animate">
        <label title="How its changes look when they animate, here and in every shot: as the shot's look, or a look of their own (a blitz in a film otherwise clean)">Look of its changes
          <select value={eventTransitionLook(e.presentation) ?? ''} onChange={(ev) => s.execute((wd) => cmd.setEventLook(wd, id, ev.target.value || null))} data-testid="event-look">
            <option value="">As the shot's look</option>
            {TRANSITION_LOOKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </PropGroup>
    </div>
  );
}

/** What is chosen, as a row a shot can have looks of its own for (D239). */
function restyleTarget(sel: ReturnType<typeof useStore>['selection']): { table: RestyleTable; id: string } | null {
  if (sel?.kind === 'entity') return { table: 'entity', id: sel.id };
  if (sel?.kind === 'group') return { table: 'entity_group', id: sel.id };
  if (sel?.kind === 'layer') return { table: 'layer', id: sel.id };
  if (sel?.kind === 'feature') return { table: 'feature', id: sel.id };
  return null;
}

/**
 * In Presentation with a shot open (D239): where a change of looks goes, everywhere (the project) or to this shot
 * only; and, when the shot has looks of its own for the thing chosen, the way back to everywhere's.
 */
function ScopeSwitch() {
  const s = useStore();
  if (s.mode !== 'present' || !s.shotId || !s.world) return null;
  const row = s.world.get('sequence', s.shotId);
  const settings = row ? parseJSON<ShotSettings | null>(row.settings, null) : null;
  if (!row || !settings) return null;
  const restyle = restyleOf(settings.restyle), tracks = tracksOf(settings.keys);
  const target = restyleTarget(s.selection);
  const keyed = target ? tracks.filter((t) => t.table === target.table && t.id === target.id).length : 0;
  const own = !!target && (restyled(restyle, target.table, target.id) || keysRow(tracks, target.table, target.id));
  return (
    <div className="looks-scope" data-testid="looks-scope">
      <span className="muted">Changes go</span>
      <span className="seg">
        <button className={`small ${s.looksScope === 'everywhere' ? 'on' : ''}`} onClick={() => s.set({ looksScope: 'everywhere' })} title="To the project: every shot, and the map worked on" data-testid="looks-scope-everywhere">Everywhere</button>
        <button className={`small ${s.looksScope === 'shot' ? 'on' : ''}`} onClick={() => s.set({ looksScope: 'shot' })} title={`To the shot "${row.name}" alone, kept with it`} data-testid="looks-scope-shot">This shot only</button>
      </span>
      {own && target && (
        <p className="muted small-text" data-testid="looks-shot-own">
          This shot has looks of its own for it{keyed ? ` (${keyed === 1 ? 'one setting animated: its keys' : `${keyed} settings animated: their keys`} in the shot's timeline)` : ''}{s.looksScope === 'everywhere' ? ', drawn in it over these' : ''}.{' '}
          <button className="small link" onClick={() => s.execute((w) => ({ ...cmd.updateSequence(w, row.id, { settings: { ...settings, restyle: withoutRestyle(restyle, target.table, [target.id]), keys: withoutRowKeys(tracks, target.table, [target.id]) } }), label: 'Back to the looks of everywhere' }))} data-testid="looks-shot-clear">Back to everywhere's</button>
        </p>
      )}
    </div>
  );
}

/** The Looks panel: the looks of the thing chosen. */
export function LooksPanel() {
  const s = useStore();
  const sel = s.selection;
  return (
    <div className="looks-panel" data-testid="looks-panel" data-drop="looks">
      <ScopeSwitch />
      {!sel && <Hint />}
      {sel?.kind === 'entity' && (drawingNow(s) ? <DrawingLooks owner={sel.id} drawing={drawingNow(s)!.drawing} /> : <EntityLooks id={sel.id} />)}
      {sel?.kind === 'layer' && <LayerLooks id={sel.id} />}
      {sel?.kind === 'feature' && <FeatureLooks id={sel.id} />}
      {sel?.kind === 'event' && <EventLooks id={sel.id} />}
      {sel?.kind === 'group' && <GroupLooks id={sel.id} />}
      {sel && sel.kind !== 'entity' && sel.kind !== 'layer' && sel.kind !== 'feature' && sel.kind !== 'event' && sel.kind !== 'group' && <Hint />}
    </div>
  );
}
