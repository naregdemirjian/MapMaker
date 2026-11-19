import { useEffect, useRef, useState } from 'react';
import { useStore, store, type PendingEdit } from '../store.ts';
import { Api, type VersionInfo, type BackupInfo, type ProjectInfo } from '../api.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, compare, fromStore, gregorian, PRESENT_YEAR } from '../../core-time/index.ts';
import { BASE_EVENT_ID } from '../../world-model/schema.ts';
import type { TransitionSpec } from '../../temporal-engine/engine.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { DateField, fmt } from './Panels.tsx';
import { loadDatasetRecords, type DatasetRecord } from '../../render-engine/basemap.ts';
import { GroupChecks } from './EventGroups.tsx';
import { FeaturePrompt } from './Features.tsx';
import { TypeDot, TypeSelect } from './EventTypes.tsx';
import { SplitPrompt } from './SplitMerge.tsx';
import { placementMode } from './Characters.tsx';
import { defaultEnd, typeSettings, type Spread } from '../../domain/event-types.ts';
import { PLANET_PRESETS, planetParamsOf, type PlanetParams, type PlanetPreset } from '../../terrain/planet.ts';
import { planetPreview } from '../../terrain/planet-preview.ts';
import { spaceCamera } from '../../space/space-view.ts';

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="close" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  );
}

export function EditPrompt() {
  const s = useStore();
  const p = s.pending;
  if (!p) return null;
  return p.kind === 'paint' ? <PaintPrompt p={p} /> : p.kind === 'feature' ? <FeaturePrompt p={p} /> : p.kind === 'split' ? <SplitPrompt p={p} /> : <VertexPrompt p={p} />;
}

