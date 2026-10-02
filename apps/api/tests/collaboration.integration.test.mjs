import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { once } from 'node:events';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { createApiServer } from '../dist/server.js';
import { createCollaborationRoomId } from '../../../packages/shared/dist/index.js';
import { createTestDatabase } from './support/database.mjs';

const origin = 'http://localhost:3000';
let database;
let prisma;
let server;
let baseUrl;
let user;
let questions;

async function graphQL(query, variables = {}) {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (result.errors) throw new Error(result.errors[0].message);
  return result.data;
}

async function createStartedInterview(question = questions[0]) {
  const interview = (
    await graphQL(
      'mutation($input: CreateInterviewInput!) { createInterview(input: $input) { id } }',
      { input: { title: `Realtime ${crypto.randomUUID()}` } },
    )
  ).createInterview;
  const attached = (
    await graphQL(
      'mutation($interviewId: ID!, $questionId: ID!) { addQuestionToInterview(interviewId: $interviewId, questionId: $questionId) { questions { id } } }',
      { interviewId: interview.id, questionId: question.id },
    )
  ).addQuestionToInterview;
  const interviewQuestionId = attached.questions[0].id;
  await graphQL(
    'mutation($interviewId: ID!) { startInterview(interviewId: $interviewId) { status } }',
    { interviewId: interview.id },
  );
  return { interviewId: interview.id, interviewQuestionId };
}

function openRoom(roomId, doc = new Y.Doc()) {
  let socket;
  let syncedResolve;
  let syncedReject;
  const synced = new Promise((resolve, reject) => {
    syncedResolve = resolve;
    syncedReject = reject;
  });
  const timeout = setTimeout(() => syncedReject(new Error('WebSocket sync timed out.')), 5_000);
  socket = new WebSocket(
    `${baseUrl.replace('http:', 'ws:')}/collaboration/${encodeURIComponent(roomId)}`,
    {
      origin,
    },
  );
  const sendUpdate = (update, updateOrigin) => {
    if (updateOrigin === socket || socket.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    socket.send(encoding.toUint8Array(encoder));
  };
  doc.on('update', sendUpdate);
  socket.on('open', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, doc);
    socket.send(encoding.toUint8Array(encoder));
  });
  socket.on('message', (data) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType !== 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      const syncType = syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
      if (encoding.length(encoder) > 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(encoding.toUint8Array(encoder));
      }
      if (syncType === syncProtocol.messageYjsSyncStep2) {
        clearTimeout(timeout);
        syncedResolve();
      }
    } catch (error) {
      syncedReject(error);
    }
  });
  socket.on('error', (error) => syncedReject(error));
  return {
    doc,
    socket,
    synced,
    close() {
      doc.off('update', sendUpdate);
      if (socket.readyState === WebSocket.OPEN) socket.close();
    },
  };
}

async function expectConverged(...clients) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const values = clients.map(({ doc }) => doc.getText('code').toString());
    if (values.every((value) => value === values[0])) return values[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Yjs clients did not converge: ${clients.map(({ doc }) => doc.getText('code').toString())}`,
  );
}

beforeAll(async () => {
  database = await createTestDatabase();
  prisma = database.prisma;
  user = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@codemeet.local' } });
  questions = await prisma.question.findMany({
    where: { createdById: user.id },
    orderBy: { title: 'asc' },
  });
  server = createApiServer({
    prisma,
    demoAuthEnabled: true,
    nodeEnv: 'test',
    allowedOrigins: [origin],
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 90_000);

afterAll(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
  if (database) await database.cleanup();
});

describe('Yjs rooms on the GraphQL HTTP server', () => {
  test('valid room is seeded once and concurrent clients exchange text updates', async () => {
    const identity = await createStartedInterview();
    const attachment = await prisma.interviewQuestion.findUniqueOrThrow({
      where: { id: identity.interviewQuestionId },
    });
    const roomId = createCollaborationRoomId(identity);
    const first = openRoom(roomId);
    const second = openRoom(roomId);
    await Promise.all([first.synced, second.synced]);
    expect(first.doc.getText('code').toString()).toBe(attachment.snapshotStarterCode);
    expect(await expectConverged(first, second)).toBe(attachment.snapshotStarterCode);

    first.doc.getText('code').insert(0, 'const a = 1;\n');
    await expectConverged(first, second);
    second.doc.getText('code').insert(0, 'const b = 2;\n');
    await expectConverged(first, second);
    expect(
      await prisma.interviewQuestion.findUniqueOrThrow({
        where: { id: identity.interviewQuestionId },
      }),
    ).toMatchObject({ snapshotStarterCode: attachment.snapshotStarterCode });
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    second.doc.getText('code').insert(0, 'const online = true;\n');
    first.doc.getText('code').insert(0, 'const offline = true;\n');
    const reconnected = openRoom(roomId, first.doc);
    await reconnected.synced;
    await expectConverged(second, reconnected);
    reconnected.close();
    second.close();
    await graphQL(
      'mutation($interviewId: ID!) { finishInterview(interviewId: $interviewId) { status } }',
      { interviewId: identity.interviewId },
    );
    const afterFinish = openRoom(roomId);
    await expect(afterFinish.synced).rejects.toThrow();
    afterFinish.close();
  });

  test('rejects a room whose question belongs to a different interview', async () => {
    const first = await createStartedInterview(questions[0]);
    const second = await createStartedInterview(questions[1]);
    const invalid = createCollaborationRoomId({
      interviewId: first.interviewId,
      interviewQuestionId: second.interviewQuestionId,
    });
    const client = openRoom(invalid);
    await expect(client.synced).rejects.toThrow();
    client.close();
  });

  test('rejects FINISHED interviews and missing snapshots', async () => {
    const finished = await createStartedInterview();
    await graphQL(
      'mutation($interviewId: ID!) { finishInterview(interviewId: $interviewId) { status } }',
      { interviewId: finished.interviewId },
    );
    const finishedClient = openRoom(createCollaborationRoomId(finished));
    await expect(finishedClient.synced).rejects.toThrow();
    finishedClient.close();

    const missing = await createStartedInterview();
    await prisma.interviewQuestion.update({
      where: { id: missing.interviewQuestionId },
      data: {
        snapshotTitle: null,
        snapshotDescription: null,
        snapshotDifficulty: null,
        snapshotLanguage: null,
        snapshotStarterCode: null,
        snapshotCapturedAt: null,
      },
    });
    const missingClient = openRoom(createCollaborationRoomId(missing));
    await expect(missingClient.synced).rejects.toThrow();
    missingClient.close();
  });

  test('rejects invalid room IDs and untrusted origins during upgrade', async () => {
    const invalid = openRoom('interview:bad/question:bad');
    await expect(invalid.synced).rejects.toThrow();
    invalid.close();
    const untrusted = new WebSocket(
      `${baseUrl.replace('http:', 'ws:')}/collaboration/${encodeURIComponent('interview:bad:question:bad')}`,
      { origin: 'https://untrusted.example' },
    );
    await expect(once(untrusted, 'open')).rejects.toThrow();
    untrusted.close();
  });
});
