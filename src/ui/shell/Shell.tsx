// The frame of the interface (D196, D234): the studios bar under the top bar (the five studios, Presentation's two
// pages, the map viewed, search, undo, and saving or resetting the page's layout of panels), and the status bar.
import { useStore } from '../store.ts';
import { STUDIOS, PAGES, studioOf, drawsOn, presents } from './studios.ts';
import { SearchBox } from '../components/Search.tsx';
import { MapChooser } from './Bars.tsx';
import { TOOLS } from '../tools.ts';

/** The studios, and what belongs to every one of them: the map viewed, search, undo and redo, the page's layout. */
export function StudioBar() {
  const s = useStore();
  const page = s.pageNow(), studio = studioOf(page), name = PAGES.find((p) => p.id === page)!.name;
  const saved = !!s.docks[page].saved;
  return (
    <nav className="studio-bar" data-testid="studio-bar">
      <div className="studios" role="tablist" aria-label="Studios">
        {STUDIOS.map((st, i) => (
          <button key={st.id} role="tab" aria-selected={st.id === studio} className={`studio-tab ${st.id === studio ? 'on' : ''}`} title={`${st.hint} (Alt+${i + 1})`}
            onClick={() => s.setStudio(st.id)} data-testid={`studio-${st.id}`}>{st.name}</button>
        ))}
      </div>
      {studio === 'present' && (
        <div className="studio-pages" role="tablist" aria-label="Pages of Presentation">
          {PAGES.filter((p) => presents(p.id)).map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === page} className={`studio-page ${p.id === page ? 'on' : ''}`} onClick={() => s.setPage(p.id)} data-testid={`present-page-${p.id}`}>{p.name}</button>
          ))}
        </div>
      )}
      <MapChooser />
      <div className="spacer" />
      <SearchBox />
      <button disabled={!s.journal.canUndo} title={s.journal.undoLabel ? `Undo: ${s.journal.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={() => s.undo()} data-testid="undo">Undo</button>
      <button disabled={!s.journal.canRedo} title={s.journal.redoLabel ? `Redo: ${s.journal.redoLabel} (Ctrl+Y)` : 'Nothing to redo'} onClick={() => s.redo()} data-testid="redo">Redo</button>
      <span className="workspace-buttons">
        <button className="small" onClick={() => s.saveWorkspace()} data-testid="save-workspace"
          title={`Keep the layout of ${name}'s panels as it is now: Reset workspace returns to it`}>Save workspace</button>
        <button className="small" onClick={() => s.resetWorkspace()} data-testid="reset-workspace"
          title={saved ? `Put ${name}'s panels back as they were saved (Window › Original layout: as they were at first)` : `Put ${name}'s panels back as they were at first`}>Reset workspace</button>
      </span>
    </nav>
  );
}

/** Along the bottom: what the tool in hand does (or the page, where there are no tools), and the state of the history. */
export function StatusBar() {
  const s = useStore();
  const problems = s.problemCount();
  const page = s.pageNow();
  const tool = TOOLS.find((t) => t.id === s.tool);
  return (
    <div className="status-bar" data-testid="status-bar">
      <span className="status-hint" data-testid="status-hint">
        {presents(page) ? 'Drag and scroll the preview to frame the shot; drag the date, the title and the boxes on it to place them.'
          : !drawsOn(page) ? <><b>{STUDIOS.find((st) => st.id === studioOf(page))!.name}</b> · {STUDIOS.find((st) => st.id === studioOf(page))!.hint}.{page === 'timeline' ? ' Drag an event to move it, its ends to retime it; double-click empty time for a new event; "Draw in History" on an event to draw its changes.' : ' Click on the map to choose; the tools to draw with are in Map Studio and History.'}</>
          : tool ? <><b>{tool.name} ({tool.key})</b> · {tool.hint}</> : null}
      </span>
      <button className={`small ${problems ? 'warn' : ''}`} onClick={() => s.set({ dialog: 'health' })} data-testid="health" title="Places where the history contradicts itself, and how to mend them">
        History Health{problems ? ` (${problems})` : ' ✓'}
      </button>
    </div>
  );
}
