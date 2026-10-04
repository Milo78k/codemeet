import { afterAll, afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { once } from 'node:events';
import { WebSocket } from 'ws';

import { createApiServer } from '../dist/server.js';
import { createTestDatabase } from './support/database.mjs';

const origin = 'http://localhost:3000';
const activeQuestionMutation = `
  mutation SetActive($interviewId: ID!, $questionId: ID!) {
    setActiveQuestion(interviewId: $interviewId, questionId: $questionId) {
      id status activeQuestion { id }
    }
  }
`;
const startMutation = `
  mutation Start($interviewId: ID!) {
    startInterview(interviewId: $interviewId) { id status activeQuestion { id } }
  }
`;
const finishMutation = `
  mutation Finish($interviewId: ID!) {
    finishInterview(interviewId: $interviewId) { id status }
  }
`;

let database;
let prisma;
let server;
let baseUrl;
let websocketUrl;
let questions;
const sockets = new Set();

async function graphQL(query, variables = {}, participantToken) {
  const headers = { 'content-type': 'application/json' };
  if (participantToken) headers.authorization = `Bearer ${participantToken}`;
  const response = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

function expectSuccess(result) {
  expect(result.errors).toBeUndefined();
  expect(result.data).toBeDefined();
  return result.data;
}

async function createInterview({ start = true } = {}) {
  const created = expectSuccess(
    await graphQL(
      'mutation($input: CreateInterviewInput!) { createInterview(input: $input) { id } }',
      { input: { title: `Session events ${crypto.randomUUID()}` } },
    ),
  ).createInterview;

  for (const [order, question] of questions.slice(0, 2).entries()) {
    expectSuccess(
      await graphQL(
        'mutation($interviewId: ID!, $questionId: ID!, $order: Int) { addQuestionToInterview(interviewId: $interviewId, questionId: $questionId, order: $order) { id } }',
        { interviewId: created.id, questionId: question.id, order },
      ),
    );
  }
  if (start) {
    expectSuccess(
      await graphQL(
        'mutation($interviewId: ID!) { startInterview(interviewId: $interviewId) { id } }',
        {
          interviewId: created.id,
        },
      ),
    );
  }
  return created.id;
}

async function joinCandidate(interviewId) {
  const invite = expectSuccess(
    await graphQL(
      'mutation($interviewId: ID!) { createGuestInvite(interviewId: $interviewId) { token } }',
      {
        interviewId,
      },
    ),
  ).createGuestInvite;
  return expectSuccess(
    await graphQL(
      'mutation($inviteToken: String!, $displayName: String!) { joinInterview(inviteToken: $inviteToken, displayName: $displayName) { participantSessionToken participant { id } } }',
      { inviteToken: invite.token, displayName: 'Session Event Candidate' },
    ),
  ).joinInterview.participantSessionToken;
}

function openSessionEvents(interviewId, authentication) {
  const socket = new WebSocket(
    `${websocketUrl}/session-events/${encodeURIComponent(interviewId)}`,
    { origin },
  );
  const client = { socket, messages: [], waiters: [], closed: null };
  client.closed = new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve([code, reason.toString()]));
  });
  socket.on('error', () => {});
  socket.on('open', () => socket.send(JSON.stringify(authentication)));
  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    const waiterIndex = client.waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = client.waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    } else {
      client.messages.push(message);
    }
  });
  sockets.add(socket);
  return client;
}

function nextMessage(client, predicate, timeoutMs = 5_000) {
  const index = client.messages.findIndex(predicate);
  if (index >= 0) return Promise.resolve(client.messages.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timeout: setTimeout(() => {
        client.waiters = client.waiters.filter((item) => item !== waiter);
        reject(new Error('Timed out waiting for session event message.'));
      }, timeoutMs),
    };
    client.waiters.push(waiter);
  });
}

function nextEvent(client, type, timeoutMs = 5_000) {
  return nextMessage(
    client,
    (message) => message.type === 'session-event' && message.event?.type === type,
    timeoutMs,
  );
}

function authenticateAsInterviewer(interviewId) {
  return openSessionEvents(interviewId, { type: 'authenticate', role: 'interviewer', token: null });
}

