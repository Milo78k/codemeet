import {
  MAX_OUTPUT_ENTRIES,
  MAX_OUTPUT_MESSAGE_CHARS,
  MAX_OUTPUT_TOTAL_CHARS,
  OUTPUT_TRUNCATED_MESSAGE,
  type CodeExecutionEntry,
  type CodeExecutionStatus,
} from '../model/execution';

export type OutputBuffer = {
  entries: CodeExecutionEntry[];
  totalChars: number;
  truncated: boolean;
};

export function createOutputBuffer(): OutputBuffer {
  return { entries: [], totalChars: 0, truncated: false };
}

/** Adds one bounded entry and returns the canonical entry that should be sent to the UI. */
export function appendOutputEntry(
  buffer: OutputBuffer,
  entry: CodeExecutionEntry,
): CodeExecutionEntry | null {
  if (buffer.truncated) return null;

  const message = entry.message.slice(0, MAX_OUTPUT_MESSAGE_CHARS);
  const limitedEntry = { level: entry.level, message };
  const canAppend =
    buffer.entries.length < MAX_OUTPUT_ENTRIES &&
    buffer.totalChars + message.length <= MAX_OUTPUT_TOTAL_CHARS;

  if (canAppend) {
    buffer.entries.push(limitedEntry);
    buffer.totalChars += message.length;
    return limitedEntry;
  }

  buffer.truncated = true;
  const marker = { level: 'warn' as const, message: OUTPUT_TRUNCATED_MESSAGE };
  if (
    buffer.entries.length < MAX_OUTPUT_ENTRIES &&
    buffer.totalChars + marker.message.length <= MAX_OUTPUT_TOTAL_CHARS
  ) {
    buffer.entries.push(marker);
    buffer.totalChars += marker.message.length;
    return marker;
  }

  const lastIndex = buffer.entries.length - 1;
  const lastEntry = buffer.entries[lastIndex];
  if (lastEntry) {
    const replacement = {
      level: 'warn' as const,
      message: OUTPUT_TRUNCATED_MESSAGE,
    };
    buffer.totalChars -= lastEntry.message.length;
    buffer.entries[lastIndex] = replacement;
    buffer.totalChars += replacement.message.length;
    return replacement;
  }

  return null;
}

export function createExecutionResult(params: {
  runId: string;
  interviewQuestionId: string;
  status: CodeExecutionStatus;
  entries: CodeExecutionEntry[];
  durationMs: number;
  errorMessage?: string;
}) {
  const errorMessage = params.errorMessage?.slice(0, MAX_OUTPUT_MESSAGE_CHARS);
  const errorEntry =
    errorMessage && (params.status === 'runtime_error' || params.status === 'timeout')
      ? { level: 'error' as const, message: errorMessage }
      : null;
  const entries: CodeExecutionEntry[] = [];
  const logEntryLimit = MAX_OUTPUT_ENTRIES - (errorEntry ? 1 : 0);
  const logCharLimit = MAX_OUTPUT_TOTAL_CHARS - (errorEntry?.message.length ?? 0);
  let totalChars = 0;
  let truncated = false;

  for (const entry of params.entries) {
    const message =
      entry.message.length > MAX_OUTPUT_MESSAGE_CHARS
        ? `${entry.message.slice(0, MAX_OUTPUT_MESSAGE_CHARS - 1)}…`
        : entry.message;
    if (entries.length >= logEntryLimit || totalChars + message.length > logCharLimit) {
      truncated = true;
      break;
    }
    entries.push({ level: entry.level, message });
    totalChars += message.length;
    if (message === OUTPUT_TRUNCATED_MESSAGE) truncated = true;
    if (truncated) break;
  }

  if (truncated && entries.at(-1)?.message !== OUTPUT_TRUNCATED_MESSAGE) {
    while (
      entries.length >= logEntryLimit ||
      totalChars + OUTPUT_TRUNCATED_MESSAGE.length > logCharLimit
    ) {
      const removed = entries.pop();
      if (!removed) break;
      totalChars -= removed.message.length;
    }
    if (
      entries.length < logEntryLimit &&
      totalChars + OUTPUT_TRUNCATED_MESSAGE.length <= logCharLimit
    ) {
      entries.push({ level: 'warn', message: OUTPUT_TRUNCATED_MESSAGE });
      totalChars += OUTPUT_TRUNCATED_MESSAGE.length;
    }
  }
  if (errorEntry) entries.push(errorEntry);
  const boundedEntries = entries;
  const stdout = boundedEntries
    .filter(({ level }) => level === 'log' || level === 'info')
    .map(({ message }) => message);
  const stderr = boundedEntries
    .filter(({ level }) => level === 'warn' || level === 'error')
    .map(({ message }) => message);

  return {
    runId: params.runId,
    interviewQuestionId: params.interviewQuestionId,
    status: params.status,
    entries: boundedEntries,
    stdout,
    stderr,
    durationMs: Math.max(0, Math.round(params.durationMs)),
  } as const;
}
