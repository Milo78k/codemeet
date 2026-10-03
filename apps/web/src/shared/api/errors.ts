import { CombinedGraphQLErrors } from '@apollo/client/errors';

const messages: Record<string, string> = {
  NOT_FOUND: 'This item could not be found. Refresh the page and try again.',
  CONFLICT: 'This change conflicts with existing data. Refresh and try again.',
  INTERNAL_SERVER_ERROR: 'Something went wrong on the server. Please try again.',
  UNAUTHENTICATED:
    'This session is no longer valid. Reopen your invite or contact the interviewer.',
  FORBIDDEN: 'You do not have permission to make this change.',
};

export function getErrorMessage(error: unknown): string {
  if (CombinedGraphQLErrors.is(error)) {
    const first = error.errors[0];
    const code = first?.extensions?.code;
    if (first && (code === 'BAD_USER_INPUT' || code === 'INVALID_STATE')) {
      return first.message;
    }
    if (typeof code === 'string' && messages[code]) {
      return messages[code];
    }
    return 'The request could not be completed. Please try again.';
  }
  return 'Unable to reach CodeMeet. Check your connection and try again.';
}
