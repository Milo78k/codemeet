'use client';

import { readBrowserCredential } from '../../../shared/api/participant-session';

type SocketMessage = string | ArrayBufferLike | Blob | ArrayBufferView;
type SocketEventHandler<T extends Event> = ((event: T) => void) | null;

/**
 * y-websocket starts Yjs sync in its `open` callback. This browser WebSocket
 * adapter delays that callback until the API acknowledges participant auth.
 */
export class AuthenticatedWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  private readonly socket: WebSocket;
  private authenticated = false;
  private readonly buffered: SocketMessage[] = [];
  onopen: SocketEventHandler<Event> = null;
  onmessage: SocketEventHandler<MessageEvent> = null;
  onerror: SocketEventHandler<Event> = null;
  onclose: SocketEventHandler<CloseEvent> = null;

  constructor(url: string, protocols?: string | string[]) {
    this.socket = new WebSocket(url, protocols);
    this.socket.onopen = () => {
      const credential = readBrowserCredential();
      this.socket.send(
        JSON.stringify(
          credential.role === 'candidate'
            ? { type: 'authenticate', role: 'candidate', token: credential.token }
            : { type: 'authenticate', role: 'interviewer', token: null },
        ),
      );
    };
    this.socket.onmessage = (event) => {
      if (!this.authenticated) {
        if (typeof event.data !== 'string') {
          this.socket.close(4401, 'Authentication is required.');
          return;
        }
        let accepted = false;
        try {
          const response = JSON.parse(event.data) as { type?: unknown };
          accepted = response.type === 'authenticated';
        } catch {
          accepted = false;
        }
        if (!accepted) {
          this.socket.close(4401, 'Authentication is required.');
          return;
        }
        this.authenticated = true;
        this.onopen?.(new Event('open'));
        for (const message of this.buffered.splice(0)) this.socket.send(message);
        return;
      }
      this.onmessage?.(event);
    };
    this.socket.onerror = (event) => this.onerror?.(event);
    this.socket.onclose = (event) => this.onclose?.(event);
  }

  get readyState() {
    return this.socket.readyState;
  }

  get binaryType(): BinaryType {
    return this.socket.binaryType;
  }

  set binaryType(value: BinaryType) {
    this.socket.binaryType = value;
  }

  get bufferedAmount() {
    return this.socket.bufferedAmount;
  }

  get protocol() {
    return this.socket.protocol;
  }

  get extensions() {
    return this.socket.extensions;
  }

  get url() {
    return this.socket.url;
  }

  send(data: SocketMessage) {
    if (this.authenticated && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
      return;
    }
    if (this.socket.readyState === WebSocket.CONNECTING || !this.authenticated) {
      this.buffered.push(data);
      return;
    }
    throw new DOMException('The WebSocket is not open.', 'InvalidStateError');
  }

  close(code?: number, reason?: string) {
    this.socket.close(code, reason);
  }
}