function authenticateAsCandidate(interviewId, token) {
  return openSessionEvents(interviewId, { type: 'authenticate', role: 'candidate', token });
}

async function expectNoEvent(client, type) {
  await expect(nextEvent(client, type, 100)).rejects.toThrow('Timed out');
}

async function closeClient(client) {
  if (
    client.socket.readyState === WebSocket.OPEN ||
    client.socket.readyState === WebSocket.CONNECTING
  ) {
    client.socket.close(1000);
  }
  await Promise.race([client.closed, new Promise((resolve) => setTimeout(resolve, 250))]);
}

beforeAll(async () => {
  database = await createTestDatabase();
  prisma = database.prisma;
  const interviewer = await prisma.user.findUniqueOrThrow({
    where: { email: 'demo@codemeet.local' },
  });
  questions = await prisma.question.findMany({
    where: { createdById: interviewer.id },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
  });
  if (questions.length < 2) throw new Error('The test database seed requires two questions.');

  server = createApiServer({
    prisma,
    demoAuthEnabled: true,
    nodeEnv: 'test',
    allowedOrigins: [origin],
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  websocketUrl = `ws://127.0.0.1:${address.port}`;
}, 90_000);

afterEach(async () => {
  await Promise.all(
    [...sockets].map(async (socket) => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000);
      }
      await Promise.race([
        once(socket, 'close').catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 250)),
      ]);
    }),
  );
  sockets.clear();
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
  if (database) await database.cleanup();
});

