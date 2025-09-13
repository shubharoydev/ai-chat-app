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

export const consumeMessages = async (topic, callback) => {
  if (!consumer) throw createError(500, 'Kafka consumer not initialized');

  try {
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const value = message.value ? JSON.parse(message.value.toString()) : null;
          if (value) await callback(value);
        } catch (err) {
          console.error(`Error in topic ${topic}:`, err);
          throw createError(500, `Failed to process message in ${topic}`, err);
        }
      },
    });
  } catch (err) {
    console.error(`Failed to consume Kafka messages from ${topic}:`, err);
    throw createError(500, `Failed to consume from ${topic}`, err);
  }
};