function PaintPrompt({ p }: { p: Extract<PendingEdit, { kind: 'paint' }> }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const who = p.value ? w.get('entity', p.value)?.name ?? 'someone' : 'nobody';
  // A correction is the most common meaning, so it is chosen; Enter applies.
  const [choice, setChoice] = useState<'new' | 'correct'>('correct');
  // A new change goes into an existing event when there is an obvious one: the event the last drawing
  // went into, the selected event, or an event starting at the date being viewed.
  const [target, setTarget] = useState<string>(() => {
    const ok = (id: string | null | undefined) => !!id && id !== BASE_EVENT_ID && !!w.get('event', id);
    if (ok(s.lastPaintEvent)) return s.lastPaintEvent!;
    if (s.selection?.kind === 'event' && ok(s.selection.id)) return s.selection.id;
    const now = w.all('event').find((x) => x.id !== BASE_EVENT_ID && compare(fromStore(x.start_day, x.start_ms), s.time) === 0);
    return now?.id ?? 'new-event';
  });
  const [evName, setEvName] = useState(p.value ? `${who} gains territory` : 'Territory abandoned');
  // A new event's type, and what follows from it until chosen by hand: its length and how its territory spreads (D75).
  const [evType, setEvType] = useState(p.value ? 'conquest' : 'general');
  const [end, setEnd] = useState<Instant | null>(() => defaultEnd(w, p.value ? 'conquest' : 'general', s.time));
  const [endTyped, setEndTyped] = useState(false);
  const typeOf = (t: string) => (t === 'new-event' ? evType : w.get('event', t)?.type_id ?? 'general');
  const [style, setStyle] = useState<Spread>(() => typeSettings(w.get('event_type', typeOf(target))).spread ?? 'instant');
  const [styleChosen, setStyleChosen] = useState(false);
  const typeChanged = (tgt: string, ty: string) => {
    const id = tgt === 'new-event' ? ty : typeOf(tgt);
    if (!styleChosen) setStyle(typeSettings(w.get('event_type', id)).spread ?? 'instant');
    if (tgt === 'new-event' && !endTyped) setEnd(defaultEnd(w, ty, s.time));
  };
  const events = w.all('event').filter((x) => x.id !== BASE_EVENT_ID).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms);

  let periodTo = 'the end of time';
  let lasts = 'Nothing later changes this area yet, so the change lasts until you record a later one.';
  if (p.sample) {
    const face = w.arrangement(p.spaceId).locate(lonLatToVec(p.sample[0], p.sample[1]));
    const next = e.nextChange(p.spaceId, p.layerId, [face], s.time);
    if (next) {
      periodTo = fmt(next);
      const nextEvent = w.get('event', e.latest(p.spaceId, p.layerId, face, next)?.eventId ?? '');
      lasts = `It lasts until ${fmt(next)}${nextEvent ? `, when “${nextEvent.name}” changes it` : ''}.`;
    }
  }
  const close = () => s.set({ pending: null });
  const confirm = () => {
    const transition: TransitionSpec | null = style === 'instant' ? null
      : style === 'border' ? { style: 'border', easing: 'smooth' }
      : style === 'advance' ? { style: 'advance', origin: p.origin, easing: 'smooth' }
      : style === 'dissolve' ? { style: 'dissolve', easing: 'smooth' } : { style: 'fade' };
    const base = { spaceId: p.spaceId, layerId: p.layerId, rings: p.rings, value: p.value, snap: p.snap };
    if (choice === 'correct') {
      // From the date being viewed on, without an event (earlier dates stay as they are).
      s.execute((wd, en) => cmd.paintTerritory(wd, en, { ...base, mode: { kind: 'change', t: s.time } }));
    } else if (target === 'new-event') {
      if (end && compare(end, s.time) < 0) { s.toast('The event cannot end before it starts.', 'error'); return; }
      const r = s.execute((wd, en) => cmd.paintWithNewEvent(wd, en, { name: evName, start: s.time, end, type_id: evType }, { ...base, transition: end ? transition : null }));
      if (r) s.set({ selection: { kind: 'event', id: r.eventId }, lastPaintEvent: r.eventId });
    } else {
      const ev = w.get('event', target)!;
      const start = fromStore(ev.start_day, ev.start_ms);
      const at = compare(s.time, start) > 0 ? s.time : null;
      s.execute((wd, en) => cmd.paintTerritory(wd, en, { ...base, mode: { kind: 'new', eventId: target, at }, transition: ev.end_day !== null ? transition : null }));
      s.set({ lastPaintEvent: target });
    }
    // A border-pen draft is done once it has been applied.
    if (p.draftId && !s.offline) s.discardDraft(p.draftId);
    close();
  };
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
      if (ev.key !== 'Enter' || ev.shiftKey) return;
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      ev.preventDefault();
      confirm();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (
    <Modal title={`What does this drawing mean?`} onClose={close}>
      <p className="muted">You drew an area for <b>{who}</b> while looking at <b>{fmt(s.time, 'minute')}</b>.</p>
      <div className={`choice ${choice === 'new' ? 'on' : ''}`} onClick={() => setChoice('new')} data-testid="choice-new">
        <b>A new change from {fmt(s.time)}</b>
        <div className="muted" data-testid="new-change-lasts">History before this date stays as it is. {lasts}</div>
        {choice === 'new' && (
          <div className="choice-body" onClick={(ev) => ev.stopPropagation()}>
            <label>Event
              <select value={target} onChange={(ev) => { setTarget(ev.target.value); typeChanged(ev.target.value, evType); }} data-testid="event-target">
                <option value="new-event">A new event…</option>
                {events.map((x) => <option key={x.id} value={x.id}>{fmt(fromStore(x.start_day, x.start_ms))} · {x.name}</option>)}
              </select>
            </label>
            {target !== 'new-event' && (() => {
              const ev = w.get('event', target);
              if (!ev) return null;
              const later = compare(s.time, fromStore(ev.start_day, ev.start_ms)) > 0;
              return <div className="muted small-note" data-testid="same-event-note">{later
                ? `Added to “${ev.name}” on ${fmt(s.time)}: in shots, the current events box shows it again then, as if it happened anew.`
                : `Added to “${ev.name}” at its start.`}</div>;
            })()}
            {target === 'new-event' && <>
              <label>Event name<input value={evName} onChange={(ev) => setEvName(ev.target.value)} data-testid="new-event-name" /></label>
              <label>Type<span className="row-inline"><TypeDot typeId={evType} /><TypeSelect value={evType} onChange={(t) => { setEvType(t); typeChanged('new-event', t); }} testId="new-event-type" /></span></label>
              <label>Ends (optional, for animated changes)<DateField value={end} allowEmpty suggest={s.time} onChange={(t) => { setEnd(t); setEndTyped(true); }} testId="new-event-end" /></label>
            </>}
            {(target !== 'new-event' ? w.get('event', target)?.end_day !== null : !!end) && (
              <label>How it spreads
                <select value={style} onChange={(ev) => { setStyle(ev.target.value as typeof style); setStyleChosen(true); }} data-testid="spread-style">
                  <option value="instant">At once</option>
                  <option value="border">Advancing front, through the land from the country's existing border</option>
                  <option value="advance">Expansion, from where you started drawing</option>
                  <option value="dissolve">Dissolve, changing hands in patches</option>
                  <option value="fade">Fade over the event's duration</option>
                </select>
              </label>
            )}
          </div>
        )}
      </div>
      <div className={`choice ${choice === 'correct' ? 'on' : ''}`} onClick={() => setChoice('correct')} data-testid="choice-correct">
        <b>Correct this period ({fmt(s.time)} – {periodTo})</b>
        <div className="muted" data-testid="correct-explained">Changes the map from {fmt(s.time)} on, without making an event; earlier dates stay as they are. {lasts}</div>
      </div>
      <div className="muted small-note">Correcting a border's shape for all time is done by dragging its points with the Border points tool.</div>
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={confirm} data-testid="confirm-edit">Apply <span className="key">Enter</span></button></div>
    </Modal>
  );
}

