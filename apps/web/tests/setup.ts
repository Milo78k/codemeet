import '@testing-library/jest-dom/jest-globals';
import { afterAll, afterEach, beforeAll, beforeEach, jest } from '@jest/globals';
import { cleanup } from '@testing-library/react';
import { clearImmediate, setImmediate } from 'node:timers';

import { resetNavigation } from './support/navigation';
import { resetEditorAdapter } from './support/monaco';
import { server } from './support/server';
import { clearCollaborationTestState } from './support/collaboration';

jest.unstable_mockModule(
  '@/features/interviews/editor/collaboration-runtime',
  async () => import('./support/collaboration'),
);

// Node's native fetch and MSW need these timers, which jsdom does not expose.
Object.assign(globalThis, { clearImmediate, setImmediate });

// jsdom has HTMLDialogElement but omits the native dialog methods.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (returnValue = '') {
    this.returnValue = returnValue;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  resetNavigation();
  resetEditorAdapter();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  clearCollaborationTestState();
  sessionStorage.clear();
});
afterAll(() => server.close());
