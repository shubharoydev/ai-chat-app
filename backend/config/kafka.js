import { Kafka, Partitioners, logLevel } from 'kafkajs';
import { kafkaBrokers, kafkaClientId } from './env.js';
import { logInfo, logError } from '../utils/logger.js';

const kafka = new Kafka({
  clientId: kafkaClientId,
  brokers: kafkaBrokers,
  logLevel: logLevel.ERROR, 
  retry: {
    initialRetryTime: 1000,
    retries: 5, // how many times to retry before failing
  },
});

// ✅ Create producer with idempotence enabled
export const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
  maxInFlightRequests: 1,
  idempotent: true, // guarantees exactly-once delivery
  retries: 5,
  maxRetryTime: 30000,
});

// Track producer state manually
let isProducerConnected = false;

// ✅ Event listeners for producer connection state
producer.on(producer.events.CONNECT, () => {
  isProducerConnected = true;
  logInfo("✅ Kafka producer connected");
});

producer.on(producer.events.DISCONNECT, () => {
  isProducerConnected = false;
  logError("⚠️ Kafka producer disconnected");
});

// ✅ Consumer factory function
export const connectKafkaConsumer = async (groupId) => {
  const consumer = kafka.consumer({ groupId });
  try {
    await consumer.connect();
    logInfo('✅ Kafka consumer connected', { groupId });
    return consumer;
  } catch (error) {
    logError('❌ Failed to connect Kafka consumer', { error: error.message });
    throw error;
  }
};

// ✅ Check & reconnect producer if needed
// (use this before producing messages)
export const checkKafkaConnection = async () => {
  try {
    if (!isProducerConnected) {
      await producer.connect(); // reconnect on demand
      logInfo('✅ Kafka producer connected');
    }
    return true;
  } catch (error) {
    logError('❌ Kafka producer disconnected', { error: error.message });
    return false;
  }
};

// ✅ Safe send function (handles Redis fallback if Kafka fails)
// Example use:
// await safeSendMessage("chat-topic", { userId: 123, text: "hello" });
export const safeSendMessage = async (topic, message, redisClient) => {
  try {
    await checkKafkaConnection();
    await producer.send({
      topic,
      messages: [{ value: JSON.stringify(message) }],
    });
    logInfo('📨 Message sent to Kafka', { topic });
  } catch (err) {
    logError('❌ Failed to send to Kafka, saving to Redis', { error: err.message });
    if (redisClient) {
      await redisClient.lpush('failed-messages', JSON.stringify({ topic, message }));
    }
  }
};

// ✅ Ensure topic exists (prevents "leader not available" on new topics)
export const ensureTopic = async (topic) => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic }],
    });
    logInfo(`📌 Ensured topic exists: ${topic}`);
  } catch (error) {
    logError('❌ Failed to ensure topic', { error: error.message, topic });
  } finally {
    await admin.disconnect();
  }
};

