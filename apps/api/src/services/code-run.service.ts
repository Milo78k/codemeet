import {
  CodeRunStatus,
  InterviewStatus,
  ParticipantRole,
  ProgrammingLanguage,
  Prisma,
  type PrismaClient,
} from '@codemeet/db';
import { z } from 'zod';

import type { ApiIdentity } from '../graphql/context.js';
import { ApiError } from '../graphql/errors.js';
import { idSchema, pageInfo, serializableTransaction, validateInput } from './shared.js';

export const CODE_RUN_MAX_SOURCE_CHARS = 100_000;
export const CODE_RUN_MAX_OUTPUT_CHARS = 20_000;
export const CODE_RUN_MAX_DURATION_MS = 15_000;
export const CODE_RUN_DEFAULT_PAGE_SIZE = 20;
export const CODE_RUN_MAX_PAGE_SIZE = 50;

export const codeRunInclude = {
  interviewQuestion: { include: { question: true } },
  createdByParticipant: { include: { user: true } },
} satisfies Prisma.CodeRunInclude;

export type CodeRunRecord = Prisma.CodeRunGetPayload<{ include: typeof codeRunInclude }>;

const codeRunStatusSchema = z.enum(CodeRunStatus);
const codeRunLanguageSchema = z.enum([
  ProgrammingLanguage.JAVASCRIPT,
  ProgrammingLanguage.TYPESCRIPT,
]);
const codeRunInputSchema = z
  .object({
    runId: idSchema,
    interviewQuestionId: idSchema,
    language: codeRunLanguageSchema,
    sourceSnapshot: z.string().max(CODE_RUN_MAX_SOURCE_CHARS),
    status: codeRunStatusSchema,
    stdout: z.string().max(CODE_RUN_MAX_OUTPUT_CHARS),
    stderr: z.string().max(CODE_RUN_MAX_OUTPUT_CHARS),
    durationMs: z.number().int().min(0).max(CODE_RUN_MAX_DURATION_MS),
  })
  .refine((input) => input.stdout.length + input.stderr.length <= CODE_RUN_MAX_OUTPUT_CHARS, {
    message: `Combined output must not exceed ${CODE_RUN_MAX_OUTPUT_CHARS} characters.`,
    path: ['stdout'],
  });

const codeRunListSchema = z.object({
  interviewId: idSchema,
  interviewQuestionId: idSchema,
  limit: z.number().int().min(1).max(CODE_RUN_MAX_PAGE_SIZE).default(CODE_RUN_DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).max(1_000_000).default(0),
});

async function authorizeInterview(
  transaction: Prisma.TransactionClient,
  identity: ApiIdentity,
  interviewId: string,
) {
  const interview = await transaction.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, createdById: true, status: true },
  });
  if (!interview) throw new ApiError('Interview was not found.', 'NOT_FOUND');

  if (identity.kind === 'interviewer') {
    if (interview.createdById !== identity.user.id) {
      throw new ApiError('Interview was not found.', 'NOT_FOUND');
    }
    const participant = await transaction.interviewParticipant.findFirst({
      where: {
        interviewId,
        userId: identity.user.id,
        role: ParticipantRole.INTERVIEWER,
      },
    });
    if (!participant) {
      throw new ApiError('The interviewer is not a participant in this interview.', 'FORBIDDEN');
    }
    return { interview, participant };
  }

  if (
    identity.participant.interviewId !== interviewId ||
    identity.participant.role !== ParticipantRole.CANDIDATE
  ) {
    throw new ApiError('Interview was not found.', 'NOT_FOUND');
  }
  const participant = await transaction.interviewParticipant.findFirst({
    where: {
      id: identity.participant.id,
      interviewId,
      role: ParticipantRole.CANDIDATE,
    },
  });
  if (!participant) throw new ApiError('Interview was not found.', 'NOT_FOUND');
  return { interview, participant };
}

async function findAttachment(
  transaction: Prisma.TransactionClient,
  interviewId: string,
  interviewQuestionId: string,
) {
  const attachment = await transaction.interviewQuestion.findFirst({
    where: { id: interviewQuestionId, interviewId },
    include: { question: { select: { language: true } } },
  });
  if (!attachment) {
    throw new ApiError('Question does not belong to this interview.', 'BAD_USER_INPUT');
  }
  return attachment;
}

