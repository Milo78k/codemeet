import type { ProgrammingLanguage } from '../../../shared/api/generated/graphql';

const languages = {
  JAVASCRIPT: { language: 'javascript', extension: 'js' },
  TYPESCRIPT: { language: 'typescript', extension: 'ts' },
  REACT_TSX: { language: 'typescript', extension: 'tsx' },
} as const satisfies Record<ProgrammingLanguage, { language: string; extension: string }>;

export function getMonacoLanguage(language: ProgrammingLanguage) {
  return languages[language].language;
}

export function getModelUri(
  interviewId: string,
  interviewQuestionId: string,
  language: ProgrammingLanguage,
) {
  return `codemeet://interview/${encodeURIComponent(interviewId)}/question/${encodeURIComponent(interviewQuestionId)}/main.${languages[language].extension}`;
}
