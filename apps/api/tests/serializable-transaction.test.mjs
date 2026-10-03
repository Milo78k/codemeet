import { expect, test } from '@jest/globals';
import { serializableTransaction } from '../dist/services/shared.js';

function transactionWriteConflict() {
  return Object.assign(new Error('TransactionWriteConflict'), {
    name: 'DriverAdapterError',
    cause: {
      kind: 'TransactionWriteConflict',
      originalCode: '40001',
      originalMessage:
        'could not serialize access due to read/write dependencies among transactions',
    },
  });
}

test('retries PostgreSQL driver-adapter serialization conflicts', async () => {
  let attempts = 0;
  const prisma = {
    async $transaction(operation) {
      attempts += 1;
      if (attempts === 1) throw transactionWriteConflict();
      return operation({});
    },
  };

  await expect(serializableTransaction(prisma, async () => 'committed')).resolves.toBe('committed');
  expect(attempts).toBe(2);
});

test('maps exhausted PostgreSQL serialization retries to a controlled conflict', async () => {
  let attempts = 0;
  const prisma = {
    async $transaction() {
      attempts += 1;
      throw transactionWriteConflict();
    },
  };

  await expect(serializableTransaction(prisma, async () => null)).rejects.toMatchObject({
    extensions: { code: 'CONFLICT' },
  });
  expect(attempts).toBe(3);
});
