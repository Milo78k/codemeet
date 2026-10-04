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

export function formatDateTime(
  value: string | null | undefined,
  style: 'full' | 'compact' = 'full',
) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const options: Intl.DateTimeFormatOptions =
    style === 'compact'
      ? {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3,
          hourCycle: 'h23',
        }
      : { dateStyle: 'medium', timeStyle: 'medium' };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatDuration(durationMs: number | null | undefined) {
  if (
    durationMs === null ||
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return '—';
  }
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;

  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  return minutes > 0 ? `${minutes} min ${seconds} sec` : `${seconds} sec`;
}
