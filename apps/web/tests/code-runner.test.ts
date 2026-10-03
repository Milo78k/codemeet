import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { MessageChannel as NodeMessageChannel, Worker as NodeWorker } from 'node:worker_threads';
import type { MessagePort as NodeMessagePort } from 'node:worker_threads';

import {
  CODE_RUN_TIMEOUT_MS,
  MAX_OUTPUT_ENTRIES,
  MAX_OUTPUT_MESSAGE_CHARS,
  MAX_OUTPUT_TOTAL_CHARS,
  OUTPUT_TRUNCATED_MESSAGE,
  type RunnerRequestMessage,
  type RunnerResponseMessage,
} from '@/features/code-runner/model/execution';
import { CodeRunner } from '@/features/code-runner/lib/CodeRunner';
import { appendOutputEntry, createOutputBuffer } from '@/features/code-runner/lib/output';
import { formatConsoleArguments } from '@/features/code-runner/lib/serialize';
import { transformExecutableSource } from '@/features/code-runner/lib/transpile';

import { installTestCodeRunner, TestCodeRunnerWorker } from './support/code-runner';

class NodeWorkerAdapter {
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminateCount = 0;
  request: RunnerRequestMessage | undefined;
  private readonly worker = new NodeWorker(
    new URL('./support/code-runner-node-worker.mjs', import.meta.url),
  );

  constructor() {
    this.worker.on('error', (error) => {
      this.onerror?.({ message: error.message, preventDefault: () => {} } as ErrorEvent);
    });
  }

  postMessage(message: RunnerRequestMessage, transfer: Transferable[]) {
    this.request = message;
    const port = transfer[0];
    if (!(port instanceof NodeMessagePortAdapter))
      throw new Error('The execution port was not transferred.');
    this.worker.postMessage({ request: message, port: port.nativePort }, [port.nativePort]);
  }

  terminate() {
    this.terminateCount += 1;
    void this.worker.terminate();
  }
}

class NodeMessagePortAdapter {
  onmessage: ((event: MessageEvent<RunnerResponseMessage>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  constructor(readonly nativePort: NodeMessagePort) {
    nativePort.on('message', (data) => {
      this.onmessage?.({ data } as MessageEvent<RunnerResponseMessage>);
    });
    nativePort.on('messageerror', (error) => {
      this.onmessageerror?.({ data: error } as MessageEvent);
    });
  }

  start() {
    this.nativePort.start();
  }

  close() {
    this.nativePort.close();
  }
}

function createRealWorkerRunner(timeoutMs = CODE_RUN_TIMEOUT_MS) {
  const workers: NodeWorkerAdapter[] = [];
  let nextRunId = 0;
  const runner = new CodeRunner({
    createWorker: () => {
      const worker = new NodeWorkerAdapter();
      workers.push(worker);
      return worker;
    },
    createChannel: () => {
      const channel = new NodeMessageChannel();
      return {
        port1: new NodeMessagePortAdapter(channel.port1),
        port2: new NodeMessagePortAdapter(channel.port2),
      };
    },
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancelSchedule: (timer) => window.clearTimeout(timer),
    timeoutMs,
    now: () => performance.now(),
    createRunId: () => `worker-run-${++nextRunId}`,
  });
  return { runner, workers };
}

const questionId = 'question-a';

describe('browser code runner controller', () => {
  let restoreRunner: (() => void) | undefined;

  afterEach(() => {
    restoreRunner?.();
    restoreRunner = undefined;
    jest.useRealTimers();
  });

  test('runs one immutable source snapshot and keeps logs in arrival order', async () => {
    restoreRunner = installTestCodeRunner();
    const runner = new CodeRunner();
    const input = {
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT' as const,
      source: 'const value = 1;',
    };
    const handle = runner.start(input);
    const worker = TestCodeRunnerWorker.instances[0];
    if (!worker?.request) throw new Error('The execution worker did not receive its snapshot.');

    input.source = 'const value = 2;';
    expect(worker.request.source).toBe('const value = 1;');
    worker.emit({
      type: 'log',
      runId: handle.runId,
      interviewQuestionId: questionId,
      entry: { level: 'log', message: 'first' },
    });
    worker.emit({
      type: 'log',
      runId: handle.runId,
      interviewQuestionId: questionId,
      entry: { level: 'info', message: 'second' },
    });
    worker.complete();

    await expect(handle.promise).resolves.toMatchObject({
      status: 'success',
      stdout: ['first', 'second'],
      entries: [
        { level: 'log', message: 'first' },
        { level: 'info', message: 'second' },
      ],
    });
    expect(worker.terminateCount).toBe(1);
  });

  test('normalizes runtime errors into stderr and retires the worker', async () => {
    restoreRunner = installTestCodeRunner();
    const runner = new CodeRunner();
    const handle = runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source: 'throw new Error("boom")',
    });
    const worker = TestCodeRunnerWorker.instances[0];
    worker?.complete('runtime_error', 'Error: boom');

    await expect(handle.promise).resolves.toMatchObject({
      status: 'runtime_error',
      stderr: ['Error: boom'],
    });
    expect(worker?.terminateCount).toBe(1);
  });

  test('a deadline terminates the worker instead of only racing its promise', async () => {
    restoreRunner = installTestCodeRunner();
    jest.useFakeTimers();
    const runner = new CodeRunner();
    const handle = runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source: 'while (true) {}',
    });
    const worker = TestCodeRunnerWorker.instances[0];

    await jest.advanceTimersByTimeAsync(5_000);
    await expect(handle.promise).resolves.toMatchObject({ status: 'timeout' });
    expect(worker?.terminateCount).toBe(1);
  });

  test('cancels one question run before starting another and ignores its late messages', async () => {
    restoreRunner = installTestCodeRunner();
    const runner = new CodeRunner();
    const first = runner.start({
      interviewQuestionId: 'question-a',
      language: 'JAVASCRIPT',
      source: 'console.log("A")',
    });
    const firstWorker = TestCodeRunnerWorker.instances[0];
    const second = runner.start({
      interviewQuestionId: 'question-b',
      language: 'JAVASCRIPT',
      source: 'console.log("B")',
    });
    const secondWorker = TestCodeRunnerWorker.instances[1];

    await expect(first.promise).resolves.toMatchObject({ status: 'cancelled' });
    expect(firstWorker?.terminateCount).toBe(1);
    firstWorker?.complete();
    secondWorker?.complete();
    await expect(second.promise).resolves.toMatchObject({
      status: 'success',
      interviewQuestionId: 'question-b',
    });
  });

  test('returns an explicit unsupported result for React TSX', async () => {
    restoreRunner = installTestCodeRunner();
    const runner = new CodeRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'REACT_TSX',
      source: 'export function App() { return <div />; }',
    }).promise;

    expect(result.status).toBe('unsupported');
    expect(result.stderr[0]).toMatch(/React TSX/i);
    expect(TestCodeRunnerWorker.instances).toHaveLength(0);
  });
});

