import {
  MAX_CODE_SOURCE_CHARS,
  type CodeExecutionLogLevel,
  type RunnerRequestMessage,
  type RunnerResponseMessage,
} from '../model/execution';
import { appendOutputEntry, createOutputBuffer } from '../lib/output';
import { formatConsoleArguments } from '../lib/serialize';
import { transformExecutableSource } from '../lib/transpile';

type WorkerPort = Pick<MessagePort, 'postMessage' | 'close'>;
type ExecutableRequest = RunnerRequestMessage & { language: 'JAVASCRIPT' | 'TYPESCRIPT' };
type WorkerScope = {
  addEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void;
  console: Console;
};

const workerScope = globalThis as unknown as WorkerScope;

function isRunnerRequest(value: unknown): value is ExecutableRequest {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<RunnerRequestMessage>;
  return (
    message.type === 'run' &&
    typeof message.runId === 'string' &&
    typeof message.interviewQuestionId === 'string' &&
    typeof message.source === 'string' &&
    (message.language === 'JAVASCRIPT' || message.language === 'TYPESCRIPT')
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name || 'Error'}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return 'Unknown runtime error';
  }
}

function send(port: WorkerPort, message: RunnerResponseMessage): void {
  try {
    port.postMessage(message);
  } catch {
    // The owning client may have cancelled and closed its port already.
  }
}

async function run(request: ExecutableRequest, port: WorkerPort): Promise<void> {
  const startedAt = performance.now();
  const output = createOutputBuffer();
  const emit = (level: CodeExecutionLogLevel, values: unknown[]) => {
    const entry = appendOutputEntry(output, {
      level,
      message: formatConsoleArguments(values),
    });
    if (entry) {
      send(port, {
        type: 'log',
        runId: request.runId,
        interviewQuestionId: request.interviewQuestionId,
        entry,
      });
    }
  };
  const capturedConsole = Object.freeze({
    log: (...values: unknown[]) => emit('log', values),
    info: (...values: unknown[]) => emit('info', values),
    warn: (...values: unknown[]) => emit('warn', values),
    error: (...values: unknown[]) => emit('error', values),
  }) as unknown as Console;

  let status: 'success' | 'runtime_error' = 'success';
  let failure: string | undefined;
  try {
    if (request.source.length > MAX_CODE_SOURCE_CHARS) {
      throw new Error(
        `Source exceeds the ${MAX_CODE_SOURCE_CHARS.toLocaleString()} character limit.`,
      );
    }

    const transformed = await transformExecutableSource(request.language, request.source);
    if (!transformed.ok) throw new SyntaxError(transformed.error);

    const originalConsole = workerScope.console;
    try {
      Object.defineProperty(workerScope, 'console', {
        configurable: true,
        value: capturedConsole,
      });
    } catch {
      // User snippets still receive the captured console as an explicit argument.
    }

    try {
      const executableBody = `"use strict"; return (async function runSnapshot() {\n${transformed.code}\n}).call(undefined);`;
      if (transformed.format === 'commonjs') {
        const exports = Object.create(null) as Record<string, unknown>;
        const moduleRecord = { exports };
        const execute = new Function('console', 'exports', 'module', executableBody) as (
          targetConsole: Console,
          targetExports: Record<string, unknown>,
          targetModule: { exports: Record<string, unknown> },
        ) => Promise<unknown>;
        await execute(capturedConsole, exports, moduleRecord);
      } else {
        const execute = new Function('console', executableBody) as (
          targetConsole: Console,
        ) => Promise<unknown>;
        await execute(capturedConsole);
      }
    } finally {
      try {
        Object.defineProperty(workerScope, 'console', {
          configurable: true,
          value: originalConsole,
        });
      } catch {
        // The worker is retired immediately after completion.
      }
    }
  } catch (error) {
    status = 'runtime_error';
    failure = errorMessage(error);
  }

  send(port, {
    type: 'complete',
    runId: request.runId,
    interviewQuestionId: request.interviewQuestionId,
    status,
    ...(failure ? { errorMessage: failure } : {}),
    durationMs: performance.now() - startedAt,
  });
  port.close();
}

const onStart = (event: MessageEvent<unknown>) => {
  const port = event.ports[0];
  if (!port || !isRunnerRequest(event.data)) return;
  workerScope.removeEventListener('message', onStart);
  void run(event.data, port);
};

workerScope.addEventListener('message', onStart);
