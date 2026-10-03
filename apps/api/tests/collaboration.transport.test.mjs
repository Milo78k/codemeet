import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { createApiServer } from '../dist/server.js';
import { createCollaborationRoomId } from '../../../packages/shared/dist/index.js';

const origin = 'http://localhost:3000';
const snapshots = new Map();
const participantSessions = new Map();
let eventWrites = 0;
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
    findFirst: async () => ({
      id: 'demo-interviewer-participant',
      displayName: 'Demo Interviewer',
      role: 'INTERVIEWER',
    }),
  },
  interviewEvent: {
    create: async () => {
      eventWrites += 1;
    },
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

function addQuestionSnapshot(interviewId, overrides = {}) {
  const interviewQuestionId = randomUUID();
  const record = {
    status: 'IN_PROGRESS',
    starterCode: 'const value = 1;\n',
    ...overrides,
  };
  snapshots.set(`${interviewId}/${interviewQuestionId}`, record);
  const identity = { interviewId, interviewQuestionId };
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
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
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
  const onAwarenessUpdate = (change) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const clientIds = [...change.added, ...change.updated, ...change.removed];
    if (clientIds.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, clientIds),
    );
    socket.send(encoding.toUint8Array(encoder));
  };
  awareness.on('update', onAwarenessUpdate);
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
      const query = encoding.createEncoder();
      encoding.writeVarUint(query, 3);
      socket.send(encoding.toUint8Array(query));
      return;
    }
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const frameType = decoding.readVarUint(decoder);
      if (frameType === 1) {
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          socket,
        );
        return;
      }
      if (frameType !== 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
      if (encoding.length(encoder) > 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(encoding.toUint8Array(encoder));
      }
      if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
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
    awareness,
    socket,
    synced,
    closed,
    close() {
      doc.off('update', onUpdate);
      awareness.off('update', onAwarenessUpdate);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      awareness.destroy();
    },
  };
}

function candidateCredential(interviewId, overrides = {}) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  participantSessions.set(tokenHash, {
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    participant: {
      id: randomUUID(),
      interviewId,
      role: 'CANDIDATE',
      displayName: 'Anton Candidate',
      userId: null,
    },
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

async function expectAwareness(client, participantId, present = true) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const found = [...client.awareness.getStates().values()].some(
      (state) => state.user?.participantId === participantId,
    );
    if (found === present) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Awareness participant ${participantId} did not become ${present ? 'present' : 'absent'}.`,
  );
}

function participantForCredential(auth) {
  const tokenHash = createHash('sha256').update(auth.token).digest('hex');
  return participantSessions.get(tokenHash).participant;
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

  test('authoritative Awareness is room-scoped, ephemeral, and removed on disconnect', async () => {
    const { identity, record, roomId } = addSnapshot();
    const questionTwo = addQuestionSnapshot(identity.interviewId);
    const credential = candidateCredential(identity.interviewId);
    const candidateIdentity = participantForCredential(credential);
    const eventCountBefore = eventWrites;
    const candidate = openRoom(roomId, new Y.Doc(), origin, credential);
    const interviewer = openRoom(roomId);
    const otherQuestionInterviewer = openRoom(questionTwo.roomId);
    await Promise.all([candidate.synced, interviewer.synced, otherQuestionInterviewer.synced]);

    const initialCode = record.starterCode;
    const anchor = JSON.parse(
      JSON.stringify(Y.createRelativePositionFromTypeIndex(candidate.doc.getText('code'), 4)),
    );
    const head = JSON.parse(
      JSON.stringify(
        Y.createRelativePositionFromTypeIndex(
          candidate.doc.getText('code'),
          candidate.doc.getText('code').length,
        ),
      ),
    );
    expect(head.item).toBeNull();
    candidate.awareness.setLocalState({
      user: { participantId: 'spoofed', displayName: 'Attacker', role: 'INTERVIEWER' },
      sessionToken: credential.token,
      permissions: { canFinish: true },
      selection: { anchor, head },
    });
    await expectAwareness(interviewer, candidateIdentity.id);
    await expectAwareness(otherQuestionInterviewer, candidateIdentity.id, false);
    const trustedCandidate = [...interviewer.awareness.getStates().values()].find(
      (state) => state.user?.participantId === candidateIdentity.id,
    );
    expect(trustedCandidate?.user).toEqual({
      participantId: candidateIdentity.id,
      displayName: 'Anton Candidate',
      role: 'CANDIDATE',
    });
    expect(trustedCandidate?.selection).toEqual({ anchor, head });
    expect(() =>
      Y.createAbsolutePositionFromRelativePosition(
        trustedCandidate.selection.head,
        interviewer.doc,
      ),
    ).not.toThrow();
    expect(trustedCandidate).not.toHaveProperty('sessionToken');
    expect(trustedCandidate).not.toHaveProperty('permissions');
    expect(JSON.stringify(trustedCandidate)).not.toContain(credential.token);
    expect(candidate.doc.getText('code').toString()).toBe(initialCode);
    expect(interviewer.doc.getText('code').toString()).toBe(initialCode);
    expect(eventWrites).toBe(eventCountBefore);

    interviewer.awareness.setLocalState({
      user: { participantId: 'forged', displayName: 'Forged Candidate', role: 'CANDIDATE' },
    });
    await expectAwareness(candidate, 'demo-interviewer-participant');
    const trustedInterviewer = [...candidate.awareness.getStates().values()].find(
      (state) => state.user?.participantId === 'demo-interviewer-participant',
    );
    expect(trustedInterviewer?.user).toEqual({
      participantId: 'demo-interviewer-participant',
      displayName: 'Demo Interviewer',
      role: 'INTERVIEWER',
    });
    await expectSameText(candidate, interviewer);

    candidate.close();
    await expectAwareness(interviewer, candidateIdentity.id, false);
    expect(interviewer.socket.readyState).toBe(WebSocket.OPEN);
    interviewer.close();
    otherQuestionInterviewer.close();
  });

  test('rejects a WebSocket trying to claim another connection Awareness clientId', async () => {
    const { roomId } = addSnapshot();
    const first = openRoom(roomId);
    const second = openRoom(roomId);
    await Promise.all([first.synced, second.synced]);
    first.awareness.setLocalState({
      user: {
        participantId: 'demo-interviewer-participant',
        displayName: 'Demo',
        role: 'INTERVIEWER',
      },
    });
    await expectAwareness(second, 'demo-interviewer-participant');
    const firstClientId = first.awareness.clientID;
    const maliciousUpdateEncoder = encoding.createEncoder();
    encoding.writeVarUint(maliciousUpdateEncoder, 1);
    encoding.writeVarUint(maliciousUpdateEncoder, firstClientId);
    encoding.writeVarUint(
      maliciousUpdateEncoder,
      (first.awareness.meta.get(firstClientId)?.clock ?? 0) + 1,
    );
    encoding.writeVarString(
      maliciousUpdateEncoder,
      JSON.stringify({
        user: { participantId: 'forged', displayName: 'Forged', role: 'CANDIDATE' },
      }),
    );
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(encoder, encoding.toUint8Array(maliciousUpdateEncoder));
    second.socket.send(encoding.toUint8Array(encoder));
    const [code] = await second.closed;
    expect(code).toBe(1008);
    first.close();
    second.close();
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
