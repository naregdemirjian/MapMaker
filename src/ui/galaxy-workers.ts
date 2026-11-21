// Galaxy pictures painted off the interface's thread (D193): rows of a picture go to a pool of the same workers
// the planetary engine uses (dist/ui/planet-worker.js), made when a picture is wanted and closed a while after the
// last row, so nothing is kept running for a picture that is finished.
import { WorkerPool } from '../planet/worker/pool.ts';
import { defaultWorkers, newWorker } from './planet-engine.ts';
import { paintGalaxiesWith } from '../space/galaxy-pictures.ts';

let pool: WorkerPool | null = null, waiting = 0, closing = 0;

paintGalaxiesWith((spec, y0, y1) => {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('No workers here'));
  pool ??= new WorkerPool(newWorker, defaultWorkers());
  window.clearTimeout(closing);
  waiting++;
  return (pool.run('galaxyRows', { spec, y0, y1 }) as Promise<Uint8ClampedArray>).finally(() => {
    if (--waiting === 0) closing = window.setTimeout(() => { pool?.dispose(); pool = null; }, 15000);
  });
});