function VertexPrompt({ p }: { p: Extract<PendingEdit, { kind: 'vertex' }> }) {
  const s = useStore();
  const close = () => s.set({ pending: null });
  // From a date when an event is being recorded or when a move for all time is not possible; else for all time (D77).
  const [choice, setChoice] = useState<'all' | 'dated'>(s.recordEventId || p.blocked ? 'dated' : 'all');
  const rec = s.recordEventId ? s.world!.get('event', s.recordEventId) : null;
  const confirm = () => {
    if (choice === 'all') {
      if (p.blocked) { s.toast(p.blocked, 'error'); return; }
      s.execute((w, en) => cmd.moveVertex(w, { spaceId: p.spaceId, vertexId: p.vertexId, to: p.to, snap: 1e-9, guard: p.layerId ? { engine: en, layerId: p.layerId, t: s.time } : undefined }));
    } else {
      if (!p.layerId) { s.toast('This map has no political layer.', 'error'); return; }
      const r = s.execute((w, e) => cmd.moveBorderFrom(w, e, { spaceId: p.spaceId, layerId: p.layerId!, vertexId: p.vertexId, to: p.to, t: s.time, mode: placementMode(), snap: 1e-9 }));
      if (r === undefined) return;
    }
    close();
  };
  return (
    <Modal title="Move this border point?" onClose={close}>
      <div className={`choice ${choice === 'all' ? 'on' : ''} ${p.blocked ? 'disabled' : ''}`} onClick={() => setChoice('all')} data-testid="vertex-choice-all">
        <b>Correct the border's shape for all time</b>
        <div className="muted">{p.blocked ? `Not possible here: ${p.blocked}` : 'Every date where this border exists shows the new position. Nothing else about history changes.'}</div>
      </div>
      <div className={`choice ${choice === 'dated' ? 'on' : ''}`} onClick={() => setChoice('dated')} data-testid="vertex-choice-dated">
        <b>Move it from {fmt(s.time)} on{rec ? `, in “${rec.name}”` : ''}</b>
        <div className="muted">Before then the border runs as it did; from then on through the new place, and the land between changes hands. For a point on a border between two countries.</div>
      </div>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button className="primary" data-testid="confirm-vertex" onClick={confirm}>{choice === 'all' ? 'Correct for all time' : `Move from ${fmt(s.time)}`}</button>
      </div>
    </Modal>
  );
}

const WORLD_PRESETS = [
  { name: 'Earth', km: 6371.0088 }, { name: 'Moon', km: 1737.4 }, { name: 'Mars', km: 3389.5 }, { name: 'Mercury', km: 2439.7 },
  { name: 'Venus', km: 6051.8 }, { name: 'Ganymede', km: 2634.1 }, { name: 'Titan', km: 2574.7 },
];

