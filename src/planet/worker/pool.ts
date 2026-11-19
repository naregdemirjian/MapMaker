// Running the planetary engine's work (Stage 14, D152): a pool of workers, or the calling thread itself.
//
// A pool has a fixed number of workers, made when first needed. Tasks wait in order and go to the next free worker;
// a cancelled task that is running stops its worker (work inside a worker cannot be interrupted otherwise), and a
// fresh worker takes its place. Progress comes back as it is reported.
import type { RunMessage, WorkerReply } from './protocol.ts';
import { runTask } from './tasks.ts';

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Whatever runs tasks: a pool of workers or this thread. */
export interface Executor {
  /** How many tasks it runs at once. */
  readonly size: number;
  run(task: string, args: unknown, opts?: RunOptions): Promise<unknown>;
  dispose(): void;
}

/** The part of a Worker the pool uses (a browser Worker, or an adapter around Node's worker_threads). */
export interface WorkerLike {
  postMessage(message: RunMessage): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export class CancelledError extends Error {
  constructor() { super('Cancelled'); this.name = 'CancelledError'; }
}

interface Job {
  id: number;
  task: string;
  args: unknown;
  opts: RunOptions;
  resolve(v: unknown): void;
  reject(e: unknown): void;
  slot?: Slot;
  onAbort?: () => void;
}
interface Slot { worker: WorkerLike; job: Job | null }

export class WorkerPool implements Executor {
  readonly size: number;
  private readonly factory: () => WorkerLike;
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 1;
  private disposed = false;

  constructor(factory: () => WorkerLike, size: number) {
    if (!(size >= 1)) throw new Error('A pool needs a worker');
    this.factory = factory;
    this.size = size;
  }

  run(task: string, args: unknown, opts: RunOptions = {}): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('The pool is closed'));
    if (opts.signal?.aborted) return Promise.reject(new CancelledError());
    return new Promise((resolve, reject) => {
      const job: Job = { id: this.nextId++, task, args, opts, resolve, reject };
      if (opts.signal) {
        job.onAbort = () => this.cancel(job);
        opts.signal.addEventListener('abort', job.onAbort, { once: true });
      }
      this.queue.push(job);
      this.pump();
    });
  }

  /** Gives a slot a new worker, listening for it. */
  private start(slot: Slot) {
    const worker = this.factory();
    slot.worker = worker;
    slot.job = null;
    worker.onmessage = (e) => { if (slot.worker === worker) this.reply(slot, e.data); };
    worker.onerror = (e) => {
      if (slot.worker !== worker) return;
      const job = slot.job;
      this.replace(slot);
      if (job) this.finish(job, () => job.reject(new Error(`The planet worker failed${e && typeof e === 'object' && 'message' in e ? `: ${(e as { message: string }).message}` : ''}`)));
      this.pump();
    };
  }

  /** Stops a slot's worker and gives the slot a new one. */
  private replace(slot: Slot) {
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
    this.start(slot);
  }

  private pump() {
    while (this.queue.length) {
      let slot = this.slots.find((s) => !s.job);
      if (!slot && this.slots.length < this.size) {
        slot = { worker: null as unknown as WorkerLike, job: null };
        this.start(slot);
        this.slots.push(slot);
      }
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.job = job;
      job.slot = slot;
      slot.worker.postMessage({ type: 'run', id: job.id, task: job.task, args: job.args });
    }
  }

  private reply(slot: Slot, msg: WorkerReply) {
    const job = slot.job;
    if (!job || msg.id !== job.id) return;
    if (msg.type === 'progress') { job.opts.onProgress?.(msg.done, msg.total); return; }
    slot.job = null;
    if (msg.type === 'done') this.finish(job, () => job.resolve(msg.result));
    else this.finish(job, () => job.reject(new Error(msg.message)));
    this.pump();
  }

  private finish(job: Job, settle: () => void) {
    if (job.onAbort) job.opts.signal?.removeEventListener('abort', job.onAbort);
    job.slot = undefined;
    settle();
  }

  private cancel(job: Job) {
    const q = this.queue.indexOf(job);
    if (q >= 0) this.queue.splice(q, 1);
    else if (job.slot && job.slot.job === job) this.replace(job.slot);
    else return;
    this.finish(job, () => job.reject(new CancelledError()));
    this.pump();
  }

  dispose() {
    this.disposed = true;
    for (const job of this.queue.splice(0)) this.finish(job, () => job.reject(new CancelledError()));
    for (const s of this.slots) {
      if (s.job) { const j = s.job; s.job = null; this.finish(j, () => j.reject(new CancelledError())); }
      s.worker.onmessage = null; s.worker.onerror = null; s.worker.terminate();
    }
    this.slots = [];
  }
}

/** Runs tasks in the calling thread, one at a time (for Node, tests, and when workers are not wanted). */
export class LocalExecutor implements Executor {
  readonly size: number;
  constructor(size = 1) { this.size = size; }
  async run(task: string, args: unknown, opts: RunOptions = {}): Promise<unknown> {
    if (opts.signal?.aborted) throw new CancelledError();
    // Arguments are copied as a worker would receive them, so nothing shared is changed by a task.
    const result = await runTask(task, structuredClone(args), (d, t) => opts.onProgress?.(d, t));
    if (opts.signal?.aborted) throw new CancelledError();
    return result;
  }
  dispose() {}
}
