import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';

import { createGraphQLYoga } from '../dist/graphql/yoga.js';
import { createGuestInvite, joinInterview } from '../dist/services/guest-access.service.js';
import {
  addQuestionToInterview,
  createInterview,
  finishInterview,
  startInterview,
} from '../dist/services/interview.service.js';
import { createTestDatabase } from './support/database.mjs';

const recordMutation = `
  mutation RecordCodeRun($interviewId: ID!, $input: RecordCodeRunInput!) {
    recordCodeRun(interviewId: $interviewId, input: $input) {
      id interviewId interviewQuestionId language sourceSnapshot status stdout stderr
      durationMs createdAt createdByParticipant { id displayName role }
    }
  }
`;
const historyQuery = `
  query CodeRuns($interviewId: ID!, $interviewQuestionId: ID!, $limit: Int, $offset: Int) {
    codeRuns(interviewId: $interviewId, interviewQuestionId: $interviewQuestionId, limit: $limit, offset: $offset) {
      items { id interviewId interviewQuestionId language sourceSnapshot status stdout stderr durationMs createdByParticipant { id displayName role } }
      pageInfo { limit offset totalCount hasNextPage }
    }
  }
`;

let database;
let prisma;
let yoga;
let owner;
let jsQuestion;
let tsQuestion;
let interviewId;
let jsAttachmentId;
let tsAttachmentId;
let candidateA;

async function execute(query, variables = {}, token, instance = yoga) {
  const response = await instance.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

function expectSuccess(result) {
  expect(result.errors).toBeUndefined();
  return result.data;
}

function expectError(result, code) {
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].extensions.code).toBe(code);
  expect(JSON.stringify(result.errors)).not.toMatch(/PrismaClient|SELECT |INSERT INTO/);
}

function runInput(interviewQuestionId, overrides = {}) {
  return {
    runId: `run-${randomUUID()}`,
    interviewQuestionId,
    language: 'JAVASCRIPT',
    sourceSnapshot: 'console.log("saved snapshot")',
    status: 'SUCCESS',
    stdout: 'saved snapshot',
    stderr: '',
    durationMs: 12,
    ...overrides,
  };
}

async function joinCandidate(targetInterviewId, displayName) {
  const invite = await createGuestInvite(prisma, owner.id, targetInterviewId);
  return joinInterview(prisma, { inviteToken: invite.token, displayName });
}

async function startInterviewWithQuestion(questionId, title) {
  const interview = await createInterview(prisma, owner, { title });
  await addQuestionToInterview(prisma, owner.id, {
    interviewId: interview.id,
    questionId,
  });
  await startInterview(prisma, owner.id, interview.id);
  return prisma.interviewQuestion.findFirstOrThrow({ where: { interviewId: interview.id } });
}

beforeAll(async () => {
  database = await createTestDatabase();
  prisma = database.prisma;
  yoga = createGraphQLYoga({ prisma, demoAuthEnabled: true, nodeEnv: 'test' });
  owner = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@codemeet.local' } });
  const questions = await prisma.question.findMany({
    where: { createdById: owner.id },
    orderBy: { title: 'asc' },
  });
  jsQuestion = questions.find(({ language }) => language === 'JAVASCRIPT');
  tsQuestion = questions.find(({ language }) => language === 'TYPESCRIPT');
  if (!jsQuestion || !tsQuestion) throw new Error('The seeded JS and TS questions are required.');

  const interview = await createInterview(prisma, owner, { title: `Code run ${randomUUID()}` });
  interviewId = interview.id;
  await addQuestionToInterview(prisma, owner.id, {
    interviewId,
    questionId: jsQuestion.id,
    order: 0,
  });
  await addQuestionToInterview(prisma, owner.id, {
    interviewId,
    questionId: tsQuestion.id,
    order: 1,
  });
  await startInterview(prisma, owner.id, interviewId);
  const attachments = await prisma.interviewQuestion.findMany({
    where: { interviewId },
    orderBy: { order: 'asc' },
  });
  jsAttachmentId = attachments[0].id;
  tsAttachmentId = attachments[1].id;
  candidateA = await joinCandidate(interviewId, 'Candidate A');
}, 90_000);