export function NewWorldDialog() {
  const s = useStore();
  const [name, setName] = useState('');
  const [km, setKm] = useState('6371');
  const [earth, setEarth] = useState(false);
  const [kind, setKind] = useState<'round' | 'paleo' | 'planet' | 'flat' | 'stars' | 'solar' | 'invented' | 'milkyway' | 'galaxy'>('round');
  const [inv, setInv] = useState({ seed: newSeed(), count: 300, radiusLy: 50, shape: 'sphere' as 'sphere' | 'disc' });
  const [gal, setGal] = useState({ seed: newSeed(), systems: 600, arms: 4, pitch: 14, radiusLy: 50000, bar: true });
  const flat = kind === 'flat';
  const [widthKm, setWidthKm] = useState('20');
  const [planet, setPlanet] = useState<PlanetParams>(() => planetParamsOf({ seed: newSeed(), preset: 'earthlike' })!);
  const close = () => s.set({ dialog: null });
  const create = () => {
    const id = kind === 'milkyway' || kind === 'galaxy'
      ? s.execute((w) => cmd.createSpaceMap(w, name.trim() || (kind === 'milkyway' ? 'The Milky Way' : 'A galaxy'), 'galaxy', undefined, { ...gal, kind: kind === 'milkyway' ? 'milkyway' : 'invented', seed: kind === 'milkyway' ? 1 : gal.seed }))
      : kind === 'stars' || kind === 'solar' || kind === 'invented'
      ? s.execute((w) => cmd.createSpaceMap(w, name.trim() || (kind === 'solar' ? 'The solar system' : kind === 'invented' ? 'Invented stars' : 'Nearby stars'), kind === 'stars' ? 'nearby' : kind, kind === 'invented' ? inv : undefined))
      : flat
      ? s.execute((w) => cmd.createFlatMap(w, name.trim() || 'New flat map', Number(widthKm)))
      : kind === 'paleo'
      ? s.execute((w) => cmd.createPaleoEarth(w, name.trim() || 'The Earth through time'))
      : kind === 'planet'
        ? s.execute((w) => cmd.createPlanet(w, name.trim() || 'New planet', Number(km), planet))
        : s.execute((w) => cmd.createWorld(w, name.trim() || 'New map', Number(km), earth ? 'natural-earth' : 'none'));
    if (id) {
      const space = kind === 'stars' || kind === 'solar' || kind === 'invented' || kind === 'milkyway' || kind === 'galaxy';
      s.set({ spaceId: id, layerId: s.world!.all('layer').find((l) => l.space_id === id)?.id ?? '', selection: null, ...(space ? { tool: 'select' as const } : {}) });
      // A map of space opens looking down at its plane at an angle, all of it in view.
      if (space) s.setCamera(spaceCamera());
      // The Earth through geological time (D134): its timeline from 540 million years ago to today, at Pangaea.
      if (kind === 'paleo') { s.fitTimeline(); s.setTime(gregorian.fromCivil({ year: PRESENT_YEAR - 250_000_000 })); }
      close();
    }
  };
  return (
    <Modal title="New map" onClose={close} wide={kind === 'planet'}>
      <p className="muted">Each map has its own geography, layers and territorial history; events and countries are shared by the whole project.</p>
      <div className="choice-row">
        <label className="check"><input type="radio" name="map-kind" checked={kind === 'round'} onChange={() => setKind('round')} /> Round: a planet or moon (Earth, another real body, or a blank one of your own)</label>
        <label className="check"><input type="radio" name="map-kind" checked={kind === 'paleo'} onChange={() => setKind('paleo')} data-testid="new-map-paleo" /> The Earth through geological time: its continents, seas and mountains as they were, from 540 million years ago to today</label>
        <label className="check"><input type="radio" name="map-kind" checked={kind === 'planet'} onChange={() => setKind('planet')} data-testid="new-map-planet" /> A planet of your own, generated: continents, seas and mountains from a seed</label>
        <label className="check"><input type="radio" name="map-kind" checked={flat} onChange={() => setKind('flat')} data-testid="new-map-flat" /> Flat: a city, a battlefield, a region (a plan, true to scale)</label>
        <label className="check"><input type="radio" name="map-kind" checked={kind === 'stars'} onChange={() => setKind('stars')} data-testid="new-map-stars" /> The stars around the Sun: every known star within 50 light-years, in three dimensions</label>
        <label className="check"><input type="radio" name="map-kind" checked={kind === 'solar'} onChange={() => setKind('solar')} data-testid="new-map-solar" /> The solar system: the Sun and the planets where they are on the date viewed</label>
        <label className="check"><input type="radio" name="map-kind" checked={kind === 'invented'} onChange={() => setKind('invented')} data-testid="new-map-invented" /> Stars of your own: an invented star map, made from a seed</label>
        <label className="check"><input type="radio" name="map-kind" checked={kind === 'milkyway'} onChange={() => setKind('milkyway')} data-testid="new-map-milkyway" /> The Milky Way: the whole galaxy, its arms and best-known places, with star systems to hold</label>
        <label className="check"><input type="radio" name="map-kind" checked={kind === 'galaxy'} onChange={() => setKind('galaxy')} data-testid="new-map-galaxy" /> A galaxy of your own: spiral arms and star systems, made from a seed</label>
      </div>
      <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={flat ? 'e.g. Old Town' : kind === 'stars' ? 'e.g. Nearby stars' : kind === 'solar' ? 'e.g. The solar system' : kind === 'invented' ? 'e.g. The Veyran Reach' : kind === 'milkyway' ? 'e.g. The Milky Way' : kind === 'galaxy' ? 'e.g. The Far Spiral' : 'e.g. Aster Prime'} data-testid="new-map-name" /></label>
      {kind === 'milkyway' || kind === 'galaxy' ? <>
        <div className="two">
          <label>Star systems<input type="number" min={0} max={5000} value={gal.systems} onChange={(e) => setGal({ ...gal, systems: Math.max(0, Math.min(5000, Number(e.target.value) || 0)) })} data-testid="new-map-galaxy-systems" /></label>
          {kind === 'galaxy' && <>
            <label>Arms<input type="number" min={1} max={8} value={gal.arms} onChange={(e) => setGal({ ...gal, arms: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} data-testid="new-map-galaxy-arms" /></label>
            <label>Winding (degrees)<input type="number" min={4} max={40} value={gal.pitch} onChange={(e) => setGal({ ...gal, pitch: Math.max(4, Math.min(40, Number(e.target.value) || 4)) })} title="How far the arms open out: small, tightly wound; large, open" /></label>
            <label>Radius (light-years)<input type="number" min={1000} max={500000} step={1000} value={gal.radiusLy} onChange={(e) => setGal({ ...gal, radiusLy: Math.max(1000, Math.min(500000, Number(e.target.value) || 1000)) })} /></label>
            <label>Seed<input type="number" min={1} value={gal.seed} onChange={(e) => setGal({ ...gal, seed: Math.max(1, Math.round(Number(e.target.value) || 1)) })} data-testid="new-map-galaxy-seed" /></label>
            <label className="check"><input type="checkbox" checked={gal.bar} onChange={(e) => setGal({ ...gal, bar: e.target.checked })} /> A bar across the middle</label>
          </>}
        </div>
        <p className="muted" data-testid="new-map-galaxy-note">{kind === 'milkyway'
          ? 'Its arms as mapped by radio astronomers, the Sun where it is, and 33 places (nebulae, clusters, remnants, notable stars, the black hole at the middle, the Magellanic Clouds), with star systems of your own along the arms to give to countries and factions and join with lanes.'
          : 'A spiral galaxy made from the seed, with a home system half way out and star systems along its arms to give to countries and factions and join with lanes.'}</p>
      </> : kind === 'invented' ? <>
        <div className="two">
          <label>Stars<input type="number" min={2} max={3000} value={inv.count} onChange={(e) => setInv({ ...inv, count: Math.max(2, Math.min(3000, Number(e.target.value) || 2)) })} data-testid="new-map-invented-count" /></label>
          <label>Reaching (light-years)<input type="number" min={5} max={5000} value={inv.radiusLy} onChange={(e) => setInv({ ...inv, radiusLy: Math.max(5, Math.min(5000, Number(e.target.value) || 5)) })} data-testid="new-map-invented-radius" /></label>
          <label>Seed<input type="number" min={1} value={inv.seed} onChange={(e) => setInv({ ...inv, seed: Math.max(1, Math.round(Number(e.target.value) || 1)) })} data-testid="new-map-invented-seed" /></label>
          <label>Shape<select value={inv.shape} onChange={(e) => setInv({ ...inv, shape: e.target.value as 'sphere' | 'disc' })}><option value="sphere">A sphere round the home star</option><option value="disc">A flat disc</option></select></label>
        </div>
        <p className="muted" data-testid="new-map-invented-note">Stars round a home star, most of them red dwarfs as around the Sun, with names of their own (the faintest numbered). The same seed gives the same stars; held stars and lanes work as on the real map.</p>
      </> : kind === 'paleo' ? <p className="muted" data-testid="new-map-paleo-note">The Earth's land and sea floor at 109 moments from 540 million years ago to today (the PALEOMAP PaleoDEMs of C. R. Scotese and N. Wright, 2018), changing steadily between them: Pangaea coming together and breaking up, oceans opening and closing, mountains rising; over the last 128,000 years the seas of the ice ages (land bridges where the sea was lower). Coasts are where the land meets the sea of each moment. Dates before 10,000 BCE are written as how long ago they were: type "250 Ma" or "21,000 years ago".</p> : kind === 'solar' ? <p className="muted" data-testid="new-map-solar-note">The planets and Pluto on their orbits, where they are on any date from their orbital elements (JPL): they move as the date changes. Give them to countries and factions, join them with lanes, as on a star map.</p> : kind === 'stars' ? <p className="muted" data-testid="new-map-stars-note">982 stars from the HYG database: real positions, colours by type, names. Drag to turn the view, scroll to zoom, click a star to see what it is.</p> : flat ? <>
        <label>Width (km)<input type="number" min={0.01} max={5000} value={widthKm} onChange={(e) => setWidthKm(e.target.value)} data-testid="new-map-width" /></label>
        <p className="muted">Borders on a flat map are straight lines; the scale bar reads in metres and kilometres.</p>
      </> : <>
        <label>Radius (km)<input type="number" value={km} onChange={(e) => setKm(e.target.value)} data-testid="new-map-radius" /></label>
        {kind === 'round' && <>
          <div className="presets">{WORLD_PRESETS.map((p) => <button key={p.name} className="small" onClick={() => { setName(p.name); setKm(String(p.km)); setEarth(p.name === 'Earth'); }}>{p.name}</button>)}</div>
          <label className="check"><input type="checkbox" checked={earth} onChange={(e) => setEarth(e.target.checked)} data-testid="new-world-earth" /> Start with Earth's geography (land, lakes and coastlines)</label>
        </>}
        {kind === 'planet' && <PlanetChooser value={planet} onChange={setPlanet} />}
      </>}
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={create} data-testid="new-map-create">Create map</button></div>
    </Modal>
  );
}

/** A seed for a new planet: any whole number from 1 to 999,999. */
const newSeed = () => 1 + Math.floor(Math.random() * 999_999);

/** The settings of a generated planet (D97), with a picture of it that follows them. */
export function PlanetChooser({ value, onChange }: { value: PlanetParams; onChange: (p: PlanetParams) => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const set = (patch: Partial<PlanetParams>) => onChange(planetParamsOf({ ...value, ...patch })!);
  const choose = (preset: PlanetPreset) => onChange(planetParamsOf({ ...PLANET_PRESETS[preset].params, seed: value.seed, preset })!);
  // The picture is made a moment after the settings stop changing (it takes a few tens of milliseconds).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const c = canvas.current;
      if (!c) return;
      const px = planetPreview(value, c.width);
      c.getContext('2d')!.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0);
      c.dataset.planet = `${value.preset}:${value.seed}`;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [value.seed, value.preset, value.sea, value.continents, value.mountains, value.roughness, value.ice]);
  const gas = value.preset === 'gas';
  const slider = (key: 'sea' | 'mountains' | 'roughness' | 'ice', label: string, max: number) => (
    <label className="range-row planet-slider">{label}: <b>{Math.round(value[key] * 100)}%</b>
      <input type="range" min={0} max={max * 100} step={1} value={Math.round(value[key] * 100)} onChange={(e) => set({ [key]: Number(e.target.value) / 100 })} data-testid={`planet-${key}`} />
    </label>
  );
  return (
    <div className="planet-chooser" data-testid="planet-chooser">
      <div className="presets">
        {(Object.keys(PLANET_PRESETS) as PlanetPreset[]).map((p) => (
          <button key={p} className={`small ${value.preset === p ? 'on' : ''}`} title={PLANET_PRESETS[p].about} onClick={() => choose(p)} data-testid={`planet-preset-${p}`}>{PLANET_PRESETS[p].name}</button>
        ))}
      </div>
      <canvas ref={canvas} width={360} height={180} className="planet-preview" data-testid="planet-preview" />
      <div className="planet-seed">
        <label>Seed<input type="number" min={1} value={value.seed} onChange={(e) => Number.isFinite(Number(e.target.value)) && set({ seed: Number(e.target.value) })} data-testid="planet-seed" /></label>
        <button onClick={() => set({ seed: newSeed() })} data-testid="planet-another" title="Another planet with these settings">Another</button>
        <span className="muted">The same seed and settings always make the same planet.</span>
      </div>
      {!gas && <>
        {slider('sea', 'Sea', 0.98)}
        <label className="range-row planet-slider">Continents: <b>{value.continents}</b>
          <input type="range" min={1} max={12} step={1} value={value.continents} onChange={(e) => set({ continents: Number(e.target.value) })} data-testid="planet-continents" />
        </label>
        {slider('mountains', 'Mountains', 2)}
        {slider('ice', 'Ice caps', 1)}
      </>}
      {slider('roughness', gas ? 'Turbulence' : 'Roughness', 1)}
    </div>
  );
}

export function DataSourcesDialog() {
  const s = useStore();
  const [records, setRecords] = useState<DatasetRecord[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { loadDatasetRecords().then(setRecords, (e: Error) => setError(e.message)); }, []);
  const close = () => s.set({ dialog: null });
  return (
    <Modal title="Data sources" onClose={close} wide>
      <p className="muted">Real-world data that Map Maker ships with. Each export lists the credit lines for the data it shows in its manifest and compositing guide.</p>
      {error && <p className="error">{error}</p>}
      {!records && !error && <p className="muted">Loading…</p>}
      {records?.map((d) => (
        <div key={d.id} className="dataset" data-testid={`dataset-${d.id}`}>
          <h4>{d.name} <span className="muted">{d.version}</span></h4>
          <table className="kv"><tbody>
            <tr><th>Used for</th><td>{d.usedFor}</td></tr>
            <tr><th>Licence</th><td>{d.licence}</td></tr>
            <tr><th>Credit line</th><td>{d.credit}</td></tr>
            <tr><th>Source</th><td>{d.source}</td></tr>
            <tr><th>Retrieved</th><td>{d.retrieved}{d.converted ? ` · ${d.converted}` : ''}</td></tr>
          </tbody></table>
        </div>
      ))}
      <div className="modal-actions"><button className="primary" onClick={close}>Close</button></div>
    </Modal>
  );
}

export function NewEventDialog() {
  const s = useStore();
  const w = s.world!;
  const [name, setName] = useState('');
  const [type, setType] = useState('general');
  const [start, setStart] = useState<Instant | null>(s.time);
  const [end, setEnd] = useState<Instant | null>(null);
  // Until an end is typed in, it follows the type's usual length (D75).
  const [endTyped, setEndTyped] = useState(false);
  const follow = (t: string, st: Instant | null) => { if (!endTyped) setEnd(st ? defaultEnd(w, t, st) : null); };
  const [desc, setDesc] = useState('');
  const [record, setRecord] = useState(true);
  // A new event joins the groups the timeline is showing, so it does not disappear from view.
  const [groups, setGroups] = useState<string[]>(() => (s.eventFilter ?? []).filter((g) => g !== cmd.UNGROUPED));
  const close = () => s.set({ dialog: null });
  const create = () => {
    if (!start) { s.toast('Give the event a start date.', 'error'); return; }
    const id = s.execute((wd) => cmd.createEvent(wd, { name, type_id: type, start, end, description: desc, groups }));
    if (id) { s.set({ selection: { kind: 'event', id }, time: start, recordEventId: record ? id : s.recordEventId, tool: record && s.tool === 'select' ? 'lasso' : s.tool }); close(); }
  };
  return (
    <Modal title="New event" onClose={close}>
      <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fall of the Northern March" data-testid="event-name" /></label>
      <label>Type<span className="row-inline"><TypeDot typeId={type} /><TypeSelect value={type} onChange={(t) => { setType(t); follow(t, start); }} testId="event-type" /></span></label>
      <label>Starts<DateField value={start} onChange={(t) => { setStart(t); follow(type, t); }} testId="event-start" /></label>
      <label>Ends (optional)<DateField value={end} allowEmpty suggest={start} onChange={(t) => { setEnd(t); setEndTyped(true); }} testId="event-end" /></label>
      <label>Description<textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      {w.all('event_group').length > 0 && <><h4>Groups</h4><GroupChecks value={groups} onChange={setGroups} /></>}
      <label className="check"><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} /> Record what I draw next into this event</label>
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={create} data-testid="event-create">Create event</button></div>
    </Modal>
  );
}

