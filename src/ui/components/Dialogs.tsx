import { useEffect, useState } from 'react';
import { useStore, store, type PendingEdit } from '../store.ts';
import { Api, type VersionInfo, type BackupInfo, type ProjectInfo } from '../api.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, compare, fromStore } from '../../core-time/index.ts';
import { BASE_EVENT_ID } from '../../world-model/schema.ts';
import type { TransitionSpec } from '../../temporal-engine/engine.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { DateField, fmt } from './Panels.tsx';
import { loadDatasetRecords, type DatasetRecord } from '../../render-engine/basemap.ts';
import { GroupChecks } from './EventGroups.tsx';

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
  return p.kind === 'paint' ? <PaintPrompt p={p} /> : <VertexPrompt p={p} />;
}

function PaintPrompt({ p }: { p: Extract<PendingEdit, { kind: 'paint' }> }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const who = p.value ? w.get('entity', p.value)?.name ?? 'someone' : 'nobody';
  const [choice, setChoice] = useState<'new' | 'correct'>('new');
  const [target, setTarget] = useState<string>('new-event');
  const [evName, setEvName] = useState(p.value ? `${who} gains territory` : 'Territory abandoned');
  const [end, setEnd] = useState<Instant | null>(null);
  const [style, setStyle] = useState<'instant' | 'advance' | 'fade'>('instant');
  const events = w.all('event').filter((x) => x.id !== BASE_EVENT_ID).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms);

  let periodFrom = 'the beginning', periodTo = 'the end of time';
  let lasts = 'Nothing later changes this area yet, so the change lasts until you record a later one.';
  if (p.sample) {
    const face = w.arrangement(p.spaceId).locate(lonLatToVec(p.sample[0], p.sample[1]));
    const a = e.latest(p.spaceId, p.layerId, face, s.time);
    if (a) periodFrom = a.eventId === BASE_EVENT_ID ? 'the base world' : fmt(a.t);
    const next = e.nextChange(p.spaceId, p.layerId, [face], s.time);
    if (next) {
      periodTo = fmt(next);
      const nextEvent = w.get('event', e.latest(p.spaceId, p.layerId, face, next)?.eventId ?? '');
      lasts = `It lasts until ${fmt(next)}${nextEvent ? `, when “${nextEvent.name}” changes it` : ''}.`;
    }
  }
  const close = () => s.set({ pending: null });
  const confirm = () => {
    const transition: TransitionSpec | null = style === 'instant' ? null : style === 'advance' ? { style: 'advance', origin: p.origin, easing: 'smooth' } : { style: 'fade' };
    const base = { spaceId: p.spaceId, layerId: p.layerId, rings: p.rings, value: p.value, snap: p.snap };
    if (choice === 'correct') {
      s.execute((wd, en) => cmd.paintTerritory(wd, en, { ...base, mode: { kind: 'correct', t: s.time } }));
    } else if (target === 'new-event') {
      if (end && compare(end, s.time) < 0) { s.toast('The event cannot end before it starts.', 'error'); return; }
      const r = s.execute((wd, en) => cmd.paintWithNewEvent(wd, en, { name: evName, start: s.time, end, type_id: p.value ? 'conquest' : 'general' }, { ...base, transition: end ? transition : null }));
      if (r) s.set({ selection: { kind: 'event', id: r.eventId } });
    } else {
      const ev = w.get('event', target)!;
      const start = fromStore(ev.start_day, ev.start_ms);
      const at = compare(s.time, start) > 0 ? s.time : null;
      s.execute((wd, en) => cmd.paintTerritory(wd, en, { ...base, mode: { kind: 'new', eventId: target, at }, transition: ev.end_day !== null ? transition : null }));
    }
    close();
  };
  return (
    <Modal title={`What does this drawing mean?`} onClose={close}>
      <p className="muted">You drew an area for <b>{who}</b> while looking at <b>{fmt(s.time, 'minute')}</b>.</p>
      <div className={`choice ${choice === 'new' ? 'on' : ''}`} onClick={() => setChoice('new')} data-testid="choice-new">
        <b>A new change from {fmt(s.time)}</b>
        <div className="muted" data-testid="new-change-lasts">History before this date stays as it is. {lasts}</div>
        {choice === 'new' && (
          <div className="choice-body" onClick={(ev) => ev.stopPropagation()}>
            <label>Event
              <select value={target} onChange={(ev) => setTarget(ev.target.value)} data-testid="event-target">
                <option value="new-event">A new event…</option>
                {events.map((x) => <option key={x.id} value={x.id}>{fmt(fromStore(x.start_day, x.start_ms))} · {x.name}</option>)}
              </select>
            </label>
            {target === 'new-event' && <>
              <label>Event name<input value={evName} onChange={(ev) => setEvName(ev.target.value)} data-testid="new-event-name" /></label>
              <label>Ends (optional, for animated changes)<DateField value={end} allowEmpty placeholder="(happens at once)" onChange={setEnd} testId="new-event-end" /></label>
            </>}
            {(target !== 'new-event' ? w.get('event', target)?.end_day !== null : !!end) && (
              <label>How it spreads
                <select value={style} onChange={(ev) => setStyle(ev.target.value as typeof style)} data-testid="spread-style">
                  <option value="instant">At once</option>
                  <option value="advance">Advancing front, from where you started drawing</option>
                  <option value="fade">Fade over the event's duration</option>
                </select>
              </label>
            )}
          </div>
        )}
      </div>
      <div className={`choice ${choice === 'correct' ? 'on' : ''}`} onClick={() => setChoice('correct')} data-testid="choice-correct">
        <b>Correct this period ({periodFrom} – {periodTo})</b>
        <div className="muted">Fixes how things were during the period you are looking at, inside the change that started it. No new event is created.</div>
      </div>
      <div className="muted small-note">Correcting a border's shape for all time is done by dragging its points with the Border points tool.</div>
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={confirm} data-testid="confirm-edit">Apply</button></div>
    </Modal>
  );
}

