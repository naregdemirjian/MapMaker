import { CalendarDialog } from './components/CalendarDialog.tsx';
import { StatisticsDialog } from './components/StatisticsDialog.tsx';
import { BranchesDialog } from './components/Branches.tsx';
import { useEffect } from 'react';
import { StudioBar, StatusBar } from './shell/Shell.tsx';
import { DockArea } from './shell/Dock.tsx';
import { drawsOn } from './shell/studios.ts';
import { arrowStep } from '../core-time/steps.ts';
import { calendarNow } from './calendar-now.ts';
import { useStore, store } from './store.ts';
import { TopBar, Toasts } from './shell/Bars.tsx';
import { ToolOptions } from './shell/Tools.tsx';
import { QuickStart } from './panels/Properties.tsx';
import { ShortcutsDialog } from './shell/MenuBar.tsx';
import { commandForKey } from './commands.ts';
import { toolForKey } from './tools.ts';
import { ShowDialog } from './components/ShowDialog.tsx';
import { SeaLevelDialog } from './components/SeaLevelDialog.tsx';
import { SkyLookDialog } from './components/SkyLook.tsx';
import { SolarRowDialog } from './components/SolarRow.tsx';
import { BorderShiftsDialog } from './components/BorderShifts.tsx';
import { EditPrompt, NewEventDialog, VersionsDialog, HealthDialog, DataSourcesDialog, ProjectPicker, OfflineNotice, AskDialog } from './components/Dialogs.tsx';
import { PlanetStudio } from './components/PlanetStudio.tsx';
import { LabelStyleDialog } from './components/LabelStyles.tsx';
import { AddCountriesDialog } from './components/AddCountries.tsx';
import { AddCitiesDialog } from './components/Cities.tsx';
import { ImportBordersDialog } from './components/ImportBorders.tsx';
import { SettingsDialog } from './components/Settings.tsx';
import { NewLayerDialog } from './components/Features.tsx';
import { DataExportDialog } from './components/Search.tsx';
import { EventTypesDialog } from './components/EventTypes.tsx';
import { MergeDialog } from './components/SplitMerge.tsx';
import { GiveRegionsDialog } from './components/Regions.tsx';
import { ZonesDialog } from './components/Reach.tsx';
import { ContextMenu, deleteEntitiesAsked, deleteEventsAsked } from './components/ContextMenu.tsx';
import { HistoryPlayer } from './components/Timeline.tsx';

export function App() {
  const s = useStore();
  useEffect(() => {
    s.loadApp().catch((e: Error) => s.toast(`Cannot reach the Map Maker service: ${e.message}`, 'error'));
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // The commands' shortcuts (with the border pen, undo and redo act on the draft being drawn only, never on the project).
      if (!store.pending && !(e.target as HTMLElement)?.isContentEditable) {
        const c = commandForKey(e);
        if (c) { e.preventDefault(); c.run(store); return; }
        // A plain letter takes its tool in hand (while nothing is being drawn or asked, in a page that draws on the map).
        const page = store.pageNow();
        if ((page === 'map' || page === 'history') && store.world && !store.dialog && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
          const t = toolForKey(e.key, store.world, store.spaceId, page);
          if (t) { e.preventDefault(); store.set({ tool: t.id }); return; }
        }
      }
      // Space: history plays or pauses (world-building), or the shot (presentation).
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !store.pending && !(e.target as HTMLElement)?.isContentEditable && tag !== 'BUTTON') {
        e.preventDefault();
        if (store.mode === 'world') { const p = store.historyPlay; store.set({ historyPlay: { ...p, on: !p.on } }); if (p.on) store.setTime(store.time); }
        else if (store.shotId) store.set({ playing: !store.playing });
      }
      // Left and right arrows step the date viewed: a day; Ctrl, a week; Ctrl+Shift, a month; Ctrl+Shift+Alt, a year.
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && store.mode === 'world' && !store.pending && !store.dialog && !(e.target as HTMLElement)?.isContentEditable) {
        const t = store.time;
        if (Number.isFinite(t.day)) {
          e.preventDefault();
          if (store.historyPlay.on) store.set({ historyPlay: { ...store.historyPlay, on: false } });
          store.setTime(arrowStep(t, e.key === 'ArrowRight' ? 1 : -1, e, calendarNow()));
        }
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
  const page = s.pageNow();

  return (
    <div className={`app mode-${s.mode} page-${page}`}>
      <TopBar />
      <StudioBar />
      {drawsOn(page) && <ToolOptions />}
      <DockArea />
      <StatusBar />
      <HistoryPlayer />
      <EditPrompt />
      <AskDialog />
      <ContextMenu />
      {s.dialog === 'planet-studio' && <PlanetStudio />}
      {s.dialog === 'new-event' && <NewEventDialog />}
      {s.dialog === 'new-layer' && <NewLayerDialog />}
      {s.dialog === 'data-export' && <DataExportDialog />}
      {s.dialog === 'event-types' && <EventTypesDialog />}
      {s.dialog === 'show' && <ShowDialog />}
      {s.dialog === 'sea-level' && <SeaLevelDialog />}
      {s.dialog === 'calendar' && <CalendarDialog />}
      {s.dialog === 'statistics' && <StatisticsDialog />}
      {s.dialog === 'branches' && <BranchesDialog />}
      {s.dialog === 'sky-look' && <SkyLookDialog />}
      {s.dialog === 'solar-row' && <SolarRowDialog />}
      {s.dialog === 'border-shifts' && <BorderShiftsDialog key={s.shiftsFor ?? ''} />}
      {s.dialog === 'merge' && <MergeDialog />}
      {s.dialog === 'give-regions' && <GiveRegionsDialog />}
      {s.dialog === 'zones' && <ZonesDialog />}
      {s.dialog === 'versions' && <VersionsDialog />}
      {s.dialog === 'health' && <HealthDialog />}
      {s.dialog === 'data-sources' && <DataSourcesDialog />}
      {s.dialog === 'settings' && <SettingsDialog />}
      {s.dialog === 'shortcuts' && <ShortcutsDialog />}
      {s.dialog === 'getting-started' && <div className="modal-back" onClick={() => s.set({ dialog: null })}><div className="modal" role="dialog" aria-label="Getting started" data-testid="getting-started-dialog" onClick={(e) => e.stopPropagation()}><QuickStart /><div className="modal-actions"><button onClick={() => s.set({ dialog: null })}>Close</button></div></div></div>}
      {s.dialog === 'label-style' && <LabelStyleDialog onClose={() => s.set({ dialog: null })} />}
      {s.dialog === 'add-countries' && <AddCountriesDialog onClose={() => s.set({ dialog: null })} />}
      {s.dialog === 'add-cities' && <AddCitiesDialog onClose={() => s.set({ dialog: null })} />}
      {s.dialog === 'import-borders' && <ImportBordersDialog onClose={() => s.set({ dialog: null })} />}
      <OfflineNotice />
      <Toasts />
      {s.busy && <div className="busy">{s.busy}</div>}
    </div>
  );
}
