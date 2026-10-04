import {
  InterviewEventType,
  InterviewStatus,
  ParticipantRole,
  Prisma,
  type PrismaClient,
} from '@codemeet/db';

import { ApiError } from '../graphql/errors.js';
import { idSchema, validateInput } from './shared.js';

const TIMELINE_EVENT_LIMIT = 100;
const VISIBLE_EVENT_TYPES = [
  InterviewEventType.INTERVIEW_STARTED,
  InterviewEventType.QUESTION_CHANGED,
  InterviewEventType.CANDIDATE_JOINED,
  InterviewEventType.INTERVIEW_FINISHED,
];

function payloadId(payload: Prisma.JsonValue, key: string): string | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const value = payload[key];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

export async function getInterviewResults(prisma: PrismaClient, userId: string, rawId: unknown) {
  const id = validateInput(idSchema, rawId);

  return prisma.$transaction(
    async (transaction) => {
      const interview = await transaction.interview.findFirst({
        where: { id, createdById: userId },
        select: {
          id: true,
          title: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          createdBy: { select: { name: true } },
          participants: {
            where: { role: { in: [ParticipantRole.INTERVIEWER, ParticipantRole.CANDIDATE] } },
            orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
            select: { displayName: true, role: true },
          },
          questions: {
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              questionId: true,
              order: true,
              snapshotTitle: true,
              snapshotLanguage: true,
              snapshotDifficulty: true,
            },
          },
        },
      });

      if (!interview) throw new ApiError('Interview was not found.', 'NOT_FOUND');

      const candidateName =
        interview.participants.find(({ role }) => role === ParticipantRole.CANDIDATE)
          ?.displayName ?? null;
      const interviewerName =
        interview.participants.find(({ role }) => role === ParticipantRole.INTERVIEWER)
          ?.displayName ?? interview.createdBy.name;
      const base = {
        id: interview.id,
        title: interview.title,
        status: interview.status,
        startedAt: interview.startedAt,
        finishedAt: interview.finishedAt,
        durationMs:
          interview.startedAt &&
          interview.finishedAt &&
          interview.finishedAt.getTime() >= interview.startedAt.getTime()
            ? interview.finishedAt.getTime() - interview.startedAt.getTime()
            : null,
        candidateName,
        interviewerName,
        totalQuestions: interview.questions.length,
      };

      if (interview.status !== InterviewStatus.FINISHED) {
        return {
          ...base,
          available: false,
          totalRuns: 0,
          questions: [],
          timeline: [],
          hasMoreTimelineEvents: false,
        };
      }

      const [runCounts, eventRows] = await Promise.all([
        transaction.codeRun.groupBy({
          by: ['questionId'],
          where: { interviewId: interview.id },
          _count: { _all: true },
          _max: { createdAt: true },
        }),
        transaction.interviewEvent.findMany({
          where: { interviewId: interview.id, type: { in: VISIBLE_EVENT_TYPES } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: TIMELINE_EVENT_LIMIT + 1,
          select: { id: true, type: true, payload: true, createdAt: true },
        }),
      ]);

      const newestTimestampPerQuestion = runCounts.flatMap((row) =>
        row._max.createdAt ? [{ questionId: row.questionId, createdAt: row._max.createdAt }] : [],
      );
      const latestRunIds = newestTimestampPerQuestion.length
        ? await transaction.codeRun.groupBy({
            by: ['questionId'],
            where: { interviewId: interview.id, OR: newestTimestampPerQuestion },
            _max: { id: true },
          })
        : [];
      const latestRows = latestRunIds.flatMap((row) => (row._max.id ? [row._max.id] : []));
      const latestRuns = latestRows.length
        ? await transaction.codeRun.findMany({
            where: { id: { in: latestRows } },
            select: {
              id: true,
              questionId: true,
              status: true,
              codeSnapshot: true,
              stdout: true,
              stderr: true,
              durationMs: true,
              createdAt: true,
            },
          })
        : [];

      const countsByQuestion = new Map(runCounts.map((row) => [row.questionId, row._count._all]));
      const latestByQuestion = new Map(latestRuns.map((row) => [row.questionId, row]));
      const titleByQuestion = new Map(
        interview.questions.map((question) => [question.questionId, question.snapshotTitle]),
      );
      const questions = interview.questions.map((question) => {
        const latest = latestByQuestion.get(question.questionId);
        return {
          interviewQuestionId: question.id,
          order: question.order,
          snapshotTitle: question.snapshotTitle,
          snapshotLanguage: question.snapshotLanguage,
          snapshotDifficulty: question.snapshotDifficulty,
          runCount: countsByQuestion.get(question.questionId) ?? 0,
          lastRun: latest
            ? {
                id: latest.id,
                status: latest.status,
                sourceSnapshot: latest.codeSnapshot,
                stdout: latest.stdout ?? '',
                stderr: latest.stderr ?? '',
                durationMs: latest.durationMs,
                createdAt: latest.createdAt,
              }
            : null,
        };
      });

      const hasMoreTimelineEvents = eventRows.length > TIMELINE_EVENT_LIMIT;
      const timeline = eventRows
        .slice(0, TIMELINE_EVENT_LIMIT)
        .reverse()
        .map((event) => {
          const questionId =
            event.type === InterviewEventType.INTERVIEW_STARTED
              ? payloadId(event.payload, 'activeQuestionId')
              : event.type === InterviewEventType.QUESTION_CHANGED
                ? payloadId(event.payload, 'questionId')
                : null;
          const previousQuestionId =
            event.type === InterviewEventType.QUESTION_CHANGED
              ? payloadId(event.payload, 'previousQuestionId')
              : null;

          return {
            id: event.id,
            type: event.type,
            createdAt: event.createdAt,
            questionTitle: questionId ? (titleByQuestion.get(questionId) ?? null) : null,
            previousQuestionTitle: previousQuestionId
              ? (titleByQuestion.get(previousQuestionId) ?? null)
              : null,
            participantName:
              event.type === InterviewEventType.CANDIDATE_JOINED ? candidateName : null,
          };
        });

      return {
        ...base,
        available: true,
        totalRuns: runCounts.reduce((total, row) => total + row._count._all, 0),
        questions,
        timeline,
        hasMoreTimelineEvents,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
