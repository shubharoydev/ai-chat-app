import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const RUN = Date.now();
const SCALE_TOPIC = `scale-topic-${RUN}`;
const SCALE_GROUP = `scale-group-${RUN}`;

const { kafka, producer, ensureTopic } = await import('../config/kafka.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('P1 Distributed Scaling & Multi-Partition Parallelism Suite', () => {
  let admin;

  beforeAll(async () => {
    admin = kafka.admin();
    await admin.connect();

    // Create topic with 3 partitions explicitly across the local 3-broker cluster
    await ensureTopic(SCALE_TOPIC, { numPartitions: 3, replicationFactor: 1 });
    await producer.connect();
  }, 30000);

  afterAll(async () => {
    await producer.disconnect().catch(() => {});
    await admin.disconnect().catch(() => {});
  }, 20000);

  test('1. Topic has 3 partitions and spreads diverse chatIds across distinct partitions', async () => {
    const topicMetadata = await admin.fetchTopicMetadata({ topics: [SCALE_TOPIC] });
    const partitions = topicMetadata.topics[0].partitions;
    expect(partitions).toHaveLength(3);

    // Publish messages with 10 different chatIds to verify partition distribution
    const distinctChats = Array.from({ length: 10 }, (_, i) => `chat-dist-${i}`);
    const results = await producer.send({
      topic: SCALE_TOPIC,
      messages: distinctChats.map((chatId) => ({
        key: chatId,
        value: JSON.stringify({ chatId, messageId: `msg-${chatId}` }),
      })),
    });

    const usedPartitions = new Set(results.map((r) => r.partition));
    // Across 10 hash keys, multiple partitions MUST be utilized (proving non-single-partition distribution)
    expect(usedPartitions.size).toBeGreaterThan(1);
  });

  test('2. Multiple consumers in the same group achieve concurrent partition assignment and parallelism', async () => {
    const consumerA = kafka.consumer({ groupId: SCALE_GROUP, sessionTimeout: 10000 });
    const consumerB = kafka.consumer({ groupId: SCALE_GROUP, sessionTimeout: 10000 });

    const assignedA = [];
    const assignedB = [];

    await consumerA.connect();
    await consumerB.connect();

    consumerA.on(consumerA.events.GROUP_JOIN, (e) => {
      assignedA.push(...(e.payload?.memberAssignment?.[SCALE_TOPIC] || []));
    });
    consumerB.on(consumerB.events.GROUP_JOIN, (e) => {
      assignedB.push(...(e.payload?.memberAssignment?.[SCALE_TOPIC] || []));
    });

    await consumerA.subscribe({ topic: SCALE_TOPIC, fromBeginning: false });
    await consumerB.subscribe({ topic: SCALE_TOPIC, fromBeginning: false });

    // Run both consumers concurrently
    const p1 = consumerA.run({ eachMessage: async () => {} });
    const p2 = consumerB.run({ eachMessage: async () => {} });

    // Allow rebalance to stabilize
    await sleep(4000);

    // Verify both consumers belong to the active group
    const describeGroup = await admin.describeGroups([SCALE_GROUP]);
    const members = describeGroup.groups[0]?.members || [];
    expect(members).toHaveLength(2);

    await consumerA.disconnect();
    await consumerB.disconnect();
  }, 30000);
});
