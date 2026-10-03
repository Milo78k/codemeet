import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import type { PrismaClient } from '@codemeet/db';
import {
  parseSessionEventAuthMessage,
  SESSION_EVENTS_PATH,
  type SessionEvent,
} from '@codemeet/shared';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import { findValidParticipantSession } from '../auth/participant-session.js';
import { parseAllowedOrigins } from '../config/origins.js';
import { createApiContext } from '../graphql/context.js';
import { ApiError } from '../graphql/errors.js';

const MAX_MESSAGE_BYTES = 16 * 1024;
const AUTH_TIMEOUT_MS = 10_000;
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_UNAVAILABLE = 4404;

export type SessionEventPublisher = (event: SessionEvent) => void;

export type SessionEventHub = {
  publish: SessionEventPublisher;
  subscribe(interviewId: string, socket: WebSocket): void;
  unsubscribe(interviewId: string, socket: WebSocket): void;
};

function isAllowedOrigin(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!origin) return false;
  try {
    return allowedOrigins.has(new URL(origin).origin) && new URL(origin).origin === origin;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket: Duplex, status: 403 | 404): void {
  const phrase = status === 403 ? 'Forbidden' : 'Not Found';
  socket.write(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function toUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return data;
}

export function createSessionEventHub(): SessionEventHub {
  const subscribers = new Map<string, Set<WebSocket>>();

  function unsubscribe(interviewId: string, socket: WebSocket): void {
    const members = subscribers.get(interviewId);
    members?.delete(socket);
    if (members?.size === 0) subscribers.delete(interviewId);
  }

  return {
    subscribe(interviewId, socket) {
      let members = subscribers.get(interviewId);
      if (!members) {
        members = new Set();
        subscribers.set(interviewId, members);
      }
      members.add(socket);
    },
    unsubscribe,
    publish(event) {
      const message = JSON.stringify({ type: 'session-event', event });
      for (const socket of subscribers.get(event.interviewId) ?? []) {
        if (socket.readyState !== WebSocket.OPEN) {
          unsubscribe(event.interviewId, socket);
          continue;
        }
        try {
          socket.send(message);
        } catch {
          unsubscribe(event.interviewId, socket);
          socket.terminate();
        }
      }
    },
  };
}

/** Attach the ephemeral Interview-scoped event channel to the existing API server. */
export function attachSessionEventWebSocket(
  server: Server,
  hub: SessionEventHub,
  config: {
    prisma: PrismaClient;
    demoAuthEnabled: boolean;
    nodeEnv: string;
    allowedOrigins: readonly string[];
  },
): () => void {
  const origins = parseAllowedOrigins(config.allowedOrigins);
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const interviewsBySocket = new Map<WebSocket, string>();
  let shuttingDown = false;

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(SESSION_EVENTS_PATH)) return;
    if (!isAllowedOrigin(request.headers.origin, origins)) {
      rejectUpgrade(socket, 403);
      return;
    }
    const encodedInterviewId = url.pathname.slice(SESSION_EVENTS_PATH.length);
    if (!encodedInterviewId || encodedInterviewId.includes('/')) {
      rejectUpgrade(socket, 404);
      return;
    }
    let interviewId: string;
    try {
      interviewId = decodeURIComponent(encodedInterviewId);
    } catch {
      rejectUpgrade(socket, 404);
      return;
    }
    if (!interviewId || interviewId.length > 128 || interviewId.includes('/')) {
      rejectUpgrade(socket, 404);
      return;
    }
    if (shuttingDown) {
      rejectUpgrade(socket, 404);
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (connection) => {
      connection.pause();
      let authenticated = false;
      let authenticating = false;
      const authTimeout = setTimeout(() => {
        if (!authenticated && connection.readyState === WebSocket.OPEN) {
          connection.close(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
        }
      }, AUTH_TIMEOUT_MS);

      const reject = (code: number, reason: string) => {
        clearTimeout(authTimeout);
        if (connection.readyState === WebSocket.OPEN) connection.close(code, reason);
      };

      const authenticate = (data: RawData, isBinary: boolean) => {
        if (
          authenticating ||
          authenticated ||
          isBinary ||
          toUint8Array(data).byteLength > MAX_MESSAGE_BYTES
        ) {
          reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
          return;
        }
        authenticating = true;
        void (async () => {
          let rawMessage: unknown;
          try {
            rawMessage = JSON.parse(new TextDecoder().decode(toUint8Array(data)));
          } catch {
            reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
            return;
          }
          const message = parseSessionEventAuthMessage(rawMessage);
          if (!message) {
            reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
            return;
          }

          if (message.role === 'candidate') {
            const session = await findValidParticipantSession(config.prisma, message.token);
            if (
              !session ||
              session.participant.interviewId !== interviewId ||
              session.participant.role !== 'CANDIDATE'
            ) {
              reject(CLOSE_FORBIDDEN, 'Participant cannot access this interview.');
              return;
            }
          } else {
            const context = createApiContext(config.prisma, config.demoAuthEnabled);
            const user = await context.getCurrentUser();
            const participant = await config.prisma.interviewParticipant.findFirst({
              where: { interviewId, userId: user.id, role: 'INTERVIEWER' },
              select: { id: true },
            });
            if (!participant) {
              reject(CLOSE_FORBIDDEN, 'Participant cannot access this interview.');
              return;
            }
          }

          if (connection.readyState !== WebSocket.OPEN) return;
          authenticated = true;
          authenticating = false;
          clearTimeout(authTimeout);
          interviewsBySocket.set(connection, interviewId);
          hub.subscribe(interviewId, connection);
          connection.send(JSON.stringify({ type: 'authenticated' }));
          if (config.nodeEnv === 'development') {
            console.info('[session-events] Participant connected.');
          }
        })().catch((error: unknown) => {
          if (error instanceof ApiError && error.extensions.code === 'UNAUTHENTICATED') {
            reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
            return;
          }
          reject(CLOSE_UNAVAILABLE, 'Session event channel is unavailable.');
        });
      };

      connection.on('message', authenticate);
      connection.once('close', () => {
        clearTimeout(authTimeout);
        const subscribedInterviewId = interviewsBySocket.get(connection);
        if (subscribedInterviewId) {
          hub.unsubscribe(subscribedInterviewId, connection);
          interviewsBySocket.delete(connection);
        }
      });
      connection.resume();
    });
  }

  // The collaboration and session-event transports share the HTTP server but
  // claim disjoint URL prefixes and keep their message formats independent.
  server.on('upgrade', upgrade);
  const onClose = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const client of websocketServer.clients) {
      client.close(1001, 'API server is shutting down.');
      setTimeout(() => client.terminate(), 1_000).unref();
    }
    for (const [socket, interviewId] of interviewsBySocket) {
      hub.unsubscribe(interviewId, socket);
    }
    interviewsBySocket.clear();
    websocketServer.close();
  };
  server.once('close', onClose);

  return () => {
    server.off('upgrade', upgrade);
    server.off('close', onClose);
    onClose();
  };
}
