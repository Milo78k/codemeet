import { describe, expect, test } from '@jest/globals';

import { createInterviewDraftStore } from '@/features/interviews/editor/draft-store';
import { getModelUri, getMonacoLanguage } from '@/features/interviews/editor/language';

describe('interview editor domain', () => {
  test.each([
    ['JAVASCRIPT', 'javascript', '.js'],
    ['TYPESCRIPT', 'typescript', '.ts'],
    ['REACT_TSX', 'typescript', '.tsx'],
  ] as const)(
    '%s maps explicitly to %s and a %s model file',
    (language, monacoLanguage, extension) => {
      expect(getMonacoLanguage(language)).toBe(monacoLanguage);
      expect(getModelUri('interview-1', 'attachment-1', language)).toMatch(
        new RegExp(`\\${extension}$`),
      );
    },
  );

  test('model identity remains stable and separates interviews and attachments', () => {
    const uri = getModelUri('interview-1', 'attachment-1', 'TYPESCRIPT');
    expect(getModelUri('interview-1', 'attachment-1', 'TYPESCRIPT')).toBe(uri);
    expect(getModelUri('interview-1', 'attachment-2', 'TYPESCRIPT')).not.toBe(uri);
    expect(getModelUri('interview-2', 'attachment-1', 'TYPESCRIPT')).not.toBe(uri);
    expect(uri).toContain('interview-1');
    expect(uri).toContain('attachment-1');
  });

  test('first opening a question creates a clean local draft from its captured starter code', () => {
    const store = createInterviewDraftStore('interview-1');
    expect(store.getDraft('attachment-1', 'const captured = true;')).toMatchObject({
      value: 'const captured = true;',
      starterCode: 'const captured = true;',
      isDirty: false,
    });
  });

  test('edits survive repeated reads and drafts of separate attachments remain independent', () => {
    const store = createInterviewDraftStore('interview-1');
    store.getDraft('attachment-1', 'const first = 1;');
    store.getDraft('attachment-2', 'const second = 2;');
    store.setValue('attachment-1', 'const first = 1;', 'const first = 100;');
    store.setValue('attachment-2', 'const second = 2;', 'const second = 200;');
    expect(store.getDraft('attachment-1', 'const first = 1;')).toMatchObject({
      value: 'const first = 100;',
      isDirty: true,
    });
    expect(store.getDraft('attachment-2', 'const second = 2;')).toMatchObject({
      value: 'const second = 200;',
      isDirty: true,
    });
    store.setValue('attachment-1', 'const first = 1;', 'const first = 1;');
    expect(store.getDraft('attachment-1', 'const first = 1;').isDirty).toBe(false);
    expect(store.getDraft('attachment-2', 'const second = 2;').value).toBe('const second = 200;');
  });

  test('an empty captured starter remains a valid clean draft', () => {
    const store = createInterviewDraftStore('interview-1');
    expect(store.getDraft('attachment-1', '').value).toBe('');
    expect(store.getDraft('attachment-1', '').isDirty).toBe(false);
    store.setValue('attachment-1', '', ' ');
    expect(store.getDraft('attachment-1', '').isDirty).toBe(true);
  });

  test('draft change subscriptions stop receiving updates after cleanup', () => {
    const store = createInterviewDraftStore('interview-1');
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.setValue('attachment-1', '', 'first edit');
    expect(notifications).toBe(1);
    unsubscribe();
    store.setValue('attachment-1', '', 'second edit');
    expect(notifications).toBe(1);
  });
});