function VertexPrompt({ p }: { p: Extract<PendingEdit, { kind: 'vertex' }> }) {
  const s = useStore();
  const close = () => s.set({ pending: null });
  return (
    <Modal title="Move this border point?" onClose={close}>
      <div className="choice on">
        <b>Correct the border's shape for all time</b>
        <div className="muted">Every date where this border exists shows the new position. Nothing else about history changes.</div>
      </div>
      <p className="muted small-note">To move a border from a particular date onward (for example after a war), draw the area that changes hands with the Territory brush instead: it asks whether that is a new change or a correction.</p>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button className="primary" data-testid="confirm-vertex" onClick={() => { s.execute((w) => cmd.moveVertex(w, { spaceId: p.spaceId, vertexId: p.vertexId, to: p.to, snap: 1e-9 })); close(); }}>Correct for all time</button>
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
  const close = () => s.set({ dialog: null });
  const create = () => {
    const id = s.execute((w) => cmd.createWorld(w, name.trim() || 'New world', Number(km), earth ? 'natural-earth' : 'none'));
    if (id) { s.set({ spaceId: id, layerId: s.world!.all('layer').find((l) => l.space_id === id)?.id ?? '', selection: null }); close(); }
  };
  return (
    <Modal title="New world" onClose={close}>
      <p className="muted">A world is a planet, moon or other body with its own map, territories and history. Fictional worlds start as an empty sphere; terrain tools come in a later stage.</p>
      <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aster Prime" /></label>
      <label>Radius (km)<input type="number" value={km} onChange={(e) => setKm(e.target.value)} /></label>
      <div className="presets">{WORLD_PRESETS.map((p) => <button key={p.name} className="small" onClick={() => { setName(p.name); setKm(String(p.km)); setEarth(p.name === 'Earth'); }}>{p.name}</button>)}</div>
      <label className="check"><input type="checkbox" checked={earth} onChange={(e) => setEarth(e.target.checked)} data-testid="new-world-earth" /> Start with Earth's geography (land, lakes and coastlines)</label>
      <div className="modal-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={create}>Create world</button></div>
    </Modal>
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
      <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>{w.all('event_type').filter((t) => t.id !== 'base').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Starts<DateField value={start} onChange={setStart} testId="event-start" /></label>
      <label>Ends (optional)<DateField value={end} allowEmpty placeholder="(happens at once)" onChange={setEnd} testId="event-end" /></label>
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
          <label>First world<input value={worldName} onChange={(e) => setWorldName(e.target.value)} /></label>
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
