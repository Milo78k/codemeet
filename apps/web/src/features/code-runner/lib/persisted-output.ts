import { MAX_OUTPUT_TOTAL_CHARS } from '../model/execution';

export function serializePersistedOutput(stdout: string[], stderr: string[]) {
  let remaining = MAX_OUTPUT_TOTAL_CHARS;
  const take = (lines: string[]) => {
    const text = lines.join('\n').slice(0, remaining);
    remaining -= text.length;
    return text;
  };

  return { stdout: take(stdout), stderr: take(stderr) };
}
