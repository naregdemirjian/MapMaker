// The bars across the top (D196, D197, D203): the menu bar with the project's name, the map and branch chooser, and the
// date viewed with its playing and comparing; the messages that come and go at the bottom (tidy stage, D213).
import { useStore, useLive } from '../store.ts';
import { compare } from '../../core-time/index.ts';
import { calendarNow } from '../calendar-now.ts';
import { isSpaceMap } from '../../world-model/world-settings.ts';
import { stepChange } from '../components/Timeline.tsx';
import { BranchSwitcher } from '../components/Branches.tsx';
import { MenuBar } from './MenuBar.tsx';
import { command } from '../commands.ts';
import { SPACE_TOOLS } from '../tools.ts';
import { DateField, yearSizer } from '../inputs.tsx';

/** The date being viewed (follows the timeline as it is scrubbed). */
function CurrentDate() {
  const s = useLive();
  return <DateField value={s.time} onChange={(t) => t && s.setTime(t)} testId="current-date" live steady={{ yearSizer: yearSizer(s.timeline.start, s.timeline.end, calendarNow()), dayOnly: s.historyPlay.on }} />;
}

/** The date viewed, with the steps to the changes before and after it, and comparing two dates: in the timeline's head (D201). */
export function DateBar() {
  const s = useStore();
  return (
    <div className="datebar">
          <button onClick={() => stepChange(-1)} title="Previous change">◀</button>
          <CurrentDate />
          <button onClick={() => stepChange(1)} title="Next change">▶</button>
          <button className={s.compare.on ? 'on' : ''} onClick={() => command('compare').run(s)}
            title="Compare two dates: the date viewed on the left of a line across the map, another date on the right (drag the line)" data-testid="compare-toggle">Compare</button>

        </div>
  );
}

/** Which map is viewed, and which timeline of it (in the workspace bar, D203). */
export function MapChooser() {
  const s = useStore();
  const w = s.world!;
  const spaces = w.all('map_space').sort((a, b) => a.sort_order - b.sort_order);
  const switchSpace = (id: string) => {
    const layer = w.all('layer').find((l) => l.space_id === id && l.kind === 'partition');
    // (A star map has only the Select tool, D110.)
    // (Leaving one for another kind of map, a tool of the other kind gives way to Select.)
    const space = isSpaceMap(w.get('map_space', id));
    const before = s.spaceId;
    s.set({ spaceId: id, layerId: layer?.id ?? '', selection: null, presentCamera: null, ...(space !== SPACE_TOOLS.includes(s.tool) || s.tool === 'select' ? { tool: 'select' as const } : {}) });
    s.mapChanged(before);
  };
  return (
    <span className="map-chooser">
      <select value={s.spaceId} onChange={(e) => switchSpace(e.target.value)} title="Which map you are looking at" data-testid="map-select">
        {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
      </select>
      {s.mode === 'world' && <BranchSwitcher />}
    </span>
  );
}

/** The bar along the top (D203): the name and the menus, thin, as in a video editor. */
export function TopBar() {
  const s = useStore();
  return (
    <header className="topbar">
      <div className="brand">Map Maker</div>
      <MenuBar />
      <div className="spacer" />
      <div className="project-name" title={s.projectDir}>{s.projectId}</div>
    </header>
  );
}

export function Toasts() {
  const s = useStore();
  return <div className="toasts">{s.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} data-testid={`toast-${t.kind}`}>{t.text}</div>)}</div>;
}
