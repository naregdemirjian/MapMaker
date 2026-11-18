import { useEffect, useRef, useState } from 'react';
import { useStore, useLive, store } from '../store.ts';
import { Api } from '../api.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, add, fromJSONValue, toJSONValue, fromStore, compare, gregorian, type Precision } from '../../core-time/index.ts';
import { defaultShot, timeAt, cameraAt, RESOLUTIONS, FRAME_RATES, shotTransitions, withStillCamera, cameraMoves, resetCamera, newTextBox, textBoxOf, EXPORT_FORMATS, isVideoFormat, type ExportFormat, type ShotSettings, type Ease, type ShotTransitions, type Overlay, type TextBox, type TextEnter, type TextExit } from '../../presentation/sequence.ts';
import { PASS_DEFS, runExport, exportPassesOf, estimateExportBytes, scaledBytes, formatBytes } from '../../presentation/export-driver.ts';
import { svgFrame } from '../../presentation/svg-frame.ts';
import { planVideo } from '../../presentation/video-encoder.ts';
import { VIDEO_QUALITIES, formatBitrate, type VideoQuality } from '../../export/video-codecs.ts';
import { eventsBoxOf, type EventsBox } from '../../presentation/events-box.ts';
import { LOOKS, LOOK_IDS, GRADES, resolveLook, type LookId, type GradeId, type ShotLook } from '../../presentation/looks.ts';
import { isSpaceMap } from '../../world-model/world-settings.ts';
import { spaceCamera } from '../../space/space-view.ts';
import { LABEL_FONTS } from '../../render-engine/label-style.ts';
import { PROJECTIONS, type ProjectionName, type Camera } from '../../render-engine/camera.ts';
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
  const [estimate, setEstimate] = useState<{ key: string; bytes: number } | null>(null);
  const [progress, setProgress] = useState<null | { done: number; total: number; label: string }>(null);
  const [result, setResult] = useState<null | { dir: string; frames: number; seconds: number; file?: string }>(null);
  // Whether this computer can encode the video chosen, and how (D121).
  const [videoPlan, setVideoPlan] = useState<{ key: string; error?: string; codec?: string; bitrate?: number; size?: [number, number] } | null>(null);
  const [svgSaved, setSvgSaved] = useState<string | null>(null);
  const [svgBusy, setSvgBusy] = useState(false);
  const cancel = useRef(false);
  useEffect(() => setName(row?.name ?? ''), [s.shotId]);
  if (!shot || !row) return <aside className="right"><div className="panel"><h3>Presentation</h3><p className="muted">Create or pick a shot on the left. Its preview appears in the middle; drag and scroll there to frame the view.</p></div></aside>;
  const seconds = shot.frames / shot.fps;
  const passes = exportPassesOf(shot);
  const setPasses = (next: string[]) => update({ exportPasses: PASS_DEFS.map((d) => d.name).filter((n) => next.includes(n)) });
  const startT = fromJSONValue(shot.time[0].at), endT = fromJSONValue(shot.time[shot.time.length - 1].at);
  const update = (patch: Partial<ShotSettings>) => saveShot(row.id, { ...shot, ...patch });
  const setFrames = (fps: number, secs: number) => {
    const frames = Math.max(2, Math.round(fps * secs));
    const scaleKey = <K extends { frame: number }>(k: K, i: number, arr: K[]) => ({ ...k, frame: i === arr.length - 1 ? frames - 1 : Math.round((k.frame / Math.max(1, shot.frames - 1)) * (frames - 1)) });
    update({ fps, frames, time: shot.time.map(scaleKey), camera: shot.camera.map(scaleKey), overlays: shot.overlays.map((o) => ({ ...o, inFrame: 0, outFrame: frames - 1 })) });
    s.set({ shotFrame: Math.min(s.shotFrame, frames - 1) });
  };
  const liveCamera = s.presentCamera ?? cameraAt(shot, s.shotFrame);
  // The camera stays still for the whole shot: framing the preview sets it, a reset clears it.
  const setCamera = (cam: typeof liveCamera) => { saveShot(row.id, withStillCamera(shot, cam)); s.set({ presentCamera: null }); };
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
      s.toast(r.file ? `Exported a video of ${r.frames} frames to ${r.file}` : `Exported ${r.frames} frames to ${r.dir}`);
    } catch (e) {
      s.toast((e as Error).message, 'error');
    }
    setProgress(null);
  };
  // The frame shown in the preview as an SVG file (D115).
  const saveSvg = async () => {
    setSvgSaved(null);
    setSvgBusy(true);
    try {
      await s.flush();
      const f = await svgFrame({ world: w, engine: s.engine!, shot, shotName: row.name, frame: s.shotFrame });
      const r = await Api.saveSvgFrame(s.projectId!, row.name, s.shotFrame, shot.exportDir ?? null, f.svg);
      setSvgSaved(r.file);
      s.toast(`Saved frame ${s.shotFrame + 1} as ${r.file}`);
    } catch (e) {
      s.toast((e as Error).message, 'error');
    }
    setSvgBusy(false);
  };
  const box = eventsBoxOf(shot.eventsBox);
  const setBox = (patch: Partial<EventsBox>) => update({ eventsBox: { ...box, ...patch } });
  const uploadBoxImage = async (file: File | undefined) => {
    if (!file) return;
    // A new graphic becomes the box itself (its shape and proportions), the simplest start.
    try { const a = await Api.uploadAsset(s.projectId!, file); setBox({ image: a.file, imageFit: 'wrap' }); } catch (e) { s.toast((e as Error).message, 'error'); }
  };
  // Re-estimated when anything that changes the files changes (after a pause, in the background).
  const estimateKey = JSON.stringify([row.settings, passes, s.world?.revision]);
  const video = isVideoFormat(shot.format);
  const videoKey = videoKeyOf(shot);
  const videoBlocked = video && (videoPlan?.key !== videoKey || !!videoPlan.error);
  const tr = shotTransitions(shot);
  const spaceMap = isSpaceMap(w.get('map_space', shot.spaceId));
  const look = resolveLook(shot.look);
  const setLook = (patch: Partial<ShotLook>) => update({ look: { ...(shot.look ?? { id: look.id }), ...patch } });
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
      <SizeEstimate shot={shot} passes={passes} estimateKey={estimateKey} onEstimate={setEstimate} />
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
          <label className="check" title={video ? 'Videos have no transparency: the background is drawn' : ''}><input type="checkbox" checked={shot.transparent && !video} disabled={video} onChange={(e) => update({ transparent: e.target.checked })} /> Transparent background (in "All"{video ? '; not in videos' : ''})</label>
          <label>File format<select value={shot.format ?? 'png'} onChange={(e) => update({ format: e.target.value as ExportFormat })} data-testid="export-format">
            <optgroup label="Image sequences (for editing)">{EXPORT_FORMATS.filter((f) => !f.video).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>
            <optgroup label="One video file (to play and share)">{EXPORT_FORMATS.filter((f) => f.video).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>
          </select></label>
          <p className="muted" data-testid="export-format-note">{EXPORT_FORMATS.find((f) => f.id === (shot.format ?? 'png'))!.note}</p>
          {video && <>
            <label>Video quality<select value={shot.videoQuality ?? 'good'} onChange={(e) => update({ videoQuality: e.target.value as VideoQuality })} data-testid="export-video-quality">
              {VIDEO_QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select></label>
            <VideoCheck shot={shot} onPlan={setVideoPlan} />
            {videoPlan?.key === videoKey && <p className={videoPlan.error ? 'error' : 'muted'} data-testid="export-video-check">{videoPlan.error ?? `${videoPlan.size![0]} x ${videoPlan.size![1]}, ${formatBitrate(videoPlan.bitrate!)}, encoded by this computer (${videoPlan.codec}).`}</p>}
          </>}
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
          <p className="muted">Drag and scroll the preview to frame the shot. The view stays still for the whole shot.</p>
          {cameraMoves(shot) && <p className="muted" data-testid="camera-moves">This shot's camera moves (it was made that way before). Framing the preview or resetting makes it still.</p>}
          <div className="buttons">
            <button onClick={() => setCamera(spaceMap ? spaceCamera() : resetCamera(shot))} data-testid="reset-camera" title={spaceMap ? 'All of it in view, from above at an angle' : 'The whole map, straight and centred'}>Reset camera</button>
          </div>
          {spaceMap ? <p className="muted">Drag the preview to turn the view, Shift-drag to move it, scroll to zoom; a double-click on a star turns the view round it.</p> : <label>Projection<select value={shot.camera[0].camera.projection} onChange={(e) => update({ camera: shot.camera.map((k) => ({ ...k, camera: { ...k.camera, projection: e.target.value as ProjectionName } })) })}>
            {shot.camera[0].camera.projection === 'flat' ? <option value="flat">Flat map (plan)</option> : PROJECTIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>}
          <label>Rotation (degrees)<NumberField min={-360} max={360} step={1} value={Math.round(liveCamera.rotation)} onCommit={(n) => setCamera({ ...liveCamera, rotation: n })} testId="camera-rotation" /></label>
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
              <label>Fit<select value={box.imageFit} onChange={(e) => setBox({ imageFit: e.target.value as EventsBox['imageFit'] })} data-testid="events-box-fit">
                <option value="wrap">Wrap the box around the graphic (the graphic is the box)</option>
                <option value="cover">Cover the box</option><option value="contain">Fit inside the box</option><option value="stretch">Stretch to the box</option>
              </select></label>
              <label>Picture opacity (%)<NumberField min={0} max={100} step={5} value={Math.round(box.imageOpacity * 100)} onCommit={(n) => setBox({ imageOpacity: n / 100 })} /></label>
              <p className="muted">{box.imageFit === 'wrap'
                ? 'The box takes your graphic\'s shape; "Width" sets its size. Use "Inner spacing" to keep the text inside its frame.'
                : 'Tip: set the background opacity to 0 to show only your graphic.'}</p>
            </>}
          </>}
        </Group>
        <Group title="Look">
          <label>Map look<select value={look.id} onChange={(e) => update({ look: { id: e.target.value as LookId } })} data-testid="shot-look">
            {LOOK_IDS.map((id) => <option key={id} value={id}>{LOOKS[id].name}</option>)}
          </select></label>
          <p className="muted" data-testid="shot-look-about">{LOOKS[look.id].about}. The world-building view keeps its own colours.</p>
          <div className="two">
            <label>Sea colour<input type="color" value={colourParts(look.ocean).hex} onChange={(e) => setLook({ ocean: e.target.value })} data-testid="look-ocean" /></label>
            <label>Land colour<input type="color" value={colourParts(look.land).hex} onChange={(e) => setLook({ land: e.target.value })} data-testid="look-land" /></label>
            <label>Border colour<input type="color" value={colourParts(look.border).hex} onChange={(e) => setLook({ border: e.target.value })} data-testid="look-border" /></label>
            <label>Border width<NumberField min={0} max={20} step={0.1} value={look.borderWidth} onCommit={(n) => setLook({ borderWidth: n })} testId="look-border-width" /></label>
            <label>Colour grade<select value={look.grade} onChange={(e) => setLook({ grade: e.target.value as GradeId })} data-testid="look-grade">
              {(Object.keys(GRADES) as GradeId[]).map((g) => <option key={g} value={g}>{GRADES[g].name}</option>)}
            </select></label>
            <label title="The frame's edges darkened, drawing the eye to the middle">Darker edges<input type="range" min={0} max={1} step={0.05} value={look.vignette} onChange={(e) => setLook({ vignette: Number(e.target.value) })} data-testid="look-vignette" /></label>
            <label title="The fine grain of paper over the map">Paper grain<input type="range" min={0} max={1} step={0.05} value={look.grain} onChange={(e) => setLook({ grain: Number(e.target.value) })} data-testid="look-grain" /></label>
          </div>
          <label className="check"><input type="checkbox" checked={look.blotches} onChange={(e) => setLook({ blotches: e.target.checked })} data-testid="look-blotches" /> Stains of old paper</label>
          {shot.look && Object.keys(shot.look).length > 1 && <div className="buttons"><button className="small" onClick={() => update({ look: { id: look.id } })} data-testid="look-reset">Back to the look's own colours</button></div>}
          <p className="muted">The grade, darker edges and paper are over the map in every exported layer, never over the texts; transparent parts stay transparent.</p>
          <label className="check"><input type="checkbox" checked={shot.graticule} onChange={(e) => update({ graticule: e.target.checked })} /> Latitude and longitude grid</label>
          <label className="check"><input type="checkbox" checked={shot.labels} onChange={(e) => update({ labels: e.target.checked })} /> Country labels</label>
          <label className="check"><input type="checkbox" checked={shot.cities !== false} onChange={(e) => update({ cities: e.target.checked })} data-testid="shot-cities" /> Cities</label>
          <label className="check"><input type="checkbox" checked={shot.characters !== false} onChange={(e) => update({ characters: e.target.checked })} data-testid="shot-characters" /> Characters</label>
          {shot.characters !== false && <label className="check"><input type="checkbox" checked={!!shot.trails} onChange={(e) => update({ trails: e.target.checked })} data-testid="shot-trails" /> Their routes so far (trails)</label>}
        </Group>
        <Group title="Text">
          <p className="muted">Drag the date, the title or the events box on the preview to place them anywhere.</p>
          <label className="check"><input type="checkbox" checked={!!dateOverlay} onChange={(e) => update({ overlays: e.target.checked ? [...shot.overlays, defaultShot(shot.spaceId, liveCamera, startT, endT, shot.fps, seconds).overlays[0]] : shot.overlays.filter((o) => o.kind !== 'date') })} /> Show the date</label>
          {dateOverlay && <label>Date detail<select value={dateOverlay.datePrecision} onChange={(e) => update({ overlays: shot.overlays.map((o) => (o.kind === 'date' ? { ...o, datePrecision: e.target.value as Precision } : o)) })}>
            <option value="year">Year</option><option value="month">Month</option><option value="day">Day</option><option value="minute">Hour and minute</option><option value="second">Seconds</option>
          </select></label>}
          <label>Title<input value={title?.text ?? ''} placeholder="(none)" onChange={(e) => {
            const text = e.target.value;
            const rest = shot.overlays.filter((o) => o.id !== 'title');
            update({ overlays: text ? [...rest, { id: 'title', kind: 'text', text, x: 0.5, y: 0.1, size: 56, color: '#f4efe6', background: null, align: 'center', inFrame: 0, outFrame: shot.frames - 1, fade: Math.round(shot.fps / 2), datePrecision: 'day' }] : rest });
          }} /></label>
          <h4>Text boxes and callouts</h4>
          <div className="buttons">
            <button className="small" onClick={() => update({ overlays: [...shot.overlays, newTextBox(shot, 'Your text')] })} data-testid="add-text-box" title="A box of text of your own: shown at times in the shot, or while history is between two dates">+ Text box</button>
            <button className="small" onClick={() => { const o = newTextBox(shot, 'A place', [liveCamera.lon, liveCamera.lat]); update({ overlays: [...shot.overlays, o] }); s.set({ pickCallout: o.id }); }} data-testid="add-callout" title="A text box with a line pointing at a place: click the preview to choose the place">+ Callout</button>
          </div>
          {s.pickCallout && <p className="muted" data-testid="callout-hint">Click the place on the preview that the callout points to.</p>}
          {shot.overlays.filter((o) => o.box).map((o) => <TextBoxEditor key={o.id} o={o} shot={shot} update={update} camera={liveCamera} />)}
        </Group>
        <Group title="Export">
          <h4>What to export</h4>
          {video ? <p className="muted" data-testid="video-passes-note">A video holds the whole picture ("All"). For layers to stack and adjust in Premiere, choose an image sequence format above.</p> : <>
          {PASS_DEFS.filter((d) => d.name === 'all').map((d) => (
            <label key={d.name} className="check" title={d.note ?? ''}><input type="checkbox" checked={passes.includes(d.name)} onChange={(e) => setPasses(e.target.checked ? [...passes, d.name] : passes.filter((p) => p !== d.name))} data-testid={`pass-${d.name}`} /> <b>{d.label}</b> <span className="muted">(everything in one image sequence)</span></label>
          ))}
          <div className="pass-box" data-testid="separate-passes">
            <p className="muted" data-testid="separate-passes-note">Each of these is exported separately, as its own image sequence, to stack and adjust in Premiere.</p>
            {PASS_DEFS.filter((d) => d.name !== 'all').map((d) => (
              <label key={d.name} className="check" title={d.note ?? ''}><input type="checkbox" checked={passes.includes(d.name)} onChange={(e) => setPasses(e.target.checked ? [...passes, d.name] : passes.filter((p) => p !== d.name))} data-testid={`pass-${d.name}`} /> {d.label}</label>
            ))}
          </div>
          </>}
          <h4>Where</h4>
          <div className="folder-field">
            <input value={shot.exportDir ?? ''} placeholder="The project's exports folder" onChange={(e) => update({ exportDir: e.target.value || null })} data-testid="export-dir" title="A full folder path. Each export makes its own folder inside it." />
            <button className="small" onClick={chooseFolder} data-testid="choose-export-dir">Choose…</button>
            {shot.exportDir && <button className="small" onClick={() => update({ exportDir: null })} title="Back to the project's exports folder">Reset</button>}
          </div>
          <p className="muted" data-testid="export-summary">{video ? <>A video of {shot.frames} frames ({seconds.toFixed(1)} s) at {shot.width} x {shot.height}.</> : <>{shot.frames} frames × {passes.length} {passes.length === 1 ? 'image sequence' : 'image sequences'} at {shot.width} x {shot.height}.</>}
            {' '}{estimate?.key === estimateKey ? <>Estimated size: <b data-testid="export-size">{video ? 'at most ' : ''}about {formatBytes(estimate.bytes)}</b> (a preview, ¼ size, about {formatBytes(video ? estimate.bytes / 16 : scaledBytes(estimate.bytes, 0.25))}).</> : passes.length || video ? 'Estimating the size…' : ''}</p>
          {progress ? (
            <div className="progress"><div className="bar"><div style={{ width: `${(100 * progress.done) / progress.total}%` }} /></div>
              <span>{progress.label}: {progress.done} / {progress.total}</span><button onClick={() => (cancel.current = true)}>Cancel</button></div>
          ) : (
            <div className="buttons">
              <button onClick={() => doExport(0.25)} disabled={videoBlocked} data-testid="export-preview">Export preview (¼ size)</button>
              <button className="primary" onClick={() => doExport(1)} disabled={videoBlocked} data-testid="export-full">{video ? 'Export video' : 'Export'}</button>
            </div>
          )}
          {result && <div className="ok-box" data-testid="export-result">{result.file ? <>Wrote a video of {result.frames} frames in {result.seconds.toFixed(1)} s.<br /><span className="path" data-testid="export-video-file">{result.file}</span></> : <>Wrote {result.frames} frames in {result.seconds.toFixed(1)} s.<br /><span className="path">{result.dir}</span></>}<br /><button onClick={() => Api.showFolder(s.projectId!, 'exports', shot.exportDir ?? undefined)}>Show the export folder</button></div>}
          <h4>One frame for print or a drawing program</h4>
          <div className="buttons">
            <button onClick={saveSvg} disabled={svgBusy} data-testid="export-svg" title="Territories, borders, areas, lines, cities, names and texts as shapes and text you can edit; the sea, land, terrain and conditions as pictures">{svgBusy ? 'Saving…' : `Save frame ${s.shotFrame + 1} as SVG`}</button>
          </div>
          {svgSaved && <div className="ok-box" data-testid="svg-result">Saved <span className="path">{svgSaved}</span></div>}
        </Group>
        <button className="danger" onClick={() => { if (confirm(`Delete the shot "${row.name}"?`)) { s.execute((wd) => cmd.deleteSequence(wd, row.id)); s.set({ shotId: null }); } }}>Delete shot</button>
      </div>
    </aside>
  );
}

/** A colour stored as rgba() or #rrggbb, as a hex colour and an opacity. */
function colourParts(c: string | null): { hex: string; a: number } {
  const m = c ? /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/i.exec(c) : null;
  if (m) return { hex: `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}`, a: m[4] !== undefined ? Number(m[4]) : 1 };
  if (c && /^#[0-9a-f]{6}$/i.test(c)) return { hex: c, a: 1 };
  return { hex: '#080e16', a: 0.7 };
}
const rgbaOf = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${Math.round(Math.max(0, Math.min(1, a)) * 100) / 100})`;
const lonLatText = (p: [number, number]) => `${Math.abs(p[1]).toFixed(2)}° ${p[1] >= 0 ? 'N' : 'S'}, ${Math.abs(p[0]).toFixed(2)}° ${p[0] >= 0 ? 'E' : 'W'}`;

/** The settings of one text box or callout (D107): its text and look, when it shows, how it comes and goes, the place it points to. */
function TextBoxEditor({ o, shot, update, camera }: { o: Overlay; shot: ShotSettings; update: (patch: Partial<ShotSettings>) => void; camera: Camera }) {
  const s = useStore();
  const b = textBoxOf(o.box);
  const set = (patch: Partial<Overlay>, box?: Partial<TextBox>) => update({ overlays: shot.overlays.map((x) => (x.id === o.id ? { ...x, ...patch, box: { ...b, ...(box ?? {}) } } : x)) });
  const [text, setText] = useState(o.text);
  useEffect(() => setText(o.text), [o.id, o.text]);
  const bg = colourParts(o.background), timing = b.timing;
  const fonts = LABEL_FONTS.includes(b.font) ? LABEL_FONTS : [b.font, ...LABEL_FONTS];
  return (
    <details className="text-box-editor" open data-testid="text-box">
      <summary>{b.anchor ? 'Callout' : 'Text'}: {o.text.split('\n')[0].slice(0, 40) || '(empty)'}</summary>
      <label>Text<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== o.text && set({ text })} data-testid="text-box-text" /></label>
      <p className="muted">Write {'{date}'} for the date shown. Drag the box on the preview to place it.</p>
      <div className="two">
        <label>Font<select value={b.font} onChange={(e) => set({}, { font: e.target.value })}>{fonts.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
        <label>Size<NumberField min={6} max={400} step={1} value={o.size} onCommit={(n) => set({ size: n })} testId="text-box-size" /></label>
        <label>Weight<select value={b.weight} onChange={(e) => set({}, { weight: Number(e.target.value) })}><option value={400}>Regular</option><option value={600}>Semibold</option><option value={700}>Bold</option><option value={800}>Heavy</option></select></label>
        <label>Align<select value={o.align} onChange={(e) => set({ align: e.target.value as Overlay['align'] })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
        <label>Colour<input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} data-testid="text-box-color" /></label>
        <label title="Lines longer than this are wrapped (pixels of a 1920-wide frame; 0: only where you start a new line)">Wrap at<NumberField min={0} max={8000} step={10} value={b.wrap} onCommit={(n) => set({}, { wrap: n })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={b.italic} onChange={(e) => set({}, { italic: e.target.checked })} /> Italic</label>
      <label className="check"><input type="checkbox" checked={!!o.background} onChange={(e) => set({ background: e.target.checked ? rgbaOf(bg.hex, bg.a) : null })} data-testid="text-box-background" /> A box behind the text</label>
      {o.background && <div className="two">
        <label>Box colour<input type="color" value={bg.hex} onChange={(e) => set({ background: rgbaOf(e.target.value, bg.a) })} /></label>
        <label>Opacity (%)<NumberField min={0} max={100} step={5} value={Math.round(bg.a * 100)} onCommit={(n) => set({ background: rgbaOf(bg.hex, n / 100) })} /></label>
        <label>Inner spacing<NumberField min={0} max={400} step={1} value={b.padding} onCommit={(n) => set({}, { padding: n })} /></label>
        <label>Corner rounding<NumberField min={0} max={400} step={1} value={b.radius} onCommit={(n) => set({}, { radius: n })} /></label>
      </div>}
      <label className="check"><input type="checkbox" checked={!!b.outline} onChange={(e) => set({}, { outline: e.target.checked ? '#000000' : null })} /> A line around the letters</label>
      {b.outline && <div className="two">
        <label>Line colour<input type="color" value={b.outline} onChange={(e) => set({}, { outline: e.target.value })} /></label>
        <label>Line width<NumberField min={0} max={60} step={0.5} value={b.outlineWidth} onCommit={(n) => set({}, { outlineWidth: n })} /></label>
      </div>}
      <label>Shown<select value={timing.by} onChange={(e) => set({}, { timing: e.target.value === 'history' ? { by: 'history', from: toJSONValue(timeAt(shot, s.shotFrame)) as [number, number], to: null } : { by: 'shot', from: 0, to: null } })} data-testid="text-box-timing">
        <option value="shot">At times in the shot</option><option value="history">While history is between two dates</option>
      </select></label>
      {timing.by === 'shot' ? <div className="two">
        <label>From (seconds)<NumberField min={0} max={36000} step={0.1} value={timing.from} onCommit={(n) => set({}, { timing: { ...timing, from: n } })} testId="text-box-from" /></label>
        <label title="0: until the end of the shot">To (seconds)<NumberField min={0} max={36000} step={0.1} value={timing.to ?? 0} onCommit={(n) => set({}, { timing: { ...timing, to: n > 0 ? n : null } })} testId="text-box-to" /></label>
      </div> : <>
        <label>From<DateField value={fromJSONValue(timing.from)} onChange={(t) => t && set({}, { timing: { ...timing, from: toJSONValue(t) as [number, number] } })} testId="text-box-from-date" /></label>
        <label>To<DateField value={timing.to ? fromJSONValue(timing.to) : null} allowEmpty placeholder="(from then on)" onChange={(t) => set({}, { timing: { ...timing, to: t ? (toJSONValue(t) as [number, number]) : null } })} testId="text-box-to-date" /></label>
      </>}
      <div className="two">
        <label>Comes in<select value={b.enter} onChange={(e) => set({}, { enter: e.target.value as TextEnter })} data-testid="text-box-enter">
          <option value="none">At once</option><option value="fade">Fading in</option><option value="rise">Rising</option><option value="pop">Popping up</option><option value="type">Typed out</option>
        </select></label>
        <label>Goes<select value={b.exit} onChange={(e) => set({}, { exit: e.target.value as TextExit })} data-testid="text-box-exit">
          <option value="none">At once</option><option value="fade">Fading out</option><option value="sink">Sinking</option>
        </select></label>
        <label>Taking (seconds)<NumberField min={0} max={60} step={0.1} value={b.seconds} onCommit={(n) => set({}, { seconds: n })} testId="text-box-seconds" /></label>
      </div>
      {b.anchor ? <>
        <p className="muted" data-testid="callout-place">Points to {lonLatText(b.anchor)}.</p>
        <div className="buttons">
          <button className="small" onClick={() => s.set({ pickCallout: o.id })} data-testid="callout-pick">Choose the place on the preview</button>
          <button className="small" onClick={() => set({}, { anchor: null })}>No pointer</button>
        </div>
        <label>Pointer colour<input type="color" value={b.pointer || o.color} onChange={(e) => set({}, { pointer: e.target.value })} /></label>
      </> : <div className="buttons"><button className="small" onClick={() => { set({}, { anchor: [camera.lon, camera.lat] }); s.set({ pickCallout: o.id }); }}>Point it at a place…</button></div>}
      <div className="buttons"><button className="small danger" onClick={() => update({ overlays: shot.overlays.filter((x) => x.id !== o.id) })} data-testid="text-box-delete">Delete this text</button></div>
    </details>
  );
}

/** Works out the export size estimate shortly after the settings stop changing. */
function SizeEstimate({ shot, passes, estimateKey, onEstimate }: { shot: ShotSettings; passes: string[]; estimateKey: string; onEstimate: (e: { key: string; bytes: number }) => void }) {
  const s = useStore();
  useEffect(() => {
    let stale = false;
    // (Drawing the sample frame takes a moment on a large map: it waits until the settings have
    // stopped changing and the page has nothing else to do, so it does not land in the middle of work.)
    let idle = 0;
    const run = () => {
      if (stale || (!passes.length && !isVideoFormat(shot.format)) || !s.world || !s.engine) return;
      estimateExportBytes(s.world, s.engine, shot, passes).then((bytes) => { if (!stale) onEstimate({ key: estimateKey, bytes }); }, () => undefined);
    };
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout: 2500 });
      else run();
    }, 700);
    return () => { stale = true; clearTimeout(timer); if (idle) window.cancelIdleCallback?.(idle); };
  }, [estimateKey]);
  return null;
}

/** What decides how a shot's video is encoded (D121). */
const videoKeyOf = (shot: ShotSettings) => JSON.stringify([shot.format, shot.width, shot.height, shot.fps, shot.videoQuality ?? 'good']);

/** Asks the browser whether it can encode the shot's video, and how (the answer in `onPlan`). */
function VideoCheck({ shot, onPlan }: { shot: ShotSettings; onPlan: (p: { key: string; error?: string; codec?: string; bitrate?: number; size?: [number, number] }) => void }) {
  const key = videoKeyOf(shot);
  useEffect(() => {
    let stale = false;
    if (!isVideoFormat(shot.format)) return;
    planVideo(shot.format, shot.width, shot.height, shot.fps, shot.videoQuality ?? 'good').then((p) => {
      if (stale) return;
      onPlan('error' in p ? { key, error: p.error } : { key, codec: p.config.codec, bitrate: p.bitrate, size: [p.width, p.height] });
    }, (e) => { if (!stale) onPlan({ key, error: (e as Error).message }); });
    return () => { stale = true; };
  }, [key]);
  return null;
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
  const s = useLive();
  const shot = currentShot();
  const raf = useRef(0);
  useEffect(() => {
    if (!s.playing || !shot) return;
    const startWall = performance.now();
    const startFrame = s.shotFrame >= shot.frames - 1 ? 0 : s.shotFrame;
    const tick = () => {
      const f = startFrame + Math.floor(((performance.now() - startWall) / 1000) * shot.fps);
      if (f >= shot.frames - 1) { store.set({ shotFrame: shot.frames - 1, playing: false, presentCamera: null }); return; }
      store.setLive({ shotFrame: f, presentCamera: null });
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
        <input type="range" min={0} max={shot.frames - 1} value={s.shotFrame} onChange={(e) => s.setLive({ shotFrame: Number(e.target.value), presentCamera: null, playing: false })} className="frame-slider" data-testid="frame-slider" />
        <button onClick={() => s.set({ shotFrame: shot.frames - 1, presentCamera: null, playing: false })}>⏭</button>
        <span className="frame-info" data-testid="frame-info">Frame {s.shotFrame + 1} / {shot.frames} · {(s.shotFrame / shot.fps).toFixed(2)} s · <b>{gregorian.format(t, 'minute')}</b></span>
      </div>
    </div>
  );
}

export { compare };
