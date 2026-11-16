import { useEffect } from 'react';
import { useStore, store } from './store.ts';
import { TopBar, Outliner, ToolBar, Inspector, Toasts } from './components/Panels.tsx';
import { MapView } from './components/MapView.tsx';
import { Timeline } from './components/Timeline.tsx';
import { EditPrompt, NewWorldDialog, NewEventDialog, VersionsDialog, HealthDialog, DataSourcesDialog, ProjectPicker, OfflineNotice } from './components/Dialogs.tsx';
import { ShotsPanel, ShotEditor, ShotTimeline } from './components/Presentation.tsx';
import { LabelStyleDialog } from './components/LabelStyles.tsx';
import { AddCountriesDialog } from './components/AddCountries.tsx';

export function App() {
  const s = useStore();
  useEffect(() => {
    s.loadApp().catch((e: Error) => s.toast(`Cannot reach the Map Maker service: ${e.message}`, 'error'));
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
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
        <MapView />
      </main>
      {s.mode === 'world' ? <Inspector /> : <ShotEditor />}
      <footer className="bottom">{s.mode === 'world' ? <Timeline /> : <ShotTimeline />}</footer>
      <EditPrompt />
      {s.dialog === 'new-world' && <NewWorldDialog />}
      {s.dialog === 'new-event' && <NewEventDialog />}
      {s.dialog === 'versions' && <VersionsDialog />}
      {s.dialog === 'health' && <HealthDialog />}
      {s.dialog === 'data-sources' && <DataSourcesDialog />}
      {s.dialog === 'label-style' && <LabelStyleDialog onClose={() => s.set({ dialog: null })} />}
      {s.dialog === 'add-countries' && <AddCountriesDialog onClose={() => s.set({ dialog: null })} />}
      <OfflineNotice />
      <Toasts />
      {s.busy && <div className="busy">{s.busy}</div>}
    </div>
  );
}
