import { useStore } from '../store.ts';
import { PRESETS, presetOf, type PresetName, type ViewSettings } from '../view-settings.ts';

/** One setting: its name, a line saying what it trades, and its choices. */
function Choice<T extends string | number>({ label, about, value, options, onChange, testId }: { label: string; about: string; value: T; options: Array<{ value: T; name: string }>; onChange: (v: T) => void; testId: string }) {
  return (
    <div className="setting">
      <div className="setting-text"><div>{label}</div><div className="muted small-text">{about}</div></div>
      <select value={String(value)} onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)} data-testid={testId}>
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.name}</option>)}
      </select>
    </div>
  );
}

/**
 * Settings for the working view: how the map is drawn on this computer while editing and
 * previewing. Nothing here is stored in the project or changes an export.
 */
export function SettingsDialog() {
  const s = useStore();
  const v = s.viewSettings;
  const set = (patch: Partial<ViewSettings>) => s.setViewSettings({ ...v, ...patch });
  const preset = presetOf(v);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && s.set({ dialog: null })}>
      <div className="modal wide" role="dialog" aria-label="Settings" data-testid="settings-dialog">
        <div className="modal-head"><h2>Settings</h2><button className="close" onClick={() => s.set({ dialog: null })} aria-label="Close">×</button></div>
        <h4>Speed of the working view</h4>
        <p className="muted">
          How the map is drawn on this computer while you work. These settings never change what you can make, and never
          change an export: every exported frame is drawn afresh at the finest quality, whatever is chosen here.
        </p>
        <div className="preset-row">
          {(Object.keys(PRESETS) as PresetName[]).map((name) => (
            <button key={name} className={`preset ${preset === name ? 'on' : ''}`} onClick={() => set(PRESETS[name].settings)} data-testid={`preset-${name}`}>
              <strong>{PRESETS[name].name}</strong>
              <span className="muted small-text">{PRESETS[name].about}</span>
            </button>
          ))}
        </div>
        <p className="muted small-text" data-testid="preset-current">{preset ? `Using: ${PRESETS[preset].name}.` : 'Using your own choices below.'}</p>
        <Choice label="While the map moves" testId="setting-moving" value={v.whileMoving} onChange={(whileMoving) => set({ whileMoving })}
          about="Moving the picture along is far faster on large projects; it is drawn afresh, sharp, a moment after the map stops."
          options={[{ value: 'carry', name: 'Move the picture along, sharpen when it stops' }, { value: 'redraw', name: 'Draw everything again each time' }]} />
        <Choice label="Country names while the map moves" testId="setting-names" value={v.names} onChange={(names) => set({ names })}
          about="Finding the best place for every name takes time; names that stay put also read more calmly."
          options={[{ value: 'hold', name: 'Stay where they are on the map' }, { value: 'place', name: 'Placed again for every movement' }, { value: 'hide', name: 'Hidden until the map stops' }]} />
        <Choice label="Sharpness" testId="setting-resolution" value={v.resolution} onChange={(resolution) => set({ resolution })}
          about="Fewer pixels to draw, shown at the same size. Helps most on very high resolution screens."
          options={[{ value: 1, name: 'Full (as sharp as the screen)' }, { value: 0.75, name: 'Three quarters' }, { value: 0.5, name: 'Half' }]} />
        <Choice label="Outlines" testId="setting-detail" value={v.detail} onChange={(detail) => set({ detail })}
          about="How closely borders and coasts on screen follow their true shape (differences are fractions of a pixel)."
          options={[{ value: 'fine', name: 'Finest' }, { value: 'normal', name: 'Normal' }, { value: 'coarse', name: 'Simpler' }]} />
        <Choice label="Coastlines close up" testId="setting-coast" value={v.coast} onChange={(coast) => set({ coast })}
          about="The most detailed coastlines take longer to draw when zoomed far in."
          options={[{ value: 'full', name: 'Most detailed' }, { value: 'medium', name: 'Medium at every zoom' }]} />
        <label className="check setting-check"><input type="checkbox" checked={v.showSpeed} onChange={(e) => set({ showSpeed: e.target.checked })} data-testid="setting-speed" /> Show how long the map takes to draw (in a corner of the map)</label>
        <div className="modal-actions"><button className="primary" onClick={() => s.set({ dialog: null })} data-testid="settings-close">Done</button></div>
      </div>
    </div>
  );
}
