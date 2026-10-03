import {
  CODE_RUN_TIMEOUT_MS,
  MAX_CODE_SOURCE_CHARS,
  type CodeExecutionEntry,
  type CodeExecutionResult,
  type CodeExecutionStatus,
  type CodeRunnerInput,
  type RunnerRequestMessage,
  type RunnerResponseMessage,
} from '../model/execution';
import { appendOutputEntry, createExecutionResult } from './output';

type MessagePortLike = {
  onmessage: ((event: MessageEvent<RunnerResponseMessage>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  start: () => void;
  close: () => void;
};

type WorkerLike = {
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: RunnerRequestMessage, transfer: Transferable[]) => void;
  terminate: () => void;
};

export type CodeRunnerEnvironment = {
  createWorker: () => WorkerLike;
  createChannel: () => { port1: MessagePortLike; port2: MessagePortLike };
  schedule: (callback: () => void, delayMs: number) => number;
  cancelSchedule: (timer: number) => void;
  timeoutMs: number;
  now: () => number;
  createRunId: () => string;
};

export type CodeRunHandle = {
  runId: string;
  promise: Promise<CodeExecutionResult>;
  cancel: () => void;
};

type ActiveRun = {
  input: CodeRunnerInput;
  runId: string;
  startedAt: number;
  entries: CodeExecutionEntry[];
  totalChars: number;
  truncated: boolean;
  worker: WorkerLike;
  parentPort: MessagePortLike;
  workerPort: MessagePortLike;
  timer: number;
  resolve: (result: CodeExecutionResult) => void;
};

let runSequence = 0;

function createBrowserEnvironment(): CodeRunnerEnvironment {
  return {
    createWorker: () =>
      new Worker('/code-runner/runner.worker.js', {
        name: 'codemeet-code-runner',
        type: 'module',
      }),
    createChannel: () => new MessageChannel(),
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancelSchedule: (timer) => window.clearTimeout(timer),
    timeoutMs: CODE_RUN_TIMEOUT_MS,
    now: () => performance.now(),
    createRunId: () => {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      runSequence += 1;
      return `local-run-${Date.now()}-${runSequence}`;
    },
  };
}

function unsupportedResult(input: CodeRunnerInput, runId: string, message: string) {
  return createExecutionResult({
    runId,
    interviewQuestionId: input.interviewQuestionId,
    status: 'unsupported',
    entries: [{ level: 'warn', message }],
    durationMs: 0,
  });
}

export class CodeRunner {
  private readonly environment: CodeRunnerEnvironment;
  private active: ActiveRun | null = null;

  constructor(environment: CodeRunnerEnvironment = createBrowserEnvironment()) {
    this.environment = environment;
  }

  start(input: CodeRunnerInput): CodeRunHandle {
    this.cancel();
    const runId = this.environment.createRunId();
    const snapshot = { ...input, source: String(input.source) };

    if (snapshot.language !== 'JAVASCRIPT' && snapshot.language !== 'TYPESCRIPT') {
      return {
        runId,
        promise: Promise.resolve(
          unsupportedResult(snapshot, runId, 'Execution for React TSX is not supported yet.'),
        ),
        cancel: () => {},
      };
    }
    if (snapshot.source.length > MAX_CODE_SOURCE_CHARS) {
      return {
        runId,
        promise: Promise.resolve(
          unsupportedResult(
            snapshot,
            runId,
            `Source exceeds the ${MAX_CODE_SOURCE_CHARS.toLocaleString()} character limit.`,
          ),
        ),
        cancel: () => {},
      };
    }

    let resolve!: (result: CodeExecutionResult) => void;
    const promise = new Promise<CodeExecutionResult>((done) => {
      resolve = done;
    });

    let worker: WorkerLike | null = null;
    let channel: ReturnType<CodeRunnerEnvironment['createChannel']> | null = null;
    let timer: number | null = null;
    try {
      worker = this.environment.createWorker();
      channel = this.environment.createChannel();
      const startedAt = this.environment.now();
      timer = this.environment.schedule(
        () =>
          this.finish(
            runId,
            'timeout',
            `Execution timed out after ${this.environment.timeoutMs / 1_000} seconds.`,
          ),
        this.environment.timeoutMs,
      );
      const active: ActiveRun = {
        input: snapshot,
        runId,
        startedAt,
        entries: [],
        totalChars: 0,
        truncated: false,
        worker,
        parentPort: channel.port1,
        workerPort: channel.port2,
        timer,
        resolve,
      };
      this.active = active;

      channel.port1.onmessage = ({ data }) => this.receive(runId, data);
      channel.port1.onmessageerror = () =>
        this.finish(runId, 'runtime_error', 'The execution result could not be read.');
      channel.port1.start();
      worker.onerror = (event) => {
        event.preventDefault();
        this.finish(runId, 'runtime_error', event.message || 'The browser worker failed.');
      };
      worker.postMessage({ type: 'run', runId, ...snapshot }, [
        channel.port2 as unknown as Transferable,
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The browser worker could not start.';
      if (this.active?.runId === runId) {
        this.finish(runId, 'runtime_error', message);
      } else {
        if (timer !== null) this.environment.cancelSchedule(timer);
        channel?.port1.close();
        channel?.port2.close();
        worker?.terminate();
        resolve(
          createExecutionResult({
            runId,
            interviewQuestionId: snapshot.interviewQuestionId,
            status: 'runtime_error',
            entries: [],
            errorMessage: message,
            durationMs: 0,
          }),
        );
      }
    }

    return { runId, promise, cancel: () => this.cancelRun(runId) };
  }

  cancel(): void {
    if (this.active) this.finish(this.active.runId, 'cancelled');
  }

  dispose(): void {
    this.cancel();
  }

  private receive(runId: string, message: RunnerResponseMessage): void {
    const active = this.active;
    if (!active || active.runId !== runId) return;
    if (
      !message ||
      message.runId !== active.runId ||
      message.interviewQuestionId !== active.input.interviewQuestionId
    )
      return;

    if (message.type === 'log') {
      const buffer = {
        entries: active.entries,
        totalChars: active.totalChars,
        truncated: active.truncated,
      };
      appendOutputEntry(buffer, message.entry);
      active.totalChars = buffer.totalChars;
      active.truncated = buffer.truncated;
      return;
    }

    this.finish(runId, message.status, message.errorMessage, message.durationMs);
  }

  private cancelRun(runId: string): void {
    if (this.active?.runId === runId) this.finish(runId, 'cancelled');
  }

  private finish(
    runId: string,
    status: CodeExecutionStatus,
    errorMessage?: string,
    workerDurationMs?: number,
  ): void {
    const active = this.active;
    if (!active || active.runId !== runId) return;
    this.active = null;
    this.environment.cancelSchedule(active.timer);
    active.parentPort.close();
    active.workerPort.close();
    active.worker.terminate();
    active.resolve(
      createExecutionResult({
        runId,
        interviewQuestionId: active.input.interviewQuestionId,
        status,
        entries: active.entries,
        ...(errorMessage ? { errorMessage } : {}),
        durationMs: workerDurationMs ?? Math.max(0, this.environment.now() - active.startedAt),
      }),
    );
  }
}
