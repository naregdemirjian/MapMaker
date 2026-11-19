import { useEffect } from 'react';
import { useStore, store } from './store.ts';
import { TopBar, Outliner, ToolBar, Inspector, Toasts } from './components/Panels.tsx';
import { ShowDialog } from './components/ShowDialog.tsx';
import { SeaLevelDialog } from './components/SeaLevelDialog.tsx';
import { SkyLookDialog } from './components/SkyLook.tsx';
import { MapView } from './components/MapView.tsx';
import { SpaceView } from './components/SpaceView.tsx';
import { isSpaceMap } from '../world-model/world-settings.ts';
import { Timeline } from './components/Timeline.tsx';
import { EditPrompt, NewWorldDialog, NewEventDialog, VersionsDialog, HealthDialog, DataSourcesDialog, ProjectPicker, OfflineNotice, AskDialog } from './components/Dialogs.tsx';
import { ShotsPanel, ShotEditor, ShotTimeline } from './components/Presentation.tsx';
import { LabelStyleDialog } from './components/LabelStyles.tsx';
import { AddCountriesDialog } from './components/AddCountries.tsx';
import { ImportBordersDialog } from './components/ImportBorders.tsx';
import { SettingsDialog } from './components/Settings.tsx';
import { NewLayerDialog } from './components/Features.tsx';
import { DataExportDialog } from './components/Search.tsx';
import { EventTypesDialog } from './components/EventTypes.tsx';
import { MergeDialog } from './components/SplitMerge.tsx';
import { GiveRegionsDialog } from './components/Regions.tsx';
import { ContextMenu, deleteEntitiesAsked, deleteEventsAsked } from './components/ContextMenu.tsx';

export function App() {
  const s = useStore();
  useEffect(() => {
    s.loadApp().catch((e: Error) => s.toast(`Cannot reach the Map Maker service: ${e.message}`, 'error'));
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // With the border pen, undo and redo act on the draft being drawn only, never on the project.
      const pen = store.tool === 'pen' && store.mode !== 'present';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (pen) store.penUndoPiece(); else store.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); if (pen) store.penRedoPiece(); else store.redo(); }
      // Space: history plays or pauses (world-building), or the shot (presentation).
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !store.pending && !(e.target as HTMLElement)?.isContentEditable && tag !== 'BUTTON') {
        e.preventDefault();
        if (store.mode === 'world') { const p = store.historyPlay; store.set({ historyPlay: { ...p, on: !p.on } }); if (p.on) store.setTime(store.time); }
        else if (store.shotId) store.set({ playing: !store.playing });
      }
      // Delete: everything chosen in the lists (the Border points tool uses Delete for points).
      if (e.key === 'Delete' && store.tool !== 'vertex' && store.mode !== 'present' && !store.pending) {
        const ents = store.chosen('entity'), evs = store.chosen('event');
        if (ents.length) { e.preventDefault(); deleteEntitiesAsked(ents); } else if (evs.length) { e.preventDefault(); deleteEventsAsked(evs); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  if (!s.world) return <><ProjectPicker /><Toasts />{s.busy && <div className="busy">{s.busy}</div>}</>;

  return (
    <div className={`app mode-${s.mode}`}>
      <TopBar />
      {s.mode === 'world' ? <Outliner /> : <ShotsPanel />}
      <main className="center">
        {s.mode === 'world' && <ToolBar />}
        {isSpaceMap(s.world.get('map_space', s.spaceId)) ? <SpaceView /> : <MapView />}
      </main>
      {s.mode === 'world' ? <Inspector /> : <ShotEditor />}
      <footer className="bottom">{s.mode === 'world' ? <Timeline /> : <ShotTimeline />}</footer>
      <EditPrompt />
      <AskDialog />
      <ContextMenu />
      {s.dialog === 'new-world' && <NewWorldDialog />}
      {s.dialog === 'new-event' && <NewEventDialog />}
      {s.dialog === 'new-layer' && <NewLayerDialog />}
      {s.dialog === 'data-export' && <DataExportDialog />}
      {s.dialog === 'event-types' && <EventTypesDialog />}
      {s.dialog === 'show' && <ShowDialog />}
      {s.dialog === 'sea-level' && <SeaLevelDialog />}
      {s.dialog === 'sky-look' && <SkyLookDialog />}
      {s.dialog === 'merge' && <MergeDialog />}
      {s.dialog === 'give-regions' && <GiveRegionsDialog />}
      {s.dialog === 'versions' && <VersionsDialog />}
      {s.dialog === 'health' && <HealthDialog />}
      {s.dialog === 'data-sources' && <DataSourcesDialog />}
      {s.dialog === 'settings' && <SettingsDialog />}
      {s.dialog === 'label-style' && <LabelStyleDialog onClose={() => s.set({ dialog: null })} />}
      {s.dialog === 'add-countries' && <AddCountriesDialog onClose={() => s.set({ dialog: null })} />}
      {s.dialog === 'import-borders' && <ImportBordersDialog onClose={() => s.set({ dialog: null })} />}
      <OfflineNotice />
      <Toasts />
      {s.busy && <div className="busy">{s.busy}</div>}
    </div>
  );
}
