import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';

import { createGraphQLYoga } from '../dist/graphql/yoga.js';
import { createGuestInvite, joinInterview } from '../dist/services/guest-access.service.js';
import {
  addQuestionToInterview,
  createInterview,
  finishInterview,
  setActiveQuestion,
  startInterview,
} from '../dist/services/interview.service.js';
import { recordCodeRun } from '../dist/services/code-run.service.js';
import { createTestDatabase } from './support/database.mjs';

const resultsQuery = `
  query InterviewResults($id: ID!) {
    interviewResults(id: $id) {
      id title status available startedAt finishedAt durationMs candidateName interviewerName
      totalQuestions totalRuns hasMoreTimelineEvents
      questions {
        interviewQuestionId order snapshotTitle snapshotLanguage snapshotDifficulty runCount
        lastRun { id status sourceSnapshot stdout stderr durationMs createdAt }
      }
      timeline { id type createdAt questionTitle previousQuestionTitle participantName }
    }
  }
`;
const runHistoryQuery = `
  query CodeRuns($interviewId: ID!, $interviewQuestionId: ID!, $limit: Int, $offset: Int) {
    codeRuns(interviewId: $interviewId, interviewQuestionId: $interviewQuestionId, limit: $limit, offset: $offset) {
      items { id createdAt createdByParticipant { id displayName role } }
      pageInfo { limit offset totalCount hasNextPage }
    }
  }
`;

let database;
let prisma;
let yoga;
let owner;
let firstQuestion;
let secondQuestion;
let interviewId;
let firstAttachmentId;
let secondAttachmentId;
let candidate;

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

async function createStartedInterview(title = `Results ${randomUUID()}`) {
  const interview = await createInterview(prisma, owner, { title });
  await addQuestionToInterview(prisma, owner.id, {
    interviewId: interview.id,
    questionId: firstQuestion.id,
    order: 0,
  });
  await startInterview(prisma, owner.id, interview.id);
  return interview.id;
}

async function createFinishedInterview(title = `Results ${randomUUID()}`) {
  const id = await createStartedInterview(title);
  await finishInterview(prisma, owner.id, id);
  return id;
}

async function insertRun(id, questionId, overrides = {}) {
  return prisma.codeRun.create({
    data: {
      id,
      interviewId,
      questionId,
      codeSnapshot: `source:${id}`,
      status: 'SUCCESS',
      stdout: `output:${id}`,
      stderr: '',
      durationMs: 23,
      createdAt: new Date('2026-10-04T14:05:00.000Z'),
      ...overrides,
    },
  });
}

beforeAll(async () => {
  database = await createTestDatabase();
  prisma = database.prisma;
  yoga = createGraphQLYoga({ prisma, demoAuthEnabled: true, nodeEnv: 'test' });
  owner = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@codemeet.local' } });
  const seeded = await prisma.question.findMany({
    where: { createdById: owner.id },
    orderBy: { title: 'asc' },
  });
  firstQuestion = seeded.find(({ language }) => language === 'JAVASCRIPT');
  secondQuestion = seeded.find(({ language }) => language === 'TYPESCRIPT');
  if (!firstQuestion || !secondQuestion)
    throw new Error('Seeded JS and TS questions are required.');

  const interview = await createInterview(prisma, owner, { title: `Finished ${randomUUID()}` });
  interviewId = interview.id;
  await addQuestionToInterview(prisma, owner.id, {
    interviewId,
    questionId: firstQuestion.id,
    order: 1,
  });
  await addQuestionToInterview(prisma, owner.id, {
    interviewId,
    questionId: secondQuestion.id,
    order: 0,
  });
  await startInterview(prisma, owner.id, interviewId);
  const attachments = await prisma.interviewQuestion.findMany({
    where: { interviewId },
    orderBy: { order: 'asc' },
  });
  secondAttachmentId = attachments[0].id;
  firstAttachmentId = attachments[1].id;
  const invite = await createGuestInvite(prisma, owner.id, interviewId);
  candidate = await joinInterview(prisma, {
    inviteToken: invite.token,
    displayName: 'Results Candidate',
  });
  await setActiveQuestion(prisma, owner.id, {
    interviewId,
    questionId: firstQuestion.id,
  });

  await insertRun('results-run-old', firstQuestion.id, {
    codeSnapshot: 'old immutable source',
    status: 'RUNTIME_ERROR',
    createdAt: new Date('2026-10-04T14:01:00.000Z'),
  });
  await insertRun('results-run-latest-a', firstQuestion.id, {
    codeSnapshot: 'tie source a',
    createdAt: new Date('2026-10-04T14:05:00.000Z'),
  });
  await insertRun('results-run-latest-z', firstQuestion.id, {
    codeSnapshot: 'latest source snapshot',
    status: 'TIMEOUT',
    stdout: '',
    stderr: 'Timed out',
    durationMs: 5_000,
    createdAt: new Date('2026-10-04T14:05:00.000Z'),
  });
  await insertRun('results-run-second-question', secondQuestion.id, {
    codeSnapshot: 'second question source',
    status: 'RUNTIME_ERROR',
    createdAt: new Date('2026-10-04T14:03:00.000Z'),
  });
  await prisma.question.update({
    where: { id: firstQuestion.id },
    data: { title: 'Reusable title changed after start' },
  });
  await finishInterview(prisma, owner.id, interviewId);

  const events = await prisma.interviewEvent.findMany({
    where: { interviewId },
    orderBy: { createdAt: 'asc' },
  });
  const eventTimes = [
    '2026-10-04T14:00:00.000Z',
    '2026-10-04T14:02:00.000Z',
    '2026-10-04T14:04:00.000Z',
    '2026-10-04T14:06:00.000Z',
  ];
  for (const [index, event] of events.entries()) {
    await prisma.interviewEvent.update({
      where: { id: event.id },
      data: { createdAt: new Date(eventTimes[index] ?? '2026-10-04T14:07:00.000Z') },
    });
  }
}, 90_000);

