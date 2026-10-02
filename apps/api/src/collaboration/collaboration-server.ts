import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { parseCollaborationRoomId } from '@codemeet/shared';
import type { PrismaClient } from '@codemeet/db';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import { findValidParticipantSession } from '../auth/participant-session.js';
import { createApiContext } from '../graphql/context.js';
import { ApiError } from '../graphql/errors.js';
import { parseAllowedOrigins } from '../config/origins.js';

const COLLABORATION_PATH = '/collaboration/';
const MAX_MESSAGE_BYTES = 1_048_576;
const WS_MESSAGE_SYNC = 0;
const WS_MESSAGE_AWARENESS = 1;
const WS_MESSAGE_AUTH = 2;
const WS_MESSAGE_QUERY_AWARENESS = 3;
const CLOSE_ROOM_UNAVAILABLE = 4404;
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
const AUTH_TIMEOUT_MS = 5_000;

type Room = {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connections: Set<WebSocket>;
  clientIdsByConnection: Map<WebSocket, Set<number>>;
  disposeListeners: () => void;
};

type RoomConnectionConfig = {
  prisma: PrismaClient;
  demoAuthEnabled: boolean;
  origins: ReadonlySet<string>;
  nodeEnv: string;
};

function rawDataToUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function createMessage(type: number): encoding.Encoder {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  return encoder;
}

