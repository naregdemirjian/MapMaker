import { GraphicStyleEditor } from './GraphicStyleEditor.tsx';
import { RangeReset } from '../shell/Reset.tsx';
import { ANIMS_IN, ANIMS_OUT, ANIM_NAMES } from '../../presentation/graphic-style.ts';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useStore, useLive, store } from '../store.ts';
import { Api } from '../api.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, add, fromJSONValue, toJSONValue, fromStore, compare, gregorian, type Precision } from '../../core-time/index.ts';
import { defaultShot, timeAt, cameraAt, RESOLUTIONS, FRAME_RATES, shotTransitions, withStillCamera, unspun, cameraMoves, resetCamera, newTextBox, textBoxOf, EXPORT_FORMATS, isVideoFormat, type ExportFormat, type ShotSettings, type Ease, type ShotTransitions, type Overlay, type TextBox, type TextEnter, type TextExit } from '../../presentation/sequence.ts';
import { PASS_DEFS, runExport, exportPassesOf, estimateExportBytes, scaledBytes, formatBytes, layerPassDefs, passDefsFor } from '../../presentation/export-driver.ts';
import { svgFrame } from '../../presentation/svg-frame.ts';
import { planVideo } from '../../presentation/video-encoder.ts';
import { VIDEO_QUALITIES, formatBitrate, type VideoQuality } from '../../export/video-codecs.ts';
import { eventsBoxOf, DEFAULT_EVENTS_BOX, type EventsBox } from '../../presentation/events-box.ts';
import { LOOKS, LOOK_IDS, GRADES, resolveLook, type LookId, type GradeId, type ShotLook } from '../../presentation/looks.ts';
import { isSpaceMap, calendarOfSpace } from '../../world-model/world-settings.ts';
import { spaceCamera } from '../../space/space-view.ts';
import { LABEL_FONTS } from '../../render-engine/label-style.ts';
import { PROJECTIONS, type ProjectionName, type Camera } from '../../render-engine/camera.ts';
import { parseJSON } from '../../temporal-engine/engine.ts';
import { DateField, NumberField } from './Panels.tsx';
import { currentShot } from './MapView.tsx';
import { TransitionLookControls } from './TransitionLook.tsx';
import { isBaseEvent, MAIN_BRANCH } from '../../world-model/schema.ts';
import { branchTree, branchName } from '../../temporal-engine/branches.ts';
import { audioPlayer, audioPeaks, drawWaveform } from '../audio-track.ts';
import type { ShotAudio } from '../../presentation/sequence.ts';

/**
 * The shot editor's tabs in the Present workspace (D212): every group, or those of one kind. Remembered on this
 * computer. The Export workspace shows only the shot, its output quality and its export.
 */
export const SHOT_TABS: Array<{ id: string; name: string; groups: string[] | null }> = [
  { id: 'all', name: 'All', groups: null },
  { id: 'shot', name: 'Shot', groups: ['Shot'] },
  { id: 'camera', name: 'Camera and timing', groups: ['Timing', 'Camera'] },
  { id: 'look', name: 'Look', groups: ['Look', 'Transitions'] },
  { id: 'graphics', name: 'Graphics and text', groups: ['Current events box', 'Text'] },
  { id: 'sound', name: 'Sound', groups: ['Sound'] },
  { id: 'output', name: 'Output', groups: ['Output quality', 'Export'] },
];
const SHOT_TAB_KEY = 'mapmaker.shotTab';
function loadShotTab(): string {
  try { const v = localStorage.getItem(SHOT_TAB_KEY); return v && SHOT_TABS.some((t) => t.id === v) ? v : 'all'; } catch { return 'all'; }
}

function saveShot(id: string, next: ShotSettings) {
  store.execute((w) => cmd.updateSequence(w, id, { settings: next }));
}

