import type { InterviewFieldsFragment } from '../../shared/api/generated/graphql';

export type InterviewQuestionEntry = InterviewFieldsFragment['questions'][number];

// A historical attachment must never fall back to its mutable reusable Question.
export function getQuestionSnapshot(entry: InterviewQuestionEntry) {
  if (
    entry.snapshotTitle == null ||
    entry.snapshotDescription == null ||
    entry.snapshotDifficulty == null ||
    entry.snapshotLanguage == null ||
    entry.snapshotStarterCode == null ||
    entry.snapshotCapturedAt == null
  ) {
    return null;
  }
  return {
    title: entry.snapshotTitle,
    description: entry.snapshotDescription,
    difficulty: entry.snapshotDifficulty,
    language: entry.snapshotLanguage,
    starterCode: entry.snapshotStarterCode,
  };
}
