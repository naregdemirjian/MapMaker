import { useEffect, useRef, useState } from 'react';
import { useStore, store } from '../store.ts';
import { Api } from '../api.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, add, fromJSONValue, toJSONValue, fromStore, compare, gregorian, type Precision } from '../../core-time/index.ts';
import { defaultShot, timeAt, cameraAt, RESOLUTIONS, FRAME_RATES, shotTransitions, type ShotSettings, type Ease, type ShotTransitions } from '../../presentation/sequence.ts';
import { PASS_DEFS, runExport } from '../../presentation/export-driver.ts';
import { eventsBoxOf, type EventsBox } from '../../presentation/events-box.ts';
import { LABEL_FONTS } from '../../render-engine/label-style.ts';
import { PROJECTIONS, type ProjectionName } from '../../render-engine/camera.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { DateField, NumberField } from './Panels.tsx';
import { currentShot } from './MapView.tsx';

function saveShot(id: string, next: ShotSettings) {
  store.execute((w) => cmd.updateSequence(w, id, { settings: next }));
}

export function ShotsPanel() {
  const s = useStore();
  const w = s.world!;
  const shots = w.all('sequence').sort((a, b) => a.created_seq - b.created_seq);
  const create = () => {
    let start: Instant = s.time, end: Instant = add(s.time, 365);
    if (s.selection?.kind === 'event') {
      const ev = w.get('event', s.selection.id);
      if (ev && ev.id !== 'evt_base') {
        start = fromStore(ev.start_day, ev.start_ms);
        end = ev.end_day !== null ? fromStore(ev.end_day, ev.end_ms ?? 0) : add(start, 30);
      }
    }
    const settings = defaultShot(s.spaceId, s.camera, start, end);
    const id = s.execute((wd) => cmd.createSequence(wd, `Shot ${shots.length + 1}`, settings));
    if (id) s.set({ shotId: id, shotFrame: 0, presentCamera: null });
  };
  return (
    <aside className="left">
      <section className="section">
        <div className="section-head"><span>Shots</span><button className="small" onClick={create} data-testid="new-shot">+ Shot</button></div>
        <div className="section-body">
          {shots.map((sh) => (
            <div key={sh.id} className={`row ${s.shotId === sh.id ? 'sel' : ''}`} onClick={() => s.set({ shotId: sh.id, shotFrame: 0, presentCamera: null, spaceId: parseJSON<ShotSettings | null>(sh.settings, null)?.spaceId ?? s.spaceId })}>{sh.name}</div>
          ))}
          {!shots.length && <div className="muted pad">No shots yet. A shot turns a stretch of history into a camera move you can export. Select an event first to base the shot on its dates.</div>}
        </div>
      </section>
    </aside>
  );
}

