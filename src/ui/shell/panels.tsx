// What each panel holds (S1, D234): the panels of the studios, by their ids (studios.ts lists them). Each is drawn
// once, wherever its tab is docked (Dock.tsx moves it there without drawing it again).
import { useStore } from '../store.ts';
import { isSpaceMap } from '../../world-model/world-settings.ts';
import { MapView } from '../components/MapView.tsx';
import { SpaceView } from '../components/SpaceView.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { ShotsPanel, ShotEditor, ShotTimeline } from '../components/Presentation.tsx';
import { ListPanel, type ListKind } from '../panels/Lists.tsx';
import { Inspector } from '../panels/Properties.tsx';
import { ToolStrip } from './Tools.tsx';
import { DateBar } from './Bars.tsx';
import { presents } from './studios.ts';
import { VIEWER, type PanelId } from './dock.ts';
import { panelInfo } from './studios.ts';

function Viewer() {
  const s = useStore();
  return <div className="viewer-panel">{isSpaceMap(s.world!.get('map_space', s.spaceId)) ? <SpaceView /> : <MapView />}</div>;
}

const LISTS: ListKind[] = ['maps', 'layers', 'countries', 'places', 'areas', 'events'];

/** A panel's contents. */
export function PanelContent({ id }: { id: PanelId }) {
  if (id === VIEWER) return <Viewer />;
  if ((LISTS as string[]).includes(id)) return <ListPanel list={id as ListKind} />;
  switch (id) {
    case 'tools': return <ToolStrip />;
    case 'properties': return <Inspector />;
    case 'timeline': return <Timeline head={<DateBar />} />;
    case 'shots': return <ShotsPanel />;
    case 'shot': return <ShotEditor />;
    case 'export': return <ShotEditor only="export" />;
    case 'shot-timeline': return <ShotTimeline />;
  }
  return null;
}

/** The name on a panel's tab (the viewer is the map, or in Presentation the shot's preview). */
export function panelTitle(id: PanelId, page: Parameters<typeof presents>[0]): string {
  if (id === VIEWER) return presents(page) ? 'Preview' : 'Map';
  return panelInfo(id)?.title ?? id;
}