function broadcast(room: Room, data: Uint8Array, except?: WebSocket): void {
  for (const client of room.connections) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function removeConnection(room: Room, connection: WebSocket): void {
  room.connections.delete(connection);
  const clientIds = room.clientIdsByConnection.get(connection);
  room.clientIdsByConnection.delete(connection);
  if (clientIds && clientIds.size > 0) {
    awarenessProtocol.removeAwarenessStates(room.awareness, [...clientIds], connection);
  }
}

async function findRoomSnapshot(
  roomIdentity: { interviewId: string; interviewQuestionId: string },
  prisma: PrismaClient,
): Promise<string> {
  const attachment = await prisma.interviewQuestion.findFirst({
    where: {
      id: roomIdentity.interviewQuestionId,
      interviewId: roomIdentity.interviewId,
      interview: {
        is: {
          status: 'IN_PROGRESS',
        },
      },
    },
    select: { snapshotStarterCode: true },
  });

  if (!attachment || attachment.snapshotStarterCode === null) {
    throw new Error('The collaboration room is unavailable.');
  }
  return attachment.snapshotStarterCode;
}

function rejectUpgrade(socket: Duplex, status: 403 | 404): void {
  const phrase = status === 403 ? 'Forbidden' : 'Not Found';
  socket.write(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/** Attach the Yjs websocket transport to the API's existing HTTP server. */
export function attachCollaborationWebSocket(
  server: Server,
  config: {
    prisma: PrismaClient;
    demoAuthEnabled: boolean;
    nodeEnv: string;
    allowedOrigins: readonly string[];
  },
): () => void {
  const connectionConfig: RoomConnectionConfig = {
    prisma: config.prisma,
    demoAuthEnabled: config.demoAuthEnabled,
    nodeEnv: config.nodeEnv,
    origins: parseAllowedOrigins(config.allowedOrigins),
  };
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const rooms = new Map<string, Room>();
  const initializations = new Map<string, Promise<Room>>();
  let shuttingDown = false;

  async function getOrCreateRoom(
    roomId: string,
    identity: { interviewId: string; interviewQuestionId: string },
  ): Promise<Room> {
    // Revalidate every new socket, including rooms already held in memory.
    const starterCode = await findRoomSnapshot(identity, connectionConfig.prisma);
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const pending = initializations.get(roomId);
    if (pending) return pending;

    const initialization = (async () => {
      if (shuttingDown) throw new Error('The collaboration server is shutting down.');
      const doc = new Y.Doc();
      if (starterCode.length > 0) {
        doc.transact(() => doc.getText('code').insert(0, starterCode), 'snapshot-seed');
      }
      const awareness = new awarenessProtocol.Awareness(doc);
      const room: Room = {
        doc,
        awareness,
        connections: new Set(),
        clientIdsByConnection: new Map(),
        disposeListeners: () => {
          doc.off('update', updateHandler);
          awareness.off('update', awarenessHandler);
        },
      };
      const updateHandler = (update: Uint8Array, origin: unknown) => {
        const encoder = createMessage(WS_MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        broadcast(room, encoding.toUint8Array(encoder), origin as WebSocket | undefined);
      };
      const awarenessHandler = (
        change: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changedIds = [...change.added, ...change.updated, ...change.removed];
        if (origin instanceof WebSocket) {
          const owned = room.clientIdsByConnection.get(origin);
          for (const id of change.added) owned?.add(id);
          for (const id of change.updated) owned?.add(id);
          for (const id of change.removed) owned?.delete(id);
        }
        if (changedIds.length === 0) return;
        const encoder = createMessage(WS_MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedIds),
        );
        broadcast(room, encoding.toUint8Array(encoder), origin as WebSocket | undefined);
      };
      doc.on('update', updateHandler);
      awareness.on('update', awarenessHandler);
      rooms.set(roomId, room);
      if (connectionConfig.nodeEnv === 'development') {
        console.info(`[realtime] Room created: ${roomId}`);
      }
      return room;
    })();

    initializations.set(roomId, initialization);
    try {
      return await initialization;
    } finally {
      if (initializations.get(roomId) === initialization) initializations.delete(roomId);
    }
  }

  function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(COLLABORATION_PATH)) return;
    const origin = request.headers.origin;
    if (!origin || !connectionConfig.origins.has(origin)) {
      rejectUpgrade(socket, 403);
      return;
    }
    const encodedRoomName = url.pathname.slice(COLLABORATION_PATH.length);
    let roomId: string;
    try {
      roomId = decodeURIComponent(encodedRoomName);
    } catch {
      rejectUpgrade(socket, 404);
      return;
    }
    const identity = parseCollaborationRoomId(roomId);
    if (!identity || encodedRoomName.includes('/')) {
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
      const handleAuthentication = (data: RawData, isBinary: boolean) => {
        if (authenticating) {
          reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
          return;
        }
        authenticating = true;
        void (async () => {
          let message: { type?: unknown; role?: unknown; token?: unknown };
          if (isBinary) {
            reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
            return;
          }
          try {
            message = JSON.parse(
              new TextDecoder().decode(rawDataToUint8Array(data)),
            ) as typeof message;
          } catch {
            reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
            return;
          }
          if (message.type !== 'authenticate') {
            reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
            return;
          }

          let candidateExpiresAt: Date | null = null;
          if (message.role === 'candidate' && typeof message.token === 'string') {
            const session = await findValidParticipantSession(
              connectionConfig.prisma,
              message.token,
            );
            if (!session) {
              reject(CLOSE_UNAUTHENTICATED, 'Participant session is invalid or expired.');
              return;
            }
            if (
              session.participant.interviewId !== identity.interviewId ||
              session.participant.role !== 'CANDIDATE'
            ) {
              reject(CLOSE_FORBIDDEN, 'Participant cannot access this room.');
              return;
            }
            candidateExpiresAt = session.expiresAt;
          } else if (message.role === 'interviewer' && message.token === null) {
            const context = createApiContext(
              connectionConfig.prisma,
              connectionConfig.demoAuthEnabled,
            );
            const user = await context.getCurrentUser();
            const participant = await connectionConfig.prisma.interviewParticipant.findFirst({
              where: {
                interviewId: identity.interviewId,
                userId: user.id,
                role: 'INTERVIEWER',
              },
              select: { id: true },
            });
            if (!participant) {
              reject(CLOSE_FORBIDDEN, 'Interviewer cannot access this room.');
              return;
            }
          } else {
            reject(CLOSE_UNAUTHENTICATED, 'Participant session is invalid or expired.');
            return;
          }

          const room = await getOrCreateRoom(roomId, identity);
          if (connection.readyState !== WebSocket.OPEN) return;
          authenticated = true;
          authenticating = false;
          clearTimeout(authTimeout);

          const clientIds = new Set<number>();
          room.connections.add(connection);
          room.clientIdsByConnection.set(connection, clientIds);
          const handleRoomMessage = (roomData: RawData) => {
            try {
              const decoder = decoding.createDecoder(rawDataToUint8Array(roomData));
              const messageType = decoding.readVarUint(decoder);
              if (messageType === WS_MESSAGE_SYNC) {
                const encoder = createMessage(WS_MESSAGE_SYNC);
                syncProtocol.readSyncMessage(decoder, encoder, room.doc, connection);
                if (encoding.length(encoder) > 1 && connection.readyState === WebSocket.OPEN) {
                  connection.send(encoding.toUint8Array(encoder));
                }
                return;
              }
              if (messageType === WS_MESSAGE_AWARENESS) {
                awarenessProtocol.applyAwarenessUpdate(
                  room.awareness,
                  decoding.readVarUint8Array(decoder),
                  connection,
                );
                return;
              }
              if (messageType === WS_MESSAGE_QUERY_AWARENESS) {
                const encoder = createMessage(WS_MESSAGE_AWARENESS);
                encoding.writeVarUint8Array(
                  encoder,
                  awarenessProtocol.encodeAwarenessUpdate(room.awareness, [
                    ...room.awareness.getStates().keys(),
                  ]),
                );
                connection.send(encoding.toUint8Array(encoder));
                return;
              }
              if (messageType === WS_MESSAGE_AUTH) {
                connection.close(CLOSE_ROOM_UNAVAILABLE, 'Collaboration is unavailable.');
                return;
              }
              connection.close(1003, 'Unsupported collaboration message.');
            } catch {
              connection.close(1003, 'Invalid collaboration message.');
            }
          };
          connection.off('message', handleAuthentication);
          connection.on('message', handleRoomMessage);
          connection.once('close', () => {
            connection.off('message', handleRoomMessage);
            removeConnection(room, connection);
            if (connectionConfig.nodeEnv === 'development') {
              console.info(`[realtime] Client disconnected: ${roomId}`);
            }
          });
          connection.on('error', () => removeConnection(room, connection));
          if (candidateExpiresAt) {
            const expirationTimer = setTimeout(
              () => {
                if (connection.readyState === WebSocket.OPEN) {
                  connection.close(CLOSE_UNAUTHENTICATED, 'Participant session expired.');
                }
              },
              Math.max(0, candidateExpiresAt.getTime() - Date.now()),
            );
            expirationTimer.unref();
            connection.once('close', () => clearTimeout(expirationTimer));
          }
          if (connectionConfig.nodeEnv === 'development') {
            console.info(`[realtime] Client connected: ${roomId}`);
          }
          connection.send(new TextEncoder().encode(JSON.stringify({ type: 'authenticated' })));
          const syncEncoder = createMessage(WS_MESSAGE_SYNC);
          syncProtocol.writeSyncStep1(syncEncoder, room.doc);
          connection.send(encoding.toUint8Array(syncEncoder));
        })().catch((error: unknown) => {
          if (error instanceof ApiError && error.extensions.code === 'UNAUTHENTICATED') {
            reject(CLOSE_UNAUTHENTICATED, 'Authentication is required.');
            return;
          }
          if (error instanceof ApiError && error.extensions.code === 'FORBIDDEN') {
            reject(CLOSE_FORBIDDEN, 'Participant cannot access this room.');
            return;
          }
          reject(CLOSE_ROOM_UNAVAILABLE, 'Collaboration room is unavailable.');
        });
      };
      connection.on('message', handleAuthentication);
      connection.once('close', () => clearTimeout(authTimeout));
      connection.resume();
    });
  }

  server.on('upgrade', handleUpgrade);
  const onClose = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const client of websocketServer.clients) {
      client.close(1001, 'API server is shutting down.');
      setTimeout(() => client.terminate(), 1_000).unref();
    }
    for (const room of rooms.values()) {
      room.disposeListeners();
      room.awareness.destroy();
      room.doc.destroy();
    }
    rooms.clear();
    initializations.clear();
    websocketServer.close();
  };
  server.once('close', onClose);

  return () => {
    server.off('upgrade', handleUpgrade);
    server.off('close', onClose);
    onClose();
  };
}
