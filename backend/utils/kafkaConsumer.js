// NOTE:
// KAFKA CONFIGURATION SWITCH — READ BEFORE CHANGING
//
// This application previously used a LOCAL Kafka instance
// started via Docker Compose. It has now been upgraded to use
// an AIVEN cloud-based Kafka service.
//
// LOCAL DEVELOPMENT WITH DOCKER KAFKA:
// - Uncomment the "Local Kafka (Docker)" configuration
// - Comment out the "Aiven Kafka" configuration
// - Use ONLY when Kafka is running via docker-compose
//
// AIVEN CLOUD KAFKA (DEFAULT / PRODUCTION):
// - Use the "Aiven Kafka" configuration
// - Requires SASL/SSL configuration and Aiven credentials
// - Do NOT use local Kafka settings with Aiven brokers
//
// Incorrect configuration will cause authentication or
// broker connection failures.

//---------------------------------------------------------------------------------//


// import { connectKafkaConsumer } from '../config/kafka.js';
// import { createError } from './errorHandler.js';

// let consumer;

// (async () => {
//   try {
//     consumer = await connectKafkaConsumer('chat-group');
//   } catch (error) {
//     console.error('Failed to initialize Kafka consumer:', error);
//     process.exit(1);
//   }
// })();

// export const consumeBatch = async (topic, batchCallback) => {
//   if (!consumer) throw createError(500, 'Kafka consumer not initialized');

//   try {
//     await consumer.subscribe({ topic, fromBeginning: false });
//     await consumer.run({
//       autoCommit: false,
//       eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
//         const messages = batch.messages;
//         console.log(`Received batch: ${messages.length} messages`);

//         try {
//           // Pass the raw messages + helpers to the worker callback
//           await batchCallback(messages, resolveOffset, heartbeat);
//         } catch (err) {
//           console.error(`Error processing batch in ${topic}:`, err);
//         }

//         await commitOffsetsIfNecessary();
//       },
//     });
//   } catch (err) {
//     console.error(`Failed to consume Kafka messages from ${topic}:`, err);
//     throw createError(500, `Failed to consume from ${topic}`, err);
//   }
// };

//----------------------------------------------------------------------------------------------------------//




import { connectKafkaConsumer } from '../config/kafka.js';
import { logError, logInfo } from './logger.js';

export const consumeBatch = async (topic, batchCallback) => {
  try {
    // Connect a consumer specifically for this worker
    const consumer = await connectKafkaConsumer('chat-group-worker');

    await consumer.subscribe({ topic, fromBeginning: false });
    logInfo(`Subscribed to topic: ${topic}`);

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