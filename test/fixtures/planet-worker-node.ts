// The planetary engine's worker in Node (worker_threads), for the tests: the same protocol as the browser's.
import { parentPort } from 'node:worker_threads';
import { handleMessage, type RunMessage } from '../../src/planet/worker/protocol.ts';

parentPort!.on('message', (msg: RunMessage) => { void handleMessage(msg, (reply, transfer) => parentPort!.postMessage(reply, transfer ?? [])); });
