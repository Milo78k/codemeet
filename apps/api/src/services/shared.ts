import { Prisma, type PrismaClient } from '@codemeet/db';
import { z } from 'zod';

import { ApiError } from '../graphql/errors.js';

export const idSchema = z.string().trim().min(1).max(128);
export const titleSchema = z.string().trim().min(1).max(200);
export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(1_000_000).default(0),
});

export function validateInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'input';
    throw new ApiError(`Invalid ${field}: ${issue?.message ?? 'invalid value'}`, 'BAD_USER_INPUT');
  }
  return result.data;
}

export function pageInfo(limit: number, offset: number, totalCount: number) {
  return { limit, offset, totalCount, hasNextPage: offset + limit < totalCount };
}

export function databaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002' || error.code === 'P2034') {
      throw new ApiError('The operation conflicts with existing data.', 'CONFLICT');
    }
    if (error.code === 'P2025') {
      throw new ApiError('The requested resource was not found.', 'NOT_FOUND');
    }
  }
  throw error;
}

// A bounded retry handles concurrent serializable mutations. Every attempt
// includes its event writes, so a failed attempt cannot leave orphan events.
export async function serializableTransaction<T>(
  prisma: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034' &&
        attempt < 2
      ) {
        continue;
      }
      databaseError(error);
    }
  }
  throw new ApiError('The operation conflicts with another request.', 'CONFLICT');
}