function attachmentLanguage(
  attachment: Awaited<ReturnType<typeof findAttachment>>,
): ProgrammingLanguage {
  return attachment.snapshotLanguage ?? attachment.question.language;
}

function ensureSupportedLanguage(language: ProgrammingLanguage) {
  if (language !== ProgrammingLanguage.JAVASCRIPT && language !== ProgrammingLanguage.TYPESCRIPT) {
    throw new ApiError(
      'Code runs are supported only for JavaScript and TypeScript.',
      'BAD_USER_INPUT',
    );
  }
}

function matchesInput(
  run: CodeRunRecord,
  input: z.infer<typeof codeRunInputSchema>,
  interviewId: string,
  participantId: string,
) {
  return (
    run.interviewId === interviewId &&
    run.interviewQuestion.id === input.interviewQuestionId &&
    run.createdByParticipantId === participantId &&
    run.codeSnapshot === input.sourceSnapshot &&
    run.status === input.status &&
    (run.stdout ?? '') === input.stdout &&
    (run.stderr ?? '') === input.stderr &&
    run.durationMs === input.durationMs
  );
}

export async function recordCodeRun(
  prisma: PrismaClient,
  identity: ApiIdentity,
  rawInterviewId: unknown,
  rawInput: unknown,
) {
  const interviewId = validateInput(idSchema, rawInterviewId);
  const input = validateInput(codeRunInputSchema, rawInput);

  return serializableTransaction(prisma, async (transaction) => {
    const { interview, participant } = await authorizeInterview(transaction, identity, interviewId);
    const attachment = await findAttachment(transaction, interviewId, input.interviewQuestionId);
    const language = attachmentLanguage(attachment);
    ensureSupportedLanguage(language);
    if (input.language !== language) {
      throw new ApiError('Run language does not match this interview question.', 'BAD_USER_INPUT');
    }

    const existing = await transaction.codeRun.findUnique({
      where: { id: input.runId },
      include: codeRunInclude,
    });
    if (existing) {
      if (!matchesInput(existing, input, interviewId, participant.id)) {
        throw new ApiError('Run ID already exists with different data.', 'CONFLICT');
      }
      return existing;
    }

    if (interview.status !== InterviewStatus.IN_PROGRESS) {
      throw new ApiError(
        'Code runs can only be recorded during an in-progress interview.',
        'INVALID_STATE',
      );
    }

    await transaction.codeRun.createMany({
      data: [
        {
          id: input.runId,
          interviewId,
          questionId: attachment.questionId,
          codeSnapshot: input.sourceSnapshot,
          status: input.status,
          stdout: input.stdout,
          stderr: input.stderr,
          durationMs: input.durationMs,
          createdByParticipantId: participant.id,
        },
      ],
      skipDuplicates: true,
    });

    const saved = await transaction.codeRun.findUnique({
      where: { id: input.runId },
      include: codeRunInclude,
    });
    if (!saved) throw new ApiError('The code run could not be saved.', 'INTERNAL_SERVER_ERROR');
    if (!matchesInput(saved, input, interviewId, participant.id)) {
      throw new ApiError('Run ID already exists with different data.', 'CONFLICT');
    }
    return saved;
  });
}

export async function listCodeRuns(prisma: PrismaClient, identity: ApiIdentity, rawInput: unknown) {
  const { interviewId, interviewQuestionId, limit, offset } = validateInput(
    codeRunListSchema,
    rawInput,
  );
  const { participant } = await authorizeInterview(prisma, identity, interviewId);
  const attachment = await findAttachment(prisma, interviewId, interviewQuestionId);
  const where: Prisma.CodeRunWhereInput = {
    interviewId,
    questionId: attachment.questionId,
    ...(identity.kind === 'candidate' ? { createdByParticipantId: participant.id } : {}),
  };
  const [items, totalCount] = await prisma.$transaction(
    [
      prisma.codeRun.findMany({
        where,
        include: codeRunInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.codeRun.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return { items, pageInfo: pageInfo(limit, offset, totalCount) };
}
