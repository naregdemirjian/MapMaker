// The Advance and buffer zone tool (D222): an advance takes the land of the neighbour clicked within a distance of
// its border with the country chosen; a buffer zone takes the land either side of the border clicked beside, for
// nobody or the owner chosen. The land is measured by travel through it (domain/reach.ts), slower over mountains and
// water as far as asked, then offered like a drawing: the prompt asks whether it is a correction or an event, and
// how it spreads (an advancing front from the border, for a conquest). Zones of control (D223): a click on a country
// divides its land among its cities, each taking the land nearer it than any other by travel; a dialog chooses the
// cities and the zone the country keeps, the zones drawn on the map meanwhile.
import { useState } from 'react';
import { useStore, store, type ZonesDraft } from '../store.ts';
import { radiansPerPixel, type View } from '../../render-engine/camera.ts';
import { landWithin, landRings, sharedBorder, borderNear, zonesOf, REACH_KM, MOST_ZONES, type ReachProblem, type SlowAt } from '../../domain/reach.ts';
import { cityImportance, UNRATED_CITY } from '../../render-engine/label-style.ts';
import { placeMetaOf } from '../../domain/places.ts';
import { useWhen, modeOf, WhenChooser, useKeys, Frame } from './SplitMerge.tsx';
import { terrainSlowness } from '../../render-engine/front-terrain.ts';
import { ownerReader } from '../../domain/commands.ts';
import * as cmd from '../../domain/commands.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { terrainSourceOf, sculptOf, seaLevelPoints, EARTH_RADIUS_KM } from '../../world-model/world-settings.ts';
import type { MapSpaceRow } from '../../world-model/schema.ts';
import { stampsAt } from '../../terrain/sculpt.ts';
import { sculpted } from '../../terrain/sculpt-cache.ts';
import { seaLevelAt } from '../../terrain/sea-level.ts';
import { RangeReset } from '../shell/Reset.tsx';
import { fmt } from '../inputs.tsx';
import { outlinerLists } from '../panels/Lists.tsx';

const MIND_DEFAULT = 0.6;

/** The tool's options: what it makes, for whom, how far, and how much the land slows it. */
export function ReachToolOptions() {
  const s = useStore();
  const w = s.world!;
  const owners = outlinerLists(s).political;
  const r = s.reach;
  const set = (patch: Partial<typeof r>) => s.set({ reach: { ...r, ...patch } });
  const heights = !!terrainSourceOf(w.get('map_space', s.spaceId));
  const who = s.paintValue ? w.get('entity', s.paintValue)?.name ?? '?' : null;
  return (
    <div className="toolbar sub" data-testid="reach-options">
      <label className="inline">Make
        <select value={r.mode} onChange={(e) => set({ mode: e.target.value as typeof r.mode })} data-testid="reach-mode">
          <option value="advance">An advance into a neighbour</option>
          <option value="buffer">A buffer zone along a border</option>
          <option value="zones">Zones of control round a country's cities</option>
        </select>
      </label>
      {r.mode !== 'zones' && <>
      <label className="inline">{r.mode === 'advance' ? 'Who advances' : 'The zone goes to'}
        <select value={s.paintValue ?? ''} onChange={(e) => s.set({ paintValue: e.target.value || null })} data-testid="reach-owner">
          <option value="">{r.mode === 'advance' ? 'Choose…' : 'Nobody (no man\'s land)'}</option>
          {owners.map((o) => { const locked = cmd.isLocked(w, o.id); return <option key={o.id} value={o.id} disabled={locked}>{o.name}{locked ? ' (locked)' : ''}</option>; })}
        </select>
      </label>
      <label className="inline" title="How far the advance reaches into the neighbour's land, or the zone reaches either side of the border, by travel through the land">Distance
        <input type="number" min={REACH_KM.min} max={REACH_KM.max} step={REACH_KM.step} value={r.km} style={{ width: '5.5em' }}
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set({ km: Math.max(REACH_KM.min, Math.min(REACH_KM.max, v)) }); }} data-testid="reach-km" /> km
        <RangeReset def={REACH_KM.start} value={r.km} />
      </label>
      </>}
      {heights && (
        <label className="inline" title="How much mountains, rough ground and water to cross slow the way: none, the distance as the crow flies over the land; all, a range or a sea holds it up">Minding the land
          <input type="range" min={0} max={1} step={0.05} value={r.mind} onChange={(e) => set({ mind: Number(e.target.value) })} data-testid="reach-mind" />
          <RangeReset def={MIND_DEFAULT} value={r.mind} />
        </label>
      )}
      <span className="muted" data-testid="reach-hint">{r.mode === 'advance'
        ? who ? `Click the land of the country ${who} advances into.` : 'Choose who advances, then click the land of the neighbour.'
        : r.mode === 'buffer' ? 'Click on or beside a border between two countries.'
        : 'Click a country: its land divided among its cities, each taking the land nearest it by travel.'}</span>
    </div>
  );
}

