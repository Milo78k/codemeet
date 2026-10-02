import { ParticipantRole, type PrismaClient } from '@codemeet/db';

import { hashOpaqueToken, isOpaqueToken } from './opaque-token.js';

export async function findValidParticipantSession(prisma: PrismaClient, rawToken: string) {
  if (!isOpaqueToken(rawToken)) return null;
  const session = await prisma.participantSession.findUnique({
    where: { tokenHash: hashOpaqueToken(rawToken) },
    include: { participant: true },
  });
  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= Date.now() ||
    session.participant.role !== ParticipantRole.CANDIDATE ||
    session.participant.userId !== null
  ) {
    return null;
  }
  return session;
}
