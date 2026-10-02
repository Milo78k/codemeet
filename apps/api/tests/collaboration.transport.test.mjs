import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { createApiServer } from '../dist/server.js';
import { createCollaborationRoomId } from '../../../packages/shared/dist/index.js';

const origin = 'http://localhost:3000';
const snapshots = new Map();
const participantSessions = new Map();
let server;
let baseUrl;

const prisma = {
  user: {
    findUnique: async () => ({
      id: 'demo-user',
      email: 'demo@codemeet.local',
      name: 'Demo Interviewer',
    }),
  },
  interviewQuestion: {
    findFirst: async ({ where }) => {
      const record = snapshots.get(`${where.interviewId}/${where.id}`);
      if (!record || record.status !== 'IN_PROGRESS') return null;
      return { snapshotStarterCode: record.starterCode };
    },
  },
  interviewParticipant: {
    findFirst: async () => ({ id: 'demo-interviewer-participant' }),
  },
  participantSession: {
    findUnique: async ({ where }) => participantSessions.get(where.tokenHash) ?? null,
  },
};

function addSnapshot(overrides = {}) {
  const interviewId = randomUUID();
  const interviewQuestionId = randomUUID();
  const identity = { interviewId, interviewQuestionId };
  const record = {
    status: 'IN_PROGRESS',
    starterCode: 'const value = 1;\n',
    ...overrides,
  };
  snapshots.set(`${interviewId}/${interviewQuestionId}`, record);
  return { identity, record, roomId: createCollaborationRoomId(identity) };
}

function openRoom(
  roomId,
  doc = new Y.Doc(),
  requestOrigin = origin,
  auth = { type: 'authenticate', role: 'interviewer', token: null },
) {
  let resolveSync;
  let rejectSync;
  let syncedState = false;
  const synced = new Promise((resolve, reject) => {
    resolveSync = resolve;
    rejectSync = reject;
  });
  const timeout = setTimeout(() => rejectSync(new Error('WebSocket sync timed out.')), 3_000);
  const socket = new WebSocket(
    `${baseUrl.replace('http:', 'ws:')}/collaboration/${encodeURIComponent(roomId)}`,
    { origin: requestOrigin },
  );
  const closed = new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve([code, reason]));
  });
  const onUpdate = (update, updateOrigin) => {
    if (updateOrigin === socket || socket.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    socket.send(encoding.toUint8Array(encoder));
  };
  doc.on('update', onUpdate);
  socket.on('open', () => {
    if (auth !== null) socket.send(JSON.stringify(auth));
  });
  socket.on('message', (data) => {
    if (typeof data === 'string' || data.toString().startsWith('{')) {
      const response = JSON.parse(data.toString());
      if (response.type !== 'authenticated') {
        rejectSync(new Error('WebSocket authentication failed.'));
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeSyncStep1(encoder, doc);
      socket.send(encoding.toUint8Array(encoder));
      return;
    }
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(decoder) !== 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      const messageType = syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
      if (encoding.length(encoder) > 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(encoding.toUint8Array(encoder));
      }
      if (messageType === syncProtocol.messageYjsSyncStep2) {
        syncedState = true;
        clearTimeout(timeout);
        resolveSync();
      }
    } catch (error) {
      rejectSync(error);
    }
  });
  socket.on('close', (code) => {
    if (!syncedState) {
      clearTimeout(timeout);
      rejectSync(new Error(`WebSocket closed before sync (${code}).`));
    }
  });
  socket.on('error', rejectSync);
  return {
    doc,
    socket,
    synced,
    closed,
    close() {
      doc.off('update', onUpdate);
      if (socket.readyState === WebSocket.OPEN) socket.close();
    },
  };
}

function candidateCredential(interviewId, overrides = {}) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  participantSessions.set(tokenHash, {
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    participant: { id: randomUUID(), interviewId, role: 'CANDIDATE', userId: null },
    ...overrides,
  });
  return { type: 'authenticate', role: 'candidate', token };
}

async function expectSameText(...clients) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const values = clients.map(({ doc }) => doc.getText('code').toString());
    if (values.every((value) => value === values[0])) return values[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Clients did not converge.');
}

