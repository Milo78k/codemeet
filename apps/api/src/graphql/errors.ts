import { GraphQLError } from 'graphql';

export type ApiErrorCode =
  | 'BAD_USER_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'INTERNAL_SERVER_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN';

// Only errors constructed at this boundary may expose messages to clients.
export class ApiError extends GraphQLError {
  constructor(message: string, code: ApiErrorCode) {
    super(message, { extensions: { code } });
  }
}

export function maskApiError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof GraphQLError) {
    if (error.originalError instanceof ApiError) return error;
    // Parser / schema validation errors contain no database internals.
    if (!error.originalError && !error.path) return error;
  }

  return new GraphQLError('An internal server error occurred.', {
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  });
}
