import { useEffect, useRef, useState } from 'react';
import { useStore, store, type PendingEdit } from '../store.ts';
import { Api, type VersionInfo, type BackupInfo, type ProjectInfo } from '../api.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, compare, fromStore } from '../../core-time/index.ts';
import { isBaseEvent } from '../../world-model/schema.ts';
import { eventsHere, listedHere } from '../events-here.ts';
import type { TransitionSpec } from '../../temporal-engine/engine.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { DateField, fmt } from '../inputs.tsx';
import { loadDatasetRecords, type DatasetRecord } from '../../render-engine/basemap.ts';
import { GroupChecks } from './EventGroups.tsx';
import { FeaturePrompt } from './Features.tsx';
import { TypeDot, TypeSelect } from './EventTypes.tsx';
import { SplitPrompt } from './SplitMerge.tsx';
import { placementMode } from './Characters.tsx';
import { defaultEnd, typeSettings, type Spread } from '../../domain/event-types.ts';
import { PLANET_PRESETS, planetParamsOf, type PlanetParams, type PlanetPreset } from '../../terrain/planet.ts';
import { planetPreview } from '../../terrain/planet-preview.ts';
import { drawsOn } from '../shell/studios.ts';

/** A dialog over the app; `side`: at the right, the map left to be seen (what it asks about is drawn on the map, D222). */
function Modal({ title, children, onClose, wide, side }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; side?: boolean }) {
  return (
    <div className={`modal-back${side ? ' side' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
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
    const ok = (id: string | null | undefined) => { const e = id ? w.get('event', id) : undefined; return !!e && listedHere(e); };
    if (ok(s.lastPaintEvent)) return s.lastPaintEvent!;
    if (s.selection?.kind === 'event' && ok(s.selection.id)) return s.selection.id;
    const now = w.all('event').find((x) => listedHere(x) && compare(fromStore(x.start_day, x.start_ms), s.time) === 0);
    return now?.id ?? 'new-event';
  });
  const [evName, setEvName] = useState(p.give ? p.give.eventName : p.value ? `${who} gains territory` : 'Territory abandoned');
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
  const events = eventsHere();

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
    // Land worked out by the Advance and buffer zone tool (D222): given only from the owners it is taken from.
    const g = p.give;
    if (g) {
      const give = { spaceId: p.spaceId, layerId: p.layerId, polygons: g.polygons, value: p.value, onlyFrom: g.onlyFrom, label: g.label };
      if (choice === 'correct') s.execute((wd, en) => cmd.giveLand(wd, en, { ...give, mode: { kind: 'change', t: s.time } }));
      else if (target === 'new-event') {
        if (end && compare(end, s.time) < 0) { s.toast('The event cannot end before it starts.', 'error'); return; }
        const r = s.execute((wd, en) => cmd.giveLand(wd, en, { ...give, mode: { kind: 'change', t: s.time }, newEvent: { name: evName, start: s.time, end, type_id: evType }, transition: end ? transition : null }));
        if (r?.eventId) s.set({ selection: { kind: 'event', id: r.eventId }, lastPaintEvent: r.eventId });
      } else {
        const ev = w.get('event', target)!;
        const start = fromStore(ev.start_day, ev.start_ms);
        const at = compare(s.time, start) > 0 ? s.time : null;
        s.execute((wd, en) => cmd.giveLand(wd, en, { ...give, mode: { kind: 'new', eventId: target, at }, transition: ev.end_day !== null ? transition : null }));
        s.set({ lastPaintEvent: target });
      }
      close();
      return;
    }
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
      // Enter or Space applies (Space only while not typing in a field).
      const tag = (ev.target as HTMLElement)?.tagName;
      const space = ev.key === ' ' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT';
      if (!space && (ev.key !== 'Enter' || ev.shiftKey)) return;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      ev.preventDefault();
      confirm();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (
    <Modal title={p.give ? 'What does this change mean?' : 'What does this drawing mean?'} onClose={close} side={!!p.give}>
      {p.give
        ? <p className="muted" data-testid="reach-what">{p.give.what} Looking at <b>{fmt(s.time, 'minute')}</b>.</p>
        : <p className="muted">You drew an area for <b>{who}</b> while looking at <b>{fmt(s.time, 'minute')}</b>.</p>}
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
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={confirm} data-testid="confirm-edit">Apply <span className="key">Enter</span> <span className="key">Space</span></button></div>
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

/** A seed for a new planet: any whole number from 1 to 999,999. */
export const newSeed = () => 1 + Math.floor(Math.random() * 999_999);

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
  // (Recorded into as it is made where there is drawing; in the Timeline studio it is planned first, D243.)
  const [record, setRecord] = useState(() => drawsOn(s.pageNow()));
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
    if (ev) s.set({ selection: { kind: 'event', id: eventId }, time: isBaseEvent(eventId) ? s.time : fromStore(ev.start_day, ev.start_ms), dialog: null });
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
      <h3>Upkeep</h3>
      <div className="conflict upkeep" data-testid="tidy-section">
        <div><b>Tidy unused borders</b>{(() => { const space = w.get('map_space', s.spaceId); return space ? <> · {space.name}</> : null; })()}</div>
        <div className="muted">Every border ever drawn stays in the map's parcels, also when the change that drew it was deleted or drawn over. Those that no change tells apart on either side are taken away, so the map stays quick on long projects. History stays exactly as it is, in every branch and every version of an event; undo brings them back.</div>
        <div className="buttons"><button onClick={() => {
          const r = s.execute((wd) => cmd.tidyParcels(wd, s.spaceId));
          if (r) s.toast(r.borders ? `Took away ${r.borders} unused border section${r.borders === 1 ? '' : 's'}: ${r.parcels} parcel${r.parcels === 1 ? '' : 's'} made whole again. History is unchanged.` : 'Nothing to tidy: every border is one some change tells apart.');
        }} data-testid="tidy-parcels">Tidy this map</button></div>
      </div>
      <div className="modal-actions"><button onClick={close}>Close</button></div>
    </Modal>
  );
}

export function ProjectPicker() {
  const s = useStore();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [examples, setExamples] = useState<Array<{ id: string; name: string; about: string }>>([]);
  const [building, setBuilding] = useState('');
  useEffect(() => { Api.examples().then(setExamples).catch(() => setExamples([])); }, []);
  // An example (D171) is built into the projects folder by the data service, then opened: a new project each time.
  const example = async (id: string) => {
    setBuilding(id);
    try { const p = await Api.buildExample(id); await s.openOrRecover(p.id); } catch (e) { s.toast((e as Error).message, 'error'); }
    setBuilding('');
  };
  const create = async () => {
    if (!name.trim()) { s.toast('Give the project a name.', 'error'); return; }
    setBusy(true);
    try { await s.createProject(name.trim()); } catch (e) { s.toast((e as Error).message, 'error'); }
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
        <label>Project name<input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} placeholder="e.g. The Long Night" data-testid="project-name" /></label>
        <p className="muted small-note">It opens in Map Studio, where you choose its first map: the Earth, the Earth through time, a planet of your own, a plan, the stars…</p>
        <button className="primary" disabled={busy} onClick={create} data-testid="project-create">Create project</button>
        {examples.length > 0 && <>
          <h3>Examples</h3>
          <p className="muted small-note">Finished projects made from an outline, to explore and change: each is built anew in your projects folder (it takes a few seconds).</p>
          <div className="list">
            {examples.map((x) => (
              <div key={x.id} className="row example-row">
                <div><b>{x.name}</b><div className="muted small-note">{x.about}</div></div>
                <button disabled={!!building} onClick={() => example(x.id)} data-testid={`example-${x.id}`}>{building === x.id ? 'Building…' : 'Build and open'}</button>
              </div>
            ))}
          </div>
        </>}
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
