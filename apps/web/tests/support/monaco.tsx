import { jest } from '@jest/globals';
import type * as Monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';

import type { MonacoAdapterProps } from '@/features/interviews/editor/MonacoAdapter';

type AdapterMode = 'ready' | 'loading' | 'error';
let mode: AdapterMode = 'ready';
let releaseModule: (() => void) | undefined;
const activeFailures = new Set<(error: unknown) => void>();

export function failActiveEditorAdapter() {
  for (const onError of activeFailures) onError(new Error('The test editor worker failed.'));
}

export function setEditorAdapterMode(value: AdapterMode) {
  mode = value;
  if (value !== 'loading') {
    releaseModule?.();
    releaseModule = undefined;
  }
}

export function resetEditorAdapter() {
  setEditorAdapterMode('ready');
}

export function createFakeMonaco() {
  const models = new Map<string, FakeModel>();
  const createdModels: FakeModel[] = [];
  let liveListeners = 0;
  let peakLiveModels = 0;
  let peakLiveListeners = 0;

  class FakeModel {
    readonly uri: Monaco.Uri;
    readonly language: string;
    private value: string;
    private disposed = false;
    private listeners = new Set<() => void>();

    constructor(value: string, language: string, uri: Monaco.Uri) {
      this.value = value;
      this.language = language;
      this.uri = uri;
    }

    getValue() {
      return this.value;
    }
    getLanguageId() {
      return this.language;
    }
    isDisposed() {
      return this.disposed;
    }
    setValue(value: string) {
      if (this.disposed) throw new Error('A disposed test model was edited.');
      this.value = value;
      for (const listener of this.listeners) listener();
    }
    onDidChangeContent(listener: () => void) {
      this.listeners.add(listener);
      liveListeners += 1;
      peakLiveListeners = Math.max(peakLiveListeners, liveListeners);
      let removed = false;
      return {
        dispose: () => {
          if (removed) return;
          removed = true;
          if (this.listeners.delete(listener)) liveListeners -= 1;
        },
      };
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      liveListeners -= this.listeners.size;
      this.listeners.clear();
      models.delete(this.uri.toString());
    }
  }

  const api = {
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    editor: {
      getModel: (uri: Monaco.Uri) => models.get(uri.toString()) ?? null,
      createModel: (value: string, language: string, uri: Monaco.Uri) => {
        if (models.has(uri.toString())) throw new Error('A duplicate test model URI was created.');
        const model = new FakeModel(value, language, uri);
        models.set(uri.toString(), model);
        createdModels.push(model);
        peakLiveModels = Math.max(peakLiveModels, models.size);
        return model;
      },
    },
  };

  return {
    // The fake implements only public Monaco operations used at the adapter seam.
    monaco: api as unknown as typeof Monaco,
    metrics: () => ({
      liveModels: models.size,
      liveListeners,
      peakLiveModels,
      peakLiveListeners,
      createdModels: createdModels.length,
      disposedModels: createdModels.filter((model) => model.isDisposed()).length,
    }),
  };
}

export const editorRuntime = createFakeMonaco();

function TestMonacoAdapter({
  uri,
  language,
  initialValue,
  models,
  onChange,
  onEditorReady,
  onLoadError,
}: MonacoAdapterProps) {
  const [model, setModel] = useState<Monaco.editor.ITextModel | null>(null);
  const [value, setValue] = useState(initialValue);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (mode === 'error') {
      onLoadError(new Error('The test browser adapter could not initialize.'));
      return;
    }
    if (mode === 'loading') return;
    const monacoLanguage = language === 'JAVASCRIPT' ? 'javascript' : 'typescript';
    const current = models.getOrCreateModel(
      editorRuntime.monaco,
      uri,
      monacoLanguage,
      initialValue,
    );
    const subscription = current.onDidChangeContent(() => {
      setValue(current.getValue());
      onChange(current.getValue());
    });
    activeFailures.add(onLoadError);
    const editor = {
      getModel: () => current,
      focus: () => input.current?.focus(),
      updateOptions: () => {},
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    let mounted = true;
    let releaseBinding: void | (() => void);
    // The real browser adapter initializes asynchronously after its chunk loads.
    queueMicrotask(() => {
      if (!mounted) return;
      setModel(current);
      setValue(current.getValue());
      releaseBinding = onEditorReady({ editor, monaco: editorRuntime.monaco, model: current });
    });
    return () => {
      mounted = false;
      activeFailures.delete(onLoadError);
      subscription.dispose();
      releaseBinding?.();
    };
    // A Monaco model is created once per mount/path; edits are model events,
    // not a reason to recreate the browser adapter effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, models, onChange, onEditorReady, onLoadError]);
  if (!model) return null;
  return (
    <textarea
      ref={input}
      aria-label="Code editor"
      value={value}
      onChange={(event) => model.setValue(event.target.value)}
    />
  );
}

// Only the browser leaf is replaced. The real editor toolbar, draft owner,
// model manager, reset dialog, Apollo client and GraphQL operations remain real.
jest.unstable_mockModule('@/features/interviews/editor/MonacoAdapter', async () => {
  if (mode === 'loading')
    await new Promise<void>((resolve) => {
      releaseModule = resolve;
    });
  return { MonacoAdapter: TestMonacoAdapter };
});