export function VersionsDialog() {
  const s = useStore();
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [label, setLabel] = useState('');
  const close = () => s.set({ dialog: null });
  const refresh = async () => {
    if (!s.projectId) return;
    setVersions(await Api.versions(s.projectId));
    setBackups(await Api.backups(s.projectId));
  };
  useEffect(() => { void refresh(); }, []);
  const save = async () => {
    await s.flush();
    await Api.createVersion(s.projectId!, label.trim() || `Version of ${new Date().toLocaleString()}`);
    setLabel('');
    s.toast('Version saved.');
    await refresh();
  };
  const applyRestore = async (what: string, call: () => Promise<{ diffs: Parameters<NonNullable<typeof s.world>['applyDiffs']>[0]; journal: typeof s.journal }>) => {
    if (!confirm(`Restore ${what}? This is added as a new step, so you can undo it.`)) return;
    await s.flush();
    try {
      const r = await call();
      s.world!.applyDiffs(r.diffs);
      s.journal = r.journal;
      s.validateSelection();
      s.toast(`Restored ${what}.`);
    } catch (e) {
      s.toast(`Could not restore ${what}: ${(e as Error).message}`, 'error');
      await s.reloadFromDisk();
    }
    s.notify();
    await refresh();
  };
  const restore = (v: VersionInfo) => applyRestore(`"${v.label}"`, () => Api.restoreVersion(s.projectId!, v.id));
  const restoreBackup = (b: BackupInfo) => applyRestore(`the backup from ${new Date(b.created_at).toLocaleString()}`, () => Api.restoreBackup(s.projectId!, b.file.split(/[\\/]/).pop()!));
  return (
    <Modal title="Versions and backups" onClose={close} wide>
      <p className="muted">Everything is saved automatically as you work. A version is a named restore point you can return to at any time.</p>
      <div className="row-form">
        <input value={label} placeholder="Version name, e.g. Before rewriting the war" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <button className="primary" onClick={save}>Save version</button>
      </div>
      <h4>Versions</h4>
      <div className="list">{versions.map((v) => <div key={v.id} className="row"><span>{v.label}</span><span className="muted"> · {new Date(v.created_at).toLocaleString()}</span><button className="small" onClick={() => restore(v)}>Restore</button></div>)}{!versions.length && <div className="muted">No named versions yet.</div>}</div>
      <h4>Automatic backups</h4>
      <p className="muted">Taken automatically every hour while you work and whenever a project is opened. The newest 24 are kept, then one a day for 30 days and one a week for a year.</p>
      <div className="list">{backups.map((b) => <div key={b.file} className="row"><span>{new Date(b.created_at).toLocaleString()}</span><span className="muted"> · {(b.bytes / 1024).toFixed(0)} KB</span><button className="small" onClick={() => restoreBackup(b)}>Restore</button></div>)}{!backups.length && <div className="muted">No backups yet.</div>}</div>
      <div className="modal-actions">
        <button onClick={async () => { await Api.backupNow(s.projectId!); await refresh(); s.toast('Backup written.'); }}>Back up now</button>
        <button onClick={() => Api.showFolder(s.projectId!, 'project')}>Show project folder</button>
        <button onClick={close}>Close</button>
      </div>
    </Modal>
  );
}

