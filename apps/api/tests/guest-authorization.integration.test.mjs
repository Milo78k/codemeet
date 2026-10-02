import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { DEMO_USER_EMAIL } from '@codemeet/db';
import { createCollaborationRoomId } from '../../../packages/shared/dist/index.js';
import { createApiServer } from '../dist/server.js';
import {
  addQuestionToInterview,
  createInterview,
  finishInterview,
  startInterview,
} from '../dist/services/interview.service.js';
import { createTestDatabase } from './support/database.mjs';

const inviteMutation = `
  mutation CreateGuestInvite($interviewId: ID!) {
    createGuestInvite(interviewId: $interviewId) { token interviewId expiresAt }
  }
`;
const joinMutation = `
  mutation JoinInterview($inviteToken: String!, $displayName: String!) {
    joinInterview(inviteToken: $inviteToken, displayName: $displayName) {
      interviewId participantSessionToken participantSessionExpiresAt
      participant { id interviewId displayName role joinedAt }
    }
  }
`;
const inviteQuery = `
  query GuestInvite($token: String!) {
    guestInvite(inviteToken: $token) { state interviewTitle expiresAt }
  }
`;
const candidateInterviewQuery = `
  query CandidateInterview($id: ID!) {
    currentParticipant { id interviewId displayName role }
    interview(id: $id) {
      id title status createdBy { id name email }
      participants { id displayName role user { id email } }
      questions {
        id snapshotTitle snapshotDescription snapshotStarterCode
        question { id title description starterCode createdBy { id email } }
      }
    }
  }
`;

let database;
let prisma;
let server;
let graphqlUrl;
let websocketUrl;
let demoUser;
let questionId;
let futureQuestionId;

