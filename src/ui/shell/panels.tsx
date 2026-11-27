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
import { MapGallery } from '../components/MapGallery.tsx';
import { LooksPanel } from '../panels/Looks.tsx';
import { EffectsPanel } from '../panels/Effects.tsx';
import { GroupsPanel, TypesPanel, BranchesPanel, StatisticsPanel } from '../panels/TimelinePanels.tsx';
import { EventTablePanel } from '../panels/EventTable.tsx';
import { CalendarPanel } from '../components/CalendarDialog.tsx';
import { EventOutlinePanel } from '../panels/EventOutline.tsx';
import { TimeBar } from '../components/TimeBar.tsx';
import { presents } from './studios.ts';
import { VIEWER, type PanelId } from './dock.ts';
import { panelInfo } from './studios.ts';

function Viewer() {
  const s = useStore();
  const sp = s.world!.get('map_space', s.spaceId);
  if (!sp) return <div className="viewer-panel"><NoMap /></div>;
  // (Effects let go over the map go to the country there, D238; space maps take none.)
  return <div className="viewer-panel" data-drop={isSpaceMap(sp) ? undefined : 'map'}>{isSpaceMap(sp) ? <SpaceView /> : <MapView />}</div>;
}

/** A project with no map yet (D235): its first is chosen in Map Studio's gallery. */
function NoMap() {
  const s = useStore();
  const studio = s.pageNow() === 'map';
  return (
    <div className="viewer-empty" data-testid="viewer-empty">
      <h3>This project has no map yet</h3>
      <p className="muted">{studio ? 'Choose its first in the gallery: the Earth, the Earth through time, a planet of your own, a plan of a city, the stars, a galaxy…' : 'Maps are made and set up in Map Studio, then drawn on here.'}</p>
      <button className="primary" onClick={() => s.openGallery()} data-testid="viewer-empty-gallery">{studio ? 'Open the gallery' : 'Choose a map in Map Studio'}</button>
    </div>
  );
}

const LISTS: ListKind[] = ['maps', 'layers', 'countries', 'places', 'areas', 'events'];

/** A panel's contents. */
export function PanelContent({ id }: { id: PanelId }) {
  if (id === VIEWER) return <Viewer />;
  if ((LISTS as string[]).includes(id)) return <ListPanel list={id as ListKind} />;
  switch (id) {
    case 'tools': return <ToolStrip />;
    case 'gallery': return <MapGallery />;
    case 'looks': return <LooksPanel />;
    case 'effects': return <EffectsPanel />;
    case 'properties': return <Inspector />;
    case 'timeline': return <Timeline head={<DateBar />} />;
    case 'timebar': return <TimeBar />;
    case 'shots': return <ShotsPanel />;
    case 'shot': return <ShotEditor />;
    case 'export': return <ShotEditor only="export" />;
    case 'shot-timeline': return <ShotTimeline />;
    case 'groups': return <GroupsPanel />;
    case 'types': return <TypesPanel />;
    case 'branches': return <BranchesPanel />;
    case 'statistics': return <StatisticsPanel />;
    case 'event-table': return <EventTablePanel />;
    case 'calendar': return <CalendarPanel />;
    case 'event-outline': return <EventOutlinePanel />;
  }
  return null;
}

/** The name on a panel's tab (the viewer is the map, or in Presentation the shot's preview). */
export function panelTitle(id: PanelId, page: Parameters<typeof presents>[0]): string {
  if (id === VIEWER) return presents(page) ? 'Preview' : 'Map';
  return panelInfo(id)?.title ?? id;
}
