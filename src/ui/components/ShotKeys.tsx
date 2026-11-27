// The shot's keyed settings as tracks (D240, S5 of the studios plan): under the shots in the shot's timeline, a track for
// each setting of looks keyed in the shot ("Kingdom of Testa · Look · Drop shadow · Distance"), its keys as diamonds
// along the shot's frames, the frame shown as a line across them. A click on a diamond goes to its frame and chooses it;
// dragged, it moves (one undo step); Delete removes the one chosen; right-click: how the setting goes on from it to the
// next key, or remove it. A click or drag on a track goes through the frames. The track's name chooses the thing (its
// Looks show); its ✕ stops animating the setting (all its keys).
import { useState } from 'react';
import { useLive, store, type Selection } from '../store.ts';
import { openMenu } from './ContextMenu.tsx';
import { tracksOf, trackIdOf, movedKey, withoutKey, easedKey, withoutTrack, KEY_EASES, type LookTrack, type KeyEase, type KeyValue } from '../../presentation/shot-looks.ts';
import type { World } from '../../world-model/world.ts';

const thingName = (w: World, t: LookTrack): string => (w.get(t.table, t.id) as { name?: string } | undefined)?.name ?? '(gone)';
const selectionOf = (t: LookTrack): Selection => ({ kind: t.table === 'entity' ? 'entity' : t.table === 'entity_group' ? 'group' : t.table === 'layer' ? 'layer' : 'feature', id: t.id } as Selection);
const easeName = (e: KeyEase) => KEY_EASES.find(([k]) => k === e)?.[1] ?? e;
const valueText = (v: KeyValue) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v);

export function ShotKeys() {
  const s = useLive();
  const [chosen, setChosen] = useState<{ track: string; frame: number } | null>(null);
  const [drag, setDrag] = useState<{ track: string; from: number; to: number } | null>(null);
  const sh = s.openShot();
  if (!sh || !s.world) return null;
  const tracks = tracksOf(sh.settings.keys);
  if (!tracks.length) return null;
  const w = s.world;
  const last = Math.max(1, sh.settings.frames - 1);
  const pct = (f: number) => `${(Math.min(f, last) / last) * 100}%`;
  const frameAt = (lane: Element, x: number) => { const r = lane.getBoundingClientRect(); return Math.max(0, Math.min(last, Math.round(((x - r.left) / Math.max(1, r.width)) * last))); };
  const go = (f: number) => store.setLive({ shotFrame: f, presentCamera: null, playing: false });
  return (
    <div className="shot-keys" data-testid="shot-keys">
      {tracks.map((t) => {
        const id = trackIdOf(t);
        const name = `${thingName(w, t)} · ${t.label}`;
        const remove = (frame: number) => { store.setShotKeys(withoutKey(tracks, id, frame), `Remove a key of ${name}`); setChosen(null); };
        return (
          <div key={id} className="key-track" data-testid="key-track" data-name={name}>
            <div className="key-track-head">
              <button className="link key-track-name" onClick={() => store.set({ selection: selectionOf(t), multi: null })} title={`${name}: ${t.keys.length} key${t.keys.length === 1 ? '' : 's'} (choose it: its looks in the Looks panel)`} data-testid="key-track-name">{name}</button>
              <button className="small key-track-remove" onClick={() => store.setShotKeys(withoutTrack(tracks, id), `Stop animating ${name}`)} title="Stop animating it: all its keys removed (it keeps its value at the frame shown)" data-testid="key-track-remove">✕</button>
            </div>
            <div className="key-lane" data-testid="key-lane"
              onPointerDown={(e) => { if (e.button !== 0 || e.target !== e.currentTarget) return; e.currentTarget.setPointerCapture(e.pointerId); go(frameAt(e.currentTarget, e.clientX)); }}
              onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) go(frameAt(e.currentTarget, e.clientX)); }}>
              {t.keys.map((k) => {
                const moving = drag?.track === id && drag.from === k.frame;
                const at = moving ? drag.to : k.frame;
                const on = chosen?.track === id && chosen.frame === k.frame;
                return (
                  <button key={k.frame} className={`key-diamond ${on ? 'chosen' : ''} ${k.ease === 'hold' ? 'hold' : ''} ${k.frame > last ? 'after' : ''}`} style={{ left: pct(at) }}
                    title={`Frame ${k.frame + 1}${k.frame > last ? ' (after the shot\'s end)' : ''}: ${valueText(k.value)}; then ${easeName(k.ease).toLowerCase()} to the next. Drag to move it; Delete removes it; right-click for more`}
                    data-testid="key-diamond" data-frame={k.frame}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDrag({ track: id, from: k.frame, to: k.frame });
                      setChosen({ track: id, frame: k.frame });
                      go(k.frame);
                    }}
                    onPointerMove={(e) => {
                      if (!moving || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      const to = frameAt(e.currentTarget.parentElement!, e.clientX);
                      if (to !== drag.to) { setDrag({ ...drag, to }); go(to); }
                    }}
                    onPointerUp={() => {
                      if (moving && drag.to !== drag.from) {
                        store.setShotKeys(movedKey(tracks, id, drag.from, drag.to), `Move a key of ${name} to frame ${drag.to + 1}`);
                        setChosen({ track: id, frame: drag.to });
                      }
                      setDrag(null);
                    }}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(k.frame); } }}
                    onContextMenu={(e) => openMenu(e, [
                      { heading: 'On to the next key' },
                      ...KEY_EASES.map(([ease, label]) => ({ label, checked: k.ease === ease, run: () => store.setShotKeys(easedKey(tracks, id, k.frame, ease), `${name}: ${label.toLowerCase()} from frame ${k.frame + 1}`), testId: `key-ease-${ease}` })),
                      'divider' as const,
                      { label: 'Go to this frame', run: () => go(k.frame) },
                      { label: 'Remove this key', danger: true, run: () => remove(k.frame), testId: 'key-remove' },
                    ], `${name} · frame ${k.frame + 1}`)}
                  />
                );
              })}
              <span className="key-lane-head" style={{ left: pct(s.shotFrame) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
