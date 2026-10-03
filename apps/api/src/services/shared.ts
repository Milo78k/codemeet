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

function isSerializableConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
  if (!error || typeof error !== 'object') return false;

  const adapterError = error as { name?: unknown; cause?: unknown };
  const cause = adapterError.cause;
  return (
    adapterError.name === 'DriverAdapterError' &&
    typeof cause === 'object' &&
    cause !== null &&
    'kind' in cause &&
    cause.kind === 'TransactionWriteConflict'
  );
}

export function databaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new ApiError('The operation conflicts with existing data.', 'CONFLICT');
    }
    if (error.code === 'P2025') {
      throw new ApiError('The requested resource was not found.', 'NOT_FOUND');
    }
  }
  if (isSerializableConflict(error)) {
    throw new ApiError('The operation conflicts with existing data.', 'CONFLICT');
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
      // Prisma's PostgreSQL driver adapter reports SQLSTATE 40001/40P01 as
      // DriverAdapterError(TransactionWriteConflict), instead of P2034.
      if (isSerializableConflict(error) && attempt < 2) {
        continue;
      }
      databaseError(error);
    }
  }
  throw new ApiError('The operation conflicts with another request.', 'CONFLICT');
}
