export type ParticipantRole = 'INTERVIEWER' | 'CANDIDATE';

export type ParticipantIdentity = {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
};

export type PresenceParticipant = ParticipantIdentity & {
  colorIndex: number;
  color: string;
};

export const participantPalette = [
  '#005f9e',
  '#8a3ffc',
  '#007a5e',
  '#a13b00',
  '#a12668',
  '#5551a8',
] as const;

export function getParticipantColor(participantId: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < participantId.length; index += 1) {
    hash ^= participantId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const colorIndex = (hash >>> 0) % participantPalette.length;
  return { colorIndex, color: participantPalette[colorIndex]! };
}

export function mapParticipantMetadata(value: unknown): ParticipantIdentity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<ParticipantIdentity>;
  if (
    typeof candidate.participantId !== 'string' ||
    candidate.participantId.length === 0 ||
    typeof candidate.displayName !== 'string' ||
    candidate.displayName.trim().length === 0 ||
    (candidate.role !== 'INTERVIEWER' && candidate.role !== 'CANDIDATE')
  ) {
    return null;
  }
  return {
    participantId: candidate.participantId,
    displayName: candidate.displayName.trim(),
    role: candidate.role,
  };
}

export function collectPresenceParticipants(
  localIdentity: ParticipantIdentity | null,
  remoteStates: Iterable<unknown>,
  connected: boolean,
): PresenceParticipant[] {
  if (!connected) return [];
  const participants = new Map<string, ParticipantIdentity>();
  if (localIdentity) participants.set(localIdentity.participantId, localIdentity);
  for (const value of remoteStates) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const participant = mapParticipantMetadata((value as { user?: unknown }).user);
    if (participant && !participants.has(participant.participantId)) {
      participants.set(participant.participantId, participant);
    }
  }
  return [...participants.values()].map((participant) => ({
    ...participant,
    ...getParticipantColor(participant.participantId),
  }));
}
