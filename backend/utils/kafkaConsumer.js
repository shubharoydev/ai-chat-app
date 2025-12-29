import { connectKafkaConsumer } from '../config/kafka.js';
import { createError } from './errorHandler.js';

let consumer;

(async () => {
  try {
    consumer = await connectKafkaConsumer('chat-group');
  } catch (error) {
    console.error('Failed to initialize Kafka consumer:', error);
    process.exit(1);
  }
})();

export const consumeBatch = async (topic, batchCallback) => {
  if (!consumer) throw createError(500, 'Kafka consumer not initialized');

  try {
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({
      autoCommit: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
        const messages = batch.messages;
        console.log(`Received batch: ${messages.length} messages`);

        try {
          // Pass the raw messages + helpers to the worker callback
          await batchCallback(messages, resolveOffset, heartbeat);
        } catch (err) {
          console.error(`Error processing batch in ${topic}:`, err);
        }

        await commitOffsetsIfNecessary();
      },
    });
  } catch (err) {
    console.error(`Failed to consume Kafka messages from ${topic}:`, err);
    throw createError(500, `Failed to consume from ${topic}`, err);
  }
};
