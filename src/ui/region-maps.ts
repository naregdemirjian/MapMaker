// The ready-made region maps (D175) made in the open project: their data loaded, then built command by command.
import { store } from './store.ts';
import { loadCountries } from './components/AddCountries.tsx';
import { loadPlaces } from './components/Cities.tsx';
import { decodeRegions, type RegionsFile } from '../domain/regions.ts';
import { REGION_MAPS, buildRegionMap, type UrbanFile } from '../domain/region-maps.ts';

export async function makeRegionMap(id: string): Promise<boolean> {
  const def = REGION_MAPS.find((m) => m.id === id);
  if (!def) return false;
  store.set({ busy: `Making "${def.name}"…` });
  try {
    const [countries, places, urban, regions] = await Promise.all([
      loadCountries(), loadPlaces(),
      fetch('data/natural-earth/urban-10m-mideast.json').then((r) => r.json() as Promise<UrbanFile>),
      def.provincesOf ? fetch('data/natural-earth/regions-10m.json').then(async (r) => decodeRegions(await r.json() as RegionsFile)) : Promise.resolve([]),
    ]);
    const made = buildRegionMap(def, { countries, places, urban, regions }, (fn) => store.execute(fn));
    if (!made) return false;
    store.set({ spaceId: made.spaceId, layerId: made.layerId, selection: null });
    store.setCamera({ ...def.camera });
    store.toast(`"${def.name}" is ready, with a 4K shot of it in Presentation. Close in, its photographs and heights are downloaded as needed.`);
    return true;
  } catch (e) {
    store.toast(`The map could not be made: ${(e as Error).message}`, 'error');
    return false;
  } finally { store.set({ busy: null }); }
}
