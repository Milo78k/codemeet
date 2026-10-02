'use client';

import { loader } from '@monaco-editor/react';
import type * as MonacoNamespace from 'monaco-editor';

type Monaco = typeof MonacoNamespace;
type RuntimeErrorListener = (error: Error) => void;

const errorListeners = new Set<RuntimeErrorListener>();
let loadingMonaco: Promise<Monaco> | undefined;
let workerRecoveryNeeded = false;

/** A workspace subscribes while mounted; worker failures stay inside its editor UI. */
export function subscribeMonacoErrors(listener: RuntimeErrorListener): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

function reportWorkerError(error: Error): void {
  workerRecoveryNeeded = true;
  for (const listener of errorListeners) listener(error);
}

function createLocalWorker(label: string): Worker {
  const isTypeScript = label === 'typescript' || label === 'javascript';
  const workerPath = isTypeScript ? '/monaco/ts.worker.js' : '/monaco/editor.worker.js';
  const message = `The local ${isTypeScript ? 'TypeScript' : 'editor'} worker could not be loaded.`;

  try {
    const worker = new Worker(new URL(workerPath, window.location.origin), {
      type: 'module',
      name: `codemeet-${isTypeScript ? 'typescript' : 'editor'}`,
    });
    const handleError = (event: Event) => {
      event.preventDefault();
      reportWorkerError(new Error(message));
    };
    worker.addEventListener('error', handleError, { once: true });
    worker.addEventListener('messageerror', handleError, { once: true });
    return worker;
  } catch (cause) {
    const error = new Error(message, { cause });
    reportWorkerError(error);
    throw error;
  }
}

function configureCompilerDefaults(monaco: Monaco): void {
  // The stable .tsx model URI enables TSX parsing. React's full type universe
  // is intentionally absent; semantic diagnostics remain enabled.
  const options: MonacoNamespace.typescript.CompilerOptions = {
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    strict: true,
  };
  monaco.typescript.typescriptDefaults.setCompilerOptions(options);
  monaco.typescript.javascriptDefaults.setCompilerOptions(options);
}

/** Configures the local ESM instance before the React wrapper can initialize. */
export async function loadMonaco(): Promise<Monaco> {
  if (typeof window === 'undefined') {
    throw new Error('The code editor can only be loaded in a browser.');
  }

  if (!loadingMonaco) {
    const runtimeGlobal = globalThis as typeof globalThis & {
      MonacoEnvironment?: MonacoNamespace.Environment;
    };
    runtimeGlobal.MonacoEnvironment = {
      getWorker: (_workerId, label) => createLocalWorker(label),
    };

    loadingMonaco = import('monaco-editor')
      .then((monaco) => {
        configureCompilerDefaults(monaco);
        loader.config({ monaco });
        return monaco;
      })
      .catch((cause: unknown) => {
        loadingMonaco = undefined;
        throw new Error('The local code editor could not be loaded.', { cause });
      });
  }

  const monaco = await loadingMonaco;
  if (workerRecoveryNeeded) {
    // Changing compiler defaults stops failed language workers so Retry can
    // initialize fresh workers without replacing the question draft models.
    workerRecoveryNeeded = false;
    configureCompilerDefaults(monaco);
  }
  return monaco;
}