export function HealthDialog() {
  const s = useStore();
  const w = s.world!;
  s.engine!.ensure();
  const conflicts = s.engine!.conflicts;
  const close = () => s.set({ dialog: null });
  const goto = (eventId: string) => {
    const ev = w.get('event', eventId);
    if (ev) s.set({ selection: { kind: 'event', id: eventId }, time: eventId === BASE_EVENT_ID ? s.time : fromStore(ev.start_day, ev.start_ms), dialog: null });
  };
  const kinds: Record<string, string> = { stale: 'Worked out from older history', simultaneous: 'Same place, same moment', overlap: 'Overlapping changes', broken: 'Broken reference' };
  return (
    <Modal title="History Health" onClose={close} wide>
      <p className="muted">Problems in the history are listed here and never fixed silently. You decide what happens.</p>
      {conflicts.length === 0 && <div className="ok-box">No problems found. History is consistent.</div>}
      {conflicts.some((c) => c.kind === 'broken' && /no longer exists/.test(c.message)) && (
        <div className="conflict broken">
          <div><b>Countries or characters that were deleted are still in history.</b></div>
          <div className="muted">Their land is shown as nobody's. Removing them gives it back to whoever held it before.</div>
          <div className="buttons"><button onClick={() => s.execute((wd) => cmd.purgeDeletedOwners(wd))} data-testid="purge-deleted">Remove them from history</button></div>
        </div>
      )}
      {conflicts.map((c, i) => (
        <div key={i} className={`conflict ${c.kind}`} data-testid={`conflict-${c.kind}`}>
          <div><b>{kinds[c.kind]}</b> · {w.get('event', c.eventId)?.name ?? 'unknown event'}</div>
          <div className="muted">{c.message}</div>
          <div className="buttons">
            {c.kind === 'stale' && <>
              <button onClick={() => s.execute((wd, en) => cmd.keepAsStored(wd, en, c.effectId))} data-testid="keep-stored">Keep as stored</button>
              <button onClick={() => s.execute((wd, en) => cmd.reapplyIntent(wd, en, c.effectId))} data-testid="reapply">Re-apply intention</button>
            </>}
            <button onClick={() => goto(c.eventId)}>Show event</button>
            {c.otherEventId && <button onClick={() => goto(c.otherEventId!)}>Show other event</button>}
          </div>
        </div>
      ))}
      <div className="modal-actions"><button onClick={close}>Close</button></div>
    </Modal>
  );
}