export function ShotEditor() {
  const s = useStore();
  const w = s.world!;
  const shot = currentShot();
  const row = s.shotId ? w.get('sequence', s.shotId) : null;
  const [name, setName] = useState(row?.name ?? '');
  const [passes, setPasses] = useState<string[]>(['background', 'land', 'fills', 'borders', 'labels', 'overlays', 'all']);
  const [progress, setProgress] = useState<null | { done: number; total: number; label: string }>(null);
  const [result, setResult] = useState<null | { dir: string; frames: number; seconds: number }>(null);
  const cancel = useRef(false);
  useEffect(() => setName(row?.name ?? ''), [s.shotId]);
  if (!shot || !row) return <aside className="right"><div className="panel"><h3>Presentation</h3><p className="muted">Create or pick a shot on the left. Its preview appears in the middle; drag and scroll there to frame the view, then store it as the start or end view.</p></div></aside>;
  const seconds = shot.frames / shot.fps;
  const startT = fromJSONValue(shot.time[0].at), endT = fromJSONValue(shot.time[shot.time.length - 1].at);
  const update = (patch: Partial<ShotSettings>) => saveShot(row.id, { ...shot, ...patch });
  const setFrames = (fps: number, secs: number) => {
    const frames = Math.max(2, Math.round(fps * secs));
    const scaleKey = <K extends { frame: number }>(k: K, i: number, arr: K[]) => ({ ...k, frame: i === arr.length - 1 ? frames - 1 : Math.round((k.frame / Math.max(1, shot.frames - 1)) * (frames - 1)) });
    update({ fps, frames, time: shot.time.map(scaleKey), camera: shot.camera.map(scaleKey), overlays: shot.overlays.map((o) => ({ ...o, inFrame: 0, outFrame: frames - 1 })) });
    s.set({ shotFrame: Math.min(s.shotFrame, frames - 1) });
  };
  const liveCamera = s.presentCamera ?? cameraAt(shot, s.shotFrame);
  const setCameraKey = (which: 'start' | 'end') => {
    const keys = [...shot.camera];
    const idx = which === 'start' ? 0 : keys.length - 1;
    keys[idx] = { ...keys[idx], camera: { ...liveCamera } };
    update({ camera: keys });
    s.set({ presentCamera: null, shotFrame: which === 'start' ? 0 : shot.frames - 1 });
  };
  const setTimeKey = (which: 'start' | 'end', t: Instant | null) => {
    if (!t) return;
    const keys = [...shot.time];
    const idx = which === 'start' ? 0 : keys.length - 1;
    keys[idx] = { ...keys[idx], at: toJSONValue(t) };
    update({ time: keys });
  };
  const res = RESOLUTIONS.find((r) => r.width === shot.width && r.height === shot.height)?.id ?? 'custom';
  const dateOverlay = shot.overlays.find((o) => o.kind === 'date');
  const title = shot.overlays.find((o) => o.id === 'title');
  const doExport = async (scale: number) => {
    cancel.current = false;
    setResult(null);
    setProgress({ done: 0, total: 1, label: scale === 1 ? 'Exporting' : 'Exporting preview' });
    try {
      await s.flush();
      const r = await runExport({
        projectId: s.projectId!, world: w, engine: s.engine!, shot, shotName: row.name, passNames: passes, scale,
        onProgress: (done, total) => setProgress({ done, total, label: scale === 1 ? 'Exporting' : 'Exporting preview' }), isCancelled: () => cancel.current,
      });
      setResult(r);
      s.toast(`Exported ${r.frames} frames to ${r.dir}`);
    } catch (e) {
      s.toast((e as Error).message, 'error');
    }
    setProgress(null);
  };
  const box = eventsBoxOf(shot.eventsBox);
  const setBox = (patch: Partial<EventsBox>) => update({ eventsBox: { ...box, ...patch } });
  const uploadBoxImage = async (file: File | undefined) => {
    if (!file) return;
    try { const a = await Api.uploadAsset(s.projectId!, file); setBox({ image: a.file }); } catch (e) { s.toast((e as Error).message, 'error'); }
  };
  const tr = shotTransitions(shot);
  const setTr = (patch: Partial<ShotTransitions>) => update({ transitions: { ...tr, ...patch } });
  const chooseFolder = async () => {
    try {
      const r = await Api.chooseFolder(shot.exportDir ?? undefined);
      if (r.path) update({ exportDir: r.path });
    } catch (e) {
      s.toast((e as Error).message, 'error');
    }
  };
  return (
    <aside className="right" data-testid="shot-editor">
      <div className="panel shot-panel">
        <Group title="Shot">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== row.name && s.execute((wd) => cmd.updateSequence(wd, row.id, { name: name.trim() }))} /></label>
        </Group>
        <Group title="Output quality">
          <label>Resolution<select value={res} onChange={(e) => { const r = RESOLUTIONS.find((x) => x.id === e.target.value); if (r) update({ width: r.width, height: r.height }); }}>
            {RESOLUTIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}{res === 'custom' && <option value="custom">Custom {shot.width} x {shot.height}</option>}
          </select></label>
          <div className="two">
            <label>Width<NumberField min={16} max={16384} step={1} value={shot.width} onCommit={(n) => update({ width: Math.round(n) })} /></label>
            <label>Height<NumberField min={16} max={16384} step={1} value={shot.height} onCommit={(n) => update({ height: Math.round(n) })} /></label>
          </div>
          <label>Frame rate<select value={shot.fps} onChange={(e) => setFrames(Number(e.target.value), seconds)}>{FRAME_RATES.map((f) => <option key={f} value={f}>{f} fps</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={shot.transparent} onChange={(e) => update({ transparent: e.target.checked })} /> Transparent background (in "All")</label>
          <p className="muted">PNG image sequences, 8-bit with transparency.</p>
        </Group>
        <Group title="Timing">
          <label>History shown from<DateField value={startT} onChange={(t) => setTimeKey('start', t)} testId="shot-from" /></label>
          <label>to<DateField value={endT} onChange={(t) => setTimeKey('end', t)} testId="shot-to" /></label>
          <label>Pacing<select value={shot.time[0].ease} onChange={(e) => update({ time: shot.time.map((k) => ({ ...k, ease: e.target.value as Ease })) })}>
            <option value="linear">Even</option><option value="smooth">Ease in and out</option>
          </select></label>
          <label>Screen time (seconds)<NumberField min={0.1} max={3600} step={0.5} value={Number(seconds.toFixed(3))} onCommit={(n) => setFrames(shot.fps, n)} testId="shot-seconds" /></label>
        </Group>
        <Group title="Camera">
          <p className="muted">Drag and scroll the preview to frame a view, then store it.</p>
          <div className="buttons">
            <button onClick={() => setCameraKey('start')} data-testid="set-start-view">Use this view at the start</button>
            <button onClick={() => setCameraKey('end')} data-testid="set-end-view">Use this view at the end</button>
          </div>
          <label>Projection<select value={shot.camera[0].camera.projection} onChange={(e) => update({ camera: shot.camera.map((k) => ({ ...k, camera: { ...k.camera, projection: e.target.value as ProjectionName } })) })}>
            {PROJECTIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <label>Rotation (degrees)<input type="number" value={Math.round(liveCamera.rotation)} onChange={(e) => s.set({ presentCamera: { ...liveCamera, rotation: Number(e.target.value) } })} /></label>
        </Group>
        <Group title="Transitions">
          <label>Border changes<select value={tr.mode} onChange={(e) => setTr({ mode: e.target.value as ShotTransitions['mode'] })} data-testid="transition-mode">
            <option value="recorded">As recorded (animated where you set an animation)</option>
            <option value="all">Animate every change</option>
            <option value="instant">No animation: change instantly</option>
          </select></label>
          {tr.mode !== 'instant' && <>
            <label className="check"><input type="checkbox" checked={tr.restyleRecorded} onChange={(e) => setTr({ restyleRecorded: e.target.checked })} data-testid="transition-restyle" /> {tr.mode === 'all' ? 'Changes recorded with their own animation use these settings too' : 'Use the settings below for recorded animations too'}</label>
            {(tr.mode === 'all' || tr.restyleRecorded) && <>
              <label>Style<select value={tr.style} onChange={(e) => setTr({ style: e.target.value as ShotTransitions['style'] })} data-testid="transition-style-shot">
                <option value="border">Advancing front (grows out of the country's existing border)</option>
                <option value="advance">Expansion (a circle from where the drawing started, or the middle)</option>
                <option value="fade">Fade</option>
              </select></label>
              <label>Length<select value={tr.timing} onChange={(e) => setTr({ timing: e.target.value as ShotTransitions['timing'] })}>
                <option value="seconds">Fixed screen time</option>
                <option value="event">The event's length (events without an end use screen time)</option>
              </select></label>
              <label>Screen time per change (seconds)<NumberField min={0.05} max={120} step={0.25} value={tr.seconds} onCommit={(n) => setTr({ seconds: n })} testId="transition-seconds" /></label>
              <label>Easing<select value={tr.easing} onChange={(e) => setTr({ easing: e.target.value as ShotTransitions['easing'] })}>
                <option value="smooth">Ease in and out</option><option value="linear">Even</option><option value="in">Ease in (start slow)</option><option value="out">Ease out (end slow)</option>
              </select></label>
            </>}
            <h4>Front line</h4>
            <label className="check"><input type="checkbox" checked={tr.front.show} onChange={(e) => setTr({ front: { ...tr.front, show: e.target.checked } })} /> Show the moving front</label>
            {tr.front.show && <div className="two">
              <label>Colour<input type="color" value={tr.front.color} onChange={(e) => setTr({ front: { ...tr.front, color: e.target.value } })} /></label>
              <label>Line width<NumberField min={0} max={40} step={0.5} value={tr.front.width} onCommit={(n) => setTr({ front: { ...tr.front, width: n } })} /></label>
              <label>Glow<NumberField min={0} max={80} step={1} value={tr.front.glow} onCommit={(n) => setTr({ front: { ...tr.front, glow: n } })} /></label>
            </div>}
          </>}
        </Group>
        <Group title="Current events box" open={box.show}>
          <label className="check"><input type="checkbox" checked={box.show} onChange={(e) => setBox({ show: e.target.checked })} data-testid="events-box-show" /> Show the events happening on screen</label>
          {box.show && <>
            <label>Position<select value={box.corner} onChange={(e) => setBox({ corner: e.target.value as EventsBox['corner'] })} data-testid="events-box-corner">
              <option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="top-right">Top right</option><option value="top-left">Top left</option><option value="custom">Custom</option>
            </select></label>
            {box.corner === 'custom' && <div className="two">
              <label>Left (% of width)<NumberField min={0} max={100} step={1} value={Math.round(box.x * 100)} onCommit={(n) => setBox({ x: n / 100 })} /></label>
              <label>Top (% of height)<NumberField min={0} max={100} step={1} value={Math.round(box.y * 100)} onCommit={(n) => setBox({ y: n / 100 })} /></label>
            </div>}
            <label>Heading<input value={box.title} placeholder="(none)" onChange={(e) => setBox({ title: e.target.value })} data-testid="events-box-title" /></label>
            <label className="check"><input type="checkbox" checked={box.showDate} onChange={(e) => setBox({ showDate: e.target.checked })} /> Show the date and time</label>
            {box.showDate && <label>Date detail<select value={box.datePrecision} onChange={(e) => setBox({ datePrecision: e.target.value as Precision })}>
              <option value="year">Year</option><option value="month">Month</option><option value="day">Day</option><option value="minute">Hour and minute</option><option value="second">Seconds</option>
            </select></label>}
            <div className="two">
              <label>Most events listed<NumberField min={0} max={20} step={1} value={box.maxEvents} onCommit={(n) => setBox({ maxEvents: Math.round(n) })} /></label>
              <label>Events without an end stay (s)<NumberField min={0} max={60} step={0.5} value={box.linger} onCommit={(n) => setBox({ linger: n })} /></label>
            </div>
            <label>Fade in and out (s)<NumberField min={0} max={10} step={0.1} value={box.fade} onCommit={(n) => setBox({ fade: n })} /></label>
            <label className="check"><input type="checkbox" checked={box.showDescription} onChange={(e) => setBox({ showDescription: e.target.checked })} /> Show each event's description</label>
            {w.all('event_group').length > 0 && <>
              <label className="check"><input type="checkbox" checked={box.groups === null} onChange={(e) => setBox({ groups: e.target.checked ? null : [] })} /> Events of every group</label>
              {box.groups !== null && w.all('event_group').map((g) => (
                <label key={g.id} className="check"><input type="checkbox" checked={box.groups!.includes(g.id)} onChange={(e) => setBox({ groups: e.target.checked ? [...box.groups!, g.id] : box.groups!.filter((x) => x !== g.id) })} /><span className="swatch" style={{ background: g.color }} />{g.name}</label>
              ))}
            </>}
            <h4>Look</h4>
            <label>Font<select value={box.font} onChange={(e) => setBox({ font: e.target.value })}>{(LABEL_FONTS.includes(box.font) ? LABEL_FONTS : [box.font, ...LABEL_FONTS]).map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
            <div className="two">
              <label>Heading size<NumberField min={6} max={200} step={1} value={box.titleSize} onCommit={(n) => setBox({ titleSize: n })} /></label>
              <label>Date size<NumberField min={6} max={200} step={1} value={box.dateSize} onCommit={(n) => setBox({ dateSize: n })} /></label>
              <label>Event size<NumberField min={6} max={200} step={1} value={box.textSize} onCommit={(n) => setBox({ textSize: n })} /></label>
              <label>Width<NumberField min={80} max={1920} step={10} value={box.width} onCommit={(n) => setBox({ width: n })} /></label>
            </div>
            <div className="two">
              <label>Heading colour<input type="color" value={box.titleColor} onChange={(e) => setBox({ titleColor: e.target.value })} /></label>
              <label>Date colour<input type="color" value={box.dateColor} onChange={(e) => setBox({ dateColor: e.target.value })} /></label>
              <label>Event colour<input type="color" value={box.textColor} onChange={(e) => setBox({ textColor: e.target.value })} /></label>
              <label>Bullet colour<input type="color" value={box.accentColor} onChange={(e) => setBox({ accentColor: e.target.value })} /></label>
              <label>Background<input type="color" value={box.background} onChange={(e) => setBox({ background: e.target.value })} /></label>
              <label>Background opacity (%)<NumberField min={0} max={100} step={5} value={Math.round(box.backgroundOpacity * 100)} onCommit={(n) => setBox({ backgroundOpacity: n / 100 })} /></label>
              <label>Border colour<input type="color" value={box.borderColor} onChange={(e) => setBox({ borderColor: e.target.value })} /></label>
              <label>Border width<NumberField min={0} max={40} step={0.5} value={box.borderWidth} onCommit={(n) => setBox({ borderWidth: n })} /></label>
              <label>Corner rounding<NumberField min={0} max={200} step={1} value={box.radius} onCommit={(n) => setBox({ radius: n })} /></label>
              <label>Inner spacing<NumberField min={0} max={200} step={1} value={box.padding} onCommit={(n) => setBox({ padding: n })} /></label>
              <label>Distance from the edge<NumberField min={0} max={500} step={1} value={box.margin} onCommit={(n) => setBox({ margin: n })} /></label>
              <label>Fixed height (0 = fit)<NumberField min={0} max={2000} step={10} value={box.height} onCommit={(n) => setBox({ height: n })} /></label>
            </div>
            <h4>Your own graphic</h4>
            <div className="buttons">
              <label className="file-button">{box.image ? 'Replace the graphic…' : 'Use a picture of your own…'}<input type="file" accept="image/*" onChange={(e) => uploadBoxImage(e.target.files?.[0])} data-testid="events-box-image" /></label>
              {box.image && <button className="small" onClick={() => setBox({ image: null })}>Remove</button>}
            </div>
            {box.image && <>
              <label>Fit<select value={box.imageFit} onChange={(e) => setBox({ imageFit: e.target.value as EventsBox['imageFit'] })}>
                <option value="cover">Cover the box</option><option value="contain">Fit inside the box</option><option value="stretch">Stretch to the box</option>
              </select></label>
              <label>Picture opacity (%)<NumberField min={0} max={100} step={5} value={Math.round(box.imageOpacity * 100)} onCommit={(n) => setBox({ imageOpacity: n / 100 })} /></label>
              <p className="muted">Tip: set the background opacity to 0 to show only your graphic.</p>
            </>}
          </>}
        </Group>
        <Group title="Look">
          <label className="check"><input type="checkbox" checked={shot.graticule} onChange={(e) => update({ graticule: e.target.checked })} /> Latitude and longitude grid</label>
          <label className="check"><input type="checkbox" checked={shot.labels} onChange={(e) => update({ labels: e.target.checked })} /> Country labels</label>
        </Group>
        <Group title="Text">
          <label className="check"><input type="checkbox" checked={!!dateOverlay} onChange={(e) => update({ overlays: e.target.checked ? [...shot.overlays, defaultShot(shot.spaceId, liveCamera, startT, endT, shot.fps, seconds).overlays[0]] : shot.overlays.filter((o) => o.kind !== 'date') })} /> Show the date</label>
          {dateOverlay && <label>Date detail<select value={dateOverlay.datePrecision} onChange={(e) => update({ overlays: shot.overlays.map((o) => (o.kind === 'date' ? { ...o, datePrecision: e.target.value as Precision } : o)) })}>
            <option value="year">Year</option><option value="month">Month</option><option value="day">Day</option><option value="minute">Hour and minute</option><option value="second">Seconds</option>
          </select></label>}
          <label>Title<input value={title?.text ?? ''} placeholder="(none)" onChange={(e) => {
            const text = e.target.value;
            const rest = shot.overlays.filter((o) => o.id !== 'title');
            update({ overlays: text ? [...rest, { id: 'title', kind: 'text', text, x: 0.5, y: 0.1, size: 56, color: '#f4efe6', background: null, align: 'center', inFrame: 0, outFrame: shot.frames - 1, fade: Math.round(shot.fps / 2), datePrecision: 'day' }] : rest });
          }} /></label>
        </Group>
        <Group title="Export">
          <h4>What to export</h4>
          {PASS_DEFS.map((d) => (
            <label key={d.name} className="check" title={d.note ?? ''}><input type="checkbox" checked={passes.includes(d.name)} onChange={(e) => setPasses(e.target.checked ? [...passes, d.name] : passes.filter((p) => p !== d.name))} data-testid={`pass-${d.name}`} /> {d.label}</label>
          ))}
          <h4>Where</h4>
          <div className="folder-field">
            <input value={shot.exportDir ?? ''} placeholder="The project's exports folder" onChange={(e) => update({ exportDir: e.target.value || null })} data-testid="export-dir" title="A full folder path. Each export makes its own folder inside it." />
            <button className="small" onClick={chooseFolder} data-testid="choose-export-dir">Choose…</button>
            {shot.exportDir && <button className="small" onClick={() => update({ exportDir: null })} title="Back to the project's exports folder">Reset</button>}
          </div>
          <p className="muted">{shot.frames} frames × {passes.length} layers at {shot.width} x {shot.height}.</p>
          {progress ? (
            <div className="progress"><div className="bar"><div style={{ width: `${(100 * progress.done) / progress.total}%` }} /></div>
              <span>{progress.label}: {progress.done} / {progress.total}</span><button onClick={() => (cancel.current = true)}>Cancel</button></div>
          ) : (
            <div className="buttons">
              <button onClick={() => doExport(0.25)} data-testid="export-preview">Export preview (¼ size)</button>
              <button className="primary" onClick={() => doExport(1)} data-testid="export-full">Export</button>
            </div>
          )}
          {result && <div className="ok-box" data-testid="export-result">Wrote {result.frames} frames in {result.seconds.toFixed(1)} s.<br /><span className="path">{result.dir}</span><br /><button onClick={() => Api.showFolder(s.projectId!, 'exports', shot.exportDir ?? undefined)}>Show the export folder</button></div>}
        </Group>
        <button className="danger" onClick={() => { if (confirm(`Delete the shot "${row.name}"?`)) { s.execute((wd) => cmd.deleteSequence(wd, row.id)); s.set({ shotId: null }); } }}>Delete shot</button>
      </div>
    </aside>
  );
}

/** A collapsible group of settings. */
function Group({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="settings-group" open={open}>
      <summary>{title}</summary>
      <div className="settings-body">{children}</div>
    </details>
  );
}

export function ShotTimeline() {
  const s = useStore();
  const shot = currentShot();
  const raf = useRef(0);
  useEffect(() => {
    if (!s.playing || !shot) return;
    const startWall = performance.now();
    const startFrame = s.shotFrame >= shot.frames - 1 ? 0 : s.shotFrame;
    const tick = () => {
      const f = startFrame + Math.floor(((performance.now() - startWall) / 1000) * shot.fps);
      if (f >= shot.frames - 1) { store.set({ shotFrame: shot.frames - 1, playing: false, presentCamera: null }); return; }
      store.set({ shotFrame: f, presentCamera: null });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [s.playing, s.shotId]);
  if (!shot) return <div className="timeline shot-timeline"><div className="muted pad">No shot selected.</div></div>;
  const t = timeAt(shot, s.shotFrame);
  return (
    <div className="timeline shot-timeline">
      <div className="shot-controls">
        <button onClick={() => s.set({ playing: !s.playing })} data-testid="play">{s.playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => s.set({ shotFrame: 0, presentCamera: null, playing: false })}>⏮</button>
        <input type="range" min={0} max={shot.frames - 1} value={s.shotFrame} onChange={(e) => s.set({ shotFrame: Number(e.target.value), presentCamera: null, playing: false })} className="frame-slider" data-testid="frame-slider" />
        <button onClick={() => s.set({ shotFrame: shot.frames - 1, presentCamera: null, playing: false })}>⏭</button>
        <span className="frame-info" data-testid="frame-info">Frame {s.shotFrame + 1} / {shot.frames} · {(s.shotFrame / shot.fps).toFixed(2)} s · <b>{gregorian.format(t, 'minute')}</b></span>
      </div>
    </div>
  );
}

export { compare };
