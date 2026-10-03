import { afterEach, describe, expect, jest, test } from '@jest/globals';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { AuthenticatedWebSocket } from '@/features/interviews/editor/authenticated-websocket';
import { storeParticipantSession } from '@/shared/api/participant-session';

class FakeSocket {
  static latest: FakeSocket | null = null;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  protocol = '';
  extensions = '';
  url: string;
  sent: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.latest = this;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sent.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  message(data: string | ArrayBuffer) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
  sessionStorage.clear();
});

describe('authenticated y-websocket transport adapter', () => {
  test('gates y-websocket open and sync sends on the auth acknowledgement', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
    const adapter = new AuthenticatedWebSocket('ws://127.0.0.1:4000/collaboration');
    const socket = FakeSocket.latest!;
    const opened = jest.fn();
    adapter.onopen = opened;
    const syncStep = new Uint8Array([0, 1]);
    adapter.send(syncStep);

    expect(socket.sent).toEqual([]);
    socket.open();
    expect(JSON.parse(String(socket.sent[0]))).toEqual({
      type: 'authenticate',
      role: 'interviewer',
      token: null,
    });
    expect(opened).not.toHaveBeenCalled();
    socket.message(JSON.stringify({ type: 'authenticated' }));

    expect(opened).toHaveBeenCalledTimes(1);
    expect(socket.sent[1]).toBe(syncStep);
  });

  test('lets y-websocket send every Yjs and Awareness update after authentication', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(
      'ws://127.0.0.1:4000/collaboration',
      'interview:one:question:one',
      doc,
      {
        disableBc: true,
        WebSocketPolyfill: AuthenticatedWebSocket as unknown as typeof WebSocket,
      },
    );
    const socket = FakeSocket.latest!;

    try {
      socket.open();
      socket.message(JSON.stringify({ type: 'authenticated' }));
      const initialFrames = socket.sent.length;

      doc.getText('code').insert(0, 'x');
      expect(socket.sent).toHaveLength(initialFrames + 1);
      expect((socket.sent.at(-1) as Uint8Array)[0]).toBe(0);

      const beforeAwareness = socket.sent.length;
      provider.awareness.setLocalStateField('selection', {
        anchor: { type: null, tname: 'code', item: null, assoc: 0 },
        head: { type: null, tname: 'code', item: null, assoc: 0 },
      });
      expect(socket.sent).toHaveLength(beforeAwareness + 1);
      expect((socket.sent.at(-1) as Uint8Array)[0]).toBe(1);
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });

  test('sends candidate bearer only as the first application message, never in the URL', () => {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
    const token = 'q'.repeat(43);
    storeParticipantSession({
      role: 'candidate',
      token,
      interviewId: 'interview-1',
      expiresAt: '2026-10-09T10:00:00.000Z',
    });
    new AuthenticatedWebSocket(
      'ws://127.0.0.1:4000/collaboration/interview%3Ainterview-1%3Aquestion%3Aattachment-1',
    );
    const socket = FakeSocket.latest!;
    socket.open();

    expect(socket.url).not.toContain(token);
    expect(JSON.parse(String(socket.sent[0]))).toEqual({
      type: 'authenticate',
      role: 'candidate',
      token,
    });
  });
});