describe('Interview-scoped session event transport', () => {
  test('a candidate waiting before start receives an after-commit start event only for their interview', async () => {
    const interviewA = await createInterview({ start: false });
    const interviewB = await createInterview({ start: false });
    const candidateTokenA = await joinCandidate(interviewA);
    const candidateTokenB = await joinCandidate(interviewB);
    const candidateA = authenticateAsCandidate(interviewA, candidateTokenA);
    const candidateB = authenticateAsCandidate(interviewB, candidateTokenB);
    await Promise.all([
      nextMessage(candidateA, (message) => message.type === 'authenticated'),
      nextMessage(candidateB, (message) => message.type === 'authenticated'),
    ]);

    const started = expectSuccess(await graphQL(startMutation, { interviewId: interviewA }));
    expect(started.startInterview).toMatchObject({
      id: interviewA,
      status: 'IN_PROGRESS',
      activeQuestion: { id: questions[0].id },
    });
    const candidateMessage = await nextEvent(candidateA, 'INTERVIEW_STARTED');
    expect(candidateMessage.event).toMatchObject({
      type: 'INTERVIEW_STARTED',
      interviewId: interviewA,
    });
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interviewA } })).toMatchObject({
      status: 'IN_PROGRESS',
      activeQuestionId: questions[0].id,
    });
    await expectNoEvent(candidateB, 'INTERVIEW_STARTED');

    const duplicate = await graphQL(startMutation, { interviewId: interviewA });
    expect(duplicate.errors).toHaveLength(1);
    await expectNoEvent(candidateA, 'INTERVIEW_STARTED');
  });

  test('authenticated interview participants receive active-question invalidations after commit only in their channel', async () => {
    const interviewA = await createInterview();
    const interviewB = await createInterview();
    const candidateToken = await joinCandidate(interviewA);
    const interviewerA = authenticateAsInterviewer(interviewA);
    const candidateA = authenticateAsCandidate(interviewA, candidateToken);
    const interviewerB = authenticateAsInterviewer(interviewB);
    await Promise.all([
      nextMessage(interviewerA, (message) => message.type === 'authenticated'),
      nextMessage(candidateA, (message) => message.type === 'authenticated'),
      nextMessage(interviewerB, (message) => message.type === 'authenticated'),
    ]);

    const questionB = questions[1].id;
    const result = expectSuccess(
      await graphQL(activeQuestionMutation, { interviewId: interviewA, questionId: questionB }),
    );
    expect(result.setActiveQuestion.activeQuestion.id).toBe(questionB);

    const [interviewerMessage, candidateMessage] = await Promise.all([
      nextEvent(interviewerA, 'ACTIVE_QUESTION_CHANGED'),
      nextEvent(candidateA, 'ACTIVE_QUESTION_CHANGED'),
    ]);
    expect(interviewerMessage.event).toMatchObject({
      interviewId: interviewA,
      type: 'ACTIVE_QUESTION_CHANGED',
    });
    expect(candidateMessage.event.interviewId).toBe(interviewA);
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interviewA } })).toMatchObject({
      activeQuestionId: questionB,
      status: 'IN_PROGRESS',
    });
    await expectNoEvent(interviewerB, 'ACTIVE_QUESTION_CHANGED');

    await closeClient(candidateA);
    const questionA = questions[0].id;
    expectSuccess(
      await graphQL(activeQuestionMutation, { interviewId: interviewA, questionId: questionA }),
    );
    const reconnectedCandidate = authenticateAsCandidate(interviewA, candidateToken);
    await nextMessage(reconnectedCandidate, (message) => message.type === 'authenticated');
    const canonical = expectSuccess(
      await graphQL(
        'query($id: ID!) { interview(id: $id) { activeQuestion { id } } }',
        {
          id: interviewA,
        },
        candidateToken,
      ),
    ).interview;
    expect(canonical.activeQuestion.id).toBe(questionA);
    await expectNoEvent(reconnectedCandidate, 'ACTIVE_QUESTION_CHANGED');
  });

  test('rejects malformed authentication and a candidate token scoped to another interview', async () => {
    const interviewA = await createInterview();
    const interviewB = await createInterview();
    const candidateTokenB = await joinCandidate(interviewB);
    const malformed = openSessionEvents(interviewA, {
      type: 'authenticate',
      role: 'candidate',
      token: 'invalid',
    });
    const foreign = authenticateAsCandidate(interviewA, candidateTokenB);

    await expect(malformed.closed).resolves.toMatchObject([4401, expect.any(String)]);
    await expect(foreign.closed).resolves.toMatchObject([4403, expect.any(String)]);
  });

  test('failed and no-op active-question/finish mutations publish nothing', async () => {
    const inProgress = await createInterview();
    const ready = await createInterview({ start: false });
    const activeSubscriber = authenticateAsInterviewer(inProgress);
    const readySubscriber = authenticateAsInterviewer(ready);
    await Promise.all([
      nextMessage(activeSubscriber, (message) => message.type === 'authenticated'),
      nextMessage(readySubscriber, (message) => message.type === 'authenticated'),
    ]);

    expectSuccess(
      await graphQL(activeQuestionMutation, {
        interviewId: inProgress,
        questionId: questions[0].id,
      }),
    );
    const invalidQuestion = await graphQL(activeQuestionMutation, {
      interviewId: inProgress,
      questionId: 'question-not-attached',
    });
    expect(invalidQuestion.errors).toHaveLength(1);
    const failedFinish = await graphQL(finishMutation, { interviewId: ready });
    expect(failedFinish.errors).toHaveLength(1);

    await expectNoEvent(activeSubscriber, 'ACTIVE_QUESTION_CHANGED');
    await expectNoEvent(readySubscriber, 'INTERVIEW_FINISHED');
  });

  test('finish event arrives after the FINISHED database state is committed to both participants', async () => {
    const interviewId = await createInterview();
    const token = await joinCandidate(interviewId);
    const interviewer = authenticateAsInterviewer(interviewId);
    const candidate = authenticateAsCandidate(interviewId, token);
    await Promise.all([
      nextMessage(interviewer, (message) => message.type === 'authenticated'),
      nextMessage(candidate, (message) => message.type === 'authenticated'),
    ]);

    expectSuccess(await graphQL(finishMutation, { interviewId }));
    const [interviewerMessage, candidateMessage] = await Promise.all([
      nextEvent(interviewer, 'INTERVIEW_FINISHED'),
      nextEvent(candidate, 'INTERVIEW_FINISHED'),
    ]);
    expect(interviewerMessage.event.interviewId).toBe(interviewId);
    expect(candidateMessage.event.interviewId).toBe(interviewId);
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } })).toMatchObject({
      status: 'FINISHED',
    });

    const failedFinish = await graphQL(finishMutation, { interviewId });
    expect(failedFinish.errors).toHaveLength(1);
    await expectNoEvent(candidate, 'INTERVIEW_FINISHED');
  });
});
