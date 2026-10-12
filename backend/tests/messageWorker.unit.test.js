/**
 * Deterministic unit tests for the Kafka batch worker (workers/messageWorker.js).
 *
 * These tests mock Kafka, MongoDB and the logger so they run without any
 * external infrastructure. They verify the parts of the recovery contract that
 * are pure application logic:
 *
 *   1. N messages are collapsed into a single bulkWrite (write-command batching).
 *   2. Kafka offsets are resolved ONLY after a successful DB write.
 *   3. A failed DB write preserves the buffer and does not commit offsets.
 *   4. Malformed / poison messages go to the DLQ and their offset is committed.
 *   5. If the DLQ hand-off itself fails, the offset is NOT committed (no silent loss).
 *   6. Every bulk op is an idempotent upsert keyed on messageId.
 */
import { jest } from '@jest/globals';

// Small threshold so a flush is triggered without 1000 messages.
process.env.MESSAGE_BULK_THRESHOLD = '3';
process.env.MESSAGE_FLUSH_INTERVAL_MS = '3600000';
process.env.KAFKA_PERSIST_TOPIC = 'unit-persist';
process.env.KAFKA_DLQ_TOPIC = 'unit-dlq';

const mockBulkWrite = jest.fn();
const mockSend = jest.fn();
const mockEnsureTopic = jest.fn().mockResolvedValue(undefined);
const mockConsumeBatch = jest.fn();
const mockLogInfo = jest.fn();
const mockLogError = jest.fn();

let capturedCallback;

jest.unstable_mockModule('../models/messageModel.js', () => ({
  Message: { bulkWrite: mockBulkWrite },
}));

jest.unstable_mockModule('../config/kafka.js', () => ({
  producer: { send: mockSend },
  ensureTopic: mockEnsureTopic,
  kafka: {},
  isCloudKafka: false,
}));

jest.unstable_mockModule('../utils/kafkaConsumer.js', () => ({
  consumeBatch: mockConsumeBatch,
  stopConsumer: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  logInfo: mockLogInfo,
  logError: mockLogError,
}));

const { startMessageBatching, stopMessageBatching } = await import('../workers/messageWorker.js');

const makeKafkaMessage = (data, offset) => ({
  offset,
  key: null,
  value: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
  headers: {},
});

const validData = (messageId) => ({
  messageId,
  chatId: 'chat-1',
  userId: 'user-a',
  friendId: 'user-b',
  content: `hello ${messageId}`,
  timestamp: new Date().toISOString(),
  isAI: false,
});

beforeEach(async () => {
  mockBulkWrite.mockReset();
  mockSend.mockReset();
  mockEnsureTopic.mockClear();
  mockLogInfo.mockClear();
  mockLogError.mockClear();
  capturedCallback = undefined;

  mockBulkWrite.mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 });
  mockSend.mockResolvedValue(undefined);
  mockConsumeBatch.mockImplementation(async (topic, cb) => {
    capturedCallback = cb;
  });

  await startMessageBatching();
});

afterAll(async () => {
  await stopMessageBatching();
});

describe('messageWorker batching + offset semantics', () => {
  test('collapses N messages into ONE bulkWrite with idempotent upserts and commits offsets after persistence', async () => {
    const resolveOffset = jest.fn();
    const heartbeat = jest.fn().mockResolvedValue(undefined);

    const messages = [
      makeKafkaMessage(validData('m1'), '0'),
      makeKafkaMessage(validData('m2'), '1'),
      makeKafkaMessage(validData('m3'), '2'),
    ];

    await capturedCallback(messages, resolveOffset, heartbeat);

    // Exactly one round trip to MongoDB for three messages.
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    const [ops, opts] = mockBulkWrite.mock.calls[0];
    expect(ops).toHaveLength(3);
    expect(opts).toEqual({ ordered: false });

    // Each op is an upsert keyed on messageId (idempotency).
    for (const op of ops) {
      expect(op.updateOne.upsert).toBe(true);
      expect(op.updateOne.filter).toHaveProperty('messageId');
      expect(op.updateOne.update.$setOnInsert.messageId).toBeTruthy();
    }

    // Offsets are resolved only after a successful write.
    expect(resolveOffset).toHaveBeenCalledTimes(3);
    expect(resolveOffset.mock.calls.map(c => c[0])).toEqual(['0', '1', '2']);
    expect(heartbeat).toHaveBeenCalled();
  });

  test('does NOT commit offsets when the DB write fails and retries the preserved buffer', async () => {
    const resolveOffset = jest.fn();
    const heartbeat = jest.fn().mockResolvedValue(undefined);

    mockBulkWrite.mockRejectedValueOnce(new Error('mongo down'));

    const firstBatch = [
      makeKafkaMessage(validData('a1'), '0'),
      makeKafkaMessage(validData('a2'), '1'),
      makeKafkaMessage(validData('a3'), '2'),
    ];

    await expect(capturedCallback(firstBatch, resolveOffset, heartbeat)).rejects.toThrow('mongo down');
    expect(resolveOffset).not.toHaveBeenCalled();

    // Next delivery flushes the preserved buffer plus the new message.
    mockBulkWrite.mockResolvedValueOnce({ upsertedCount: 4, modifiedCount: 0 });
    await capturedCallback(
      [makeKafkaMessage(validData('a4'), '3')],
      resolveOffset,
      heartbeat,
    );

    expect(mockBulkWrite).toHaveBeenCalledTimes(2);
    expect(mockBulkWrite.mock.calls[1][0]).toHaveLength(4); // 3 preserved + 1 new
    expect(resolveOffset).toHaveBeenCalledTimes(4);
  });

  test('routes malformed messages to the DLQ and commits their offset', async () => {
    const resolveOffset = jest.fn();
    const heartbeat = jest.fn().mockResolvedValue(undefined);

    await capturedCallback(
      [makeKafkaMessage('this is not json', '7')],
      resolveOffset,
      heartbeat,
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].topic).toBe('unit-dlq');
    expect(resolveOffset).toHaveBeenCalledWith('7');
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  test('routes messages without messageId to the DLQ', async () => {
    const resolveOffset = jest.fn();
    const heartbeat = jest.fn().mockResolvedValue(undefined);

    await capturedCallback(
      [makeKafkaMessage({ chatId: 'c', content: 'no id' }, '8')],
      resolveOffset,
      heartbeat,
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(resolveOffset).toHaveBeenCalledWith('8');
  });

  test('does NOT commit a poison message offset when DLQ delivery fails (no silent loss)', async () => {
    const resolveOffset = jest.fn();
    const heartbeat = jest.fn().mockResolvedValue(undefined);

    mockSend.mockRejectedValueOnce(new Error('kafka down'));

    await capturedCallback(
      [makeKafkaMessage('{bad json', '9')],
      resolveOffset,
      heartbeat,
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(resolveOffset).not.toHaveBeenCalled();
  });
});