describe('actual execution worker runtime', () => {
  test('executes the seeded JavaScript starter with exports inside the actual worker', async () => {
    const { runner, workers } = createRealWorkerRunner();
    const source =
      'export function twoSum(nums, target) {\n  // Return two indices.\n}\nconsole.log("hello");';
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source,
    }).promise;

    expect(workers[0]?.request?.source).toBe(source);
    expect(result).toMatchObject({ status: 'success', stdout: ['hello'] });
  });

  test('executes JavaScript and captures multiple console calls in order', async () => {
    const { runner, workers } = createRealWorkerRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source: 'console.log("hello"); console.info(42); console.warn("careful");',
    }).promise;

    expect(result.status).toBe('success');
    expect(result.stdout).toEqual(['hello', '42']);
    expect(result.stderr).toEqual(['careful']);
    expect(result.entries.map(({ message }) => message)).toEqual(['hello', '42', 'careful']);
    expect(workers[0]?.terminateCount).toBe(1);
  });

  test('normalizes a thrown user error instead of a module parser error', async () => {
    const { runner } = createRealWorkerRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source: 'throw new Error("boom");',
    }).promise;

    expect(result.status).toBe('runtime_error');
    expect(result.stderr[0]).toBe('Error: boom');
  });

  test('safely serializes a circular object in the actual worker', async () => {
    const { runner } = createRealWorkerRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source: 'const value = {}; value.self = value; console.log(value);',
    }).promise;

    expect(result.status).toBe('success');
    expect(result.stdout[0]).toContain('[Circular]');
  });

  test('normalizes a JavaScript syntax error instead of leaking a parser failure', async () => {
    const { runner } = createRealWorkerRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source: 'const value = ;',
    }).promise;

    expect(result.status).toBe('runtime_error');
    expect(result.stderr[0]).toMatch(/^SyntaxError:/);
    expect(result.stderr[0]).not.toContain('export');
  });

  test('terminates an actual infinite-loop worker at the configured deadline', async () => {
    const { runner, workers } = createRealWorkerRunner(100);
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source: 'while (true) {}',
    }).promise;

    expect(result.status).toBe('timeout');
    expect(result.stderr[0]).toContain('0.1 seconds');
    expect(workers[0]?.terminateCount).toBe(1);
  });

  test('transpiles and runs TypeScript in the worker without claiming type-checking', async () => {
    const { runner } = createRealWorkerRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'TYPESCRIPT',
      source: 'const value: number = 42; console.log(value);',
    }).promise;

    expect(result).toMatchObject({ status: 'success', stdout: ['42'] });
  });

  test('executes the seeded TypeScript starter export inside the actual worker', async () => {
    const { runner } = createRealWorkerRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'TYPESCRIPT',
      source:
        'export function groupBy<T, K extends PropertyKey>(items: T[], getKey: (item: T) => K): Record<K, T[]> { return {} as Record<K, T[]>; }\nconsole.log("typed");',
    }).promise;

    expect(result).toMatchObject({ status: 'success', stdout: ['typed'] });
  });

  test('reports TypeScript syntax errors as runtime output', async () => {
    const { runner } = createRealWorkerRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'TYPESCRIPT',
      source: 'const broken: = ;',
    }).promise;

    expect(result.status).toBe('runtime_error');
    expect(result.stderr[0]).toContain('TS');
  });

  test('caps actual worker output and marks the truncation', async () => {
    const { runner } = createRealWorkerRunner();
    const result = await runner.start({
      interviewQuestionId: questionId,
      language: 'JAVASCRIPT',
      source: 'for (let index = 0; index < 110; index += 1) console.log(index);',
    }).promise;

    expect(result.status).toBe('success');
    expect(result.entries).toHaveLength(MAX_OUTPUT_ENTRIES);
    expect(result.entries.at(-1)?.message).toBe(OUTPUT_TRUNCATED_MESSAGE);
  });
});