async function execute(query, variables = {}, participantToken) {
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(participantToken ? { authorization: `Bearer ${participantToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

function expectError(result, code) {
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].extensions.code).toBe(code);
  expect(result.errors[0].message).not.toMatch(/[A-Za-z0-9_-]{43}/);
}

async function createInProgressInterview() {
  const interview = await createInterview(prisma, demoUser, {
    title: `Guest test ${randomUUID()}`,
  });
  await addQuestionToInterview(prisma, demoUser.id, {
    interviewId: interview.id,
    questionId,
  });
  await addQuestionToInterview(prisma, demoUser.id, {
    interviewId: interview.id,
    questionId: futureQuestionId,
  });
  await startInterview(prisma, demoUser.id, interview.id);
  return interview.id;
}

async function createInvite(interviewId) {
  const result = await execute(inviteMutation, { interviewId });
  expect(result.errors).toBeUndefined();
  return result.data.createGuestInvite;
}

async function join(inviteToken, displayName = 'Candidate') {
  return execute(joinMutation, { inviteToken, displayName });
}

function connectRoom(roomId, token, sendIdentity = true) {
  const socket = new WebSocket(`${websocketUrl}/collaboration/${encodeURIComponent(roomId)}`, {
    origin: 'http://localhost:3000',
  });
  const closed = once(socket, 'close');
  let resolveSynced;
  let rejectSynced;
  const synced = new Promise((resolve, reject) => {
    resolveSynced = resolve;
    rejectSynced = reject;
  });
  const doc = new Y.Doc();
  let authenticated = false;
  socket.on('open', () => {
    if (sendIdentity) {
      socket.send(JSON.stringify({ type: 'authenticate', role: 'candidate', token: token ?? '' }));
    } else {
      socket.send(new Uint8Array([0]));
    }
  });
  socket.on('message', (data) => {
    if (data.toString().startsWith('{')) {
      const message = JSON.parse(data.toString());
      if (message.type !== 'authenticated') {
        rejectSynced(new Error('Authentication rejected.'));
        return;
      }
      authenticated = true;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeSyncStep1(encoder, doc);
      socket.send(encoding.toUint8Array(encoder));
      return;
    }
    if (!authenticated) return;
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(decoder) !== 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      const type = syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
      if (encoding.length(encoder) > 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(encoding.toUint8Array(encoder));
      }
      if (type === syncProtocol.messageYjsSyncStep2) resolveSynced();
    } catch (error) {
      rejectSynced(error);
    }
  });
  socket.on('close', (code) => rejectSynced(new Error(`WebSocket closed (${code}).`)));
  socket.on('error', rejectSynced);
  return { socket, closed, synced, doc };
}

beforeAll(async () => {
  database = await createTestDatabase();
  prisma = database.prisma;
  demoUser = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_USER_EMAIL } });
  const questions = await prisma.question.findMany({
    where: { createdById: demoUser.id },
    orderBy: { id: 'asc' },
    take: 2,
  });
  questionId = questions[0].id;
  futureQuestionId = questions[1].id;
  server = createApiServer({
    prisma,
    demoAuthEnabled: true,
    nodeEnv: 'test',
    allowedOrigins: ['http://localhost:3000'],
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  graphqlUrl = `http://127.0.0.1:${server.address().port}/graphql`;
  websocketUrl = `ws://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
  await database?.cleanup();
});

describe('guest invite and participant authorization', () => {
  test('creates a one-time invite and transactionally issues only hashed candidate credentials', async () => {
    const interviewId = await createInProgressInterview();
    const invite = await createInvite(interviewId);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.interviewId).toBe(interviewId);

    const storedInvite = await prisma.guestToken.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(invite.token).digest('hex') },
    });
    expect(storedInvite.tokenHash).not.toBe(invite.token);
    expect(storedInvite.usedAt).toBeNull();
    expect((await execute(inviteQuery, { token: invite.token })).data.guestInvite.state).toBe(
      'VALID',
    );

    const result = await join(invite.token, '  Anton  ');
    expect(result.errors).toBeUndefined();
    const payload = result.data.joinInterview;
    expect(payload.participant).toMatchObject({
      interviewId,
      displayName: 'Anton',
      role: 'CANDIDATE',
    });
    expect(payload.participantSessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.participantSessionToken).not.toBe(invite.token);

    const [usedInvite, session, events] = await Promise.all([
      prisma.guestToken.findUniqueOrThrow({ where: { id: storedInvite.id } }),
      prisma.participantSession.findUniqueOrThrow({
        where: {
          tokenHash: createHash('sha256').update(payload.participantSessionToken).digest('hex'),
        },
      }),
      prisma.interviewEvent.findMany({ where: { interviewId, type: 'CANDIDATE_JOINED' } }),
    ]);
    expect(usedInvite.usedAt).toBeInstanceOf(Date);
    expect(session.tokenHash).not.toBe(payload.participantSessionToken);
    expect(session.participantId).toBe(payload.participant.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      participantId: payload.participant.id,
      role: 'CANDIDATE',
    });
    expectError(await join(invite.token), 'CONFLICT');
  });

  test('reports invalid, expired, used and finished invites without exposing the token', async () => {
    expect((await execute(inviteQuery, { token: 'invalid' })).data.guestInvite.state).toBe(
      'INVALID',
    );
    expectError(await join('invalid'), 'BAD_USER_INPUT');

    const interviewId = await createInProgressInterview();
    const expiredInvite = await createInvite(interviewId);
    await prisma.guestToken.update({
      where: { tokenHash: createHash('sha256').update(expiredInvite.token).digest('hex') },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(
      (await execute(inviteQuery, { token: expiredInvite.token })).data.guestInvite.state,
    ).toBe('EXPIRED');
    expectError(await join(expiredInvite.token), 'INVALID_STATE');

    const usedInvite = await createInvite(interviewId);
    expect((await join(usedInvite.token)).errors).toBeUndefined();
    expect((await execute(inviteQuery, { token: usedInvite.token })).data.guestInvite.state).toBe(
      'USED',
    );

    const finishedInterviewId = await createInProgressInterview();
    const finishedInvite = await createInvite(finishedInterviewId);
    await finishInterview(prisma, demoUser.id, finishedInterviewId);
    expect(
      (await execute(inviteQuery, { token: finishedInvite.token })).data.guestInvite.state,
    ).toBe('INTERVIEW_FINISHED');
    expectError(await join(finishedInvite.token), 'INVALID_STATE');
  });

  test('allows exactly one winner when two candidates join the same invite concurrently', async () => {
    const interviewId = await createInProgressInterview();
    const invite = await createInvite(interviewId);
    const results = await Promise.all([
      join(invite.token, 'Candidate A'),
      join(invite.token, 'Candidate B'),
    ]);
    const successes = results.filter((result) => result.data?.joinInterview);
    const failures = results.filter((result) => result.errors);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].errors[0].extensions.code).toBe('CONFLICT');
    expect(
      await prisma.interviewParticipant.count({ where: { interviewId, role: 'CANDIDATE' } }),
    ).toBe(1);
    expect(
      await prisma.interviewEvent.count({ where: { interviewId, type: 'CANDIDATE_JOINED' } }),
    ).toBe(1);
  });

  test('limits candidates to their own interview and snapshot data, and rejects expired/revoked sessions', async () => {
    const interviewId = await createInProgressInterview();
    const invite = await createInvite(interviewId);
    const joined = (await join(invite.token, 'Mira')).data.joinInterview;
    const token = joined.participantSessionToken;
    const candidateData = await execute(candidateInterviewQuery, { id: interviewId }, token);
    expect(candidateData.errors).toBeUndefined();
    expect(candidateData.data.currentParticipant).toMatchObject({
      id: joined.participant.id,
      interviewId,
      displayName: 'Mira',
      role: 'CANDIDATE',
    });
    expect(candidateData.data.interview.createdBy).toBeNull();
    expect(candidateData.data.interview.participants).toHaveLength(1);
    expect(candidateData.data.interview.participants[0]).toMatchObject({
      id: joined.participant.id,
      user: null,
    });
    expect(candidateData.data.interview.questions).toHaveLength(1);
    expect(candidateData.data.interview.questions[0].question.id).toBe(questionId);
    expect(candidateData.data.interview.questions[0].question.createdBy).toBeNull();
    expectError(
      await execute(candidateInterviewQuery, { id: interviewId }, 'z'.repeat(43)),
      'UNAUTHENTICATED',
    );

    const otherInterviewId = await createInProgressInterview();
    const otherData = await execute(candidateInterviewQuery, { id: otherInterviewId }, token);
    expect(otherData.errors).toBeUndefined();
    expect(otherData.data.interview).toBeNull();
    expectError(await execute('{ questions(limit: 1) { items { id } } }', {}, token), 'FORBIDDEN');
    expectError(
      await execute(
        'mutation Finish($id: ID!) { finishInterview(interviewId: $id) { id } }',
        {
          id: interviewId,
        },
        token,
      ),
      'FORBIDDEN',
    );
    const noteQuery = await execute(
      `query PrivateNote($id: ID!) { interview(id: $id) { notes { content } } }`,
      {
        id: interviewId,
      },
      token,
    );
    expect(noteQuery.errors[0].message).toContain('Cannot query field "notes"');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    await prisma.participantSession.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expectError(
      await execute(candidateInterviewQuery, { id: interviewId }, token),
      'UNAUTHENTICATED',
    );
  });

  test('requires WebSocket identity before Yjs sync and binds candidate tokens to one interview', async () => {
    const interviewA = await createInProgressInterview();
    const inviteA = await createInvite(interviewA);
    const joined = (await join(inviteA.token, 'Candidate A')).data.joinInterview;
    const attachmentA = await prisma.interviewQuestion.findFirstOrThrow({
      where: { interviewId: interviewA },
    });
    const roomA = createCollaborationRoomId({
      interviewId: interviewA,
      interviewQuestionId: attachmentA.id,
    });
    const allowed = connectRoom(roomA, joined.participantSessionToken);
    await allowed.synced;
    expect(allowed.doc.getText('code').toString()).toBe(attachmentA.snapshotStarterCode);
    allowed.socket.close();

    const interviewB = await createInProgressInterview();
    const attachmentB = await prisma.interviewQuestion.findFirstOrThrow({
      where: { interviewId: interviewB },
    });
    const roomB = createCollaborationRoomId({
      interviewId: interviewB,
      interviewQuestionId: attachmentB.id,
    });
    const denied = connectRoom(roomB, joined.participantSessionToken);
    const [closeCode] = await denied.closed;
    expect(closeCode).toBe(4403);
    await expect(denied.synced).rejects.toThrow('WebSocket closed');

    const missingIdentity = connectRoom(roomA, null, false);
    const [missingCode] = await missingIdentity.closed;
    expect(missingCode).toBe(4401);
    await expect(missingIdentity.synced).rejects.toThrow('WebSocket closed');
  });

  test('rejects revoked participant sessions for GraphQL and WebSocket access', async () => {
    const interviewId = await createInProgressInterview();
    const invite = await createInvite(interviewId);
    const joined = (await join(invite.token, 'Candidate')).data.joinInterview;
    const tokenHash = createHash('sha256').update(joined.participantSessionToken).digest('hex');
    await prisma.participantSession.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    expectError(
      await execute(candidateInterviewQuery, { id: interviewId }, joined.participantSessionToken),
      'UNAUTHENTICATED',
    );
    const attachment = await prisma.interviewQuestion.findFirstOrThrow({ where: { interviewId } });
    const roomId = createCollaborationRoomId({ interviewId, interviewQuestionId: attachment.id });
    const denied = connectRoom(roomId, joined.participantSessionToken);
    const [code] = await denied.closed;
    expect(code).toBe(4401);
  });
});
