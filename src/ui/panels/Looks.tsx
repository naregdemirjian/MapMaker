// The Looks panel (S3 of the studios plan, D236): how the thing chosen is drawn, its fundamentals by kind: a country's
// colour, fill, look, borders and label; a person's marker; a city's showing; a layer's fill, look, borders and front
// lines; an area's, a line's or a point's look; an event's changes as they animate. The one place looks are set:
// Properties says what a thing is. "Design" (a button in Properties, and Ctrl+D) brings it to the front.
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { isFeatureKind } from '../../render-engine/feature-style.ts';
import { eventTransitionLook, TRANSITION_LOOKS } from '../../presentation/sequence.ts';
import { PropGroup } from '../shell/Group.tsx';
import { NumberField } from '../inputs.tsx';
import { CountryLabelSection } from '../components/LabelStyles.tsx';
import { CountryFillSection } from '../components/CountryFill.tsx';
import { CountryLookSection, LayerLookSection } from '../components/LookEditor.tsx';
import { CountryBordersSection, LayerBordersSection } from '../components/BorderEditor.tsx';
import { CharacterIconSection } from '../components/CharacterIcons.tsx';
import { CityAlwaysShown } from '../components/Characters.tsx';
import { FeatureLookSection } from '../components/Features.tsx';

/** In a panel's heading: its looks, in the Looks panel (brought to the front; Ctrl+D). */
export function DesignButton() {
  return <button className="small design-button" onClick={() => store.design()} title="How it is drawn: in the Looks panel (Ctrl+D)" data-testid="open-looks">Design…</button>;
}

function Hint() {
  return (
    <div className="panel">
      <h3>Looks</h3>
      <p className="muted">Choose a country, a person or a city, a layer, an area, a line or a point, or an event: how it is drawn is set here (what it is, in Properties).</p>
    </div>
  );
}

function EntityLooks({ id }: { id: string }) {
  const s = useStore();
  const e = s.world!.get('entity', id);
  if (!e) return <Hint />;
  const political = e.type_id === 'polity' || e.type_id === 'faction';
  return (
    <div className="panel" data-testid="looks-entity">
      <h3><span className="swatch big" style={{ background: e.color }} /> {e.name}</h3>
      <PropGroup id="entity:fill" title={political ? 'Colour and fill' : 'Colour'}>
        <label>Colour<input type="color" value={e.color} onChange={(ev) => s.execute((wd) => cmd.updateEntity(wd, id, { color: ev.target.value }))} data-testid="entity-color" /></label>
        {political && <CountryFillSection id={id} />}
      </PropGroup>
      {political && <PropGroup id="entity:look" title="Look and borders"><CountryLookSection id={id} /><CountryBordersSection id={id} /></PropGroup>}
      {political && <PropGroup id="entity:label" title="Label"><CountryLabelSection id={id} /></PropGroup>}
      {e.type_id === 'character' && <PropGroup id="entity:marker" title="Marker"><CharacterIconSection id={id} /></PropGroup>}
      {e.type_id === 'settlement' && <PropGroup id="entity:showing" title="Showing"><CityAlwaysShown id={id} /></PropGroup>}
    </div>
  );
}

function LayerLooks({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!;
  const layer = w.get('layer', id);
  if (!layer) return <Hint />;
  if (isFeatureKind(layer.kind) || layer.kind === 'field') {
    return <div className="panel" data-testid="looks-layer"><h3>{layer.name}</h3><p className="muted">Each of its {layer.kind === 'field' ? 'conditions' : 'areas, lines or points'} has its own look: choose one.</p></div>;
  }
  const layers = [layer];
  return (
    <div className="panel" data-testid="looks-layer">
      <h3>{layer.name}</h3>
      {layers.length > 0 && <PropGroup id="layer:fill" title="Fill and look">
        {layers.map((l) => (
          <label key={`fill-${l.id}`} className="inline layer-option" title="Stripes or dots let the layers under this one show through: for occupation, control or influence over the political map">Fill
            <select value={parseJSON<{ fill?: string }>(l.style, {}).fill ?? 'solid'} onChange={(e) => s.execute((wd) => cmd.setLayerFill(wd, l.id, e.target.value as 'solid' | 'hatch' | 'cross' | 'dots'))} data-testid="layer-fill">
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
              <label title="How strongly the countries' colours cover the map under them, in shots and exports too">Opacity (%)<NumberField min={0} max={100} step={5} value={Math.round((st.fillOpacity ?? 0.78) * 100)} def={l.export_pass === 'political' ? 78 : 60} onCommit={(n) => s.execute((wd) => cmd.setLayerLook(wd, l.id, { fillOpacity: n / 100 }))} testId="layer-opacity" /></label>
              <label title="The width of the borders between countries on this layer (pixels at 1920 wide)">Border width<NumberField min={0} max={20} step={0.25} value={st.borderWidth ?? 1.3} def={l.export_pass === 'political' ? 1.4 : 1} onCommit={(n) => s.execute((wd) => cmd.setLayerLook(wd, l.id, { borderWidth: n }))} testId="layer-border-width" /></label>
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
              <select value={st.fronts ?? 'off'} onChange={(e) => s.execute((wd) => cmd.setLayerFronts(wd, l.id, e.target.value === 'off' ? null : e.target.value as 'second' | 'first' | 'plain'))} data-testid="layer-fronts">
                <option value="off">None</option>
                <option value="second" title="Where two countries are at war: teeth into the second of the war (as entered)">Teeth to the 2nd</option>
                <option value="first" title="Where two countries are at war: teeth into the first of the war">Teeth to the 1st</option>
                <option value="plain">No teeth</option>
              </select>
              {st.fronts && <input type="color" value={st.frontColor ?? '#d62828'} onChange={(e) => s.execute((wd) => cmd.setLayerFronts(wd, l.id, st.fronts!, e.target.value))} title="The colour of the front lines" data-testid="layer-front-color" />}
            </label>
          );
        })}
      </PropGroup>}
    </div>
  );
}

function FeatureLooks({ id }: { id: string }) {
  const s = useStore();
  const f = s.world!.get('feature', id);
  if (!f) return <Hint />;
  return (
    <div className="panel" data-testid="looks-feature">
      <h3>{f.name}</h3>
      <PropGroup id="feature:look" title="Look"><div className="look-grid"><FeatureLookSection id={id} /></div></PropGroup>
    </div>
  );
}

function EventLooks({ id }: { id: string }) {
  const s = useStore();
  const e = s.world!.get('event', id);
  if (!e) return <Hint />;
  return (
    <div className="panel" data-testid="looks-event">
      <h3>{e.name}</h3>
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

/** The Looks panel: the looks of the thing chosen. */
export function LooksPanel() {
  const s = useStore();
  const sel = s.selection;
  return (
    <div className="looks-panel" data-testid="looks-panel">
      {!sel && <Hint />}
      {sel?.kind === 'entity' && <EntityLooks id={sel.id} />}
      {sel?.kind === 'layer' && <LayerLooks id={sel.id} />}
      {sel?.kind === 'feature' && <FeatureLooks id={sel.id} />}
      {sel?.kind === 'event' && <EventLooks id={sel.id} />}
      {sel && sel.kind !== 'entity' && sel.kind !== 'layer' && sel.kind !== 'feature' && sel.kind !== 'event' && <Hint />}
    </div>
  );
}