beforeAll(async () => {
  server = createApiServer({
    prisma,
    demoAuthEnabled: true,
    nodeEnv: 'test',
    allowedOrigins: [origin],
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});

describe('Yjs WebSocket transport', () => {
  test('requires an identity message before accepting a Yjs frame', async () => {
    const { roomId } = addSnapshot();
    const client = openRoom(roomId, new Y.Doc(), origin, null);
    client.socket.on('open', () => client.socket.send(new Uint8Array([0])));
    const [code] = await client.closed;
    expect(code).toBe(4401);
    await expect(client.synced).rejects.toThrow('WebSocket closed before sync');
    client.close();
  });

  test('allows a valid candidate only into its own interview room', async () => {
    const first = addSnapshot();
    const second = addSnapshot();
    const credential = candidateCredential(first.identity.interviewId);
    const allowed = openRoom(first.roomId, new Y.Doc(), origin, credential);
    await allowed.synced;
    allowed.close();

    const denied = openRoom(second.roomId, new Y.Doc(), origin, credential);
    const [code] = await denied.closed;
    expect(code).toBe(4403);
    await expect(denied.synced).rejects.toThrow('WebSocket closed before sync');
    denied.close();
  });

  test.each([
    ['expired', { expiresAt: new Date(Date.now() - 1_000) }],
    ['revoked', { revokedAt: new Date() }],
  ])('rejects a %s participant session', async (_label, overrides) => {
    const { identity, roomId } = addSnapshot();
    const client = openRoom(
      roomId,
      new Y.Doc(),
      origin,
      candidateCredential(identity.interviewId, overrides),
    );
    const [code] = await client.closed;
    expect(code).toBe(4401);
    await expect(client.synced).rejects.toThrow('WebSocket closed before sync');
    client.close();
  });

  test('seeds one logical room and synchronizes concurrent clients', async () => {
    const { roomId, record } = addSnapshot();
    const first = openRoom(roomId);
    const second = openRoom(roomId);
    await Promise.all([first.synced, second.synced]);
    expect(await expectSameText(first, second)).toBe(record.starterCode);
    first.doc.getText('code').insert(0, 'const first = true;\n');
    await expectSameText(first, second);
    second.doc.getText('code').insert(0, 'const second = true;\n');
    expect(await expectSameText(first, second)).toContain('const second = true;');

    first.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    second.doc.getText('code').insert(0, 'const online = true;\n');
    first.doc.getText('code').insert(0, 'const offline = true;\n');
    const reconnected = openRoom(roomId, first.doc);
    await reconnected.synced;
    expect(await expectSameText(second, reconnected)).toContain('const offline = true;');
    reconnected.close();
    second.close();
  });

  test('rejects unrelated, finished, snapshotless, malformed and untrusted rooms', async () => {
    const valid = addSnapshot();
    const wrongQuestion = openRoom(
      createCollaborationRoomId({
        interviewId: valid.identity.interviewId,
        interviewQuestionId: randomUUID(),
      }),
    );
    await expect(wrongQuestion.synced).rejects.toThrow();
    wrongQuestion.close();

    const finished = addSnapshot();
    const openFinished = openRoom(finished.roomId);
    await openFinished.synced;
    openFinished.close();
    finished.record.status = 'FINISHED';
    const rejectFinished = openRoom(finished.roomId);
    await expect(rejectFinished.synced).rejects.toThrow();
    rejectFinished.close();

    const missing = addSnapshot({ starterCode: null });
    const rejectMissing = openRoom(missing.roomId);
    await expect(rejectMissing.synced).rejects.toThrow();
    rejectMissing.close();

    const invalid = openRoom('interview:bad/question:bad');
    await expect(invalid.synced).rejects.toThrow();
    invalid.close();

    const untrusted = openRoom(
      createCollaborationRoomId(addSnapshot().identity),
      new Y.Doc(),
      'https://untrusted.example',
    );
    await expect(untrusted.synced).rejects.toThrow();
    untrusted.close();
  });
});
