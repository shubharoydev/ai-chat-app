import { connectKafkaConsumer } from '../config/kafka.js';
import { logError, logInfo } from './logger.js';

// Tracks the consumer created by the most recent consumeBatch call so it can be
// shut down cleanly (used by workers/messageWorker.js stopMessageBatching and by
// the integration test suite).
let activeConsumer = null;
let activeGroupId = null;

export const consumeBatch = async (topic, batchCallback, options = {}) => {
  const groupId = options.groupId
    || process.env.KAFKA_CONSUMER_GROUP
    || 'chat-group-worker';

  try {
    // Connect a consumer specifically for this worker
    const consumer = await connectKafkaConsumer(groupId);
    activeConsumer = consumer;
    activeGroupId = groupId;

    await consumer.subscribe({ topic, fromBeginning: options.fromBeginning ?? false });
    logInfo(`Subscribed to topic: ${topic}`, { groupId });

    await consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        if (!isRunning() || isStale()) return;

        try {
          // Pass raw messages and helpers to the worker
          await batchCallback(batch.messages, resolveOffset, heartbeat);
        } catch (err) {
          logError(`Error processing batch in ${topic}`, { error: err.message });
        }
      },
    });
  } catch (err) {
    logError(`Failed to consume Kafka messages from ${topic}`, { error: err.message });
    throw err;
  }
};

// Disconnects the active consumer if any. Safe to call multiple times.
export const stopConsumer = async () => {
  if (!activeConsumer) return;
  const consumer = activeConsumer;
  activeConsumer = null;
  activeGroupId = null;
  try {
    await consumer.disconnect();
    logInfo('Kafka consumer disconnected');
  } catch (err) {
    logError('Failed to disconnect Kafka consumer', { error: err.message });
  }
};

export const getActiveConsumerGroupId = () => activeGroupId;
