import type * as Monaco from 'monaco-editor';
import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import type { MonacoBinding } from 'y-monaco';

import type { EditorReadyContext } from './MonacoAdapter';

export function createMonacoAwarenessBinding(
  Binding: typeof MonacoBinding,
  text: Y.Text,
  context: EditorReadyContext,
  awareness: WebsocketProvider['awareness'],
) {
  return new Binding(
    text,
    context.model,
    new Set<Monaco.editor.IStandaloneCodeEditor>([context.editor]),
    awareness,
  );
}
