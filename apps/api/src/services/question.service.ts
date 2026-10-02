import { Prisma, ProgrammingLanguage, QuestionDifficulty, type PrismaClient } from '@codemeet/db';
import { z } from 'zod';

import { ApiError } from '../graphql/errors.js';
import {
  databaseError,
  idSchema,
  pageInfo,
  paginationSchema,
  titleSchema,
  validateInput,
} from './shared.js';

export const questionInclude = {
  createdBy: true,
} satisfies Prisma.QuestionInclude;

export type QuestionRecord = Prisma.QuestionGetPayload<{
  include: typeof questionInclude;
}>;

const createQuestionSchema = z.object({
  title: titleSchema,
  description: z.string().trim().min(1).max(20_000),
  difficulty: z.enum(QuestionDifficulty),
  language: z.enum(ProgrammingLanguage),
  starterCode: z.string().max(100_000),
});
const updateQuestionSchema = createQuestionSchema
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'At least one field is required.',
  });
const questionListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  difficulty: z.enum(QuestionDifficulty).optional(),
  language: z.enum(ProgrammingLanguage).optional(),
});

export async function listQuestions(prisma: PrismaClient, userId: string, input: unknown) {
  const { limit, offset, search, language, difficulty } = validateInput(questionListSchema, input);
  const where: Prisma.QuestionWhereInput = {
    createdById: userId,
    ...(language ? { language } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, totalCount] = await prisma.$transaction(
    [
      prisma.question.findMany({
        where,
        include: questionInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.question.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return { items, pageInfo: pageInfo(limit, offset, totalCount) };
}

export async function findQuestion(prisma: PrismaClient, userId: string, rawId: unknown) {
  const id = validateInput(idSchema, rawId);
  return prisma.question.findFirst({
    where: { id, createdById: userId },
    include: questionInclude,
  });
}

export async function createQuestion(prisma: PrismaClient, userId: string, input: unknown) {
  const data = validateInput(createQuestionSchema, input);
  try {
    return await prisma.question.create({
      data: { ...data, createdById: userId },
      include: questionInclude,
    });
  } catch (error) {
    databaseError(error);
  }
}

export async function updateQuestion(
  prisma: PrismaClient,
  userId: string,
  rawId: unknown,
  input: unknown,
) {
  const id = validateInput(idSchema, rawId);
  const validated = validateInput(updateQuestionSchema, input);
  // Explicit omission preserves Prisma's strict optional property contract.
  const data: Prisma.QuestionUpdateInput = {};
  if (validated.title !== undefined) data.title = validated.title;
  if (validated.description !== undefined) data.description = validated.description;
  if (validated.difficulty !== undefined) data.difficulty = validated.difficulty;
  if (validated.language !== undefined) data.language = validated.language;
  if (validated.starterCode !== undefined) data.starterCode = validated.starterCode;
  try {
    // Owner scope is part of the update itself, rather than a separate check
    // that could authorize a different record after a concurrent change.
    return await prisma.question.update({
      where: { id, createdById: userId },
      data,
      include: questionInclude,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new ApiError('Question was not found.', 'NOT_FOUND');
    }
    databaseError(error);
  }
}
