declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';
  import { EventEmitter } from 'node:events';

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    pause(): void;
    resume(): void;
    send(data: Uint8Array): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }

  export class WebSocketServer extends EventEmitter {
    readonly clients: Set<WebSocket>;
    constructor(options: { noServer: true; maxPayload?: number; perMessageDeflate?: boolean });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (connection: WebSocket) => void,
    ): void;
    close(): void;
  }
}
