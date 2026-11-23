// The Advance and buffer zone tool (D222): an advance takes the land of the neighbour clicked within a distance of
// its border with the country chosen; a buffer zone takes the land either side of the border clicked beside, for
// nobody or the owner chosen. The land is measured by travel through it (domain/reach.ts), slower over mountains and
// water as far as asked, then offered like a drawing: the prompt asks whether it is a correction or an event, and
// how it spreads (an advancing front from the border, for a conquest).
import { useStore, store } from '../store.ts';
import { radiansPerPixel, type View } from '../../render-engine/camera.ts';
import { landWithin, landRings, sharedBorder, borderNear, REACH_KM, type ReachProblem, type SlowAt } from '../../domain/reach.ts';
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
        </select>
      </label>
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
      {heights && (
        <label className="inline" title="How much mountains, rough ground and water to cross slow the way: none, the distance as the crow flies over the land; all, a range or a sea holds it up">Minding the land
          <input type="range" min={0} max={1} step={0.05} value={r.mind} onChange={(e) => set({ mind: Number(e.target.value) })} data-testid="reach-mind" />
          <RangeReset def={MIND_DEFAULT} value={r.mind} />
        </label>
      )}
      <span className="muted" data-testid="reach-hint">{r.mode === 'advance'
        ? who ? `Click the land of the country ${who} advances into.` : 'Choose who advances, then click the land of the neighbour.'
        : 'Click on or beside a border between two countries.'}</span>
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
