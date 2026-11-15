import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { store } from './store.ts';
import { gregorian } from '../core-time/index.ts';
import { lonLatToVec } from '../geo-kernel/vec.ts';

// A small read-only window into the live state, used by the automated interface tests.
(window as unknown as { __mapmaker: unknown }).__mapmaker = {
  store,
  ownerAt(lon: number, lat: number, date: string) {
    const s = store;
    const t = gregorian.parse(date)?.instant;
    if (!s.engine || !t) return undefined;
    const id = s.engine.valueAtPoint(s.spaceId, s.layerId, lonLatToVec(lon, lat), t);
    return id ? s.world!.get('entity', id)?.name ?? id : null;
  },
};

createRoot(document.getElementById('root')!).render(<App />);
