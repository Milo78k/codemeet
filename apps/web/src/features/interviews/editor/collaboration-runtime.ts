'use client';

import type { WebsocketProvider } from 'y-websocket';
import type * as Monaco from 'monaco-editor';
import type * as Y from 'yjs';

import { AuthenticatedWebSocket } from './authenticated-websocket';

export type CollaborationBinding = {
  doc: Y.Doc;
  text: Y.Text;
  provider: WebsocketProvider;
  bindModel(model: Monaco.editor.ITextModel): Promise<() => void>;
  reset(): boolean;
  destroy(): void;
};

const documents = new Map<string, Y.Doc>();
const connections = new Map<string, Promise<CollaborationBinding>>();
const questionOwners = new Map<string, number>();
const releaseGenerations = new Map<string, number>();

export async function connectCollaborativeQuestion(
  roomId: string,
  starterCode: string,
): Promise<CollaborationBinding> {
  let connection = connections.get(roomId);
  if (!connection) {
    connection = createConnection(roomId, starterCode);
    connections.set(roomId, connection);
    void connection.catch(() => {
      if (connections.get(roomId) === connection) connections.delete(roomId);
    });
  }
  return connection;
}

async function createConnection(roomId: string, starterCode: string) {
  if (!process.env.NEXT_PUBLIC_REALTIME_URL) {
    throw new Error('The collaboration websocket endpoint is not configured.');
  }
  const [{ WebsocketProvider }, Y] = await Promise.all([import('y-websocket'), import('yjs')]);
  let doc = documents.get(roomId);
  if (!doc) {
    doc = new Y.Doc();
    documents.set(roomId, doc);
  }
  const activeDoc = doc;
  const provider = new WebsocketProvider(process.env.NEXT_PUBLIC_REALTIME_URL, roomId, activeDoc, {
    disableBc: true,
    maxBackoffTime: 5_000,
    WebSocketPolyfill: AuthenticatedWebSocket as unknown as typeof WebSocket,
  });
  const onClosed = () => provider.emit('status', [{ status: 'disconnected' }]);
  provider.on('closed', onClosed);
  const text = activeDoc.getText('code');
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Could not connect to the collaboration server.'));
    }, 15_000);
    const onStatus = ({ status }: { status: string }) => {
      if (status === 'connected') {
        provider.off('status', onStatus);
        provider.once('sync', onSync);
      }
    };
    const onSync = (synced: boolean) => {
      if (!synced) return;
      cleanup();
      resolve();
    };
    const onClose = (event: CloseEvent | null) => {
      if (!event) return;
      if (event.code >= 4400 && event.code < 4500) {
        cleanup();
        reject(new Error('This collaboration room is unavailable.'));
      }
    };
    function cleanup() {
      window.clearTimeout(timeout);
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.off('connection-close', onClose);
    }
    provider.on('status', onStatus);
    provider.on('connection-close', onClose);
    if (provider.wsconnected) provider.once('sync', onSync);
  }).catch((error: unknown) => {
    provider.destroy();
    throw error;
  });
  let destroyed = false;
  return {
    doc: activeDoc,
    text,
    provider,
    async bindModel(model: Monaco.editor.ITextModel) {
      const { MonacoBinding } = await import('y-monaco');
      const binding = new MonacoBinding(text, model);
      return () => binding.destroy();
    },
    reset() {
      if (!provider.wsconnected) return false;
      activeDoc.transact(() => {
        if (text.length > 0) text.delete(0, text.length);
        if (starterCode.length > 0) text.insert(0, starterCode);
      }, 'reset');
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      provider.off('closed', onClosed);
      provider.destroy();
      if (connections.get(roomId)) connections.delete(roomId);
    },
  };
}

export function retainCollaborativeQuestion(roomId: string): void {
  questionOwners.set(roomId, (questionOwners.get(roomId) ?? 0) + 1);
  releaseGenerations.set(roomId, (releaseGenerations.get(roomId) ?? 0) + 1);
}

export function releaseCollaborativeQuestion(roomId: string): void {
  questionOwners.set(roomId, Math.max(0, (questionOwners.get(roomId) ?? 1) - 1));
  const generation = (releaseGenerations.get(roomId) ?? 0) + 1;
  releaseGenerations.set(roomId, generation);
  queueMicrotask(() => {
    if (questionOwners.get(roomId) !== 0 || releaseGenerations.get(roomId) !== generation) return;
    connections
      .get(roomId)
      ?.then(({ destroy }) => destroy())
      .catch(() => {});
    connections.delete(roomId);
    questionOwners.delete(roomId);
    releaseGenerations.delete(roomId);
  });
}

export function destroyCollaborationDocuments(interviewId: string): void {
  for (const [roomId, doc] of documents) {
    if (!roomId.startsWith(`interview:${encodeURIComponent(interviewId)}:`)) continue;
    const connection = connections.get(roomId);
    if (connection) {
      void connection
        .then(({ destroy }) => {
          destroy();
          doc.destroy();
        })
        .catch(() => doc.destroy());
    } else {
      doc.destroy();
    }
    connections.delete(roomId);
    questionOwners.delete(roomId);
    releaseGenerations.delete(roomId);
    doc.destroy();
    documents.delete(roomId);
  }
}