/** How much slower the map's land is to cross at a place (D142), with its sculpting and its sea of the date viewed; none without heights. */
function slowness(space: MapSpaceRow | undefined, amount: number, radiusKm: number): SlowAt | undefined {
  if (!(amount > 0) || !terrainSourceOf(space)) return undefined;
  const ground = store.terrainOf(space, store.time);
  if (!ground) return undefined;
  const carved = sculpted(ground.grid, ground.key, stampsAt(sculptOf(space), store.time), radiusKm);
  return terrainSlowness(carved?.grid ?? ground.grid, seaLevelAt(seaLevelPoints(space), store.time), amount);
}

const PROBLEMS: Record<ReachProblem, string> = {
  'no-border': 'They share no border.',
  'too-long': 'That border is too long to measure at once: make the distance shorter.',
  nothing: 'No land lies within that distance.',
};

/**
 * What the tool does at a place clicked: the land worked out and offered as a drawing to apply, or a word on why not.
 * `view`: for how near a border a click for a buffer zone must be (a dozen pixels).
 */
export function reachAt(view: View, ll: [number, number]): void {
  const s = store, w = s.world, e = s.engine;
  const layer = w?.get('layer', s.layerId);
  if (!w || !e || !layer || layer.kind !== 'partition' || layer.space_id !== s.spaceId) { s.toast('Choose a layer of territory to work on.', 'error'); return; }
  const arr = w.arrangement(s.spaceId);
  const of = ownerReader(arr, e.partitionState(s.spaceId, layer.id, s.time));
  const name = (id: string) => e.nameAt(id, s.time) ?? w.get('entity', id)?.name ?? '?';
  const space = w.get('map_space', s.spaceId);
  const radiusKm = (space?.radius_m ?? EARTH_RADIUS_KM * 1000) / 1000;
  const { mode, km, mind } = s.reach;
  const slowAt = slowness(space, mind, radiusKm);
  const minding = slowAt ? ', minding the land' : '';
  if (mode === 'zones') {
    const C = of(arr.locate(lonLatToVec(ll[0], ll[1])));
    if (!C) { s.toast('Click the land of the country to divide.', 'error'); return; }
    if (cmd.isLocked(w, C)) { s.toast(`${name(C)} is locked: unlock it to divide its land.`, 'error'); return; }
    // Its cities: those standing on its land at the date viewed, the most important first.
    const cities: ZonesDraft['cities'] = [];
    const rank = new Map<string, number>();
    for (const c of e.charactersAt(s.spaceId, s.time)) {
      const ent = w.get('entity', c.entity);
      if (ent?.type_id !== 'settlement' || of(arr.locate(lonLatToVec(c.lon, c.lat))) !== C) continue;
      cities.push({ id: ent.id, name: e.nameAt(ent.id, s.time) ?? ent.name, at: [c.lon, c.lat] });
      rank.set(ent.id, cityImportance(placeMetaOf(ent.style), cmd.entityStyle(ent).importance) ?? UNRATED_CITY);
    }
    cities.sort((a, b) => rank.get(b.id)! - rank.get(a.id)! || a.name.localeCompare(b.name));
    if (cities.length < 2) { s.toast(`${name(C)} has ${cities.length ? 'only one city' : 'no cities'} on its land on ${fmt(s.time)}: place two or more (Characters & cities).`, 'error'); return; }
    const chosen = cities.slice(0, Math.min(12, MOST_ZONES)).map((c) => c.id);
    s.set({ dialog: 'zones', zonesDraft: withZones({ country: C, cities, chosen, keep: chosen[0], zones: null, clip: landRings(arr, of, new Set([C])) }) });
    return;
  }
  if (mode === 'advance') {
    const A = s.paintValue;
    if (!A || !w.get('entity', A)) { s.toast('Choose who advances first.', 'error'); return; }
    const B = of(arr.locate(lonLatToVec(ll[0], ll[1])));
    if (!B) { s.toast(`Click the land of the country ${name(A)} advances into.`, 'error'); return; }
    if (B === A) { s.toast(`That is ${name(A)}'s own land: click the land of a neighbour.`, 'error'); return; }
    if (cmd.isLocked(w, B)) { s.toast(`${name(B)} is locked: unlock it to take its land.`, 'error'); return; }
    const line = sharedBorder(arr, of, A, B);
    if (!line.length) { s.toast(`${name(A)} and ${name(B)} share no border on ${fmt(s.time)}.`, 'error'); return; }
    const clip = landRings(arr, of, new Set([B]));
    const r = landWithin(clip, line, km, radiusKm, slowAt);
    if (!r.polygons.length) { s.toast(PROBLEMS[r.problem ?? 'nothing'], 'error'); return; }
    s.set({ pending: { kind: 'paint', spaceId: s.spaceId, layerId: layer.id, rings: [], value: A, sample: ll, origin: ll, snap: 0, give: {
      polygons: r.polygons, onlyFrom: [B], clip,
      label: `${name(A)} advances ${km} km into ${name(B)}`,
      what: `${name(A)} advances ${km} km into ${name(B)} from the border they share${minding}.`,
      eventName: `${name(A)} advances into ${name(B)}`,
    } } });
    return;
  }
  const pair = borderNear(arr, of, ll[0], ll[1], (12 * radiansPerPixel(view) * 180) / Math.PI);
  if (!pair) { s.toast('Click on or beside a border between two countries.', 'error'); return; }
  const [A, B] = pair;
  const locked = pair.find((o) => cmd.isLocked(w, o));
  if (locked) { s.toast(`${name(locked)} is locked: unlock it to make a zone on its land.`, 'error'); return; }
  const to = s.paintValue && w.get('entity', s.paintValue) ? s.paintValue : null;
  const clip = landRings(arr, of, new Set(pair));
  const r = landWithin(clip, sharedBorder(arr, of, A, B), km, radiusKm, slowAt);
  if (!r.polygons.length) { s.toast(PROBLEMS[r.problem ?? 'nothing'], 'error'); return; }
  s.set({ pending: { kind: 'paint', spaceId: s.spaceId, layerId: layer.id, rings: [], value: to, sample: ll, origin: ll, snap: 0, give: {
    polygons: r.polygons, onlyFrom: [A, B], clip,
    label: `A buffer zone along the border of ${name(A)} and ${name(B)}`,
    what: `A buffer zone ${km} km either side of the border of ${name(A)} and ${name(B)}${minding}, to ${to ? name(to) : 'nobody'}.`,
    eventName: `A buffer zone between ${name(A)} and ${name(B)}`,
  } } });
}

