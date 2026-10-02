import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createPrismaClient, seedDatabase } from '@codemeet/db';
import { createGraphQLYoga } from '../dist/graphql/yoga.js';
import { createApiServer } from '../dist/server.js';
import { createTestDatabase, withSchema } from './support/database.mjs';

const questionFields = `
  id title description difficulty language starterCode createdAt updatedAt
  createdBy { id name email }
`;
const snapshotFields = `
  snapshotTitle snapshotDescription snapshotDifficulty snapshotLanguage
  snapshotStarterCode snapshotCapturedAt
`;
const interviewFields = `
  id title status startedAt finishedAt createdAt updatedAt
  createdBy { id name email }
  activeQuestion { id title }
  questions { id order ${snapshotFields} question { ${questionFields} } }
  participants { id displayName role user { id email } }
`;
const createQuestionMutation = `
  mutation CreateQuestion($input: CreateQuestionInput!) {
    createQuestion(input: $input) { ${questionFields} }
  }
`;
const createInterviewMutation = `
  mutation CreateInterview($input: CreateInterviewInput!) {
    createInterview(input: $input) { ${interviewFields} }
  }
`;
const addQuestionMutation = `
  mutation Attach($interviewId: ID!, $questionId: ID!, $order: Int) {
    addQuestionToInterview(interviewId: $interviewId, questionId: $questionId, order: $order) {
      ${interviewFields}
    }
  }
`;
const activeQuestionMutation = `
  mutation Active($interviewId: ID!, $questionId: ID!) {
    setActiveQuestion(interviewId: $interviewId, questionId: $questionId) { ${interviewFields} }
  }
`;
const startMutation = `
  mutation Start($interviewId: ID!) {
    startInterview(interviewId: $interviewId) { ${interviewFields} }
  }
`;
const finishMutation = `
  mutation Finish($interviewId: ID!) {
    finishInterview(interviewId: $interviewId) { ${interviewFields} }
  }
`;

let database;
let prisma;
let yoga;
let demoUser;
let seedQuestions;

async function execute(query, variables = {}, instance = yoga) {
  const response = await instance.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

function expectSuccess(result) {
  expect(result.errors).toBeUndefined();
  expect(result.data).toBeDefined();
  return result.data;
}

function expectError(result, code) {
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].extensions.code).toBe(code);
  expect(result.errors[0].extensions).not.toHaveProperty('stacktrace');
  expect(result.errors[0].message).not.toMatch(/PrismaClient|prisma\.|SELECT |INSERT INTO/);
}

function questionInput(overrides = {}) {
  return {
    title: `Question ${randomUUID()}`,
    description: 'Implement the function and describe its complexity.',
    difficulty: 'EASY',
    language: 'JAVASCRIPT',
    starterCode: 'function solve(input) {\n  return input;\n}',
    ...overrides,
  };
}

async function createQuestion(overrides = {}) {
  return expectSuccess(await execute(createQuestionMutation, { input: questionInput(overrides) }))
    .createQuestion;
}

async function createInterview(title = `Interview ${randomUUID()}`) {
  return expectSuccess(await execute(createInterviewMutation, { input: { title } }))
    .createInterview;
}

async function attachSeedQuestion(interviewId) {
  return expectSuccess(
    await execute(addQuestionMutation, { interviewId, questionId: seedQuestions[0].id }),
  ).addQuestionToInterview;
}

beforeAll(async () => {
  database = await createTestDatabase();
  prisma = database.prisma;
  yoga = createGraphQLYoga({ prisma, demoAuthEnabled: true, nodeEnv: 'test' });
  demoUser = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@codemeet.local' } });
  seedQuestions = await prisma.question.findMany({
    where: { createdById: demoUser.id },
    orderBy: { title: 'asc' },
  });
}, 90_000);

afterAll(async () => {
  if (database) await database.cleanup();
});

