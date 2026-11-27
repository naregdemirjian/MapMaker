// The Effects panel (S4 of the studios plan, D238): every effect the software has, in folders (Countries, Borders,
// Labels, Graphics, Transitions, Saved by you), found by name. An effect is dragged onto a country on the map, into the
// Looks panel (the thing chosen there), or onto a row of the lists (a country, a group, a layer, an event); a
// double-click or Enter gives it to what is chosen. Its settings are then in the Looks panel, like any other.
import { useState } from 'react';
import { useStore, store } from '../store.ts';
import { openMenu } from '../components/ContextMenu.tsx';
import * as cmd from '../../domain/commands.ts';
import { catalogue, filterItems, FOLDERS, type EffectItem, type FolderId } from '../../render-engine/effects-catalogue.ts';
import { chosenTargets, giveToChosen, targetsText } from '../effects.ts';
import { startEffectDrag } from '../effect-drag.ts';

/** A small sign for each folder's effects. */
const SIGN: Record<FolderId, string> = { countries: '◧', borders: '┅', labels: 'Aa', graphics: '▭', transitions: '⇢', saved: '★' };

function EffectRow({ item }: { item: EffectItem }) {
  return (
    <div className={`effect-item fx-${item.folder}`} tabIndex={0} role="button" data-testid={`effect-${item.id}`}
      title={`${item.note}. Drag it onto a country on the map, into the Looks panel or onto a row of the lists; double-click to give it to what is chosen.`}
      onPointerDown={(ev) => startEffectDrag(item, ev)}
      onDoubleClick={() => giveToChosen(item)}
      onContextMenu={item.folder === 'saved' ? (ev) => {
        // (An effect saved by you, D250: renamed or forgotten.)
        const id = item.id.slice('saved:'.length);
        openMenu(ev, [
          { label: 'Rename…', testId: 'saved-rename', run: async () => { const n = await store.askText('Rename the effect', 'Its name', item.name, 'Rename'); if (n) store.execute((w) => cmd.renameLookPreset(w, id, n)); } },
          { label: 'Forget it', danger: true, testId: 'saved-forget', run: () => store.execute((w) => cmd.deleteLookPreset(w, id)) },
        ], item.name);
      } : undefined}
      onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); giveToChosen(item); } }}>
      <span className="fx-sign" aria-hidden="true">{SIGN[item.folder]}</span><span className="fx-name">{item.name}</span>
    </div>
  );
}

/** The Effects panel. */
export function EffectsPanel() {
  const s = useStore();
  const [filter, setFilter] = useState('');
  if (!s.world) return null;
  const items = filterItems(catalogue(cmd.lookPresets(s.world)), filter);
  const targets = chosenTargets();
  return (
    <div className="effects-panel" data-testid="effects-panel">
      <div className="effects-find">
        <input type="search" value={filter} placeholder="Find an effect" onChange={(ev) => setFilter(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Escape') setFilter(''); }} data-testid="effects-filter" />
      </div>
      <div className="effects-folders">
        {FOLDERS.map((f) => {
          const list = items.filter((i) => i.folder === f.id);
          if (!list.length && filter.trim()) return null;
          const folded = !filter.trim() && s.collapsed.includes(`fx:${f.id}`);
          return (
            <div key={f.id} className="effects-folder" data-testid={`effects-folder-${f.id}`}>
              <div className="effects-folder-head" title={f.note} onClick={() => s.toggleCollapsed(`fx:${f.id}`)} data-testid={`effects-folder-head-${f.id}`}>
                <span className="twisty">{folded ? '▸' : '▾'}</span><b>{f.name}</b><span className="muted"> {list.length}</span>
              </div>
              {!folded && list.map((it) => <EffectRow key={it.id} item={it} />)}
              {!folded && !list.length && f.id === 'saved' && <p className="muted small-text">Looks you keep (Keep this look…, in a country's Looks) are here, to give at once.</p>}
            </div>
          );
        })}
        {!items.length && <p className="muted">No effect is called that.</p>}
      </div>
      <p className="effects-foot muted" data-testid="effects-foot">
        {targets.length ? <>Double-click an effect to give it to <b>{targetsText(targets)}</b>, or drag it onto something.</> : 'Drag an effect onto a country on the map, into the Looks panel or onto a row of the lists; or choose something and double-click one.'}
      </p>
    </div>
  );
}
