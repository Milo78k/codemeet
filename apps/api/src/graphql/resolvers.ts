import type { InterviewParticipant, User } from '@codemeet/db';

import {
  addQuestionToInterview,
  createInterview,
  findInterview,
  finishInterview,
  findCandidateInterview,
  listInterviews,
  setActiveQuestion,
  startInterview,
  type InterviewRecord,
} from '../services/interview.service.js';
import {
  createQuestion,
  findQuestion,
  listQuestions,
  updateQuestion,
  type QuestionRecord,
} from '../services/question.service.js';
import {
  createGuestInvite,
  inspectGuestInvite,
  joinInterview,
} from '../services/guest-access.service.js';
import type { ApiContext } from './context.js';

type ResolverArgs = Record<string, unknown>;

export const resolvers = {
  Query: {
    health: () => 'ok',
    guestInvite: (_parent: unknown, args: ResolverArgs, context: ApiContext) =>
      inspectGuestInvite(context.prisma, args.inviteToken),
    currentParticipant: (_parent: unknown, _args: unknown, context: ApiContext) =>
      context.getCurrentParticipant(),
    async questions(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return listQuestions(context.prisma, user.id, args);
    },
    async question(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return findQuestion(context.prisma, user.id, args.id);
    },
    async interviews(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return listInterviews(context.prisma, user.id, args);
    },
    async interview(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const identity = await context.getIdentity();
      if (identity.kind === 'candidate') {
        return findCandidateInterview(context.prisma, identity.participant.id, args.id);
      }
      return findInterview(context.prisma, identity.user.id, args.id);
    },
  },
  Mutation: {
    async createGuestInvite(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return createGuestInvite(context.prisma, user.id, args.interviewId);
    },
    async joinInterview(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      return joinInterview(context.prisma, args);
    },
    async createQuestion(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return createQuestion(context.prisma, user.id, args.input);
    },
    async updateQuestion(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return updateQuestion(context.prisma, user.id, args.id, args.input);
    },
    async createInterview(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return createInterview(context.prisma, user, args.input);
    },
    async addQuestionToInterview(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return addQuestionToInterview(context.prisma, user.id, args);
    },
    async setActiveQuestion(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      const result = await setActiveQuestion(context.prisma, user.id, args);
      if (result.changed) {
        context.publishSessionEvent({
          type: 'ACTIVE_QUESTION_CHANGED',
          interviewId: result.interview.id,
          occurredAt: new Date().toISOString(),
        });
      }
      return result.interview;
    },
    async startInterview(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      return startInterview(context.prisma, user.id, args.interviewId);
    },
    async finishInterview(_parent: unknown, args: ResolverArgs, context: ApiContext) {
      const user = await context.getCurrentUser();
      const interview = await finishInterview(context.prisma, user.id, args.interviewId);
      context.publishSessionEvent({
        type: 'INTERVIEW_FINISHED',
        interviewId: interview.id,
        occurredAt: new Date().toISOString(),
      });
      return interview;
    },
  },
  User: {
    createdAt: (user: User) => user.createdAt.toISOString(),
    updatedAt: (user: User) => user.updatedAt.toISOString(),
  },
  Question: {
    createdAt: (question: QuestionRecord) => question.createdAt.toISOString(),
    updatedAt: (question: QuestionRecord) => question.updatedAt.toISOString(),
  },
  Interview: {
    createdBy: (interview: InterviewRecord, _args: unknown, context: ApiContext) =>
      context
        .getCurrentParticipant()
        .then((participant) => (participant ? null : interview.createdBy)),
    participants: (interview: InterviewRecord, _args: unknown, context: ApiContext) =>
      context
        .getCurrentParticipant()
        .then((participant) =>
          participant
            ? interview.participants.filter(({ id }) => id === participant.id)
            : interview.participants,
        ),
    questions: (interview: InterviewRecord, _args: unknown, context: ApiContext) =>
      context
        .getCurrentParticipant()
        .then((participant) =>
          participant && interview.activeQuestionId
            ? interview.questions.filter(
                ({ questionId }) => questionId === interview.activeQuestionId,
              )
            : participant
              ? []
              : interview.questions,
        ),
    activeQuestion: (interview: InterviewRecord, _args: unknown, context: ApiContext) =>
      context.getCurrentParticipant().then((participant) => {
        if (!participant || !interview.activeQuestionId) return interview.activeQuestion;
        const attachment = interview.questions.find(
          ({ questionId }) => questionId === interview.activeQuestionId,
        );
        return attachment ? candidateQuestionSnapshot(attachment) : null;
      }),
    startedAt: (interview: InterviewRecord) => interview.startedAt?.toISOString() ?? null,
    finishedAt: (interview: InterviewRecord) => interview.finishedAt?.toISOString() ?? null,
    createdAt: (interview: InterviewRecord) => interview.createdAt.toISOString(),
    updatedAt: (interview: InterviewRecord) => interview.updatedAt.toISOString(),
  },
  InterviewParticipant: {
    interviewId: (participant: InterviewRecord['participants'][number]) => participant.interviewId,
    joinedAt: (participant: InterviewParticipant) => participant.joinedAt.toISOString(),
    user: (
      participant:
        InterviewRecord['participants'][number] | (InterviewParticipant & { user?: User | null }),
      _args: unknown,
      context: ApiContext,
    ) =>
      context
        .getCurrentParticipant()
        .then((current) => (current ? null : 'user' in participant ? participant.user : null)),
  },
  InterviewQuestion: {
    question: (
      attachment: InterviewRecord['questions'][number],
      _args: unknown,
      context: ApiContext,
    ) =>
      context
        .getCurrentParticipant()
        .then((participant) =>
          participant ? candidateQuestionSnapshot(attachment) : attachment.question,
        ),
    snapshotCapturedAt: (question: InterviewRecord['questions'][number]) =>
      question.snapshotCapturedAt?.toISOString() ?? null,
  },
  GuestInvite: {
    expiresAt: (invite: { expiresAt: Date }) => invite.expiresAt.toISOString(),
  },
  GuestInvitePreview: {
    expiresAt: (invite: { expiresAt: Date | null }) => invite.expiresAt?.toISOString() ?? null,
  },
  JoinInterviewPayload: {
    participantSessionExpiresAt: (payload: { participantSessionExpiresAt: Date }) =>
      payload.participantSessionExpiresAt.toISOString(),
  },
};

function candidateQuestionSnapshot(attachment: InterviewRecord['questions'][number]) {
  const capturedAt = attachment.snapshotCapturedAt ?? new Date(0);
  return {
    id: attachment.questionId,
    title: attachment.snapshotTitle ?? 'Snapshot unavailable',
    description: attachment.snapshotDescription ?? '',
    difficulty: attachment.snapshotDifficulty ?? 'EASY',
    language: attachment.snapshotLanguage ?? 'JAVASCRIPT',
    starterCode: attachment.snapshotStarterCode ?? '',
    createdBy: null,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}
