/**
 * Integration tests for the Kafka -> worker -> MongoDB persistence path.
 *
 * These tests require the local docker-compose stack:
 *   docker compose up -d zookeeper1 zookeeper2 zookeeper3 kafka kafka2 kafka3 mongodb redis
 *
 * They exercise the REAL worker (workers/messageWorker.js), the REAL Kafka
 * broker and the REAL MongoDB/Redis. Each run uses unique topic names and a
 * unique consumer group so repeated runs are isolated and deterministic.
 *
 * Covered scenarios:
 *   1. End-to-end persistence + offset commit after a successful DB write.
 *   2. Duplicate delivery of the same messageId produces a single record
 *      (idempotent upsert) - the crash-before-commit consequence.
 *   3. Malformed (poison) messages are routed to the DLQ while valid messages
 *      continue to be persisted.
 *   4. Uncommitted offsets are redelivered; committed offsets are not
 *      (the foundation of at-least-once delivery).
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const RUN = Date.now();
const PERSIST_TOPIC = `it-persist-${RUN}`;
const DLQ_TOPIC = `it-dlq-${RUN}`;
const GROUP = `it-group-${RUN}`;
const CRASH_TOPIC = `it-crash-${RUN}`;
const CRASH_GROUP = `it-crash-group-${RUN}`;

process.env.KAFKA_PERSIST_TOPIC = PERSIST_TOPIC;
process.env.KAFKA_DLQ_TOPIC = DLQ_TOPIC;
process.env.KAFKA_CONSUMER_GROUP = GROUP;
process.env.MESSAGE_BULK_THRESHOLD = '10';
process.env.MESSAGE_FLUSH_INTERVAL_MS = '3600000';

const { kafka, producer, ensureTopic } = await import('../config/kafka.js');
const { Message } = await import('../models/messageModel.js');
const { startMessageBatching, stopMessageBatching } = await import('../workers/messageWorker.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (predicate, { timeout = 30000, interval = 250, label = 'condition' } = {}) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const makeData = (messageId, chatId) => ({
  messageId,
  chatId,
  userId: '507f1f77bcf86cd799439011',
  friendId: '507f1f77bcf86cd799439012',
  content: `message ${messageId}`,
  timestamp: new Date().toISOString(),
  isAI: false,
});

const publish = (topic, payloads) => producer.send({
  topic,
  messages: payloads.map((p) => ({
    key: typeof p === 'string' ? null : p.chatId,
    value: typeof p === 'string' ? p : JSON.stringify(p),
  })),
});

const fetchOffsets = async (groupId, topic) => {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const result = await admin.fetchOffsets({ groupId, topics: [topic] });
    const partitions = result?.[0]?.partitions ?? [];
    // -1 means "no committed offset yet".
    if (partitions.some((p) => Number(p.offset) < 0)) return -1;
    return partitions.reduce((sum, p) => sum + Number(p.offset), 0);
  } finally {
    await admin.disconnect();
  }
};

const collectMessages = async (topic, groupId, { fromBeginning, maxMessages, timeoutMs = 20000 }) => {
  const consumer = kafka.consumer({ groupId, sessionTimeout: 10000 });
  const received = [];
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning });
  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, isRunning, isStale, pause }) => {
      for (const message of batch.messages) {
        if (!isRunning() || isStale()) return;
        received.push({ offset: message.offset, value: message.value.toString() });
        if (received.length >= maxMessages) {
          pause();
          return;
        }
      }
    },
  });

  const deadline = Date.now() + timeoutMs;
  while (received.length < maxMessages && Date.now() < deadline) {
    await sleep(200);
  }
  await consumer.disconnect();
  return received;
};

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await Message.deleteMany({});
  await Message.init();

  await ensureTopic(PERSIST_TOPIC, { numPartitions: 1, replicationFactor: 1 });
  await ensureTopic(DLQ_TOPIC, { numPartitions: 1, replicationFactor: 1 });
  await ensureTopic(CRASH_TOPIC, { numPartitions: 1, replicationFactor: 1 });

  await producer.connect();
  await startMessageBatching();

  // Allow the worker consumer to join its group before publishing.
  await sleep(4000);
}, 60000);

afterAll(async () => {
  await stopMessageBatching().catch(() => {});
  await producer.disconnect().catch(() => {});
  await mongoose.disconnect().catch(() => {});
}, 30000);

describe('Kafka -> MongoDB persistence integration', () => {
  const testChat = `it-chat-${RUN}`;
  const ids = Array.from({ length: 10 }, (_, i) => `it-${RUN}-${i}`);

  test('1. persists messages end-to-end and commits offsets after the DB write', async () => {
    const payloads = ids.map((id) => makeData(id, testChat));
    await publish(PERSIST_TOPIC, payloads);

    const count = await waitFor(
      () => Message.countDocuments({ chatId: testChat }),
      { label: '10 persisted messages' },
    );
    expect(count).toBe(10);

    const committed = await waitFor(
      () => fetchOffsets(GROUP, PERSIST_TOPIC).then((o) => (o >= 10 ? o : 0)),
      { label: 'committed offset >= 10' },
    );
    expect(committed).toBeGreaterThanOrEqual(10);

    const doc = await Message.findOne({ messageId: ids[0] }).lean();
    expect(doc).toMatchObject({
      messageId: ids[0],
      chatId: testChat,
      content: `message ${ids[0]}`,
      isAI: false,
    });
  });

  test('2. duplicate delivery of identical messageIds produces no duplicate records', async () => {
    // Re-publish the same 10 messageIds twice (simulates redelivery).
    const payloads = ids.map((id) => makeData(id, testChat));
    await publish(PERSIST_TOPIC, payloads);
    await publish(PERSIST_TOPIC, payloads);

    // Wait until the worker has consumed the duplicates (offset advances by 20).
    await waitFor(
      () => fetchOffsets(GROUP, PERSIST_TOPIC).then((o) => (o >= 30 ? o : 0)),
      { label: 'committed offset >= 30 after duplicates' },
    );

    const count = await Message.countDocuments({ chatId: testChat });
    expect(count).toBe(10); // still exactly 10 unique messages

    const uniqueIds = await Message.distinct('messageId', { chatId: testChat });
    expect(uniqueIds).toHaveLength(10);
  }, 60000);

  test('3. malformed messages are routed to the DLQ while valid messages persist', async () => {
    const goodIds = Array.from({ length: 10 }, (_, i) => `it-dlq-good-${RUN}-${i}`);
    await publish(PERSIST_TOPIC, [
      ...goodIds.map((id) => makeData(id, testChat)),
      'this is definitely not json', // poison message
    ]);

    // Poison message readable from the DLQ.
    const dlq = await collectMessages(DLQ_TOPIC, `dlq-reader-${RUN}`, {
      fromBeginning: true,
      maxMessages: 1,
      timeoutMs: 25000,
    });
    expect(dlq).toHaveLength(1);
    expect(dlq[0].value).toContain('this is definitely not json');

    // The valid messages in the same window are still persisted.
    const persisted = await waitFor(
      () => Message.countDocuments({ messageId: { $in: goodIds } }),
      { label: 'valid messages persisted despite poison neighbour' },
    );
    expect(persisted).toBe(10);
  }, 60000);

  test('4. uncommitted offsets are redelivered after restart; committed offsets are not', async () => {
    const crashIds = Array.from({ length: 5 }, (_, i) => `crash-${RUN}-${i}`);
    await publish(CRASH_TOPIC, crashIds.map((id) => makeData(id, `crash-chat-${RUN}`)));

    // First consumer: read all 5 but only commit up to offset 2 (of 0..4).
    const first = kafka.consumer({ groupId: CRASH_GROUP, sessionTimeout: 10000 });
    const firstOffsets = [];
    await first.connect();
    await first.subscribe({ topic: CRASH_TOPIC, fromBeginning: true });
    await first.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        firstOffsets.push(message.offset);
        if (firstOffsets.length === 2) {
          await first.commitOffsets([
            { topic, partition, offset: String(Number(message.offset) + 1) },
          ]);
        }
      },
    });
    await waitFor(() => firstOffsets.length >= 5 && firstOffsets.length, {
      label: 'first consumer read 5 messages',
      timeout: 25000,
    });
    await first.disconnect();
    expect(firstOffsets).toHaveLength(5);

    // Second consumer, same group: only the uncommitted tail (offsets 2,3,4) is redelivered.
    const second = kafka.consumer({ groupId: CRASH_GROUP, sessionTimeout: 10000 });
    const secondOffsets = [];
    await second.connect();
    await second.subscribe({ topic: CRASH_TOPIC, fromBeginning: false });
    await second.run({
      autoCommit: false,
      eachMessage: async ({ message }) => { secondOffsets.push(message.offset); },
    });
    await waitFor(() => secondOffsets.length >= 3 && secondOffsets.length, {
      label: 'second consumer read the redelivered tail',
      timeout: 25000,
    });
    await second.disconnect();

    expect(secondOffsets.sort()).toEqual(['2', '3', '4']);
  }, 60000);
});
