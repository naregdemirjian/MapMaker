// The planetary engine's worker (Stage 14, D152), built to dist/ui/planet-worker.js by scripts/build.mjs.
import { handleMessage, type RunMessage, type WorkerReply } from './protocol.ts';

const scope = globalThis as unknown as {
  onmessage: ((e: { data: RunMessage }) => void) | null;
  postMessage(message: WorkerReply, transfer: ArrayBuffer[]): void;
};
scope.onmessage = (e) => { void handleMessage(e.data, (reply, transfer) => scope.postMessage(reply, transfer ?? [])); };
