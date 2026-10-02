import { describe, expect, test } from '@jest/globals';
import * as Y from 'yjs';

describe('Yjs text convergence', () => {
  test('merges independent and overlapping concurrent edits in different update orders', () => {
    const first = new Y.Doc();
    const second = new Y.Doc();
    first.getText('code').insert(0, 'const value = 1;');
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    const firstUpdates = [];
    const secondUpdates = [];
    first.on('update', (update) => firstUpdates.push(update));
    second.on('update', (update) => secondUpdates.push(update));
    first.getText('code').insert(6, 'left_');
    second.getText('code').insert(6, 'right_');
    first.getText('code').insert(11, 'near');
    second.getText('code').insert(11, 'adjacent');

    for (const update of [...secondUpdates].reverse()) Y.applyUpdate(first, update);
    for (const update of [...firstUpdates].reverse()) Y.applyUpdate(second, update);
    expect(first.getText('code').toString()).toBe(second.getText('code').toString());

    first.destroy();
    second.destroy();
  });
});
