import type {
  RunnerRequestMessage,
  RunnerResponseMessage,
} from '@/features/code-runner/model/execution';

type Listener = ((event: MessageEvent<RunnerResponseMessage>) => void) | null;

class TestMessagePort {
  onmessage: Listener = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  peer: TestMessagePort | null = null;
  closed = false;

  start() {}

  close() {
    this.closed = true;
  }

  postMessage(message: RunnerResponseMessage) {
    if (!this.closed && !this.peer?.closed)
      this.peer?.onmessage?.({ data: message } as MessageEvent<RunnerResponseMessage>);
  }
}

class TestMessageChannel {
  readonly port1 = new TestMessagePort();
  readonly port2 = new TestMessagePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

export class TestCodeRunnerWorker {
  static instances: TestCodeRunnerWorker[] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: RunnerRequestMessage | null = null;
  outputPort: TestMessagePort | null = null;
  terminateCount = 0;

  constructor() {
    TestCodeRunnerWorker.instances.push(this);
  }

  postMessage(message: RunnerRequestMessage, transfer: Transferable[]) {
    this.request = message;
    this.outputPort = transfer[0] as unknown as TestMessagePort;
  }

  terminate() {
    this.terminateCount += 1;
  }

  emit(message: RunnerResponseMessage) {
    this.outputPort?.postMessage(message);
  }

  complete(status: 'success' | 'runtime_error' = 'success', errorMessage?: string) {
    if (!this.request) throw new Error('A run request has not been posted to this worker.');
    this.emit({
      type: 'complete',
      runId: this.request.runId,
      interviewQuestionId: this.request.interviewQuestionId,
      status,
      ...(errorMessage ? { errorMessage } : {}),
      durationMs: 12,
    });
  }

  static reset() {
    this.instances = [];
  }
}

export function installTestCodeRunner() {
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const previousChannel = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
  TestCodeRunnerWorker.reset();
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: TestCodeRunnerWorker,
  });
  Object.defineProperty(globalThis, 'MessageChannel', {
    configurable: true,
    writable: true,
    value: TestMessageChannel,
  });
  return () => {
    if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
    if (previousChannel) Object.defineProperty(globalThis, 'MessageChannel', previousChannel);
    else Reflect.deleteProperty(globalThis, 'MessageChannel');
    TestCodeRunnerWorker.reset();
  };
}