afterAll(async () => {
  if (database) await database.cleanup();
});

describe('persisted browser code run history', () => {
  test('stores exact browser snapshot and completed result without executing code on the API', async () => {
    const input = runInput(jsAttachmentId, {
      sourceSnapshot: 'const answer = 42;\nconsole.log(answer);',
      stdout: '42',
    });
    const result = expectSuccess(await execute(recordMutation, { interviewId, input }));
    expect(result.recordCodeRun).toMatchObject({
      id: input.runId,
      interviewId,
      interviewQuestionId: jsAttachmentId,
      language: 'JAVASCRIPT',
      sourceSnapshot: input.sourceSnapshot,
      status: 'SUCCESS',
      stdout: '42',
      stderr: '',
      durationMs: 12,
      createdByParticipant: { role: 'INTERVIEWER' },
    });
    expect(await prisma.codeRun.findUniqueOrThrow({ where: { id: input.runId } })).toMatchObject({
      codeSnapshot: input.sourceSnapshot,
      questionId: jsQuestion.id,
      stdout: '42',
      status: 'SUCCESS',
    });
  });

  test('returns the existing run on identical retries and rejects an id reused with different data', async () => {
    const input = runInput(tsAttachmentId, {
      language: 'TYPESCRIPT',
      status: 'RUNTIME_ERROR',
      sourceSnapshot: 'const value: number = 3; throw new Error("boom");',
      stderr: 'Error: boom',
    });
    const first = expectSuccess(await execute(recordMutation, { interviewId, input }));
    const countAfterFirst = await prisma.codeRun.count({ where: { id: input.runId } });
    const replay = expectSuccess(await execute(recordMutation, { interviewId, input }));
    expect(replay.recordCodeRun.id).toBe(first.recordCodeRun.id);
    expect(await prisma.codeRun.count({ where: { id: input.runId } })).toBe(countAfterFirst);

    expectError(
      await execute(recordMutation, {
        interviewId,
        input: { ...input, sourceSnapshot: 'different source' },
      }),
      'CONFLICT',
    );
  });

  test('persists TIMEOUT as an execution status rather than a judge verdict', async () => {
    const input = runInput(jsAttachmentId, {
      status: 'TIMEOUT',
      sourceSnapshot: 'while (true) {}',
      stderr: 'Execution timed out after 5 seconds.',
      durationMs: 5_000,
    });
    const saved = expectSuccess(
      await execute(recordMutation, { interviewId, input }),
    ).recordCodeRun;
    expect(saved).toMatchObject({ status: 'TIMEOUT', sourceSnapshot: 'while (true) {}' });
  });

  test.each([
    ['source limit', (id) => ({ sourceSnapshot: 'x'.repeat(100_001), ...id })],
    ['output limit', (id) => ({ stdout: 'x'.repeat(20_001), ...id })],
    ['duration limit', (id) => ({ durationMs: 15_001, ...id })],
    ['unsupported language', (id) => ({ language: 'REACT_TSX', ...id })],
  ])('rejects a run that violates %s before writing', async (_label, overrides) => {
    const input = { ...runInput(jsAttachmentId), ...overrides({}) };
    const before = await prisma.codeRun.count();
    expectError(await execute(recordMutation, { interviewId, input }), 'BAD_USER_INPUT');
    expect(await prisma.codeRun.count()).toBe(before);
  });

  test('accepts only real completed statuses and does not accept a client participant identity', async () => {
    const before = await prisma.codeRun.count();
    const invalidStatus = await execute(recordMutation, {
      interviewId,
      input: { ...runInput(jsAttachmentId), status: 'FAILED' },
    });
    expect(invalidStatus.errors).toHaveLength(1);
    const clientActor = await execute(recordMutation, {
      interviewId,
      input: { ...runInput(jsAttachmentId), participantId: candidateA.participant.id },
    });
    expect(clientActor.errors).toHaveLength(1);
    expect(JSON.stringify(clientActor.errors)).not.toMatch(/PrismaClient|SELECT |INSERT INTO/);
    expect(await prisma.codeRun.count()).toBe(before);
  });

  test('scopes a run to an attachment in the same interview and enforces language', async () => {
    const otherAttachment = await startInterviewWithQuestion(
      jsQuestion.id,
      `Other interview ${randomUUID()}`,
    );
    expectError(
      await execute(recordMutation, {
        interviewId,
        input: runInput(otherAttachment.id),
      }),
      'BAD_USER_INPUT',
    );
    expectError(
      await execute(
        historyQuery,
        { interviewId: otherAttachment.interviewId, interviewQuestionId: otherAttachment.id },
        candidateA.participantSessionToken,
      ),
      'NOT_FOUND',
    );
    expectError(
      await execute(
        recordMutation,
        { interviewId: otherAttachment.interviewId, input: runInput(otherAttachment.id) },
        candidateA.participantSessionToken,
      ),
      'NOT_FOUND',
    );
    expectError(
      await execute(recordMutation, {
        interviewId,
        input: runInput(tsAttachmentId),
      }),
      'BAD_USER_INPUT',
    );
  });

  test('candidates can record and read only their own runs while the interviewer sees the interview history', async () => {
    const interviewerInput = runInput(jsAttachmentId, { sourceSnapshot: 'interviewer run' });
    const candidateInput = runInput(jsAttachmentId, { sourceSnapshot: 'candidate run' });
    const otherUser = await prisma.user.create({
      data: { name: 'Other interviewer', email: `other-${randomUUID()}@codemeet.local` },
    });
    const otherParticipant = await prisma.interviewParticipant.create({
      data: {
        interviewId,
        userId: otherUser.id,
        displayName: otherUser.name,
        role: 'INTERVIEWER',
      },
    });
    const otherActorRun = runInput(jsAttachmentId, { sourceSnapshot: 'other participant run' });
    await prisma.codeRun.create({
      data: {
        id: otherActorRun.runId,
        interviewId,
        questionId: jsQuestion.id,
        codeSnapshot: otherActorRun.sourceSnapshot,
        status: 'SUCCESS',
        stdout: '',
        stderr: '',
        durationMs: 1,
        createdByParticipantId: otherParticipant.id,
      },
    });
    expectSuccess(await execute(recordMutation, { interviewId, input: interviewerInput }));
    expectSuccess(
      await execute(
        recordMutation,
        { interviewId, input: candidateInput },
        candidateA.participantSessionToken,
      ),
    );

    const variables = { interviewId, interviewQuestionId: jsAttachmentId, limit: 20, offset: 0 };
    const historyA = expectSuccess(
      await execute(historyQuery, variables, candidateA.participantSessionToken),
    ).codeRuns;
    const interviewerHistory = expectSuccess(await execute(historyQuery, variables)).codeRuns;
    expect(historyA.items.map(({ id }) => id)).toEqual([candidateInput.runId]);
    expect(interviewerHistory.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([interviewerInput.runId, candidateInput.runId, otherActorRun.runId]),
    );
  });

  test('applies default and maximum history pagination', async () => {
    const defaultPage = expectSuccess(
      await execute(historyQuery, { interviewId, interviewQuestionId: jsAttachmentId }),
    ).codeRuns;
    expect(defaultPage.pageInfo).toMatchObject({ limit: 20, offset: 0 });
    expectError(
      await execute(historyQuery, {
        interviewId,
        interviewQuestionId: jsAttachmentId,
        limit: 51,
      }),
      'BAD_USER_INPUT',
    );
  });

  test('orders newest first deterministically and pages without repeating rows', async () => {
    const ownerParticipant = await prisma.interviewParticipant.findFirstOrThrow({
      where: { interviewId, role: 'INTERVIEWER' },
    });
    const createdAt = new Date('2099-01-01T00:00:00.000Z');
    await prisma.codeRun.createMany({
      data: [
        {
          id: 'phase10-order-a',
          interviewId,
          questionId: jsQuestion.id,
          codeSnapshot: 'older tie',
          status: 'SUCCESS',
          stdout: '',
          stderr: '',
          durationMs: 1,
          createdByParticipantId: ownerParticipant.id,
          createdAt,
        },
        {
          id: 'phase10-order-z',
          interviewId,
          questionId: jsQuestion.id,
          codeSnapshot: 'latest',
          status: 'SUCCESS',
          stdout: '',
          stderr: '',
          durationMs: 1,
          createdByParticipantId: ownerParticipant.id,
          createdAt: new Date('2099-01-02T00:00:00.000Z'),
        },
        {
          id: 'phase10-order-b',
          interviewId,
          questionId: jsQuestion.id,
          codeSnapshot: 'newer tie',
          status: 'SUCCESS',
          stdout: '',
          stderr: '',
          durationMs: 1,
          createdByParticipantId: ownerParticipant.id,
          createdAt,
        },
      ],
    });
    const firstPage = expectSuccess(
      await execute(historyQuery, {
        interviewId,
        interviewQuestionId: jsAttachmentId,
        limit: 2,
      }),
    ).codeRuns;
    const secondPage = expectSuccess(
      await execute(historyQuery, {
        interviewId,
        interviewQuestionId: jsAttachmentId,
        limit: 2,
        offset: 2,
      }),
    ).codeRuns;
    expect(firstPage.items.map(({ id }) => id)).toEqual(['phase10-order-z', 'phase10-order-b']);
    expect(secondPage.items[0].id).toBe('phase10-order-a');
    const firstPageIds = firstPage.items.map(({ id }) => id);
    const secondPageIds = secondPage.items.map(({ id }) => id);
    expect(firstPageIds.filter((id) => secondPageIds.includes(id))).toEqual([]);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);
  });

  test('rejects writes outside IN_PROGRESS, invalid sessions, and anonymous history reads', async () => {
    const readyInterview = await createInterview(prisma, owner, {
      title: `Ready ${randomUUID()}`,
    });
    await addQuestionToInterview(prisma, owner.id, {
      interviewId: readyInterview.id,
      questionId: jsQuestion.id,
    });
    const readyAttachment = await prisma.interviewQuestion.findFirstOrThrow({
      where: { interviewId: readyInterview.id },
    });
    expectError(
      await execute(recordMutation, {
        interviewId: readyInterview.id,
        input: runInput(readyAttachment.id),
      }),
      'INVALID_STATE',
    );
    const inProgressAttachment = await startInterviewWithQuestion(
      jsQuestion.id,
      `Finished ${randomUUID()}`,
    );
    await finishInterview(prisma, owner.id, inProgressAttachment.interviewId);
    expectError(
      await execute(recordMutation, {
        interviewId: inProgressAttachment.interviewId,
        input: runInput(inProgressAttachment.id),
      }),
      'INVALID_STATE',
    );

    expectError(
      await execute(
        historyQuery,
        { interviewId, interviewQuestionId: jsAttachmentId },
        'invalid-session-token',
      ),
      'UNAUTHENTICATED',
    );

    const anonymousYoga = createGraphQLYoga({ prisma, demoAuthEnabled: false, nodeEnv: 'test' });
    expectError(
      await execute(
        historyQuery,
        { interviewId, interviewQuestionId: jsAttachmentId },
        undefined,
        anonymousYoga,
      ),
      'UNAUTHENTICATED',
    );
  });
});
