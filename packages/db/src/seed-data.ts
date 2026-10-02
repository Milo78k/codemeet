import type { PrismaClient } from './generated/client.js';
import {
  InterviewEventType,
  InterviewStatus,
  ParticipantRole,
  ProgrammingLanguage,
  QuestionDifficulty,
} from './generated/enums.js';

export const DEMO_USER_EMAIL = 'demo@codemeet.local';

const DEMO_INTERVIEW_ID = 'demo-interview';
const DEMO_QUESTIONS = [
  {
    id: 'demo-question-two-sum',
    title: 'Two Sum',
    description:
      'Given an array of numbers and a target, return the indices of two distinct elements whose sum equals the target.',
    difficulty: QuestionDifficulty.EASY,
    language: ProgrammingLanguage.JAVASCRIPT,
    starterCode: 'export function twoSum(nums, target) {\n  // Return two indices.\n}\n',
  },
  {
    id: 'demo-question-group-by',
    title: 'Group By',
    description:
      'Implement a type-safe groupBy helper that groups items by the key returned by a callback.',
    difficulty: QuestionDifficulty.MEDIUM,
    language: ProgrammingLanguage.TYPESCRIPT,
    starterCode:
      'export function groupBy<T, K extends PropertyKey>(\n  items: T[],\n  getKey: (item: T) => K,\n): Record<K, T[]> {\n  // Group items by key.\n  throw new Error("Not implemented");\n}\n',
  },
  {
    id: 'demo-question-react-counter',
    title: 'React Counter',
    description:
      'Build a React counter with increment and decrement buttons. The counter must never drop below zero.',
    difficulty: QuestionDifficulty.EASY,
    language: ProgrammingLanguage.REACT_TSX,
    starterCode:
      'import { useState } from "react";\n\nexport function Counter() {\n  const [count, setCount] = useState(0);\n  return <section>{count}</section>;\n}\n',
  },
] as const;

export async function seedDatabase(client: PrismaClient): Promise<void> {
  await client.$transaction(async (transaction) => {
    const user = await transaction.user.upsert({
      where: { email: DEMO_USER_EMAIL },
      update: {},
      create: {
        id: 'demo-user',
        name: 'Demo Interviewer',
        email: DEMO_USER_EMAIL,
      },
    });

    for (const question of DEMO_QUESTIONS) {
      await transaction.question.upsert({
        where: { id: question.id },
        update: {},
        create: { ...question, createdById: user.id },
      });
    }

    // All demo interview children are created only with the interview itself.
    // Re-seeding never resets its state or changes tasks after a user edits it.
    await transaction.interview.upsert({
      where: { id: DEMO_INTERVIEW_ID },
      update: {},
      create: {
        id: DEMO_INTERVIEW_ID,
        title: 'Demo technical interview',
        status: InterviewStatus.DRAFT,
        createdById: user.id,
        participants: {
          create: {
            id: 'demo-interviewer-participant',
            userId: user.id,
            displayName: user.name,
            role: ParticipantRole.INTERVIEWER,
          },
        },
        questions: {
          create: [
            { id: 'demo-interview-question-1', questionId: DEMO_QUESTIONS[0].id, order: 0 },
            { id: 'demo-interview-question-2', questionId: DEMO_QUESTIONS[1].id, order: 1 },
          ],
        },
        events: {
          create: {
            id: 'demo-interview-created-event',
            type: InterviewEventType.INTERVIEW_CREATED,
            payload: { createdById: user.id },
          },
        },
      },
    });
  });
}
