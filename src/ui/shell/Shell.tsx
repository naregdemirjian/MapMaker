// The frame of the interface (D196): the workspace bar under the top bar, the edges panels are resized by,
// and the status bar along the bottom.
import { useRef } from 'react';
import { useStore, store } from '../store.ts';
import { WORKSPACES, DEFAULT_LAYOUTS, dragged, tracks, type Side } from './layout.ts';
import { SearchBox } from '../components/Search.tsx';
import { TOOLS } from '../tools.ts';

/** The workspaces, and what belongs to every one of them: search, undo and redo, folding panels away. */
export function WorkspaceBar() {
  const s = useStore();
  const now = s.workspaceNow(), hidden = s.layouts[now].hidden;
  const fold = (side: Side, name: string, glyph: string) => (
    <button className={`small panel-toggle ${hidden.includes(side) ? '' : 'on'}`} onClick={() => s.togglePanel(side)} data-testid={`toggle-${side}`}
      title={`${hidden.includes(side) ? 'Show' : 'Hide'} the ${name}`}>{glyph}</button>
  );
  return (
    <nav className="workspace-bar" data-testid="workspace-bar">
      <div className="workspaces" role="tablist" aria-label="Workspaces">
        {WORKSPACES.map((w) => (
          <button key={w.id} role="tab" aria-selected={w.id === now} className={`workspace ${w.id === now ? 'on' : ''}`} title={w.hint} onClick={() => s.setWorkspace(w.id)} data-testid={`workspace-${w.id}`}>{w.name}</button>
        ))}
      </div>
      <div className="spacer" />
      <SearchBox />
      <button disabled={!s.journal.canUndo} title={s.journal.undoLabel ? `Undo: ${s.journal.undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={() => s.undo()} data-testid="undo">Undo</button>
      <button disabled={!s.journal.canRedo} title={s.journal.redoLabel ? `Redo: ${s.journal.redoLabel} (Ctrl+Y)` : 'Nothing to redo'} onClick={() => s.redo()} data-testid="redo">Redo</button>
      <span className="panel-toggles">
        {fold('left', 'lists at the left', '◧')}
        {fold('bottom', 'timeline', '⬓')}
        {fold('right', 'panel at the right', '◨')}
        <button className="small" onClick={() => s.setLayout(null)} title="Put this workspace's panels back as they were at first" data-testid="reset-workspace">Reset</button>
      </span>
    </nav>
  );
}

/**
 * The edge of a panel, dragged to resize it. While dragging only the frame's own measures change (nothing
 * is drawn again but what the browser lays out); the new size is kept when the edge is let go. A double
 * click puts the panel back to its first size.
 */
export function Splitter({ side, frame }: { side: Side; frame: React.RefObject<HTMLDivElement | null> }) {
  const s = useStore();
  const drag = useRef<{ at: number; size: number; now: number } | null>(null);
  const layout = s.layouts[s.workspaceNow()];
  if (layout.hidden.includes(side)) return null;
  const pos = (e: React.PointerEvent) => (side === 'bottom' ? e.clientY : e.clientX);
  return (
    <div className={`splitter splitter-${side}`} data-testid={`splitter-${side}`} title="Drag to resize; double-click for the first size"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { at: pos(e), size: layout[side], now: layout[side] }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.now = dragged(side, d.size, pos(e) - d.at);
        frame.current?.style.setProperty(`--${side}`, `${d.now}px`);
      }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d && d.now !== d.size) store.setLayout({ [side]: d.now }); }}
      onPointerCancel={() => { const d = drag.current; drag.current = null; if (d) frame.current?.style.setProperty(`--${side}`, `${d.size}px`); }}
      onDoubleClick={() => store.setLayout({ [side]: DEFAULT_LAYOUTS[store.workspaceNow()][side] })} />
  );
}

/** The frame's measures as CSS variables. */
export function frameStyle(s: ReturnType<typeof useStore>): React.CSSProperties {
  const t = tracks(s.layouts[s.workspaceNow()]);
  const world = s.mode === 'world';
  return { '--left': `${t.left}px`, '--right': `${t.right}px`, '--bottom': `${t.bottom}px`, '--tools': world ? '44px' : '0px', '--options': world ? '36px' : '0px' } as React.CSSProperties;
}

/** Along the bottom: what the tool in hand does, and the state of the history. */
export function StatusBar() {
  const s = useStore();
  const problems = s.problemCount();
  const tool = TOOLS.find((t) => t.id === s.tool);
  return (
    <div className="status-bar" data-testid="status-bar">
      <span className="status-hint" data-testid="status-hint">
        {s.mode === 'present' ? 'Drag and scroll the preview to frame the shot; drag the date, the title and the boxes on it to place them.'
          : tool ? <><b>{tool.name} ({tool.key})</b> · {tool.hint}</> : null}
      </span>
      <button className={`small ${problems ? 'warn' : ''}`} onClick={() => s.set({ dialog: 'health' })} data-testid="health" title="Places where the history contradicts itself, and how to mend them">
        History Health{problems ? ` (${problems})` : ' ✓'}
      </button>
    </div>
  );
}
