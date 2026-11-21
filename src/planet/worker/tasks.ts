// What the planetary engine's workers can be asked to do (Stage 14, D152). The same functions run in the
// interface's thread when no workers are wanted (LocalExecutor) and in Node for tests.
import { STAGES, type ProductData } from '../pipeline/stages.ts';
import { galaxyPainter, type GalaxyPictureSpec } from '../../space/galaxy-picture.ts';

export type Progress = (done: number, total: number) => void;

export const TASKS: Record<string, (args: never, progress: Progress) => unknown> = {
  /** Answers at once (to check a worker is alive). */
  ping: () => 'pong',
  /** Runs a stage (or one part of it). */
  stage: (args: { stage: string; inputs: ProductData; deps: Record<string, ProductData>; range?: [number, number]; hints?: Record<string, ProductData> }, progress: Progress) => {
    const s = STAGES[args.stage];
    if (!s) throw new Error(`No stage called ${args.stage}`);
    return s.run(args.inputs, args.deps, { progress, ...(args.hints ? { hints: args.hints } : {}) }, args.range);
  },
  /** Paints rows of a galaxy's picture (D193): the same pool of workers, nothing of the planetary engine. */
  galaxyRows: (args: { spec: GalaxyPictureSpec; y0: number; y1: number }) => galaxyPainter(args.spec).rows(args.y0, args.y1),
};

export async function runTask(task: string, args: unknown, progress: Progress): Promise<unknown> {
  const f = TASKS[task] as ((args: unknown, progress: Progress) => unknown) | undefined;
  if (!f) throw new Error(`No task called ${task}`);
  return f(args, progress);
}