export function ProjectPicker() {
  const s = useStore();
  const [name, setName] = useState('');
  const [worldName, setWorldName] = useState('Earth');
  const [km, setKm] = useState('6371.0088');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) { s.toast('Give the project a name.', 'error'); return; }
    setBusy(true);
    try { await s.createProject(name.trim(), worldName.trim() || 'Earth', Number(km) || 6371); } catch (e) { s.toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="picker">
      <div className="picker-card">
        <h1>Map Maker</h1>
        <p className="muted">Historical world-building and map animation for your film. Version {s.appVersion}.</p>
        <h3>Open a project</h3>
        <div className="list">
          {s.projects.map((p: ProjectInfo) => (
            <div key={p.id} className="row project-row" onClick={() => s.openOrRecover(p.id)} data-testid={`project-${p.id}`}>
              <b>{p.name}</b><span className="muted"> · last changed {new Date(p.modified).toLocaleString()}</span>
            </div>
          ))}
          {!s.projects.length && <div className="muted">No projects yet.</div>}
        </div>
        <h3>New project</h3>
        <label>Project name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Long Night" data-testid="project-name" /></label>
        <div className="two">
          <label>First map<input value={worldName} onChange={(e) => setWorldName(e.target.value)} /></label>
          <label>Radius (km)<input type="number" value={km} onChange={(e) => setKm(e.target.value)} /></label>
        </div>
        <button className="primary" disabled={busy} onClick={create} data-testid="project-create">Create project</button>
        <p className="muted small-note">Projects are stored in {s.projectsDir}</p>
      </div>
    </div>
  );
}

