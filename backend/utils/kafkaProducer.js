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


// import { producer } from '../config/kafka.js';
// import { createError } from './errorHandler.js';

// let isProducerConnected = false;

// const ensureProducerConnected = async () => {
//   if (!isProducerConnected) {
//     try {
//       await producer.connect();
//       isProducerConnected = true;
//     } catch (err) {
//       console.error('Kafka producer connection failed:', err);
//       throw createError(500, 'Kafka producer connection failed', err);
//     }
//   }
// };

// export const publishMessage = async (topic, message) => {
//   try {
//     await ensureProducerConnected();
//     await producer.send({
//       topic,
//       messages: [{ key: message.messageId || Date.now().toString(), value: JSON.stringify(message) }],
//     });
//   } catch (err) {
//     console.error('Kafka message publish failed:', err);
//     throw createError(500, 'Kafka message publish failed', err);
//   }
// };

// export const publishBatchMessages = async (topic, messages) => {
//   try {
//     await ensureProducerConnected();
//     await producer.send({
//       topic,
//       messages: messages.map(msg => ({
//         key: msg.messageId || Date.now().toString(),
//         value: JSON.stringify(msg),
//       })),
//     });
//   } catch (err) {
//     console.error('Kafka batch publish failed:', err);
//     throw createError(500, 'Kafka batch publish failed', err);
//   }
// };

// process.on('SIGTERM', async () => {
//   try {
//     if (isProducerConnected) {
//       await producer.disconnect();
//       console.log('Kafka producer disconnected');
//     }
//   } catch (err) {
//     console.error('Error during Kafka shutdown:', err);
//   }
//   process.exit(0);
// });



//----------------------------------------------------------------------------------------//





import { kafka, producer } from '../config/kafka.js';

let producerConnected = false;

/**
 * Hardened Publish with Metadata Refresh
 * This solves the "This server does not host this topic-partition" error
 */
export const publishMessage = async (topic, message) => {
  try {
    // 1. Ensure Connection
    if (!producerConnected) {
      await producer.connect();
      producerConnected = true;
      console.log('Producer connected to Aiven');
    }

    // 2. The Secret Sauce: Force a Metadata Refresh
    // This tells the broker to confirm it owns the topic before we send the message
    const admin = kafka.admin();
    await admin.connect();
    try {
      // Fetching fetchTopicMetadata forces the client to find the leader
      await admin.fetchTopicMetadata({ topics: [topic] });
    } finally {
      await admin.disconnect();
    }

    // 3. Send Message
    await producer.send({
      topic,
      messages: [{
        key: message.messageId?.toString() || Date.now().toString(),
        value: JSON.stringify(message),
      }],
      // If the broker is still warming up, wait up to 30s for it to become leader
      timeout: 30000, 
    });

  } catch (err) {
    // Error Code 3 is 'UnknownTopicOrPartition'
    if (err.code === 3) {
      console.error(`CRITICAL: The topic "${topic}" does not exist or isn't ready on Aiven.`);
      console.log("Check Aiven Console and ensure the topic is created with Partitions: 1");
    }
    console.error('Kafka Message Publish Failed:', err.message);
    throw err;
  }
};