import type * as Monaco from 'monaco-editor';

export function createInterviewModelManager() {
  const ownedModels = new Map<string, Monaco.editor.ITextModel>();

  return {
    getOrCreateModel(monaco: typeof Monaco, uri: string, language: string, initialValue: string) {
      const owned = ownedModels.get(uri);
      if (owned && !owned.isDisposed()) return owned;
      const modelUri = monaco.Uri.parse(uri);
      // Do not adopt or dispose a model that belongs to another workspace.
      if (monaco.editor.getModel(modelUri)) {
        throw new Error('The code model is already owned by another interview workspace.');
      }
      const model = monaco.editor.createModel(initialValue, language, modelUri);
      ownedModels.set(uri, model);
      return model;
    },
    dispose() {
      for (const model of ownedModels.values()) {
        if (!model.isDisposed()) model.dispose();
      }
      ownedModels.clear();
    },
  };
}

export type InterviewModelManager = ReturnType<typeof createInterviewModelManager>;