describe('runner output helpers', () => {
  test('caps message length, total output and entry count with one truncation marker', () => {
    const buffer = createOutputBuffer();
    const first = appendOutputEntry(buffer, {
      level: 'log',
      message: 'x'.repeat(MAX_OUTPUT_MESSAGE_CHARS + 1),
    });
    expect(first?.message).toHaveLength(MAX_OUTPUT_MESSAGE_CHARS);

    for (let index = 0; index < MAX_OUTPUT_ENTRIES + 5; index += 1) {
      appendOutputEntry(buffer, { level: 'log', message: 'x'.repeat(MAX_OUTPUT_MESSAGE_CHARS) });
    }
    expect(buffer.entries.length).toBeLessThanOrEqual(MAX_OUTPUT_ENTRIES);
    expect(buffer.totalChars).toBeLessThanOrEqual(MAX_OUTPUT_TOTAL_CHARS);
    expect(buffer.entries.at(-1)?.message).toBe(OUTPUT_TRUNCATED_MESSAGE);
    expect(
      buffer.entries.filter(({ message }) => message === OUTPUT_TRUNCATED_MESSAGE),
    ).toHaveLength(1);
  });

  test('formats normal values, Error, undefined and circular objects safely', () => {
    const circular: { value: number; self?: unknown } = { value: 42 };
    circular.self = circular;

    expect(
      formatConsoleArguments(['hello', 42, null, undefined, new Error('boom'), [1, 2], circular]),
    ).toContain('[Circular]');
    expect(formatConsoleArguments([new Error('boom')])).toBe('Error: boom');
    expect(formatConsoleArguments([undefined])).toBe('undefined');
  });

  test('keeps plain JavaScript unchanged and without module markers', async () => {
    const source = 'console.log("hello");';
    await expect(transformExecutableSource('JAVASCRIPT', source)).resolves.toEqual({
      ok: true,
      code: source,
      format: 'script',
    });
  });

  test('lowers JavaScript starter exports without emitting ESM markers', async () => {
    const source = 'export function twoSum(nums, target) { return [0, 1]; }';
    const transformed = await transformExecutableSource('JAVASCRIPT', source);

    expect(transformed).toMatchObject({ ok: true, format: 'commonjs' });
    if (!transformed.ok) throw new Error(transformed.error);
    expect(transformed.code).toContain('exports.twoSum');
    expect(transformed.code).not.toMatch(/\bexport\b|\bimport\s/);
  });

  test('rejects static module imports with an explicit unsupported message', async () => {
    await expect(
      transformExecutableSource('JAVASCRIPT', 'import { helper } from "./helper.js";'),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('imports and external packages are not supported'),
    });
  });

  test('transpiles TypeScript without synthetic import/export markers', async () => {
    const transformed = await transformExecutableSource(
      'TYPESCRIPT',
      'const value: number = 42; console.log(value);',
    );

    expect(transformed).toMatchObject({ ok: true, format: 'script' });
    if (!transformed.ok) throw new Error(transformed.error);
    expect(transformed.code).toContain('value');
    expect(transformed.code).not.toMatch(/\bexport\b|\bimport\s/);
  });

  test('transpiles TypeScript and turns syntax diagnostics into readable errors', async () => {
    await expect(
      transformExecutableSource('TYPESCRIPT', 'const answer: number = 42;'),
    ).resolves.toMatchObject({
      ok: true,
      code: expect.stringContaining('answer'),
    });
    await expect(
      transformExecutableSource('TYPESCRIPT', 'const broken: = ;'),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('TS'),
    });
  });
});
