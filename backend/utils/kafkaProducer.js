import { producer } from '../config/kafka.js';
import { createError } from './errorHandler.js';

let isProducerConnected = false;

const ensureProducerConnected = async () => {
  if (!isProducerConnected) {
    try {
      await producer.connect();
      isProducerConnected = true;
    } catch (err) {
      console.error('Kafka producer connection failed:', err);
      throw createError(500, 'Kafka producer connection failed', err);
    }
  }
};

export const publishMessage = async (topic, message) => {
  try {
    await ensureProducerConnected();
    await producer.send({
      topic,
      messages: [{ key: message.id || Date.now().toString(), value: JSON.stringify(message) }],
    });
  } catch (err) {
    console.error('Kafka message publish failed:', err);
    throw createError(500, 'Kafka message publish failed', err);
  }
};

export const publishBatchMessages = async (topic, messages) => {
  try {
    await ensureProducerConnected();
    await producer.send({
      topic,
      messages: messages.map(msg => ({
        key: msg.id || Date.now().toString(),
        value: JSON.stringify(msg),
      })),
    });
  } catch (err) {
    console.error('Kafka batch publish failed:', err);
    throw createError(500, 'Kafka batch publish failed', err);
  }
};

process.on('SIGTERM', async () => {
  try {
    if (isProducerConnected) {
      await producer.disconnect();
      console.log('Kafka producer disconnected');
    }
  } catch (err) {
    console.error('Error during Kafka shutdown:', err);
  }
  process.exit(0);
});