/** A draft's zones worked out again for the cities chosen (null with fewer than two), minding the land as the tool asks. */
export function withZones(d: ZonesDraft): ZonesDraft {
  const w = store.world, space = w?.get('map_space', store.spaceId);
  const radiusKm = (space?.radius_m ?? EARTH_RADIUS_KM * 1000) / 1000;
  const at = new Map(d.cities.map((c) => [c.id, c.at]));
  const places = d.chosen.map((id) => at.get(id)).filter((p): p is [number, number] => !!p);
  return { ...d, zones: places.length >= 2 ? zonesOf(d.clip, places, slowness(space, store.reach.mind, radiusKm)) : null };
}

/** Dividing a country's land among its cities (D223): which cities, the zone it keeps, when; the zones on the map meanwhile. */
export function ZonesDialog() {
  const s = useStore();
  const w = s.world!;
  const d = s.zonesDraft;
  const country = d ? w.get('entity', d.country) : null;
  const [when, setWhen] = useWhen(`${country?.name ?? 'The country'} divided among its cities`);
  const close = () => s.set({ dialog: null, zonesDraft: null });
  const ok = !!d && !!country && !!d.zones && d.chosen.length >= 2;
  const confirm = () => {
    if (!d || !country || !d.zones || !s.layerId) return;
    const { mode, newEvent } = modeOf(when, s.time, w);
    const byId = new Map(d.cities.map((c) => [c.id, c]));
    const zones = d.chosen.map((id, k) => ({ owner: id === d.keep ? d.country : { name: byId.get(id)!.name }, polygons: d.zones![k] }));
    const r = s.execute((wd, en) => cmd.divideLand(wd, en, { spaceId: s.spaceId, layerId: s.layerId!, from: d.country, zones, mode, newEvent, label: `${country.name} divided among its cities` }));
    if (r) { close(); s.toast(`${country.name} divided among ${d.chosen.length} cities.`); }
  };
  useKeys(confirm, close);
  const [, force] = useState(0);
  if (!d || !country) return null;
  const set = (patch: Partial<ZonesDraft>) => { s.set({ zonesDraft: withZones({ ...d, ...patch }) }); force((n) => n + 1); };
  const toggle = (id: string, on: boolean) => {
    const chosen = d.cities.map((c) => c.id).filter((x) => (x === id ? on : d.chosen.includes(x))).slice(0, MOST_ZONES);
    set({ chosen, keep: d.keep && chosen.includes(d.keep) ? d.keep : null });
  };
  return (
    <Frame title={`Divide ${country.name} among its cities`} testId="zones" onClose={close} side>
      <p className="muted">Each city chosen takes the land nearer to it than to any other, by travel through the land{s.reach.mind > 0 ? ', slower over mountains and water' : ''}; the zones are drawn on the map. The zones go to new countries named after their cities{d.keep ? `, but ${country.name} keeps the one round ${d.cities.find((c) => c.id === d.keep)?.name}` : ''}.</p>
      <div className="zone-cities" data-testid="zone-cities">
        {d.cities.map((c) => (
          <label key={c.id} className="check"><input type="checkbox" checked={d.chosen.includes(c.id)} disabled={!d.chosen.includes(c.id) && d.chosen.length >= MOST_ZONES} onChange={(ev) => toggle(c.id, ev.target.checked)} data-testid="zone-city" data-name={c.name} /> {c.name}</label>
        ))}
      </div>
      <label>{country.name} keeps the zone round
        <select value={d.keep ?? ''} onChange={(ev) => set({ keep: ev.target.value || null })} data-testid="zones-keep">
          <option value="">None: all of it divided</option>
          {d.chosen.map((id) => <option key={id} value={id}>{d.cities.find((c) => c.id === id)?.name}</option>)}
        </select>
      </label>
      {!d.zones && <p className="muted" data-testid="zones-none">Choose two cities or more.</p>}
      <h4>When</h4>
      <WhenChooser when={when} setWhen={setWhen} />
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" disabled={!ok} onClick={confirm} data-testid="confirm-zones">Divide <span className="key">Enter</span></button></div>
    </Frame>
  );
}
