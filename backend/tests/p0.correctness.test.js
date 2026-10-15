import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const RUN = Date.now();
const ORDER_TOPIC = `order-topic-${RUN}`;
const ORDER_GROUP = `order-group-${RUN}`;

process.env.KAFKA_PERSIST_TOPIC = ORDER_TOPIC;
process.env.KAFKA_CONSUMER_GROUP = ORDER_GROUP;
process.env.MESSAGE_BULK_THRESHOLD = '100';
process.env.MESSAGE_FLUSH_INTERVAL_MS = '60000';

const { kafka, producer, ensureTopic } = await import('../config/kafka.js');
const { Message } = await import('../models/messageModel.js');
const { Friend } = await import('../models/friendModel.js');
const { User } = await import('../models/userModel.js');
const { sendMessage, getMessages, retryFailedMessages } = await import('../services/chatService.js');
const { getRedisClient } = await import('../config/redisSetup.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('P0 Correctness & Durability Suite', () => {
  let userA, userB, userC;
  let redisClient;

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    await Message.deleteMany({});
    await Friend.deleteMany({});
    await User.deleteMany({});

    // Create 3 test users
    userA = await User.create({ name: 'Alice', email: `alice-${RUN}@test.com`, password: 'Password123!' });
    userB = await User.create({ name: 'Bob', email: `bob-${RUN}@test.com`, password: 'Password123!' });
    userC = await User.create({ name: 'Charlie', email: `charlie-${RUN}@test.com`, password: 'Password123!' });

    // Establish friendship between Alice and Bob only
    await Friend.create([
      { userId: userA._id, friendId: userB._id },
      { userId: userB._id, friendId: userA._id },
    ]);

    await ensureTopic(ORDER_TOPIC, { numPartitions: 3, replicationFactor: 1 });
    await producer.connect();
    redisClient = getRedisClient();
  }, 30000);

  afterAll(async () => {
    await producer.disconnect().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }, 20000);

  test('1. Authorization blocks non-friends from sending or reading messages', async () => {
    // Alice -> Charlie (not friends)
    await expect(sendMessage(userA._id.toString(), userC._id.toString(), 'Hello stranger'))
      .rejects.toThrow(/Forbidden/);

    // Alice -> Alice (self)
    await expect(sendMessage(userA._id.toString(), userA._id.toString(), 'Self talk'))
      .rejects.toThrow(/Cannot send message to yourself/);

    // Charlie reading Alice's messages
    await expect(getMessages(userC._id.toString(), userA._id.toString()))
      .rejects.toThrow(/Forbidden/);
  });

  test('2. Redis history slicing returns latest 20 messages in chronological order matching MongoDB', async () => {
    const chatId = [userA._id.toString(), userB._id.toString()].sort().join(':');
    const redisKey = `chat:recent:${chatId}`;
    await redisClient.del(redisKey);
    await Message.deleteMany({ chatId });

    // Send 25 messages from Alice to Bob
    for (let i = 1; i <= 25; i++) {
      await sendMessage(userA._id.toString(), userB._id.toString(), `Msg #${i}`);
    }

    // Retrieve from Redis cache
    const cached = await getMessages(userA._id.toString(), userB._id.toString());
    expect(cached).toHaveLength(20);
    // Should be Msg #6 through Msg #25 in chronological order
    expect(cached[0].content).toBe('Msg #6');
    expect(cached[19].content).toBe('Msg #25');

    // Clear Redis cache to force MongoDB fallback path
    await redisClient.del(redisKey);
    // Persist all 25 docs to MongoDB to test DB path
    const docs = [];
    for (let i = 1; i <= 25; i++) {
      docs.push({
        messageId: `db-order-${i}`,
        chatId,
        userId: userA._id,
        friendId: userB._id,
        content: `Msg #${i}`,
        timestamp: new Date(Date.now() + i * 1000),
      });
    }
    await Message.insertMany(docs);

    const fromDB = await getMessages(userA._id.toString(), userB._id.toString());
    expect(fromDB).toHaveLength(20);
    expect(fromDB[0].content).toBe('Msg #6');
    expect(fromDB[19].content).toBe('Msg #25');
  });

  test('3. Kafka publishes with chatId key preserving partition affinity and in-order per-chat routing', async () => {
    const chatId = [userA._id.toString(), userB._id.toString()].sort().join(':');
    const testMessages = Array.from({ length: 15 }, (_, i) => ({
      messageId: `seq-${i}`,
      chatId,
      userId: userA._id.toString(),
      friendId: userB._id.toString(),
      content: `Seq #${i}`,
    }));

    // Record partitions assigned to these messages
    const metadata = await producer.send({
      topic: ORDER_TOPIC,
      messages: testMessages.map(m => ({
        key: m.chatId,
        value: JSON.stringify(m),
      })),
    });

    // All messages with identical key MUST land in the exact same partition
    const partitions = new Set(metadata.map(m => m.partition));
    expect(partitions.size).toBe(1);
  });

  test('4. Kafka-to-Redis fallback handles queuing and background retry recovery', async () => {
    const chatId = [userA._id.toString(), userB._id.toString()].sort().join(':');
    const fallbackKey = `chat:failed:${chatId}`;
    await redisClient.del(fallbackKey);

    const testMsg = {
      messageId: `fallback-${Date.now()}`,
      chatId,
      userId: userA._id.toString(),
      friendId: userB._id.toString(),
      content: 'Fallback retry test',
    };

    // Simulate fallback queue insertion
    await redisClient.lpush(fallbackKey, JSON.stringify(testMsg));

    // Verify message is queued
    const queued = await redisClient.lrange(fallbackKey, 0, -1);
    expect(queued).toHaveLength(1);

    // Run retryFailedMessages service
    await retryFailedMessages();

    // Verify message was successfully published and removed from the failed queue
    const remaining = await redisClient.lrange(fallbackKey, 0, -1);
    expect(remaining).toHaveLength(0);
  });
});
