import {
  InterviewEventType,
  InterviewStatus,
  ParticipantRole,
  type PrismaClient,
} from '@codemeet/db';
import { z } from 'zod';

import { createOpaqueToken, hashOpaqueToken } from '../auth/opaque-token.js';
import { ApiError } from '../graphql/errors.js';
import { idSchema, serializableTransaction, validateInput } from './shared.js';

const INVITE_LIFETIME_MS = 48 * 60 * 60 * 1000;
const PARTICIPANT_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const joinInputSchema = z.object({
  inviteToken: inviteTokenSchema,
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !containsControlCharacters(value)),
});

export type GuestInviteState = 'VALID' | 'EXPIRED' | 'USED' | 'INTERVIEW_FINISHED' | 'INVALID';

export async function createGuestInvite(
  prisma: PrismaClient,
  ownerId: string,
  rawInterviewId: unknown,
) {
  const interviewId = validateInput(idSchema, rawInterviewId);
  const token = createOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS);
  await serializableTransaction(prisma, async (transaction) => {
    const interview = await transaction.interview.findFirst({
      where: { id: interviewId, createdById: ownerId },
      select: { id: true, status: true },
    });
    if (!interview) throw new ApiError('Interview was not found.', 'NOT_FOUND');
    if (
      interview.status !== InterviewStatus.READY &&
      interview.status !== InterviewStatus.IN_PROGRESS
    ) {
      throw new ApiError(
        'An invite can only be created for a prepared interview.',
        'INVALID_STATE',
      );
    }
    await transaction.guestToken.create({
      data: { interviewId, tokenHash: hashOpaqueToken(token), expiresAt },
    });
  });
  return { token, interviewId, expiresAt };
}

export async function inspectGuestInvite(prisma: PrismaClient, rawToken: unknown) {
  const parsed = inviteTokenSchema.safeParse(rawToken);
  if (!parsed.success) return invalidInvite();
  const record = await prisma.guestToken.findUnique({
    where: { tokenHash: hashOpaqueToken(parsed.data) },
    include: { interview: { select: { id: true, title: true, status: true } } },
  });
  if (!record) return invalidInvite();
  const state: GuestInviteState =
    record.interview.status === InterviewStatus.FINISHED
      ? 'INTERVIEW_FINISHED'
      : record.usedAt !== null
        ? 'USED'
        : record.expiresAt.getTime() <= Date.now()
          ? 'EXPIRED'
          : 'VALID';
  return {
    state,
    interviewTitle: record.interview.title,
    expiresAt: record.expiresAt,
  };
}

export async function joinInterview(prisma: PrismaClient, rawInput: unknown) {
  const input = validateInput(joinInputSchema, rawInput);
  const now = new Date();
  const participantSessionToken = createOpaqueToken();
  const participantSessionExpiresAt = new Date(now.getTime() + PARTICIPANT_SESSION_LIFETIME_MS);

  const participant = await serializableTransaction(prisma, async (transaction) => {
    const invite = await transaction.guestToken.findUnique({
      where: { tokenHash: hashOpaqueToken(input.inviteToken) },
      include: { interview: { select: { id: true, status: true } } },
    });
    if (!invite) throw new ApiError('This invite is invalid or no longer available.', 'NOT_FOUND');
    if (invite.usedAt !== null) {
      throw new ApiError('This invite has already been used.', 'CONFLICT');
    }
    if (invite.expiresAt.getTime() <= now.getTime()) {
      throw new ApiError('This invite has expired.', 'INVALID_STATE');
    }
    if (invite.interview.status === InterviewStatus.FINISHED) {
      throw new ApiError('This interview has finished.', 'INVALID_STATE');
    }

    const claimed = await transaction.guestToken.updateMany({
      where: { id: invite.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      throw new ApiError('This invite has already been used.', 'CONFLICT');
    }

    const createdParticipant = await transaction.interviewParticipant.create({
      data: {
        interviewId: invite.interview.id,
        displayName: input.displayName,
        role: ParticipantRole.CANDIDATE,
      },
    });
    await transaction.participantSession.create({
      data: {
        participantId: createdParticipant.id,
        tokenHash: hashOpaqueToken(participantSessionToken),
        expiresAt: participantSessionExpiresAt,
      },
    });
    await transaction.interviewEvent.create({
      data: {
        interviewId: invite.interview.id,
        type: InterviewEventType.CANDIDATE_JOINED,
        payload: { participantId: createdParticipant.id, role: ParticipantRole.CANDIDATE },
      },
    });
    return createdParticipant;
  });

  return {
    interviewId: participant.interviewId,
    participant,
    participantSessionToken,
    participantSessionExpiresAt,
  };
}

function invalidInvite() {
  return { state: 'INVALID' as const, interviewTitle: null, expiresAt: null };
}

function containsControlCharacters(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}
