import type {
  InterviewStatus,
  ProgrammingLanguage,
  QuestionDifficulty,
} from '../api/generated/graphql';
export const languageLabels: Record<ProgrammingLanguage, string> = {
  JAVASCRIPT: 'JavaScript',
  TYPESCRIPT: 'TypeScript',
  REACT_TSX: 'React / TSX',
};
export const difficultyLabels: Record<QuestionDifficulty, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};
export const statusLabels: Record<InterviewStatus, string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  IN_PROGRESS: 'In progress',
  FINISHED: 'Finished',
};
export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
