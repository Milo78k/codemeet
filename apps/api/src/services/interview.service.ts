import {
  InterviewEventType,
  InterviewStatus,
  ParticipantRole,
  Prisma,
  type PrismaClient,
  type User,
} from '@codemeet/db';
import { z } from 'zod';

import { ApiError } from '../graphql/errors.js';
import { questionInclude } from './question.service.js';
import {
  idSchema,
  pageInfo,
  paginationSchema,
  serializableTransaction,
  titleSchema,
  validateInput,
} from './shared.js';

export const interviewInclude = {
  createdBy: true,
  activeQuestion: { include: questionInclude },
  questions: {
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    include: { question: { include: questionInclude } },
  },
  participants: {
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    include: { user: true },
  },
} satisfies Prisma.InterviewInclude;

export type InterviewRecord = Prisma.InterviewGetPayload<{
  include: typeof interviewInclude;
}>;

const interviewListSchema = paginationSchema.extend({
  status: z.enum(InterviewStatus).optional(),
});
const createInterviewSchema = z.object({ title: titleSchema });
const attachQuestionSchema = z.object({
  interviewId: idSchema,
  questionId: idSchema,
  order: z.number().int().min(0).max(1_000_000).optional(),
});
const activeQuestionSchema = attachQuestionSchema.omit({ order: true });

async function ownedInterview(transaction: Prisma.TransactionClient, userId: string, id: string) {
  const interview = await transaction.interview.findFirst({
    where: { id, createdById: userId },
    include: interviewInclude,
  });
  if (!interview) {
    throw new ApiError('Interview was not found.', 'NOT_FOUND');
  }
  return interview;
}

async function readInterview(transaction: Prisma.TransactionClient, id: string) {
  return transaction.interview.findUniqueOrThrow({
    where: { id },
    include: interviewInclude,
  });
}

