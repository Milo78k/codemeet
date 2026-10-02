const MAX_ID_LENGTH = 128;

export type CollaborationRoomIdentity = Readonly<{
  interviewId: string;
  interviewQuestionId: string;
}>;

export function createCollaborationRoomId({
  interviewId,
  interviewQuestionId,
}: CollaborationRoomIdentity): string {
  if (!isValidId(interviewId) || !isValidId(interviewQuestionId)) {
    throw new TypeError('Interview and interview question IDs must be non-empty strings.');
  }
  return `interview:${encodeURIComponent(interviewId)}:question:${encodeURIComponent(interviewQuestionId)}`;
}

export function parseCollaborationRoomId(roomId: string): CollaborationRoomIdentity | null {
  const match = /^interview:([^:]+):question:([^:]+)$/.exec(roomId);
  if (!match?.[1] || !match[2]) return null;

  try {
    const identity = {
      interviewId: decodeURIComponent(match[1]),
      interviewQuestionId: decodeURIComponent(match[2]),
    };
    if (!isValidId(identity.interviewId) || !isValidId(identity.interviewQuestionId)) return null;
    return createCollaborationRoomId(identity) === roomId ? identity : null;
  } catch {
    return null;
  }
}

function isValidId(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}
