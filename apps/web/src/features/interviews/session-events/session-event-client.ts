'use client';

import {
  parseSessionEventServerMessage,
  SESSION_EVENTS_PATH,
  type SessionEvent,
  type SessionEventAuthMessage,
} from '@codemeet/shared';

type SocketLike = {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type SessionEventWebSocketConstructor = new (url: string) => SocketLike;

export function createSessionEventsUrl(realtimeUrl: string, interviewId: string): string {
  const url = new URL(realtimeUrl);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('NEXT_PUBLIC_REALTIME_URL must use ws or wss.');
  }
  url.pathname = `${SESSION_EVENTS_PATH}${encodeURIComponent(interviewId)}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function connectInterviewSessionEvents(options: {
  url: string;
  interviewId: string;
  authentication: SessionEventAuthMessage;
  onConnected(): void;
  onEvent(event: SessionEvent): void;
  WebSocketConstructor?: SessionEventWebSocketConstructor;
}): () => void {
  const WebSocketConstructor = options.WebSocketConstructor ?? WebSocket;
  let currentSocket: SocketLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let stopped = false;

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(250 * 2 ** reconnectAttempt, 5_000);
    reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  function connect(): void {
    if (stopped) return;
    let socket: SocketLike;
    try {
      socket = new WebSocketConstructor(options.url);
    } catch {
      scheduleReconnect();
      return;
    }
    currentSocket = socket;

    socket.onopen = () => {
      if (stopped || currentSocket !== socket) return;
      try {
        socket.send(JSON.stringify(options.authentication));
      } catch {
        socket.close();
      }
    };
    socket.onmessage = (message) => {
      if (stopped || currentSocket !== socket || typeof message.data !== 'string') return;
      let value: unknown;
      try {
        value = JSON.parse(message.data);
      } catch {
        return;
      }
      const parsed = parseSessionEventServerMessage(value);
      if (!parsed) return;
      if (parsed.type === 'authenticated') {
        reconnectAttempt = 0;
        options.onConnected();
        return;
      }
      if (parsed.event.interviewId === options.interviewId) options.onEvent(parsed.event);
    };
    socket.onerror = () => {
      if (currentSocket === socket) socket.close();
    };
    socket.onclose = (event) => {
      if (currentSocket === socket) currentSocket = null;
      if (event.code >= 4400 && event.code < 4500) {
        stopped = true;
        return;
      }
      scheduleReconnect();
    };
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const socket = currentSocket;
    currentSocket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, 'Session closed.');
    }
  };
}