export async function listInterviews(prisma: PrismaClient, userId: string, input: unknown) {
  const { limit, offset, status } = validateInput(interviewListSchema, input);
  const where: Prisma.InterviewWhereInput = {
    createdById: userId,
    ...(status ? { status } : {}),
  };
  const [items, totalCount] = await prisma.$transaction(
    [
      prisma.interview.findMany({
        where,
        include: interviewInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.interview.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return { items, pageInfo: pageInfo(limit, offset, totalCount) };
}

export async function findInterview(prisma: PrismaClient, userId: string, rawId: unknown) {
  const id = validateInput(idSchema, rawId);
  return prisma.interview.findFirst({
    where: { id, createdById: userId },
    include: interviewInclude,
  });
}

export async function findCandidateInterview(
  prisma: PrismaClient,
  participantId: string,
  rawId: unknown,
) {
  const id = validateInput(idSchema, rawId);
  return prisma.interview.findFirst({
    where: { id, participants: { some: { id: participantId, role: ParticipantRole.CANDIDATE } } },
    include: interviewInclude,
  });
}

export async function createInterview(prisma: PrismaClient, user: User, input: unknown) {
  const { title } = validateInput(createInterviewSchema, input);
  return serializableTransaction(prisma, async (transaction) => {
    const interview = await transaction.interview.create({
      data: {
        title,
        status: InterviewStatus.DRAFT,
        createdById: user.id,
        participants: {
          create: {
            userId: user.id,
            displayName: user.name,
            role: ParticipantRole.INTERVIEWER,
          },
        },
        events: {
          create: {
            type: InterviewEventType.INTERVIEW_CREATED,
            payload: { createdById: user.id },
          },
        },
      },
      include: interviewInclude,
    });
    return interview;
  });
}

export async function addQuestionToInterview(prisma: PrismaClient, userId: string, input: unknown) {
  const { interviewId, questionId, order } = validateInput(attachQuestionSchema, input);
  return serializableTransaction(prisma, async (transaction) => {
    const interview = await ownedInterview(transaction, userId, interviewId);
    if (interview.status !== InterviewStatus.DRAFT && interview.status !== InterviewStatus.READY) {
      throw new ApiError(
        'Questions can only be added before the interview starts.',
        'INVALID_STATE',
      );
    }
    const question = await transaction.question.findFirst({
      where: { id: questionId, createdById: userId },
      select: { id: true },
    });
    if (!question) {
      throw new ApiError('Question was not found.', 'NOT_FOUND');
    }
    if (interview.questions.some((entry) => entry.questionId === questionId)) {
      throw new ApiError('Question is already in this interview.', 'CONFLICT');
    }

    const nextOrder = order ?? (interview.questions.at(-1)?.order ?? -1) + 1;
    if (nextOrder > 1_000_000) {
      throw new ApiError('Question order exceeds the supported range.', 'BAD_USER_INPUT');
    }
    if (interview.questions.some((entry) => entry.order === nextOrder)) {
      throw new ApiError('Question order is already occupied.', 'CONFLICT');
    }

    await transaction.interviewQuestion.create({
      data: { interviewId, questionId, order: nextOrder },
    });
    // READY is a real state: the first attachment makes a new draft ready.
    // Seeded drafts may already have questions and can still start directly.
    if (interview.status === InterviewStatus.DRAFT) {
      const result = await transaction.interview.updateMany({
        where: { id: interviewId, createdById: userId, status: InterviewStatus.DRAFT },
        data: { status: InterviewStatus.READY },
      });
      if (result.count !== 1) {
        throw new ApiError('Interview state changed concurrently.', 'CONFLICT');
      }
    }
    return readInterview(transaction, interviewId);
  });
}

export async function setActiveQuestion(prisma: PrismaClient, userId: string, input: unknown) {
  const { interviewId, questionId } = validateInput(activeQuestionSchema, input);
  return serializableTransaction(prisma, async (transaction) => {
    const interview = await ownedInterview(transaction, userId, interviewId);
    if (interview.status !== InterviewStatus.IN_PROGRESS) {
      throw new ApiError(
        'Questions can only be switched during an in-progress interview.',
        'INVALID_STATE',
      );
    }
    if (!interview.questions.some((entry) => entry.questionId === questionId)) {
      throw new ApiError('Question does not belong to this interview.', 'BAD_USER_INPUT');
    }
    if (interview.activeQuestionId === questionId) return interview;

    const result = await transaction.interview.updateMany({
      where: { id: interviewId, createdById: userId, status: InterviewStatus.IN_PROGRESS },
      data: { activeQuestionId: questionId },
    });
    if (result.count !== 1) {
      throw new ApiError('Interview state changed concurrently.', 'CONFLICT');
    }
    await transaction.interviewEvent.create({
      data: {
        interviewId,
        type: InterviewEventType.QUESTION_CHANGED,
        payload: { questionId, previousQuestionId: interview.activeQuestionId },
      },
    });
    return readInterview(transaction, interviewId);
  });
}

export async function startInterview(prisma: PrismaClient, userId: string, rawId: unknown) {
  const interviewId = validateInput(idSchema, rawId);
  return serializableTransaction(prisma, async (transaction) => {
    const interview = await ownedInterview(transaction, userId, interviewId);
    if (interview.status !== InterviewStatus.DRAFT && interview.status !== InterviewStatus.READY) {
      throw new ApiError('Only a draft or ready interview can start.', 'INVALID_STATE');
    }
    const firstQuestion = interview.questions[0];
    if (!firstQuestion) {
      throw new ApiError('Add at least one question before starting.', 'INVALID_STATE');
    }
    const activeQuestionId = firstQuestion.questionId;
    const startedAt = new Date();
    for (const entry of interview.questions) {
      await transaction.interviewQuestion.update({
        where: { id: entry.id },
        data: {
          snapshotTitle: entry.question.title,
          snapshotDescription: entry.question.description,
          snapshotDifficulty: entry.question.difficulty,
          snapshotLanguage: entry.question.language,
          snapshotStarterCode: entry.question.starterCode,
          snapshotCapturedAt: startedAt,
        },
      });
    }
    const result = await transaction.interview.updateMany({
      where: {
        id: interviewId,
        createdById: userId,
        status: { in: [InterviewStatus.DRAFT, InterviewStatus.READY] },
      },
      data: {
        status: InterviewStatus.IN_PROGRESS,
        startedAt,
        activeQuestionId,
      },
    });
    if (result.count !== 1) {
      throw new ApiError('Interview state changed concurrently.', 'CONFLICT');
    }
    await transaction.interviewEvent.create({
      data: {
        interviewId,
        type: InterviewEventType.INTERVIEW_STARTED,
        payload: { activeQuestionId },
      },
    });
    return readInterview(transaction, interviewId);
  });
}

export async function finishInterview(prisma: PrismaClient, userId: string, rawId: unknown) {
  const interviewId = validateInput(idSchema, rawId);
  return serializableTransaction(prisma, async (transaction) => {
    const interview = await ownedInterview(transaction, userId, interviewId);
    if (interview.status !== InterviewStatus.IN_PROGRESS) {
      throw new ApiError('Only an in-progress interview can finish.', 'INVALID_STATE');
    }
    const result = await transaction.interview.updateMany({
      where: {
        id: interviewId,
        createdById: userId,
        status: InterviewStatus.IN_PROGRESS,
      },
      data: { status: InterviewStatus.FINISHED, finishedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new ApiError('Interview state changed concurrently.', 'CONFLICT');
    }
    await transaction.interviewEvent.create({
      data: {
        interviewId,
        type: InterviewEventType.INTERVIEW_FINISHED,
        payload: { finishedById: userId },
      },
    });
    return readInterview(transaction, interviewId);
  });
}
