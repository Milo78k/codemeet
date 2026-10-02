import type { GetQuestionsQuery, GetInterviewsQuery } from '@/shared/api/generated/graphql';

export type QuestionResult = GetQuestionsQuery['questions']['items'][number];
export type InterviewResult = GetInterviewsQuery['interviews']['items'][number];

const createdAt = '2026-10-01T09:00:00.000Z';
const creator: QuestionResult['createdBy'] = {
  __typename: 'User',
  id: 'demo-user',
  name: 'Demo Interviewer',
  email: 'demo@codemeet.local',
};

export function question(
  id = 'question-1',
  title = 'Two Sum',
  overrides: Partial<QuestionResult> = {},
): QuestionResult {
  return {
    __typename: 'Question',
    id,
    title,
    description: 'Find two numbers whose sum matches a target.',
    difficulty: 'EASY',
    language: 'JAVASCRIPT',
    starterCode: '',
    createdBy: creator,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

export function interview(
  id = 'interview-ready',
  title = 'Frontend interview',
  status: InterviewResult['status'] = 'READY',
  questions: QuestionResult[] = [question()],
): InterviewResult {
  const started = status === 'IN_PROGRESS' || status === 'FINISHED';
  return {
    __typename: 'Interview',
    id,
    title,
    status,
    createdBy: creator,
    activeQuestion: started ? (questions[0] ?? null) : null,
    startedAt: status === 'IN_PROGRESS' || status === 'FINISHED' ? createdAt : null,
    finishedAt: status === 'FINISHED' ? createdAt : null,
    createdAt,
    updatedAt: createdAt,
    questions: questions.map((item, order) => ({
      __typename: 'InterviewQuestion',
      id: `${id}-attachment-${item.id}`,
      order,
      snapshotTitle: started ? item.title : null,
      snapshotDescription: started ? item.description : null,
      snapshotDifficulty: started ? item.difficulty : null,
      snapshotLanguage: started ? item.language : null,
      snapshotStarterCode: started ? item.starterCode : null,
      snapshotCapturedAt: started ? createdAt : null,
      question: item,
    })),
    participants: [],
  };
}

export function questionsData(
  items: QuestionResult[],
  offset = 0,
  totalCount = items.length,
  limit = 12,
): GetQuestionsQuery {
  return {
    questions: {
      __typename: 'QuestionPage',
      items,
      pageInfo: {
        __typename: 'PageInfo',
        offset,
        limit,
        totalCount,
        hasNextPage: offset + limit < totalCount,
      },
    },
  };
}

export function interviewsData(
  items: InterviewResult[],
  offset = 0,
  totalCount = items.length,
  limit = 6,
): GetInterviewsQuery {
  return {
    interviews: {
      __typename: 'InterviewPage',
      items,
      pageInfo: {
        __typename: 'PageInfo',
        offset,
        limit,
        totalCount,
        hasNextPage: offset + limit < totalCount,
      },
    },
  };
}

export function apiError(message: string, code = 'BAD_USER_INPUT') {
  return { errors: [{ message, extensions: { code } }] };
}

export function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