afterAll(async () => {
  if (database) await database.cleanup();
});

describe('interview results', () => {
  test('the owner interviewer can read a finished summary with correct counts and ordered snapshots', async () => {
    const results = expectSuccess(
      await execute(resultsQuery, { id: interviewId }),
    ).interviewResults;
    expect(results).toMatchObject({
      id: interviewId,
      status: 'FINISHED',
      available: true,
      candidateName: 'Results Candidate',
      interviewerName: owner.name,
      totalQuestions: 2,
      totalRuns: 4,
      questions: [
        { interviewQuestionId: secondAttachmentId, order: 0, snapshotLanguage: 'TYPESCRIPT' },
        { interviewQuestionId: firstAttachmentId, order: 1, snapshotLanguage: 'JAVASCRIPT' },
      ],
    });
    const persisted = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
    expect(results.startedAt).toBe(persisted.startedAt.toISOString());
    expect(results.finishedAt).toBe(persisted.finishedAt.toISOString());
    expect(results.durationMs).toBe(persisted.finishedAt.getTime() - persisted.startedAt.getTime());
  });

  test('selects the deterministic latest run per question and preserves snapshots over reusable edits', async () => {
    const results = expectSuccess(
      await execute(resultsQuery, { id: interviewId }),
    ).interviewResults;
    expect(results.questions[0]).toMatchObject({
      snapshotTitle: secondQuestion.title,
      runCount: 1,
      lastRun: { id: 'results-run-second-question', status: 'RUNTIME_ERROR' },
    });
    expect(results.questions[1]).toMatchObject({
      snapshotTitle: firstQuestion.title,
      runCount: 3,
      lastRun: {
        id: 'results-run-latest-z',
        status: 'TIMEOUT',
        sourceSnapshot: 'latest source snapshot',
        stderr: 'Timed out',
        durationMs: 5_000,
      },
    });
    expect(results.questions[1].lastRun.createdAt).toBe('2026-10-04T14:05:00.000Z');
    expect(results.questions[1].snapshotTitle).not.toBe('Reusable title changed after start');
  });

  test('orders only persisted key events chronologically and resolves question titles from snapshots', async () => {
    const results = expectSuccess(
      await execute(resultsQuery, { id: interviewId }),
    ).interviewResults;
    expect(results.timeline.map(({ type }) => type)).toEqual([
      'INTERVIEW_STARTED',
      'CANDIDATE_JOINED',
      'QUESTION_CHANGED',
      'INTERVIEW_FINISHED',
    ]);
    expect(results.timeline[0].questionTitle).toBe(secondQuestion.title);
    expect(results.timeline[1].participantName).toBe('Results Candidate');
    expect(results.timeline[2]).toMatchObject({
      questionTitle: firstQuestion.title,
      previousQuestionTitle: secondQuestion.title,
    });
    expect(results.timeline.map(({ createdAt }) => createdAt)).toEqual([
      '2026-10-04T14:02:00.000Z',
      '2026-10-04T14:04:00.000Z',
      '2026-10-04T14:06:00.000Z',
      '2026-10-04T14:07:00.000Z',
    ]);
  });

  test('returns an unavailable state for an in-progress interview without exposing code runs', async () => {
    const id = await createStartedInterview();
    const attachment = await prisma.interviewQuestion.findFirstOrThrow({
      where: { interviewId: id },
    });
    await prisma.codeRun.create({
      data: {
        id: `private-${randomUUID()}`,
        interviewId: id,
        questionId: attachment.questionId,
        codeSnapshot: 'must not be returned before finish',
        status: 'SUCCESS',
      },
    });
    const results = expectSuccess(await execute(resultsQuery, { id })).interviewResults;
    expect(results).toMatchObject({
      status: 'IN_PROGRESS',
      available: false,
      questions: [],
      totalRuns: 0,
    });
    expect(JSON.stringify(results)).not.toContain('must not be returned before finish');
  });

  test('handles a finished interview without runs, candidate name, or usable timestamps', async () => {
    const id = await createFinishedInterview();
    await prisma.interview.update({ where: { id }, data: { startedAt: null, finishedAt: null } });
    await prisma.interviewEvent.deleteMany({ where: { interviewId: id } });
    const results = expectSuccess(await execute(resultsQuery, { id })).interviewResults;
    expect(results).toMatchObject({
      status: 'FINISHED',
      available: true,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      candidateName: null,
      totalRuns: 0,
    });
    expect(results.questions[0]).toMatchObject({ runCount: 0, lastRun: null });
    expect(results.timeline).toEqual([]);
  });

  test('rejects an unauthenticated request and does not include source snapshots', async () => {
    const anonymousYoga = createGraphQLYoga({ prisma, demoAuthEnabled: false, nodeEnv: 'test' });
    const response = await execute(resultsQuery, { id: interviewId }, undefined, anonymousYoga);
    expectError(response, 'UNAUTHENTICATED');
    expect(JSON.stringify(response)).not.toContain('latest source snapshot');
  });

  test('rejects a candidate and does not include interviewer-only source or aggregate data', async () => {
    const response = await execute(
      resultsQuery,
      { id: interviewId },
      candidate.participantSessionToken,
    );
    expectError(response, 'FORBIDDEN');
    expect(JSON.stringify(response)).not.toContain('latest source snapshot');
    expect(JSON.stringify(response)).not.toContain('totalRuns');
  });

  test('returns not found for an interview owned by another interviewer', async () => {
    const other = await prisma.user.create({
      data: { name: 'Another interviewer', email: `another-${randomUUID()}@codemeet.local` },
    });
    const otherInterview = await createInterview(prisma, other, {
      title: `Private ${randomUUID()}`,
    });
    expectError(await execute(resultsQuery, { id: otherInterview.id }), 'NOT_FOUND');
  });

  test('continues to enforce existing bounded pagination on full run history', async () => {
    expectError(
      await execute(runHistoryQuery, {
        interviewId,
        interviewQuestionId: firstAttachmentId,
        limit: 51,
        offset: 0,
      }),
      'BAD_USER_INPUT',
    );
    const page = expectSuccess(
      await execute(runHistoryQuery, {
        interviewId,
        interviewQuestionId: firstAttachmentId,
        limit: 2,
        offset: 0,
      }),
    ).codeRuns;
    expect(page.pageInfo).toMatchObject({ limit: 2, offset: 0, totalCount: 3, hasNextPage: true });
  });

  test('returns each code run timestamp and its persisted participant identity', async () => {
    const id = await createStartedInterview();
    const attachment = await prisma.interviewQuestion.findFirstOrThrow({
      where: { interviewId: id },
    });
    const invite = await createGuestInvite(prisma, owner.id, id);
    const joinedCandidate = await joinInterview(prisma, {
      inviteToken: invite.token,
      displayName: `Actor Candidate ${randomUUID()}`,
    });
    const common = {
      interviewQuestionId: attachment.id,
      language: 'JAVASCRIPT',
      sourceSnapshot: 'console.log("actor")',
      status: 'SUCCESS',
      stdout: 'actor',
      stderr: '',
      durationMs: 5,
    };
    const interviewerRunId = `actor-interviewer-${randomUUID()}`;
    const candidateRunId = `actor-candidate-${randomUUID()}`;
    await recordCodeRun(prisma, { kind: 'interviewer', user: owner }, id, {
      ...common,
      runId: interviewerRunId,
    });
    await recordCodeRun(
      prisma,
      { kind: 'candidate', participant: joinedCandidate.participant },
      id,
      { ...common, runId: candidateRunId },
    );

    const page = expectSuccess(
      await execute(runHistoryQuery, {
        interviewId: id,
        interviewQuestionId: attachment.id,
        limit: 20,
        offset: 0,
      }),
    ).codeRuns;
    expect(page.items).toHaveLength(2);
    expect(page.items.map(({ createdByParticipant }) => createdByParticipant)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Demo Interviewer', role: 'INTERVIEWER' }),
        expect.objectContaining({
          displayName: joinedCandidate.participant.displayName,
          role: 'CANDIDATE',
        }),
      ]),
    );
    const persistedRuns = await prisma.codeRun.findMany({
      where: { id: { in: [interviewerRunId, candidateRunId] } },
      select: { id: true, createdAt: true },
    });
    expect(
      Object.fromEntries(page.items.map(({ id: runId, createdAt }) => [runId, createdAt])),
    ).toEqual(
      Object.fromEntries(
        persistedRuns.map(({ id: runId, createdAt }) => [runId, createdAt.toISOString()]),
      ),
    );
  });

  test('bounds the timeline to the most recent 100 persisted key events', async () => {
    const id = await createFinishedInterview();
    await prisma.interviewEvent.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        interviewId: id,
        type: 'QUESTION_CHANGED',
        payload: { questionId: firstQuestion.id },
        createdAt: new Date(Date.UTC(2026, 9, 4, 15, 0, index)),
      })),
    });
    const results = expectSuccess(await execute(resultsQuery, { id })).interviewResults;
    expect(results.timeline).toHaveLength(100);
    expect(results.hasMoreTimelineEvents).toBe(true);
    expect(results.timeline[0].type).toBe('QUESTION_CHANGED');
  });
});