/** Shown when a change could not be saved. Editing stays paused until the project is reloaded from disk. */
export function OfflineNotice() {
  const s = useStore();
  const [trying, setTrying] = useState(false);
  if (!s.offline) return null;
  const retry = async () => {
    setTrying(true);
    const ok = await s.reloadFromDisk();
    setTrying(false);
    if (ok) s.toast('Reconnected. The project was reloaded from disk.');
  };
  return (
    <div className="modal-back blocking">
      <div className="modal" role="alertdialog" aria-label="Changes are not being saved" data-testid="offline-notice">
        <div className="modal-head"><h2>Changes are not being saved</h2></div>
        <p>{s.offline}</p>
        <p className="muted">This usually means the black Map Maker window was closed. Start Map Maker again (double-click “Start Map Maker”), then click Reconnect. Everything saved before this point is safe; the change above, and anything after it, will need to be redone.</p>
        <div className="modal-actions"><button className="primary" disabled={trying} onClick={retry} data-testid="reconnect">{trying ? 'Trying…' : 'Reconnect'}</button></div>
      </div>
    </div>
  );
}

export { store };

/** The app's own "type a name" dialog (store.askText). */
export function AskDialog() {
  const s = useStore();
  const a = s.ask;
  const [v, setV] = useState(a?.value ?? '');
  useEffect(() => setV(a?.value ?? ''), [a]);
  if (!a) return null;
  const done = (value: string | null) => { s.set({ ask: null }); a.resolve(value); };
  return (
    <Modal title={a.title} onClose={() => done(null)}>
      <label>{a.label}<input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) done(v.trim()); if (e.key === 'Escape') done(null); }} data-testid="ask-input" /></label>
      <div className="modal-actions"><button onClick={() => done(null)}>Cancel</button><button className="primary" disabled={!v.trim()} onClick={() => done(v.trim())} data-testid="ask-ok">{a.ok}</button></div>
    </Modal>
  );
}
