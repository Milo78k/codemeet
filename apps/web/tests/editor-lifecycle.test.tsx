import { describe, expect, test } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useCallback } from 'react';

import {
  createInterviewDraftStore,
  useInterviewDraftStore,
} from '@/features/interviews/editor/draft-store';
import { InterviewCodeEditor } from '@/features/interviews/editor/InterviewCodeEditor';
import { getModelUri } from '@/features/interviews/editor/language';
import { createInterviewModelManager } from '@/features/interviews/editor/model-manager';
import type { EditorReadyContext } from '@/features/interviews/editor/MonacoAdapter';

import { createFakeMonaco, editorRuntime } from './support/monaco';

const starterCode = 'const initial = 1;';

describe('interview model ownership', () => {
  test('reuses a stable model and never overwrites its edited draft on repeated initialization', () => {
    const runtime = createFakeMonaco();
    const models = createInterviewModelManager();
    const uri = getModelUri('interview-1', 'attachment-1', 'JAVASCRIPT');
    const model = models.getOrCreateModel(runtime.monaco, uri, 'javascript', starterCode);
    model.setValue('const edited = 10;');
    const repeated = models.getOrCreateModel(runtime.monaco, uri, 'javascript', starterCode);
    expect(repeated).toBe(model);
    expect(repeated.getValue()).toBe('const edited = 10;');
    expect(runtime.metrics()).toMatchObject({ liveModels: 1, createdModels: 1, peakLiveModels: 1 });
    models.dispose();
    expect(runtime.metrics()).toMatchObject({ liveModels: 0, disposedModels: 1 });
  });

  test('separate attachment models retain independent text and are disposed by their owner', () => {
    const runtime = createFakeMonaco();
    const models = createInterviewModelManager();
    const first = models.getOrCreateModel(
      runtime.monaco,
      getModelUri('interview-1', 'attachment-1', 'JAVASCRIPT'),
      'javascript',
      'first starter',
    );
    const second = models.getOrCreateModel(
      runtime.monaco,
      getModelUri('interview-1', 'attachment-2', 'TYPESCRIPT'),
      'typescript',
      'second starter',
    );
    first.setValue('first draft');
    second.setValue('second draft');
    expect(first.getValue()).toBe('first draft');
    expect(second.getValue()).toBe('second draft');
    expect(first.getLanguageId()).toBe('javascript');
    expect(second.getLanguageId()).toBe('typescript');
    expect(runtime.metrics().liveModels).toBe(2);
    models.dispose();
    models.dispose();
    expect(runtime.metrics()).toMatchObject({ liveModels: 0, disposedModels: 2 });
  });

  test('rejects a model owned elsewhere and never disposes that foreign resource', () => {
    const runtime = createFakeMonaco();
    const uri = getModelUri('interview-1', 'foreign-attachment', 'JAVASCRIPT');
    const foreign = runtime.monaco.editor.createModel(
      'foreign draft',
      'javascript',
      runtime.monaco.Uri.parse(uri),
    );
    const models = createInterviewModelManager();
    expect(() => models.getOrCreateModel(runtime.monaco, uri, 'javascript', starterCode)).toThrow(
      /already owned/i,
    );
    models.dispose();
    expect(foreign.isDisposed()).toBe(false);
    expect(foreign.getValue()).toBe('foreign draft');
    foreign.dispose();
  });

  test('synchronous StrictMode release and retain preserve the existing model until final cleanup', async () => {
    const runtime = createFakeMonaco();
    const drafts = createInterviewDraftStore('interview-1');
    drafts.retain();
    const uri = getModelUri('interview-1', 'attachment-1', 'JAVASCRIPT');
    const model = drafts.models.getOrCreateModel(runtime.monaco, uri, 'javascript', starterCode);
    model.setValue('strict draft');
    drafts.setValue('attachment-1', starterCode, model.getValue());
    drafts.release();
    drafts.retain();
    await Promise.resolve();
    expect(model.isDisposed()).toBe(false);
    expect(drafts.models.getOrCreateModel(runtime.monaco, uri, 'javascript', starterCode)).toBe(
      model,
    );
    expect(drafts.getDraft('attachment-1', starterCode).value).toBe('strict draft');
    drafts.release();
    await Promise.resolve();
    expect(model.isDisposed()).toBe(true);
    expect(runtime.metrics().liveModels).toBe(0);
  });

  test('React StrictMode keeps one live model, preserves edits and cleans model and binding listeners', async () => {
    let bindings = 0;
    let releasedBindings = 0;
    let readyModel: EditorReadyContext['model'] | undefined;
    function Workspace() {
      const drafts = useInterviewDraftStore('strict-workspace');
      const ready = useCallback(({ model }: EditorReadyContext) => {
        bindings += 1;
        readyModel = model;
        const listener = model.onDidChangeContent(() => {});
        return () => {
          releasedBindings += 1;
          listener.dispose();
        };
      }, []);
      return (
        <InterviewCodeEditor
          interviewId="strict-workspace"
          interviewQuestionId="strict-attachment"
          language="JAVASCRIPT"
          starterCode={starterCode}
          drafts={drafts}
          onEditorReady={ready}
        />
      );
    }
    const user = userEvent.setup();
    const view = render(
      <StrictMode>
        <Workspace />
      </StrictMode>,
    );
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    await user.clear(editor);
    await user.type(editor, 'const strictDraft = 42;');
    view.rerender(
      <StrictMode>
        <Workspace />
      </StrictMode>,
    );
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(
      'const strictDraft = 42;',
    );
    expect(readyModel?.getValue()).toBe('const strictDraft = 42;');
    expect(editorRuntime.metrics()).toMatchObject({
      liveModels: 1,
      peakLiveModels: 1,
      liveListeners: 3,
      peakLiveListeners: 3,
    });
    view.unmount();
    await waitFor(() =>
      expect(editorRuntime.metrics()).toMatchObject({ liveModels: 0, liveListeners: 0 }),
    );
    expect(releasedBindings).toBe(bindings);
    expect(readyModel?.isDisposed()).toBe(true);
    expect(editorRuntime.metrics().disposedModels).toBe(editorRuntime.metrics().createdModels);
  });

  test('a new interview workspace gets a new model and disposes the previous workspace', async () => {
    function Workspace({ id }: { id: string }) {
      const drafts = useInterviewDraftStore(id);
      return (
        <InterviewCodeEditor
          interviewId={id}
          interviewQuestionId="same-attachment"
          language="TYPESCRIPT"
          starterCode={starterCode}
          drafts={drafts}
        />
      );
    }
    const user = userEvent.setup();
    const view = render(<Workspace id="previous-workspace" />);
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    await user.clear(editor);
    await user.type(editor, 'const previousDraft = true;');
    view.rerender(<Workspace id="next-workspace" />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(starterCode),
    );
    await waitFor(() => expect(editorRuntime.metrics().liveModels).toBe(1));
    const previousUri = editorRuntime.monaco.Uri.parse(
      getModelUri('previous-workspace', 'same-attachment', 'TYPESCRIPT'),
    );
    expect(editorRuntime.monaco.editor.getModel(previousUri)).toBeNull();
    view.unmount();
    await waitFor(() =>
      expect(editorRuntime.metrics()).toMatchObject({ liveModels: 0, liveListeners: 0 }),
    );
  });
});
