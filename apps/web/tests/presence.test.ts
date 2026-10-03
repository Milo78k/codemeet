import { describe, expect, jest, test } from '@jest/globals';
import type * as Monaco from 'monaco-editor';
import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import type { MonacoBinding } from 'y-monaco';

import { createMonacoAwarenessBinding } from '@/features/interviews/editor/monaco-awareness-binding';
import {
  collectPresenceParticipants,
  getParticipantColor,
  mapParticipantMetadata,
  participantPalette,
  type ParticipantIdentity,
} from '@/features/interviews/editor/presence';
import type { EditorReadyContext } from '@/features/interviews/editor/MonacoAdapter';

const interviewer: ParticipantIdentity = {
  participantId: 'participant-interviewer',
  displayName: 'Ludmila',
  role: 'INTERVIEWER',
};
const candidate: ParticipantIdentity = {
  participantId: 'participant-candidate',
  displayName: 'Anton',
  role: 'CANDIDATE',
};

describe('participant presence', () => {
  test('maps only safe participant metadata and rejects incomplete identities', () => {
    expect(mapParticipantMetadata({ ...candidate, token: 'private' })).toEqual(candidate);
    expect(mapParticipantMetadata({ ...candidate, role: 'ADMIN' })).toBeNull();
    expect(mapParticipantMetadata({ ...candidate, displayName: '  ' })).toBeNull();
  });

  test('derives a stable color from participantId using the bounded palette', () => {
    expect(getParticipantColor(candidate.participantId)).toEqual(
      getParticipantColor(candidate.participantId),
    );
    expect(getParticipantColor(candidate.participantId).color).toBe(
      participantPalette[getParticipantColor(candidate.participantId).colorIndex],
    );
    expect(participantPalette).toHaveLength(6);
  });

  test('shows the connected local participant once and deduplicates multiple tabs by participantId', () => {
    const participants = collectPresenceParticipants(
      interviewer,
      [
        { user: { ...interviewer, displayName: 'Another Ludmila tab' } },
        { user: candidate },
        { user: { ...candidate, displayName: 'Anton second tab' } },
      ],
      true,
    );
    expect(
      participants.map(({ participantId, displayName, role }) => ({
        participantId,
        displayName,
        role,
      })),
    ).toEqual([interviewer, candidate]);
  });

  test('removing Awareness state removes that participant and disconnected local state is not shown', () => {
    expect(collectPresenceParticipants(interviewer, [{ user: candidate }], true)).toHaveLength(2);
    expect(collectPresenceParticipants(interviewer, [{ user: candidate }], false)).toEqual([]);
    expect(collectPresenceParticipants(null, [], false)).toEqual([]);
  });

  test('constructs MonacoBinding with the active editor and authorized room Awareness', () => {
    const editor = {} as Monaco.editor.IStandaloneCodeEditor;
    const model = {} as Monaco.editor.ITextModel;
    const context = { editor, model, monaco: {} } as EditorReadyContext;
    const text = {} as Y.Text;
    const awareness = {} as WebsocketProvider['awareness'];
    const mockBinding = jest.fn(() => ({}));
    const Binding = mockBinding as unknown as typeof MonacoBinding;

    createMonacoAwarenessBinding(Binding, text, context, awareness);

    const [passedText, passedModel, editors, passedAwareness] = mockBinding.mock
      .calls[0] as unknown as [
      Y.Text,
      Monaco.editor.ITextModel,
      Set<Monaco.editor.IStandaloneCodeEditor>,
      WebsocketProvider['awareness'],
    ];
    expect(passedText).toBe(text);
    expect(passedModel).toBe(model);
    expect(editors).toEqual(new Set([editor]));
    expect(passedAwareness).toBe(awareness);
  });
});
