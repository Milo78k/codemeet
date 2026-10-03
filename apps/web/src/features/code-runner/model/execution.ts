import type { ProgrammingLanguage } from '../../../shared/api/generated/graphql';

export const CODE_RUN_TIMEOUT_MS = 5_000;
export const MAX_CODE_SOURCE_CHARS = 100_000;
export const MAX_OUTPUT_ENTRIES = 100;
export const MAX_OUTPUT_MESSAGE_CHARS = 2_000;
export const MAX_OUTPUT_TOTAL_CHARS = 20_000;
export const OUTPUT_TRUNCATED_MESSAGE = '[output truncated]';

export const codeRunnerSupportedLanguages = new Set<ProgrammingLanguage>([
  'JAVASCRIPT',
  'TYPESCRIPT',
]);

export type CodeExecutionStatus =
  'success' | 'runtime_error' | 'timeout' | 'unsupported' | 'cancelled';

export type CodeExecutionLogLevel = 'log' | 'info' | 'warn' | 'error';

export type CodeExecutionEntry = {
  level: CodeExecutionLogLevel;
  message: string;
};

export type CodeExecutionResult = {
  runId: string;
  interviewQuestionId: string;
  status: CodeExecutionStatus;
  entries: CodeExecutionEntry[];
  stdout: string[];
  stderr: string[];
  durationMs: number;
};

export type CodeRunnerInput = {
  interviewQuestionId: string;
  language: ProgrammingLanguage;
  source: string;
};

export type RunnerRequestMessage = CodeRunnerInput & {
  type: 'run';
  runId: string;
};

export type RunnerLogMessage = {
  type: 'log';
  runId: string;
  interviewQuestionId: string;
  entry: CodeExecutionEntry;
};

export type RunnerCompleteMessage = {
  type: 'complete';
  runId: string;
  interviewQuestionId: string;
  status: 'success' | 'runtime_error';
  errorMessage?: string;
  durationMs: number;
};

export type RunnerResponseMessage = RunnerLogMessage | RunnerCompleteMessage;

export function isCodeRunnerLanguageSupported(language: ProgrammingLanguage): boolean {
  return codeRunnerSupportedLanguages.has(language);
}
