// Rivers drawn on a map (D220): their settings, for the rivers to be drawn (in the options bar) and for a river chosen
// (in Properties, with how wide and deep its valley is cut, another shape of it, and taking it away).
import { useEffect, useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { sculptOf } from '../../world-model/world-settings.ts';
import { LEGACY_RIVER, type RiverSpec } from '../../terrain/river-course.ts';
import { NumberField, fmt } from '../inputs.tsx';
import { fromStore } from '../../core-time/index.ts';

/** A slider that shows its value while dragged and sets it once, when let go (one undo step, one working out). */
function CommitRange({ value, onCommit, testId, title, label }: { value: number; onCommit: (v: number) => void; testId: string; title: string; label: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <label className="inline" title={title}>{label} <b>{Math.round(v * 100)}%</b>
      <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} data-testid={testId} />
    </label>
  );
}

/** A river's settings (D220), for the rivers to be drawn (options bar) or a river chosen (Properties). */
export function RiverSettings({ value, onChange, idPrefix }: { value: RiverSpec; onChange: (patch: Partial<RiverSpec>) => void; idPrefix: string }) {
  return (
    <span className="inline river-settings">
      <label className="inline" title="How wide its water is drawn at its mouth (×1: as usual); narrower upstream and in its tributaries">Width
        <NumberField min={0.2} max={6} step={0.1} def={1} value={value.width} onCommit={(v) => onChange({ width: v })} testId={`${idPrefix}-width`} /> ×
      </label>
      <CommitRange label="Winding" value={value.meander} onCommit={(v) => onChange({ meander: v })} testId={`${idPrefix}-meander`} title="How much it winds, at every scale: most on flat ground, least in the mountains (0: smoothly through its points)" />
      <CommitRange label="Tributaries" value={value.tributaries} onCommit={(v) => onChange({ tributaries: v })} testId={`${idPrefix}-tributaries`} title="How many tributaries the heights around it give it, where their water gathers (0: none)" />
      <label className="check inline" title="Between its points it keeps to the valleys and runs downhill, as water would; otherwise it runs smoothly from point to point">
        <input type="checkbox" checked={value.follow} onChange={(e) => onChange({ follow: e.target.checked })} data-testid={`${idPrefix}-follow`} /> Follows the valleys
      </label>
    </span>
  );
}

/** A river chosen on the map (D220). */
export function RiverPanel({ id, spaceId }: { id: string; spaceId: string }) {
  const s = useStore();
  const st = sculptOf(s.world!.get('map_space', spaceId)).find((x) => x.id === id && x.tool === 'river');
  if (!st) return <div className="river-panel" data-testid="river-panel"><h3>River</h3><p className="muted">This river is no longer on the map.</p></div>;
  const spec = st.river ?? LEGACY_RIVER;
  const update = (patch: Parameters<typeof cmd.updateTerrainStamp>[3]) => s.execute((wd) => cmd.updateTerrainStamp(wd, spaceId, id, patch));
  const n = st.path.length;
  return (
    <div className="river-panel" data-testid="river-panel">
      <h3>River</h3>
      <p className="muted">Worked out from its {n} points{st.river ? '' : ' (drawn before rivers kept their settings: change one to make it like the rivers drawn now)'}. With Select on the map, drag a point to move it, Alt+click one to take it away, double-click the line between two to put one in.</p>
      <div className="river-sel">
        <RiverSettings value={spec} onChange={(patch) => update({ river: { ...spec, ...patch } })} idPrefix="river-sel" />
      </div>
      <p className="muted" data-testid="river-sel-when">{st.from ? `From ${fmt(fromStore(st.from.day, st.from.ms))} on.` : 'In the base world (at every date).'}</p>
      <div className="buttons">
        <button onClick={() => update({ seed: 1 + Math.floor(Math.random() * 999_999) })} title="The same river winding and branching another way" data-testid="river-sel-reshape">Another shape</button>
        <button className="danger" onClick={() => { s.execute((wd) => cmd.removeTerrainStamp(wd, spaceId, id)); s.set({ selection: null }); }} data-testid="river-sel-delete">Remove the river</button>
      </div>
    </div>
  );
}