describe('GraphQL API with PostgreSQL and deployed Prisma migrations', () => {
  test('health query works without demo authentication', async () => {
    const unauthenticatedYoga = createGraphQLYoga({
      prisma,
      demoAuthEnabled: false,
      nodeEnv: 'test',
    });
    expect(expectSuccess(await execute('{ health }', {}, unauthenticatedYoga))).toEqual({
      health: 'ok',
    });
    expectError(
      await execute('{ questions { items { id } } }', {}, unauthenticatedYoga),
      'UNAUTHENTICATED',
    );
  });

  test('production startup refuses temporary demo authentication', () => {
    expect(() =>
      createGraphQLYoga({ prisma, demoAuthEnabled: true, nodeEnv: 'production' }),
    ).toThrow('TEMP DEMO AUTH must not be enabled in production.');
  });

  test('questions returns all three seed questions and their creator', async () => {
    const data = expectSuccess(
      await execute(
        `{ questions(limit: 100) { items { ${questionFields} } pageInfo { totalCount } } }`,
      ),
    );
    expect(data.questions.items).toHaveLength(3);
    expect(data.questions.items.map((question) => question.title).sort()).toEqual([
      'Group By',
      'React Counter',
      'Two Sum',
    ]);
    expect(data.questions.pageInfo.totalCount).toBe(3);
    expect(data.questions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Two Sum', language: 'JAVASCRIPT', difficulty: 'EASY' }),
        expect.objectContaining({
          title: 'Group By',
          language: 'TYPESCRIPT',
          difficulty: 'MEDIUM',
        }),
        expect.objectContaining({
          title: 'React Counter',
          language: 'REACT_TSX',
          difficulty: 'EASY',
        }),
      ]),
    );
    for (const question of data.questions.items) {
      expect(question.createdBy.email).toBe('demo@codemeet.local');
    }
  });

  test('seed is idempotent for users, questions, interviews and attached questions', async () => {
    const countsBefore = await Promise.all([
      prisma.user.count(),
      prisma.question.count(),
      prisma.interview.count(),
      prisma.interviewQuestion.count(),
    ]);
    await seedDatabase(prisma);
    const countsAfter = await Promise.all([
      prisma.user.count(),
      prisma.question.count(),
      prisma.interview.count(),
      prisma.interviewQuestion.count(),
    ]);
    expect(countsAfter).toEqual(countsBefore);
    expect(countsAfter).toEqual([1, 3, 1, 2]);
  });

  test('createQuestion persists inputs, trimmed title and the centralized demo owner', async () => {
    const input = questionInput({ title: '  Created through GraphQL  ' });
    const question = expectSuccess(await execute(createQuestionMutation, { input })).createQuestion;
    expect(question.title).toBe('Created through GraphQL');
    expect(question.description).toBe(input.description);
    expect(question.starterCode).toBe(input.starterCode);
    expect(question.createdBy.id).toBe(demoUser.id);
    expect(await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).toMatchObject({
      title: 'Created through GraphQL',
      createdById: demoUser.id,
      language: 'JAVASCRIPT',
    });
  });

  test('updateQuestion applies a partial update and keeps omitted fields', async () => {
    const question = await createQuestion();
    const result = await execute(
      `mutation Update($id: ID!, $input: UpdateQuestionInput!) {
        updateQuestion(id: $id, input: $input) { ${questionFields} }
      }`,
      { id: question.id, input: { title: '  Updated title  ', difficulty: 'HARD' } },
    );
    expect(expectSuccess(result).updateQuestion).toMatchObject({
      id: question.id,
      title: 'Updated title',
      difficulty: 'HARD',
      language: question.language,
      starterCode: question.starterCode,
      description: question.description,
    });
  });

  test.each([
    ['blank title', { title: '   ' }],
    ['blank description', { description: ' \n ' }],
    ['oversized starter code', { starterCode: 'x'.repeat(100_001) }],
  ])('rejects createQuestion with %s without writing a row', async (_label, overrides) => {
    const before = await prisma.question.count();
    const result = await execute(createQuestionMutation, { input: questionInput(overrides) });
    expectError(result, 'BAD_USER_INPUT');
    expect(await prisma.question.count()).toBe(before);
  });

  test.each([
    {},
    { title: '   ' },
    { description: '' },
    { starterCode: 'x'.repeat(100_001) },
    { starterCode: null },
  ])('rejects invalid partial updates %# without changing the question', async (input) => {
    const question = await createQuestion();
    const before = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    const result = await execute(
      `mutation Update($id: ID!, $input: UpdateQuestionInput!) {
          updateQuestion(id: $id, input: $input) { id }
        }`,
      { id: question.id, input },
    );
    expectError(result, 'BAD_USER_INPUT');
    expect(await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).toEqual(before);
  });

  test.each(['', ' \n '])(
    'preserves empty or whitespace starterCode exactly %#',
    async (starterCode) => {
      const created = await createQuestion({ starterCode });
      expect(created.starterCode).toBe(starterCode);
      expect(await prisma.question.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
        starterCode,
      });
      const anotherQuestion = await createQuestion();
      const updated = expectSuccess(
        await execute(
          `mutation Update($id: ID!, $input: UpdateQuestionInput!) {
          updateQuestion(id: $id, input: $input) { id starterCode }
        }`,
          { id: anotherQuestion.id, input: { starterCode } },
        ),
      ).updateQuestion;
      expect(updated.starterCode).toBe(starterCode);
      expect(
        await prisma.question.findUniqueOrThrow({ where: { id: anotherQuestion.id } }),
      ).toMatchObject({
        starterCode,
      });
    },
  );

  test('filters and offset pagination return filtered totals and correct pageInfo', async () => {
    const marker = `Search ${randomUUID()}`;
    const created = [];
    for (let index = 0; index < 3; index += 1) {
      created.push(
        await createQuestion({
          title: `${marker} ${index}`,
          language: 'TYPESCRIPT',
          difficulty: 'HARD',
        }),
      );
    }
    await createQuestion({ title: `${marker} excluded`, language: 'JAVASCRIPT' });
    const query = `query Filter($search: String!, $offset: Int!) {
      questions(search: $search, language: TYPESCRIPT, difficulty: HARD, limit: 2, offset: $offset) {
        items { id language difficulty }
        pageInfo { limit offset totalCount hasNextPage }
      }
    }`;
    const first = expectSuccess(
      await execute(query, { search: marker.toLowerCase(), offset: 0 }),
    ).questions;
    const second = expectSuccess(
      await execute(query, { search: marker.toLowerCase(), offset: 2 }),
    ).questions;
    expect(first.pageInfo).toEqual({ limit: 2, offset: 0, totalCount: 3, hasNextPage: true });
    expect(second.pageInfo).toEqual({ limit: 2, offset: 2, totalCount: 3, hasNextPage: false });
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map(({ id }) => id).sort()).toEqual(
      created.map(({ id }) => id).sort(),
    );
    expect(
      first.items.every(
        ({ language, difficulty }) => language === 'TYPESCRIPT' && difficulty === 'HARD',
      ),
    ).toBe(true);
  });

  test.each([
    ['questions', 'limit: 101'],
    ['questions', 'limit: 0'],
    ['questions', 'limit: -1'],
    ['questions', 'offset: -1'],
    ['interviews', 'limit: 101'],
    ['interviews', 'offset: -1'],
  ])('validates %s pagination (%s)', async (field, args) => {
    expectError(await execute(`{ ${field}(${args}) { items { id } } }`), 'BAD_USER_INPUT');
  });

  test('single-item queries return data and null for missing ids', async () => {
    const question = seedQuestions[0];
    const found = expectSuccess(
      await execute(`query One($id: ID!) { question(id: $id) { id title } }`, { id: question.id }),
    ).question;
    expect(found).toEqual({ id: question.id, title: question.title });
    for (const field of ['question', 'interview']) {
      const result = expectSuccess(
        await execute(`query Missing($id: ID!) { ${field}(id: $id) { id } }`, { id: randomUUID() }),
      );
      expect(result[field]).toBeNull();
    }
  });

  test('createInterview creates DRAFT and exactly one INTERVIEW_CREATED event together', async () => {
    const interview = await createInterview('  API interview  ');
    expect(interview).toMatchObject({
      title: 'API interview',
      status: 'DRAFT',
      startedAt: null,
      finishedAt: null,
      createdBy: { id: demoUser.id },
    });
    const persisted = await prisma.interview.findUniqueOrThrow({
      where: { id: interview.id },
      include: { events: true },
    });
    expect(persisted.status).toBe('DRAFT');
    expect(persisted.events).toHaveLength(1);
    expect(persisted.events[0].type).toBe('INTERVIEW_CREATED');
  });

  test('blank interview title returns BAD_USER_INPUT without creating interview or event', async () => {
    const before = await Promise.all([prisma.interview.count(), prisma.interviewEvent.count()]);
    expectError(
      await execute(createInterviewMutation, { input: { title: ' \n ' } }),
      'BAD_USER_INPUT',
    );
    expect(await Promise.all([prisma.interview.count(), prisma.interviewEvent.count()])).toEqual(
      before,
    );
  });

  test('first attached question makes READY attainable and preserves ordered relations', async () => {
    const interview = await createInterview();
    const first = expectSuccess(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[0].id,
      }),
    ).addQuestionToInterview;
    expect(first.status).toBe('READY');
    const second = expectSuccess(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[1].id,
      }),
    ).addQuestionToInterview;
    expect(second.questions.map(({ order, question }) => [order, question.id])).toEqual([
      [0, seedQuestions[0].id],
      [1, seedQuestions[1].id],
    ]);
    expect(second.questions[0].question.createdBy.email).toBe('demo@codemeet.local');
  });

  test('cannot attach the same question twice or use an occupied order', async () => {
    const interview = await createInterview();
    const variables = { interviewId: interview.id, questionId: seedQuestions[0].id, order: 0 };
    expectSuccess(await execute(addQuestionMutation, variables));
    expectError(await execute(addQuestionMutation, variables), 'CONFLICT');
    expectError(
      await execute(addQuestionMutation, { ...variables, questionId: seedQuestions[1].id }),
      'CONFLICT',
    );
    expect(await prisma.interviewQuestion.count({ where: { interviewId: interview.id } })).toBe(1);
  });

  test('concurrent duplicate attachment has one success and one controlled conflict', async () => {
    const interview = await createInterview();
    const variables = { interviewId: interview.id, questionId: seedQuestions[0].id };
    const results = await Promise.all([
      execute(addQuestionMutation, variables),
      execute(addQuestionMutation, variables),
    ]);
    expect(results.filter(({ errors }) => !errors)).toHaveLength(1);
    expectError(
      results.find(({ errors }) => errors),
      'CONFLICT',
    );
    expect(await prisma.interviewQuestion.count({ where: { interviewId: interview.id } })).toBe(1);
  });

  test('failed attachment leaves state and relations unchanged', async () => {
    const interview = await createInterview();
    expectError(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: randomUUID(),
      }),
      'NOT_FOUND',
    );
    expectError(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[0].id,
        order: -1,
      }),
      'BAD_USER_INPUT',
    );
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toMatchObject(
      {
        status: 'DRAFT',
        activeQuestionId: null,
      },
    );
    expect(await prisma.interviewQuestion.count({ where: { interviewId: interview.id } })).toBe(0);
  });

  test('active question must belong to the interview and changing it records an event', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    expectSuccess(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[1].id,
      }),
    );
    // Switching now belongs to the running session. Keep the original membership
    // and event assertions, using a third unattached question and the second task.
    expectSuccess(await execute(startMutation, { interviewId: interview.id }));
    expectError(
      await execute(activeQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[2].id,
      }),
      'BAD_USER_INPUT',
    );
    expect(
      await prisma.interviewEvent.count({
        where: { interviewId: interview.id, type: 'QUESTION_CHANGED' },
      }),
    ).toBe(0);
    const result = expectSuccess(
      await execute(activeQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[1].id,
      }),
    ).setActiveQuestion;
    expect(result.activeQuestion).toEqual({
      id: seedQuestions[1].id,
      title: seedQuestions[1].title,
    });
    expect(
      await prisma.interviewEvent.count({
        where: { interviewId: interview.id, type: 'QUESTION_CHANGED' },
      }),
    ).toBe(1);
  });

  test.each(['DRAFT', 'READY'])(
    'starts %s interview and records INTERVIEW_STARTED',
    async (status) => {
      const interview = await createInterview();
      await attachSeedQuestion(interview.id);
      if (status === 'DRAFT') {
        // A seeded draft can already have questions. Exercise the same legal
        // persisted state without sharing the seed interview between tests.
        await prisma.interview.update({ where: { id: interview.id }, data: { status: 'DRAFT' } });
      }
      const started = expectSuccess(
        await execute(startMutation, { interviewId: interview.id }),
      ).startInterview;
      expect(started.status).toBe('IN_PROGRESS');
      expect(Number.isNaN(Date.parse(started.startedAt))).toBe(false);
      expect(started.finishedAt).toBeNull();
      expect(
        await prisma.interviewEvent.count({
          where: { interviewId: interview.id, type: 'INTERVIEW_STARTED' },
        }),
      ).toBe(1);
    },
  );

  test('starting an empty draft returns INVALID_STATE and does not write a start event', async () => {
    const interview = await createInterview();
    expectError(await execute(startMutation, { interviewId: interview.id }), 'INVALID_STATE');
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toMatchObject(
      {
        status: 'DRAFT',
        startedAt: null,
        activeQuestionId: null,
      },
    );
    expect(
      await prisma.interviewEvent.count({
        where: { interviewId: interview.id, type: 'INTERVIEW_STARTED' },
      }),
    ).toBe(0);
  });

  test('finishInterview requires IN_PROGRESS and rejected transitions do not write events', async () => {
    const interview = await createInterview();
    expectError(await execute(finishMutation, { interviewId: interview.id }), 'INVALID_STATE');
    expect(
      await prisma.interviewEvent.count({
        where: { interviewId: interview.id, type: 'INTERVIEW_FINISHED' },
      }),
    ).toBe(0);
    await attachSeedQuestion(interview.id);
    expectError(await execute(finishMutation, { interviewId: interview.id }), 'INVALID_STATE');
    expectSuccess(await execute(startMutation, { interviewId: interview.id }));
    expectError(await execute(startMutation, { interviewId: interview.id }), 'INVALID_STATE');
    const finished = expectSuccess(
      await execute(finishMutation, { interviewId: interview.id }),
    ).finishInterview;
    expect(finished.status).toBe('FINISHED');
    expect(Number.isNaN(Date.parse(finished.finishedAt))).toBe(false);
    expectError(await execute(finishMutation, { interviewId: interview.id }), 'INVALID_STATE');
    expectError(await execute(startMutation, { interviewId: interview.id }), 'INVALID_STATE');
    expectError(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[1].id,
      }),
      'INVALID_STATE',
    );
    expectError(
      await execute(activeQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[0].id,
      }),
      'INVALID_STATE',
    );
    const events = await prisma.interviewEvent.findMany({ where: { interviewId: interview.id } });
    expect(events.map(({ type }) => type).sort()).toEqual([
      'INTERVIEW_CREATED',
      'INTERVIEW_FINISHED',
      'INTERVIEW_STARTED',
    ]);
  });

  test('concurrent starts and finishes each commit exactly one state transition and event', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    for (const [mutation, eventType] of [
      [startMutation, 'INTERVIEW_STARTED'],
      [finishMutation, 'INTERVIEW_FINISHED'],
    ]) {
      const results = await Promise.all([
        execute(mutation, { interviewId: interview.id }),
        execute(mutation, { interviewId: interview.id }),
      ]);
      expect(results.filter(({ errors }) => !errors)).toHaveLength(1);
      expectError(
        results.find(({ errors }) => errors),
        'INVALID_STATE',
      );
      expect(
        await prisma.interviewEvent.count({
          where: { interviewId: interview.id, type: eventType },
        }),
      ).toBe(1);
    }
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toMatchObject(
      {
        status: 'FINISHED',
      },
    );
  });

  test.each([
    ['create', 'INTERVIEW_CREATED'],
    ['start', 'INTERVIEW_STARTED'],
    ['finish', 'INTERVIEW_FINISHED'],
  ])(
    '%s transaction rolls back when its event insert fails in PostgreSQL',
    async (operation, eventType) => {
      let interview;
      if (operation !== 'create') {
        interview = await createInterview();
        await attachSeedQuestion(interview.id);
        if (operation === 'start') {
          expectSuccess(
            await execute(addQuestionMutation, {
              interviewId: interview.id,
              questionId: seedQuestions[1].id,
            }),
          );
        }
      }
      if (operation === 'finish') {
        expectSuccess(await execute(startMutation, { interviewId: interview.id }));
      }
      const beforeCount = await prisma.interview.count();
      const beforeEventCount = await prisma.interviewEvent.count();
      const beforeInterview = interview
        ? await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })
        : null;
      const beforeQuestions = interview
        ? await prisma.interviewQuestion.findMany({
            where: { interviewId: interview.id },
            orderBy: { order: 'asc' },
          })
        : null;
      const constraint = `cm_test_block_${operation}`;
      // The schema is generated by the isolated database helper. Event types and
      // constraint names come only from this test's fixed cases.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${database.schema}"."InterviewEvent" ADD CONSTRAINT "${constraint}" CHECK ("type" <> '${eventType}') NOT VALID`,
      );
      try {
        const result =
          operation === 'create'
            ? await execute(createInterviewMutation, {
                input: { title: `Rollback ${randomUUID()}` },
              })
            : await execute(operation === 'start' ? startMutation : finishMutation, {
                interviewId: interview.id,
              });
        expectError(result, 'INTERNAL_SERVER_ERROR');
        expect(await prisma.interview.count()).toBe(beforeCount);
        expect(await prisma.interviewEvent.count()).toBe(beforeEventCount);
        if (interview) {
          expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toEqual(
            beforeInterview,
          );
          expect(
            await prisma.interviewQuestion.findMany({
              where: { interviewId: interview.id },
              orderBy: { order: 'asc' },
            }),
          ).toEqual(beforeQuestions);
        }
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "${database.schema}"."InterviewEvent" DROP CONSTRAINT "${constraint}"`,
        );
      }
    },
  );

  test('owner scoping hides foreign resources and prevents all foreign mutations', async () => {
    const marker = `Foreign ${randomUUID()}`;
    const otherUser = await prisma.user.create({
      data: { name: 'Other interviewer', email: `${randomUUID()}@codemeet.local` },
    });
    const foreignQuestion = await prisma.question.create({
      data: { ...questionInput({ title: marker }), createdById: otherUser.id },
    });
    const foreignInterview = await prisma.interview.create({
      data: { title: marker, createdById: otherUser.id },
    });
    const ownInterview = await createInterview();
    const found = expectSuccess(
      await execute(
        `query Foreign($questionId: ID!, $interviewId: ID!, $search: String!) {
        question(id: $questionId) { id }
        interview(id: $interviewId) { id }
        questions(search: $search) { items { id } pageInfo { totalCount } }
        interviews(limit: 100) { items { id } }
      }`,
        {
          questionId: foreignQuestion.id,
          interviewId: foreignInterview.id,
          search: marker,
        },
      ),
    );
    expect(found.question).toBeNull();
    expect(found.interview).toBeNull();
    expect(found.questions).toEqual({ items: [], pageInfo: { totalCount: 0 } });
    expect(found.interviews.items.map(({ id }) => id)).not.toContain(foreignInterview.id);
    const mutations = [
      execute(
        `mutation Update($id: ID!) { updateQuestion(id: $id, input: {title: "Forbidden"}) { id } }`,
        { id: foreignQuestion.id },
      ),
      execute(addQuestionMutation, {
        interviewId: ownInterview.id,
        questionId: foreignQuestion.id,
      }),
      execute(addQuestionMutation, {
        interviewId: foreignInterview.id,
        questionId: seedQuestions[0].id,
      }),
      execute(activeQuestionMutation, {
        interviewId: foreignInterview.id,
        questionId: seedQuestions[0].id,
      }),
      execute(startMutation, { interviewId: foreignInterview.id }),
      execute(finishMutation, { interviewId: foreignInterview.id }),
    ];
    for (const result of await Promise.all(mutations)) expectError(result, 'NOT_FOUND');
    expect(
      await prisma.question.findUniqueOrThrow({ where: { id: foreignQuestion.id } }),
    ).toMatchObject({ title: marker });
    expect(
      await prisma.interview.findUniqueOrThrow({ where: { id: foreignInterview.id } }),
    ).toMatchObject({ status: 'DRAFT', startedAt: null, finishedAt: null });
    expect(await prisma.interviewQuestion.count({ where: { interviewId: ownInterview.id } })).toBe(
      0,
    );
  });

  test('interview queries include participants and filter states with correct pagination', async () => {
    const interview = await createInterview();
    await prisma.interviewParticipant.create({
      data: { interviewId: interview.id, displayName: 'Guest candidate', role: 'CANDIDATE' },
    });
    const found = expectSuccess(
      await execute(`query One($id: ID!) { interview(id: $id) { ${interviewFields} } }`, {
        id: interview.id,
      }),
    ).interview;
    expect(found.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'INTERVIEWER',
          user: { id: demoUser.id, email: demoUser.email },
        }),
        expect.objectContaining({ role: 'CANDIDATE', displayName: 'Guest candidate', user: null }),
      ]),
    );
    const draftCount = await prisma.interview.count({
      where: { status: 'DRAFT', createdById: demoUser.id },
    });
    const page = expectSuccess(
      await execute(`{ interviews(status: DRAFT, limit: 1, offset: 0) {
        items { id status } pageInfo { limit offset totalCount hasNextPage }
      } }`),
    ).interviews;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('DRAFT');
    expect(page.pageInfo).toEqual({
      limit: 1,
      offset: 0,
      totalCount: draftCount,
      hasNextPage: draftCount > 1,
    });
  });

  test('question snapshots remain absent while the interview is being prepared', async () => {
    const interview = await createInterview();
    const prepared = await attachSeedQuestion(interview.id);
    expect(prepared.status).toBe('READY');
    expect(prepared.questions[0]).toMatchObject({
      snapshotTitle: null,
      snapshotDescription: null,
      snapshotDifficulty: null,
      snapshotLanguage: null,
      snapshotStarterCode: null,
      snapshotCapturedAt: null,
    });
    expect(
      await prisma.interviewQuestion.findUniqueOrThrow({
        where: { id: prepared.questions[0].id },
      }),
    ).toMatchObject({ snapshotCapturedAt: null, snapshotTitle: null });
  });

  test('startInterview captures the current attached question data and one shared timestamp', async () => {
    const question = await createQuestion();
    const interview = await createInterview();
    expectSuccess(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: question.id,
      }),
    );
    const current = {
      title: 'Updated before start',
      description: 'Use the latest requirements at the moment the interview starts.',
      difficulty: 'HARD',
      language: 'TYPESCRIPT',
      starterCode: '',
    };
    expectSuccess(
      await execute(
        `mutation Update($id: ID!, $input: UpdateQuestionInput!) {
      updateQuestion(id: $id, input: $input) { ${questionFields} }
    }`,
        { id: question.id, input: current },
      ),
    );
    const started = expectSuccess(
      await execute(startMutation, { interviewId: interview.id }),
    ).startInterview;
    expect(started).toMatchObject({ status: 'IN_PROGRESS', activeQuestion: { id: question.id } });
    expect(started.questions[0]).toMatchObject({
      snapshotTitle: current.title,
      snapshotDescription: current.description,
      snapshotDifficulty: current.difficulty,
      snapshotLanguage: current.language,
      snapshotStarterCode: '',
      snapshotCapturedAt: started.startedAt,
    });
    const persisted = await prisma.interviewQuestion.findUniqueOrThrow({
      where: { id: started.questions[0].id },
    });
    expect(persisted.snapshotCapturedAt.toISOString()).toBe(started.startedAt);
    expect(persisted.snapshotStarterCode).toBe('');
  });

  test('editing reusable question content after start does not change the interview snapshot', async () => {
    const question = await createQuestion({ starterCode: '  original code\n' });
    const interview = await createInterview();
    expectSuccess(
      await execute(addQuestionMutation, { interviewId: interview.id, questionId: question.id }),
    );
    const started = expectSuccess(
      await execute(startMutation, { interviewId: interview.id }),
    ).startInterview;
    const before = await prisma.interviewQuestion.findUniqueOrThrow({
      where: { id: started.questions[0].id },
    });
    const later = {
      title: 'Changed after start',
      description: 'These requirements belong only to future interviews.',
      difficulty: 'HARD',
      language: 'REACT_TSX',
      starterCode: 'export function Future() { return null; }',
    };
    expectSuccess(
      await execute(
        `mutation Update($id: ID!, $input: UpdateQuestionInput!) {
      updateQuestion(id: $id, input: $input) { ${questionFields} }
    }`,
        { id: question.id, input: later },
      ),
    );
    expectSuccess(await execute(finishMutation, { interviewId: interview.id }));
    const historical = expectSuccess(
      await execute(
        `query One($id: ID!) {
      interview(id: $id) { ${interviewFields} }
    }`,
        { id: interview.id },
      ),
    ).interview;
    expect(historical.status).toBe('FINISHED');
    expect(historical.questions[0]).toMatchObject({
      snapshotTitle: question.title,
      snapshotDescription: question.description,
      snapshotDifficulty: question.difficulty,
      snapshotLanguage: question.language,
      snapshotStarterCode: '  original code\n',
      snapshotCapturedAt: started.startedAt,
      question: later,
    });
    expect(
      await prisma.interviewQuestion.findUniqueOrThrow({
        where: { id: before.id },
      }),
    ).toEqual(before);
  });

  test('start selects the first ordered attachment even when a legacy preparation active question differs', async () => {
    const interview = await createInterview();
    for (const [question, order] of [
      [seedQuestions[0], 8],
      [seedQuestions[1], 2],
      [seedQuestions[2], 17],
    ]) {
      expectSuccess(
        await execute(addQuestionMutation, {
          interviewId: interview.id,
          questionId: question.id,
          order,
        }),
      );
    }
    await prisma.interview.update({
      where: { id: interview.id },
      data: { activeQuestionId: seedQuestions[2].id },
    });
    const started = expectSuccess(
      await execute(startMutation, { interviewId: interview.id }),
    ).startInterview;
    expect(started.activeQuestion.id).toBe(seedQuestions[1].id);
    expect(started.questions.map(({ order, question }) => [order, question.id])).toEqual([
      [2, seedQuestions[1].id],
      [8, seedQuestions[0].id],
      [17, seedQuestions[2].id],
    ]);
    expect(started.questions.every((entry) => entry.snapshotCapturedAt === started.startedAt)).toBe(
      true,
    );
    const queried = expectSuccess(
      await execute(
        `query One($id: ID!) {
      interview(id: $id) { ${interviewFields} }
    }`,
        { id: interview.id },
      ),
    ).interview;
    expect(queried.questions.map(({ id }) => id)).toEqual(started.questions.map(({ id }) => id));
  });

  test('questions cannot be attached after start and existing snapshots remain unchanged', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    expectSuccess(await execute(startMutation, { interviewId: interview.id }));
    const before = await prisma.interviewQuestion.findMany({
      where: { interviewId: interview.id },
    });
    expectError(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[1].id,
      }),
      'INVALID_STATE',
    );
    expect(
      await prisma.interviewQuestion.findMany({ where: { interviewId: interview.id } }),
    ).toEqual(before);
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toMatchObject(
      { status: 'IN_PROGRESS' },
    );
  });

  test('concurrent attachment and start leave only fully snapshotted final attachments', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    const [attached, started] = await Promise.all([
      execute(addQuestionMutation, { interviewId: interview.id, questionId: seedQuestions[1].id }),
      execute(startMutation, { interviewId: interview.id }),
    ]);
    const running = expectSuccess(started).startInterview;
    if (attached.errors) expectError(attached, 'INVALID_STATE');
    else expectSuccess(attached);
    const rows = await prisma.interviewQuestion.findMany({ where: { interviewId: interview.id } });
    expect(rows).toHaveLength(attached.errors ? 1 : 2);
    expect(
      rows.every(
        (entry) =>
          entry.snapshotTitle !== null &&
          entry.snapshotCapturedAt?.toISOString() === running.startedAt,
      ),
    ).toBe(true);
    expect(
      await prisma.interviewEvent.count({
        where: { interviewId: interview.id, type: 'INTERVIEW_STARTED' },
      }),
    ).toBe(1);
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toMatchObject(
      { status: 'IN_PROGRESS', activeQuestionId: seedQuestions[0].id },
    );
  });

  test.each(['DRAFT', 'READY', 'FINISHED'])(
    'setActiveQuestion rejects %s before even accepting a same-question no-op',
    async (status) => {
      const interview = await createInterview();
      await attachSeedQuestion(interview.id);
      if (status !== 'FINISHED') {
        await prisma.interview.update({
          where: { id: interview.id },
          data: { status, activeQuestionId: seedQuestions[0].id },
        });
      } else if (status === 'FINISHED') {
        expectSuccess(await execute(startMutation, { interviewId: interview.id }));
        expectSuccess(await execute(finishMutation, { interviewId: interview.id }));
      }
      const before = await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } });
      expectError(
        await execute(activeQuestionMutation, {
          interviewId: interview.id,
          questionId: seedQuestions[0].id,
        }),
        'INVALID_STATE',
      );
      expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toEqual(
        before,
      );
      expect(
        await prisma.interviewEvent.count({
          where: { interviewId: interview.id, type: 'QUESTION_CHANGED' },
        }),
      ).toBe(0);
    },
  );

  test('switching an in-progress question records only the previous and next question IDs', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    expectSuccess(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[1].id,
      }),
    );
    expectSuccess(await execute(startMutation, { interviewId: interview.id }));
    const changed = expectSuccess(
      await execute(activeQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[1].id,
      }),
    ).setActiveQuestion;
    expect(changed.activeQuestion.id).toBe(seedQuestions[1].id);
    const events = await prisma.interviewEvent.findMany({
      where: { interviewId: interview.id, type: 'QUESTION_CHANGED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      questionId: seedQuestions[1].id,
      previousQuestionId: seedQuestions[0].id,
    });
  });

  test('selecting the already active in-progress question is a no-op without another event', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    expectSuccess(await execute(startMutation, { interviewId: interview.id }));
    const before = await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expectSuccess(
        await execute(activeQuestionMutation, {
          interviewId: interview.id,
          questionId: seedQuestions[0].id,
        }),
      );
    }
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toEqual(
      before,
    );
    expect(
      await prisma.interviewEvent.count({
        where: { interviewId: interview.id, type: 'QUESTION_CHANGED' },
      }),
    ).toBe(0);
  });

  test('QUESTION_CHANGED and the active question update roll back together if event insertion fails', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    expectSuccess(
      await execute(addQuestionMutation, {
        interviewId: interview.id,
        questionId: seedQuestions[1].id,
      }),
    );
    expectSuccess(await execute(startMutation, { interviewId: interview.id }));
    const before = await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } });
    const beforeQuestions = await prisma.interviewQuestion.findMany({
      where: { interviewId: interview.id },
      orderBy: { order: 'asc' },
    });
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${database.schema}"."InterviewEvent" ADD CONSTRAINT "cm_test_block_question_changed" CHECK ("type" <> 'QUESTION_CHANGED') NOT VALID`,
    );
    try {
      expectError(
        await execute(activeQuestionMutation, {
          interviewId: interview.id,
          questionId: seedQuestions[1].id,
        }),
        'INTERNAL_SERVER_ERROR',
      );
      expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toEqual(
        before,
      );
      expect(
        await prisma.interviewQuestion.findMany({
          where: { interviewId: interview.id },
          orderBy: { order: 'asc' },
        }),
      ).toEqual(beforeQuestions);
      expect(
        await prisma.interviewEvent.count({
          where: { interviewId: interview.id, type: 'QUESTION_CHANGED' },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${database.schema}"."InterviewEvent" DROP CONSTRAINT "cm_test_block_question_changed"`,
      );
    }
  });

  test('repeated start preserves the original snapshots and produces a controlled error', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    expectSuccess(await execute(startMutation, { interviewId: interview.id }));
    const before = await prisma.interviewQuestion.findMany({
      where: { interviewId: interview.id },
    });
    expectError(await execute(startMutation, { interviewId: interview.id }), 'INVALID_STATE');
    expect(
      await prisma.interviewQuestion.findMany({ where: { interviewId: interview.id } }),
    ).toEqual(before);
    expect(
      await prisma.interviewEvent.count({
        where: { interviewId: interview.id, type: 'INTERVIEW_STARTED' },
      }),
    ).toBe(1);
  });

  test.each(['IN_PROGRESS', 'FINISHED'])(
    'legacy %s interviews keep missing snapshots rather than inventing history during reads or seed',
    async (status) => {
      const interview = await createInterview();
      await attachSeedQuestion(interview.id);
      const startedAt = new Date('2026-01-01T10:00:00.000Z');
      await prisma.interview.update({
        where: { id: interview.id },
        data: {
          status,
          startedAt,
          finishedAt: status === 'FINISHED' ? new Date('2026-01-01T11:00:00.000Z') : null,
          activeQuestionId: seedQuestions[0].id,
        },
      });
      const before = await prisma.interviewQuestion.findMany({
        where: { interviewId: interview.id },
      });
      await seedDatabase(prisma);
      const legacy = expectSuccess(
        await execute(
          `query One($id: ID!) {
        interview(id: $id) { ${interviewFields} }
      }`,
          { id: interview.id },
        ),
      ).interview;
      expect(legacy.status).toBe(status);
      expect(legacy.startedAt).toBe(startedAt.toISOString());
      expect(legacy.questions[0]).toMatchObject({
        snapshotTitle: null,
        snapshotDescription: null,
        snapshotDifficulty: null,
        snapshotLanguage: null,
        snapshotStarterCode: null,
        snapshotCapturedAt: null,
      });
      expect(
        await prisma.interviewQuestion.findMany({ where: { interviewId: interview.id } }),
      ).toEqual(before);
    },
  );

  test('PostgreSQL rejects partially populated question snapshots independently of services', async () => {
    const interview = await createInterview();
    const prepared = await attachSeedQuestion(interview.id);
    const id = prepared.questions[0].id;
    await expect(
      prisma.interviewQuestion.update({
        where: { id },
        data: { snapshotTitle: 'Partial snapshot' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.interviewQuestion.update({ where: { id }, data: { snapshotCapturedAt: new Date() } }),
    ).rejects.toThrow();
    expect(await prisma.interviewQuestion.findUniqueOrThrow({ where: { id } })).toMatchObject({
      snapshotTitle: null,
      snapshotCapturedAt: null,
    });
    expectSuccess(await execute(startMutation, { interviewId: interview.id }));
    await expect(
      prisma.interviewQuestion.update({ where: { id }, data: { snapshotStarterCode: null } }),
    ).rejects.toThrow();
    expect(
      (await prisma.interviewQuestion.findUniqueOrThrow({ where: { id } })).snapshotStarterCode,
    ).toBe(seedQuestions[0].starterCode);
  });

  test('PostgreSQL rejects negative question order independently of service validation', async () => {
    const interview = await createInterview();
    await expect(
      prisma.interviewQuestion.create({
        data: { interviewId: interview.id, questionId: seedQuestions[0].id, order: -1 },
      }),
    ).rejects.toThrow();
    expect(await prisma.interviewQuestion.count({ where: { interviewId: interview.id } })).toBe(0);
  });

  test('PostgreSQL requires a user for interviewers and permits only one guest candidate', async () => {
    const interview = await createInterview();
    await expect(
      prisma.interviewParticipant.create({
        data: {
          interviewId: interview.id,
          displayName: 'Invalid interviewer',
          role: 'INTERVIEWER',
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.interviewParticipant.count({ where: { interviewId: interview.id } })).toBe(
      1,
    );
    await prisma.interviewParticipant.create({
      data: { interviewId: interview.id, displayName: 'First guest', role: 'CANDIDATE' },
    });
    await expect(
      prisma.interviewParticipant.create({
        data: { interviewId: interview.id, displayName: 'Second guest', role: 'CANDIDATE' },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.interviewParticipant.count({
        where: { interviewId: interview.id, role: 'CANDIDATE' },
      }),
    ).toBe(1);
  });

  test('PostgreSQL prevents assigning an unattached question as active', async () => {
    const interview = await createInterview();
    await attachSeedQuestion(interview.id);
    await expect(
      prisma.interview.update({
        where: { id: interview.id },
        data: { activeQuestionId: seedQuestions[1].id },
      }),
    ).rejects.toThrow();
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toMatchObject(
      {
        activeQuestionId: null,
      },
    );
    await prisma.interview.update({
      where: { id: interview.id },
      data: { activeQuestionId: seedQuestions[0].id },
    });
    expect(await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).toMatchObject(
      {
        activeQuestionId: seedQuestions[0].id,
      },
    );
  });

  test('stored CodeRun tasks and optional actors must belong to the same interview', async () => {
    const first = await createInterview();
    const second = await createInterview();
    await attachSeedQuestion(first.id);
    expectSuccess(
      await execute(addQuestionMutation, {
        interviewId: second.id,
        questionId: seedQuestions[1].id,
      }),
    );
    const firstActor = first.participants[0];
    const secondActor = second.participants[0];
    const snapshot = {
      interviewId: first.id,
      questionId: seedQuestions[0].id,
      createdByParticipantId: firstActor.id,
      codeSnapshot: 'const answer = 42;',
      status: 'SUCCESS',
    };
    // This checks the persistence model only. No code runner is invoked.
    await expect(
      prisma.codeRun.create({ data: { ...snapshot, questionId: seedQuestions[1].id } }),
    ).rejects.toThrow();
    await expect(
      prisma.codeRun.create({ data: { ...snapshot, createdByParticipantId: secondActor.id } }),
    ).rejects.toThrow();
    expect(await prisma.codeRun.count({ where: { interviewId: first.id } })).toBe(0);
    const attributed = await prisma.codeRun.create({ data: snapshot });
    const unattributed = await prisma.codeRun.create({
      data: { ...snapshot, createdByParticipantId: null },
    });
    expect(attributed.createdByParticipantId).toBe(firstActor.id);
    expect(unattributed.createdByParticipantId).toBeNull();
    expect(await prisma.codeRun.count({ where: { interviewId: first.id } })).toBe(2);
  });

  test('unexpected real Prisma failures expose a controlled error without database internals', async () => {
    const absentSchema = `cm_test_missing_${randomUUID().replaceAll('-', '')}`;
    const unavailablePrisma = createPrismaClient(withSchema(database.databaseUrl, absentSchema));
    try {
      const brokenYoga = createGraphQLYoga({
        prisma: unavailablePrisma,
        demoAuthEnabled: true,
        nodeEnv: 'test',
      });
      expect(expectSuccess(await execute('{ health }', {}, brokenYoga))).toEqual({ health: 'ok' });
      const result = await execute('{ questions { items { id } } }', {}, brokenYoga);
      expectError(result, 'INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(result.errors)).not.toContain(absentSchema);
      expect(JSON.stringify(result.errors)).not.toMatch(/P2021|does not exist|postgresql:\/\//);
    } finally {
      await unavailablePrisma.$disconnect();
    }
  });

  test('the existing HTTP server preserves health, HEAD, method checks and unknown routes', async () => {
    const server = createApiServer({ prisma, demoAuthEnabled: true, nodeEnv: 'test' });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ service: 'codemeet-api', status: 'ok' });
      const head = await fetch(`${baseUrl}/health`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      const unsupported = await fetch(`${baseUrl}/health`, { method: 'POST' });
      expect(unsupported.status).toBe(405);
      expect(unsupported.headers.get('allow')).toBe('GET, HEAD');
      expect((await fetch(`${baseUrl}/missing`)).status).toBe(404);
      const graphql = await fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ health }' }),
      });
      expect(graphql.status).toBe(200);
      expect(expectSuccess(await graphql.json())).toEqual({ health: 'ok' });
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  });
});
