import { parentPort } from 'node:worker_threads';

// Simulate the browser Worker global so TypeScript selects its browser system.
Object.defineProperty(globalThis, 'process', { configurable: true, value: undefined });

const listeners = new Map();
globalThis.addEventListener = (type, listener) => {
  if (type !== 'message') return;
  const wrapped = (message) => listener({ data: message.request, ports: [message.port] });
  listeners.set(listener, wrapped);
  parentPort?.on('message', wrapped);
};
globalThis.removeEventListener = (type, listener) => {
  if (type !== 'message') return;
  const wrapped = listeners.get(listener);
  if (wrapped) parentPort?.off('message', wrapped);
  listeners.delete(listener);
};

await import(new URL('../../public/code-runner/runner.worker.js', import.meta.url).href);