export function ShotsPanel() {
  const s = useStore();
  const w = s.world!;
  const shots = w.all('sequence').sort((a, b) => a.created_seq - b.created_seq);
  // A timelapse of the whole history (improvement pass): from the first change to the last, at an even pace
  // (a second for every eight years, 10 s to 2 min), the date shown to the year, every change animated.
  const wholeHistory = () => {
    const times = (s.engine?.changeInstants() ?? []).filter((t) => Number.isFinite(t.day));
    if (!times.length) { s.toast('There is no history to show yet: draw or import some changes first.', 'error'); return; }
    const first = times[0], last = times[times.length - 1];
    const span = Math.max(1, last.day - first.day), pad = Math.max(30, Math.round(span * 0.02));
    const start = add(first, -pad), end = add(last, pad);
    const years = (end.day - start.day) / 365.2425;
    const seconds = Math.max(10, Math.min(120, years / 8));
    const settings = defaultShot(s.spaceId, s.camera, start, end, 24, seconds);
    if (s.branch !== MAIN_BRANCH) settings.branch = s.branch;
    settings.time = settings.time.map((k) => ({ ...k, ease: 'linear' as Ease }));
    const precision: Precision = years > 30 ? 'year' : years > 2 ? 'month' : 'day';
    settings.overlays = settings.overlays.map((o) => (o.kind === 'date' ? { ...o, datePrecision: precision } : o));
    settings.transitions = { ...shotTransitions(settings), mode: 'all' };
    const id = s.execute((wd) => cmd.createSequence(wd, 'Whole history', settings));
    if (id) s.set({ shotId: id, shotFrame: 0, presentCamera: null });
  };
  const create = () => {
    let start: Instant = s.time, end: Instant = add(s.time, 365);
    if (s.selection?.kind === 'event') {
      const ev = w.get('event', s.selection.id);
      if (ev && !isBaseEvent(ev.id)) {
        start = fromStore(ev.start_day, ev.start_ms);
        end = ev.end_day !== null ? fromStore(ev.end_day, ev.end_ms ?? 0) : add(start, 30);
      }
    }
    const settings = defaultShot(s.spaceId, s.camera, start, end);
    // (A shot shows the timeline being viewed when it is made, D150.)
    if (s.branch !== MAIN_BRANCH) settings.branch = s.branch;
    const id = s.execute((wd) => cmd.createSequence(wd, `Shot ${shots.length + 1}`, settings));
    if (id) s.set({ shotId: id, shotFrame: 0, presentCamera: null });
  };
  return (
    <aside className="left">
      <section className="section">
        <div className="section-head"><span>Shots</span><span><button className="small" onClick={wholeHistory} title="A shot of everything that happens: from the first change to the last, at an even pace, the year counting up, every change animated" data-testid="new-shot-history">+ Whole history</button> <button className="small" onClick={create} data-testid="new-shot">+ Shot</button></span></div>
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

export function ShotEditor({ only }: { only?: 'export' } = {}) {
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
  const [tab, setTab] = useState(loadShotTab);
  const cancel = useRef(false);
  useEffect(() => setName(row?.name ?? ''), [s.shotId]);
  if (!shot || !row) return <aside className="right"><div className="panel"><h3>Presentation</h3><p className="muted">Create or pick a shot on the left. Its preview appears in the middle; drag and scroll there to frame the view.</p></div></aside>;
  const seconds = shot.frames / shot.fps;
  const passes = exportPassesOf(shot);
  const setPasses = (next: string[]) => update({ exportPasses: passDefsFor(w, shot).map((d) => d.name).filter((n) => next.includes(n)) });
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
  const setCamera = (cam: typeof liveCamera) => { saveShot(row.id, withStillCamera(shot, unspun(shot, cam, s.shotFrame))); s.set({ presentCamera: null }); };
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
        projectId: s.projectId!, world: w, engine: s.engineFor(shot.branch), shot, shotName: row.name, passNames: passes, scale,
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
      const f = await svgFrame({ world: w, engine: s.engineFor(shot.branch), shot, shotName: row.name, frame: s.shotFrame });
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
      {only !== 'export' && (
        <div className="list-tabs shot-tabs" role="tablist" aria-label="Settings of the shot" data-testid="shot-tabs">
          {SHOT_TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`list-tab ${tab === t.id ? 'on' : ''}`} onClick={() => { setTab(t.id); try { localStorage.setItem(SHOT_TAB_KEY, t.id); } catch { /* (not kept) */ } }} data-testid={`shot-tab-${t.id}`}>{t.name}</button>)}
        </div>
      )}
      <div className="panel shot-panel">
        <GroupsShown.Provider value={only === 'export' ? EXPORT_GROUPS : SHOT_TABS.find((t) => t.id === tab)?.groups ?? null}>
        <Group title="Shot">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== row.name && s.execute((wd) => cmd.updateSequence(wd, row.id, { name: name.trim() }))} /></label>
          {(w.all('branch').length > 0 || (shot.branch && shot.branch !== MAIN_BRANCH)) && (
            <label title="Which history the shot shows: the main timeline or one of its branches (D150)">Timeline
              <select value={shot.branch && w.get('branch', shot.branch) ? shot.branch : MAIN_BRANCH} onChange={(e) => update({ branch: e.target.value === MAIN_BRANCH ? undefined : e.target.value })} data-testid="shot-branch">
                {branchTree(w).map((b) => <option key={b.id} value={b.id}>{'\u00a0\u00a0'.repeat(b.depth)}{branchName(w, b.id)}</option>)}
              </select>
            </label>
          )}
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
          <label title="Several pictures averaged into each exported frame, so what moves is smeared along its way as on film (exports take as many times longer)">Motion blur<select value={shot.motionBlur?.samples ?? 0} onChange={(e) => { const n = Number(e.target.value); update({ motionBlur: n > 1 ? { samples: n, shutter: shot.motionBlur?.shutter ?? 0.5 } : undefined }); }} data-testid="export-motion-blur">
            <option value={0}>None</option><option value={4}>Light (4 pictures a frame)</option><option value={8}>Film (8)</option><option value={16}>Smooth (16)</option>
          </select></label>
          {shot.motionBlur && <label title="How much of the time between frames the pictures are spread over (half, as a film camera's shutter)">Shutter (%)<NumberField min={5} max={100} step={5} value={Math.round(shot.motionBlur.shutter * 100)} def={50} onCommit={(n) => update({ motionBlur: { ...shot.motionBlur!, shutter: n / 100 } })} testId="export-shutter" /></label>}
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
        <Group title="Sound" open={!!shot.audio}>
          <p className="muted small-text">Music or a narration to time the shot to (D151): heard while the shot plays here, its waveform under the frames, a copy written beside every export to line up in your editor. It is not mixed into exported videos.</p>
          {shot.audio ? <>
            <div className="row-inline"><span data-testid="shot-audio-name">♪ {shot.audio.name}</span>
              <button className="small" onClick={() => update({ audio: undefined })} data-testid="shot-audio-remove">Remove</button></div>
            <label title="The second of the track heard at the shot's first frame">Track second at the first frame<NumberField min={0} max={36000} step={0.1} value={shot.audio.offset} onCommit={(n) => update({ audio: { ...shot.audio!, offset: Math.max(0, n) } })} testId="shot-audio-offset" /></label>
            <label>Volume (%)<span className="row-inline amount"><input type="range" min={0} max={100} step={5} value={Math.round(shot.audio.volume * 100)} onChange={(e) => update({ audio: { ...shot.audio!, volume: Number(e.target.value) / 100 } })} data-testid="shot-audio-volume" /><RangeReset def={100} value={Math.round(shot.audio.volume * 100)} /><span className="muted amount-value">{Math.round(shot.audio.volume * 100)}</span></span></label>
          </> : (
            <label className="file-button">Choose a sound file…<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus" data-testid="shot-audio-file" onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try { const a = await Api.uploadAsset(s.projectId!, file); update({ audio: { asset: a.file, name: file.name, offset: 0, volume: 0.8 } }); } catch (err) { s.toast((err as Error).message, 'error'); }
            }} /></label>
          )}
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
          <label>Rotation (degrees)<NumberField min={-360} max={360} step={1} value={Math.round(liveCamera.rotation)} def={0} onCommit={(n) => setCamera({ ...liveCamera, rotation: n })} testId="camera-rotation" /></label>
          {shot.camera[0].camera.projection === 'globe' && <>
            <label>Turn the globe (degrees a second)<NumberField min={-120} max={120} step={1} value={shot.spin ?? 0} def={0} onCommit={(n) => update({ spin: n })} testId="globe-spin" /></label>
            <p className="muted">The planet turns through the shot as the Earth does (west to east) at this speed; negative turns it the other way, 0 holds it still. 15 is one turn in 24 seconds.</p>
          </>}
        </Group>
        <Group title="Transitions">
          <label>Border changes<select value={tr.mode} onChange={(e) => setTr({ mode: e.target.value as ShotTransitions['mode'] })} data-testid="transition-mode">
            <option value="recorded">As recorded (animated where you set an animation)</option>
            <option value="all">Animate every change</option>
            <option value="instant">No animation: change instantly</option>
          </select></label>
          {tr.mode !== 'instant' && <>
            <TransitionLookControls tr={tr} onChange={(t) => update({ transitions: t })} />
            {tr.mode === 'recorded' && !tr.restyleRecorded && <p className="muted">Changes keep the animation recorded for them (front, expansion, dissolve or fade) and take this look's edges, glow and line.</p>}
            <label className="check"><input type="checkbox" checked={tr.restyleRecorded} onChange={(e) => setTr({ restyleRecorded: e.target.checked })} data-testid="transition-restyle" /> {tr.mode === 'all' ? 'Changes recorded with their own animation use these settings too' : 'Use the settings below for recorded animations too'}</label>
            {(tr.mode === 'all' || tr.restyleRecorded) && <>
              <label>Style<select value={tr.style} onChange={(e) => setTr({ style: e.target.value as ShotTransitions['style'], look: 'custom' })} data-testid="transition-style-shot">
                <option value="border">Advancing front (through the land from the country's border)</option>
                <option value="advance">Expansion (from where the drawing started, or the middle)</option>
                <option value="dissolve">Dissolve (changing hands in patches)</option>
                <option value="fade">Fade</option>
              </select></label>
              <label>Length<select value={tr.timing} onChange={(e) => setTr({ timing: e.target.value as ShotTransitions['timing'] })}>
                <option value="seconds">Fixed screen time</option>
                <option value="event">The event's length (events without an end use screen time)</option>
              </select></label>
              <label>Screen time per change (seconds)<NumberField min={0.05} max={120} step={0.25} value={tr.seconds} onCommit={(n) => setTr({ seconds: n })} testId="transition-seconds" /></label>
              <label>Easing<select value={tr.easing} onChange={(e) => setTr({ easing: e.target.value as ShotTransitions['easing'], look: 'custom' })} data-testid="transition-easing">
                <option value="smooth">Ease in and out</option><option value="linear">Even</option><option value="in">Ease in (start slow)</option><option value="out">Ease out (end slow)</option>
              </select></label>
            </>}
          </>}
        </Group>
        <Group title="Current events box" open={box.show}>
          <label className="check"><input type="checkbox" checked={box.show} onChange={(e) => setBox({ show: e.target.checked })} data-testid="events-box-show" /> Show the events happening on screen</label>
          {box.show && <>
            <label>Position<select value={box.corner} onChange={(e) => setBox({ corner: e.target.value as EventsBox['corner'] })} data-testid="events-box-corner">
              <option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="top-right">Top right</option><option value="top-left">Top left</option><option value="custom">Custom</option>
            </select></label>
            {box.corner === 'custom' && <div className="two">
              <label>Left (% of width)<NumberField min={0} max={100} step={1} value={Math.round(box.x * 100)} def={Math.round(DEFAULT_EVENTS_BOX.x * 100)} onCommit={(n) => setBox({ x: n / 100 })} /></label>
              <label>Top (% of height)<NumberField min={0} max={100} step={1} value={Math.round(box.y * 100)} def={Math.round(DEFAULT_EVENTS_BOX.y * 100)} onCommit={(n) => setBox({ y: n / 100 })} /></label>
            </div>}
            <label>Heading<input value={box.title} placeholder="(none)" onChange={(e) => setBox({ title: e.target.value })} data-testid="events-box-title" /></label>
            <label className="check"><input type="checkbox" checked={box.showDate} onChange={(e) => setBox({ showDate: e.target.checked })} /> Show the date and time</label>
            {box.showDate && <label>Date detail<select value={box.datePrecision} onChange={(e) => setBox({ datePrecision: e.target.value as Precision })}>
              <option value="year">Year</option><option value="month">Month</option><option value="day">Day</option><option value="minute">Hour and minute</option><option value="second">Seconds</option>
            </select></label>}
            <div className="two">
              <label>Most events listed<NumberField min={0} max={20} step={1} value={box.maxEvents} def={DEFAULT_EVENTS_BOX.maxEvents} onCommit={(n) => setBox({ maxEvents: Math.round(n) })} /></label>
              <label>Events without an end stay (s)<NumberField min={0} max={60} step={0.5} value={box.linger} def={DEFAULT_EVENTS_BOX.linger} onCommit={(n) => setBox({ linger: n })} /></label>
            </div>
            <label className="check" title="The box is as tall as the most events it lists need (each name on one line, shortened if long), so events come and go inside it and it never grows, shrinks or moves"><input type="checkbox" checked={!!box.keepSize} onChange={(e) => setBox({ keepSize: e.target.checked })} data-testid="events-box-keep-size" /> Keep its size and place (room for {box.maxEvents} {box.maxEvents === 1 ? 'event' : 'events'})</label>
            <label>Fade in and out (s)<NumberField min={0} max={10} step={0.1} value={box.fade} def={DEFAULT_EVENTS_BOX.fade} onCommit={(n) => setBox({ fade: n })} /></label>
            <label className="check"><input type="checkbox" checked={box.showDescription} onChange={(e) => setBox({ showDescription: e.target.checked })} /> Show each event's description</label>
            <label className="check"><input type="checkbox" checked={box.hideWhenEmpty} onChange={(e) => setBox({ hideWhenEmpty: e.target.checked })} data-testid="events-box-hide-empty" /> Hide the box while no event is listed</label>
            {w.all('event_group').length > 0 && <>
              <label className="check"><input type="checkbox" checked={box.groups === null} onChange={(e) => setBox({ groups: e.target.checked ? null : [] })} /> Events of every group</label>
              {box.groups !== null && w.all('event_group').map((g) => (
                <label key={g.id} className="check"><input type="checkbox" checked={box.groups!.includes(g.id)} onChange={(e) => setBox({ groups: e.target.checked ? [...box.groups!, g.id] : box.groups!.filter((x) => x !== g.id) })} /><span className="swatch" style={{ background: g.color }} />{g.name}</label>
              ))}
            </>}
            <h4>Look</h4>
            <label>Font<select value={box.font} onChange={(e) => setBox({ font: e.target.value })}>{(LABEL_FONTS.includes(box.font) ? LABEL_FONTS : [box.font, ...LABEL_FONTS]).map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
            <div className="two">
              <label>Heading size<NumberField min={6} max={200} step={1} value={box.titleSize} def={DEFAULT_EVENTS_BOX.titleSize} onCommit={(n) => setBox({ titleSize: n })} /></label>
              <label>Date size<NumberField min={6} max={200} step={1} value={box.dateSize} def={DEFAULT_EVENTS_BOX.dateSize} onCommit={(n) => setBox({ dateSize: n })} /></label>
              <label>Event size<NumberField min={6} max={200} step={1} value={box.textSize} def={DEFAULT_EVENTS_BOX.textSize} onCommit={(n) => setBox({ textSize: n })} /></label>
              <label>Width<NumberField min={80} max={1920} step={10} value={box.width} def={DEFAULT_EVENTS_BOX.width} onCommit={(n) => setBox({ width: n })} /></label>
            </div>
            <div className="two">
              <label>Heading colour<input type="color" value={box.titleColor} onChange={(e) => setBox({ titleColor: e.target.value })} /></label>
              <label>Date colour<input type="color" value={box.dateColor} onChange={(e) => setBox({ dateColor: e.target.value })} /></label>
              <label>Event colour<input type="color" value={box.textColor} onChange={(e) => setBox({ textColor: e.target.value })} /></label>
              <label>Bullet colour<input type="color" value={box.accentColor} onChange={(e) => setBox({ accentColor: e.target.value })} /></label>
              <label>Background<input type="color" value={box.background} onChange={(e) => setBox({ background: e.target.value })} /></label>
              <label>Background opacity (%)<NumberField min={0} max={100} step={5} value={Math.round(box.backgroundOpacity * 100)} def={Math.round(DEFAULT_EVENTS_BOX.backgroundOpacity * 100)} onCommit={(n) => setBox({ backgroundOpacity: n / 100 })} /></label>
              <label>Border colour<input type="color" value={box.borderColor} onChange={(e) => setBox({ borderColor: e.target.value })} /></label>
              <label>Border width<NumberField min={0} max={40} step={0.5} value={box.borderWidth} def={DEFAULT_EVENTS_BOX.borderWidth} onCommit={(n) => setBox({ borderWidth: n })} /></label>
              <label>Corner rounding<NumberField min={0} max={200} step={1} value={box.radius} def={DEFAULT_EVENTS_BOX.radius} onCommit={(n) => setBox({ radius: n })} /></label>
              <label>Inner spacing<NumberField min={0} max={200} step={1} value={box.padding} def={DEFAULT_EVENTS_BOX.padding} onCommit={(n) => setBox({ padding: n })} /></label>
              <label>Distance from the edge<NumberField min={0} max={500} step={1} value={box.margin} def={DEFAULT_EVENTS_BOX.margin} onCommit={(n) => setBox({ margin: n })} /></label>
              <label>Fixed height (0 = fit)<NumberField min={0} max={2000} step={10} value={box.height} def={DEFAULT_EVENTS_BOX.height} onCommit={(n) => setBox({ height: n })} /></label>
            </div>
            <h4>Style</h4>
            <GraphicStyleEditor value={box.style} idPrefix="events-box"
              onChange={(st) => setBox({ style: st })}
              onTemplate={(tp) => setBox({ style: tp.style, titleColor: tp.colors.title, accentColor: tp.colors.accent, textColor: tp.colors.text, dateColor: tp.colors.text, background: tp.colors.background, backgroundOpacity: tp.colors.backgroundOpacity, font: tp.colors.font })} />
            <label>Events come in<select value={box.itemEnter ?? 'fade'} onChange={(e) => setBox({ itemEnter: e.target.value as 'fade' })} data-testid="events-box-item-enter">
              <option value="fade">Fading in</option><option value="slide">Sliding in</option><option value="blur">Coming into focus</option>
            </select></label>
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
              <label>Picture opacity (%)<NumberField min={0} max={100} step={5} value={Math.round(box.imageOpacity * 100)} def={Math.round(DEFAULT_EVENTS_BOX.imageOpacity * 100)} onCommit={(n) => setBox({ imageOpacity: n / 100 })} /></label>
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
            <label>Border width<NumberField min={0} max={20} step={0.1} value={look.borderWidth} def={LOOKS[look.id].look.borderWidth} onCommit={(n) => setLook({ borderWidth: n })} testId="look-border-width" /></label>
            <label>Colour grade<select value={look.grade} onChange={(e) => setLook({ grade: e.target.value as GradeId })} data-testid="look-grade">
              {(Object.keys(GRADES) as GradeId[]).map((g) => <option key={g} value={g}>{GRADES[g].name}</option>)}
            </select></label>
            <label title="The frame's edges darkened, drawing the eye to the middle">Darker edges<input type="range" min={0} max={1} step={0.05} value={look.vignette} onChange={(e) => setLook({ vignette: Number(e.target.value) })} data-testid="look-vignette" /><RangeReset def={LOOKS[look.id].look.vignette} value={look.vignette} /></label>
            <label title="The fine grain of paper over the map">Paper grain<input type="range" min={0} max={1} step={0.05} value={look.grain} onChange={(e) => setLook({ grain: Number(e.target.value) })} data-testid="look-grain" /><RangeReset def={LOOKS[look.id].look.grain} value={look.grain} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={look.blotches} onChange={(e) => setLook({ blotches: e.target.checked })} data-testid="look-blotches" /> Stains of old paper</label>
          {shot.look && Object.keys(shot.look).length > 1 && <div className="buttons"><button className="small" onClick={() => update({ look: { id: look.id } })} data-testid="look-reset">Back to the look's own colours</button></div>}
          <p className="muted">The grade, darker edges and paper are over the map in every exported layer, never over the texts; transparent parts stay transparent.</p>
          <label className="check"><input type="checkbox" checked={shot.graticule} onChange={(e) => update({ graticule: e.target.checked })} /> Latitude and longitude grid</label>
          <label className="check"><input type="checkbox" checked={shot.labels} onChange={(e) => update({ labels: e.target.checked })} /> Country labels</label>
          <label className="check"><input type="checkbox" checked={shot.cities !== false} onChange={(e) => update({ cities: e.target.checked })} data-testid="shot-cities" /> Cities</label>
          <label className="check"><input type="checkbox" checked={shot.characters !== false} onChange={(e) => update({ characters: e.target.checked })} data-testid="shot-characters" /> Characters</label>
          {shot.characters !== false && <label className="check"><input type="checkbox" checked={!!shot.trails} onChange={(e) => update({ trails: e.target.checked })} data-testid="shot-trails" /> Their routes so far (trails)</label>}
          {shot.characters !== false && shot.trails && <label>Trails from<select value={shot.trailsFrom ?? 'all'} onChange={(e) => update({ trailsFrom: e.target.value === 'shot' ? 'shot' : undefined })} data-testid="shot-trails-from">
            <option value="all">the beginning of each route</option>
            <option value="shot">the shot's first moment (only the way travelled in the shot)</option>
          </select></label>}
        </Group>
        <Group title="Text">
          <p className="muted">Drag the date, the title or the events box on the preview to place them anywhere.</p>
          <label className="check"><input type="checkbox" checked={!!dateOverlay} onChange={(e) => update({ overlays: e.target.checked ? [...shot.overlays, defaultShot(shot.spaceId, liveCamera, startT, endT, shot.fps, seconds).overlays[0]] : shot.overlays.filter((o) => o.kind !== 'date') })} /> Show the date</label>
          {dateOverlay && <label>Date detail<select value={dateOverlay.datePrecision} onChange={(e) => update({ overlays: shot.overlays.map((o) => (o.kind === 'date' ? { ...o, datePrecision: e.target.value as Precision } : o)) })}>
            <option value="year">Year</option><option value="month">Month</option><option value="day">Day</option><option value="minute">Hour and minute</option><option value="second">Seconds</option>
          </select></label>}
          {shot.overlays.some((o) => !o.box) && <details>
            <summary>Style of the date and title{shot.overlays.some((o) => !o.box && o.style) ? ' (set)' : ''}</summary>
            <GraphicStyleEditor value={shot.overlays.find((o) => !o.box && o.style)?.style} idPrefix="date-title"
              onChange={(st) => update({ overlays: shot.overlays.map((o) => (o.box ? o : { ...o, style: st })) })}
              onTemplate={(tp) => update({ overlays: shot.overlays.map((o) => (o.box ? o : { ...o, style: tp.style, color: tp.colors.text, background: tp.colors.backgroundOpacity > 0 ? rgbaOf(tp.colors.background, tp.colors.backgroundOpacity) : null })) })} />
          </details>}
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
            {!spaceMap && layerPassDefs(w, shot).length > 1 && <>
              <p className="muted">Or each layer on its own (its fills and borders, areas and lines, or conditions), to fade or colour a layer apart:</p>
              {layerPassDefs(w, shot).map((d) => (
                <label key={d.name} className="check" title={d.note ?? ''}><input type="checkbox" checked={passes.includes(d.name)} onChange={(e) => setPasses(e.target.checked ? [...passes, d.name] : passes.filter((p) => p !== d.name))} data-testid={`pass-layer-${d.label.slice(7)}`} /> {d.label}</label>
              ))}
            </>}
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
        </GroupsShown.Provider>
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
      <p className="muted">Write {'{date}'} for the date shown, and a statistic's name in braces (such as {'{GDP}'}, from the map's Statistics) for its value then. Drag the box on the preview to place it.</p>
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
          {ANIMS_IN.map((a) => <option key={a} value={a}>{ANIM_NAMES[a]}</option>)}
        </select></label>
        <label>Goes<select value={b.exit} onChange={(e) => set({}, { exit: e.target.value as TextExit })} data-testid="text-box-exit">
          {ANIMS_OUT.map((a) => <option key={a} value={a}>{ANIM_NAMES[a]}</option>)}
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
      <details className="text-box-style">
        <summary>Style{o.style ? ' (set)' : ''}</summary>
        <GraphicStyleEditor value={o.style} idPrefix="text-box"
          onChange={(st) => update({ overlays: shot.overlays.map((x) => (x.id === o.id ? { ...x, style: st } : x)) })}
          onTemplate={(tp) => update({ overlays: shot.overlays.map((x) => (x.id === o.id ? { ...x, style: tp.style, color: tp.colors.text, background: tp.colors.backgroundOpacity > 0 ? rgbaOf(tp.colors.background, tp.colors.backgroundOpacity) : null, box: { ...b, font: tp.colors.font } } : x)) })} />
      </details>
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
      estimateExportBytes(s.world, s.engineFor(shot.branch), shot, passes).then((bytes) => { if (!stale) onEstimate({ key: estimateKey, bytes }); }, () => undefined);
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

/** The groups of a shot's settings shown (null: all of them). The Export workspace shows those of the export alone. */
const GroupsShown = createContext<string[] | null>(null);
const EXPORT_GROUPS = ['Shot', 'Output quality', 'Export'];

/** A collapsible group of settings. */
function Group({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  const only = useContext(GroupsShown);
  if (only && !only.includes(title)) return null;
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
    // The audio reference track (D151), heard from the frame the shot plays from; while it sounds, its own
    // clock moves the frames, so picture and sound stay together.
    const au = shot.audio ? audioPlayer(shot.audio.asset) : null;
    let heard = false;
    if (au && shot.audio) {
      const at = shot.audio.offset + startFrame / shot.fps;
      au.volume = Math.max(0, Math.min(1, shot.audio.volume));
      if (at >= 0 && (!Number.isFinite(au.duration) || at < au.duration)) {
        au.currentTime = at;
        au.play().then(() => { heard = true; }, () => undefined);
      }
    }
    const tick = () => {
      const f = au && heard && !au.paused && shot.audio
        ? Math.floor((au.currentTime - shot.audio.offset) * shot.fps)
        : startFrame + Math.floor(((performance.now() - startWall) / 1000) * shot.fps);
      if (f >= shot.frames - 1) { store.set({ shotFrame: shot.frames - 1, playing: false, presentCamera: null }); return; }
      store.setLive({ shotFrame: Math.max(startFrame, f), presentCamera: null });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); au?.pause(); };
  }, [s.playing, s.shotId]);
  if (!shot) return <div className="timeline shot-timeline"><ShotClips /><div className="muted pad">No shot selected.</div></div>;
  const t = timeAt(shot, s.shotFrame);
  return (
    <div className="timeline shot-timeline">
      <div className="shot-controls">
        <button onClick={() => s.set({ playing: !s.playing })} data-testid="play">{s.playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => s.set({ shotFrame: 0, presentCamera: null, playing: false })}>⏮</button>
        <input type="range" min={0} max={shot.frames - 1} value={s.shotFrame} onChange={(e) => s.setLive({ shotFrame: Number(e.target.value), presentCamera: null, playing: false })} className="frame-slider" data-testid="frame-slider" />
        <button onClick={() => s.set({ shotFrame: shot.frames - 1, presentCamera: null, playing: false })}>⏭</button>
        <span className="frame-info" data-testid="frame-info">Frame {s.shotFrame + 1} / {shot.frames} · {(s.shotFrame / shot.fps).toFixed(2)} s · <b>{calendarOfSpace(s.world?.get('map_space', shot.spaceId)).format(t, 'minute')}</b></span>
      </div>
      <ShotClips />
      {shot.audio && <Waveform audio={shot.audio} seconds={shot.frames / shot.fps} at={s.shotFrame / shot.fps} />}
    </div>
  );
}

/**
 * The shots as clips one after another (D212), as long as they last: a click on one chooses it; on the one chosen, a
 * click or drag moves to that frame, its playhead showing where the preview is.
 */
function ShotClips() {
  const s = useLive();
  const drag = useRef(false);
  const w = s.world;
  if (!w) return null;
  const clips = w.all('sequence').sort((a, b) => a.created_seq - b.created_seq).map((sh) => {
    const st = parseJSON<ShotSettings | null>(sh.settings, null);
    return { sh, st, secs: st ? st.frames / st.fps : 1 };
  });
  if (!clips.length) return null;
  const frameAt = (el: HTMLElement, x: number, frames: number) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(frames - 1, Math.round(((x - r.left) / Math.max(1, r.width)) * (frames - 1)))); };
  return (
    <div className="shot-clips" data-testid="shot-clips">
      {clips.map(({ sh, st, secs }) => {
        const on = sh.id === s.shotId;
        return (
          <div key={sh.id} className={`shot-clip ${on ? 'on' : ''}`} style={{ flexGrow: secs }} data-testid="shot-clip" data-shot={sh.id} title={on ? 'Click or drag to move through the shot' : `Choose “${sh.name}”`}
            onPointerDown={(e) => {
              if (!on || !st) { store.set({ shotId: sh.id, shotFrame: 0, presentCamera: null, playing: false, spaceId: st?.spaceId ?? store.spaceId }); return; }
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = true;
              store.setLive({ shotFrame: frameAt(e.currentTarget, e.clientX, st.frames), presentCamera: null, playing: false });
            }}
            onPointerMove={(e) => { if (drag.current && on && st) store.setLive({ shotFrame: frameAt(e.currentTarget, e.clientX, st.frames), presentCamera: null }); }}
            onPointerUp={() => { drag.current = false; }}
            onPointerCancel={() => { drag.current = false; }}>
            <span className="shot-clip-name">{sh.name}</span>
            <span className="shot-clip-len">{secs < 10 ? secs.toFixed(1) : Math.round(secs)} s</span>
            {on && st && <span className="shot-clip-head" style={{ left: `${(s.shotFrame / Math.max(1, st.frames - 1)) * 100}%` }} />}
          </div>
        );
      })}
    </div>
  );
}

/** The audio reference track under the frames (D151): the part of it the shot covers, where the frame shown is. */
function Waveform({ audio, seconds, at }: { audio: ShotAudio; seconds: number; at: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [wave, setWave] = useState<{ duration: number; data: Float32Array } | null | undefined>(undefined);
  useEffect(() => { let live = true; setWave(undefined); audioPeaks(audio.asset).then((w) => { if (live) setWave(w); }); return () => { live = false; }; }, [audio.asset]);
  useEffect(() => { if (ref.current && wave) drawWaveform(ref.current, wave, audio.offset, seconds, audio.offset + at); }, [wave, audio.offset, seconds, at]);
  return (
    <div className="shot-waveform" data-testid="shot-waveform" title={`${audio.name}: from ${audio.offset.toFixed(2)} s of it at the first frame`}>
      {wave === null ? <span className="muted">The sound of "{audio.name}" could not be read here; it still goes beside the exports.</span> : <canvas ref={ref} />}
    </div>
  );
}

export { compare };
