// The messages between the interface and the planetary engine's workers (Stage 14, D152).
//   to a worker:   { type: 'run', id, task, args }
//   from a worker: { type: 'progress', id, done, total } … then { type: 'done', id, result } or { type: 'error', id, message }
// Typed arrays in a result are moved, not copied (their buffers are transferred).
import { runTask } from './tasks.ts';

export interface RunMessage { type: 'run'; id: number; task: string; args: unknown }
export type WorkerReply =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'done'; id: number; result: unknown }
  | { type: 'error'; id: number; message: string };

/** The buffers of the typed arrays in a value (each once; shared memory is never transferred). */
export function transferablesOf(v: unknown, out: ArrayBuffer[] = [], seen = new Set<unknown>()): ArrayBuffer[] {
  if (!v || typeof v !== 'object' || seen.has(v)) return out;
  seen.add(v);
  if (ArrayBuffer.isView(v)) {
    const b = v.buffer;
    if (b instanceof ArrayBuffer && !seen.has(b)) { seen.add(b); out.push(b); }
    return out;
  }
  for (const x of Array.isArray(v) ? v : Object.values(v)) transferablesOf(x, out, seen);
  return out;
}

/** Handles one message in a worker, replying through `post`. */
export async function handleMessage(msg: RunMessage, post: (reply: WorkerReply, transfer?: ArrayBuffer[]) => void): Promise<void> {
  if (!msg || msg.type !== 'run') return;
  const { id } = msg;
  try {
    const result = await runTask(msg.task, msg.args, (done, total) => post({ type: 'progress', id, done, total }));
    post({ type: 'done', id, result }, transferablesOf(result));
  } catch (e) {
    post({ type: 'error', id, message: e instanceof Error ? e.message : String(e) });
  }
}
