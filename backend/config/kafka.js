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

// import { Kafka, Partitioners, logLevel } from 'kafkajs';
// import { kafkaBrokers, kafkaClientId } from './env.js';
// import { logInfo, logError } from '../utils/logger.js';

// const kafka = new Kafka({
//   clientId: kafkaClientId,
//   brokers: kafkaBrokers,
//   logLevel: logLevel.ERROR, 
//   retry: {
//     initialRetryTime: 1000,
//     retries: 5, // how many times to retry before failing
//   },
// });

// // ✅ Create producer with idempotence enabled
// export const producer = kafka.producer({
//   createPartitioner: Partitioners.LegacyPartitioner,
//   maxInFlightRequests: 1,
//   idempotent: true, // guarantees exactly-once delivery
//   retries: 5,
//   maxRetryTime: 30000,
// });

// // Track producer state manually
// let isProducerConnected = false;

// // ✅ Event listeners for producer connection state
// producer.on(producer.events.CONNECT, () => {
//   isProducerConnected = true;
//   logInfo("✅ Kafka producer connected");
// });

// producer.on(producer.events.DISCONNECT, () => {
//   isProducerConnected = false;
//   logError("⚠️ Kafka producer disconnected");
// });

// // ✅ Consumer factory function
// export const connectKafkaConsumer = async (groupId) => {
//   const consumer = kafka.consumer({ groupId });
//   try {
//     await consumer.connect();
//     logInfo('✅ Kafka consumer connected', { groupId });
//     return consumer;
//   } catch (error) {
//     logError('❌ Failed to connect Kafka consumer', { error: error.message });
//     throw error;
//   }
// };

// // ✅ Check & reconnect producer if needed
// // (use this before producing messages)
// export const checkKafkaConnection = async () => {
//   try {
//     if (!isProducerConnected) {
//       await producer.connect(); // reconnect on demand
//       logInfo('✅ Kafka producer connected');
//     }
//     return true;
//   } catch (error) {
//     logError('❌ Kafka producer disconnected', { error: error.message });
//     return false;
//   }
// };

// // ✅ Safe send function (handles Redis fallback if Kafka fails)
// // Example use:
// // await safeSendMessage("chat-topic", { userId: 123, text: "hello" });
// export const safeSendMessage = async (topic, message, redisClient) => {
//   try {
//     await checkKafkaConnection();
//     await producer.send({
//       topic,
//       messages: [{ value: JSON.stringify(message) }],
//     });
//     logInfo('📨 Message sent to Kafka', { topic });
//   } catch (err) {
//     logError('❌ Failed to send to Kafka, saving to Redis', { error: err.message });
//     if (redisClient) {
//       await redisClient.lpush('failed-messages', JSON.stringify({ topic, message }));
//     }
//   }
// };

// // ✅ Ensure topic exists (prevents "leader not available" on new topics)
// export const ensureTopic = async (topic) => {
//   const admin = kafka.admin();
//   try {
//     await admin.connect();
//     await admin.createTopics({
//       topics: [{ topic }],
//     });
//     logInfo(`📌 Ensured topic exists: ${topic}`);
//   } catch (error) {
//     logError('❌ Failed to ensure topic', { error: error.message, topic });
//   } finally {
//     await admin.disconnect();
//   }
// };



// ------------------------------------------------------------------------------------------------//


import dotenv from 'dotenv';
dotenv.config();
import { Kafka, logLevel } from 'kafkajs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const broker = process.env.SERVICE_URI;
const hostname = broker.split(':')[0];

const caPath = path.resolve(process.cwd(), process.env.KAFKA_CA_CERT_PATH);
const ca = fs.readFileSync(caPath, 'utf-8');

export const kafka = new Kafka({
  clientId: 'chat-app',
  brokers: [broker],
  ssl: {
    ca: [ca],
    rejectUnauthorized: true,
    servername: hostname,
  },
  sasl: {
    mechanism: 'scram-sha-256',
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD
  },
  logLevel: logLevel.ERROR,
});


export const producer = kafka.producer({
  idempotent: true,
  maxInFlightRequests: 1,
});

export const ensureTopic = async (topic) => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const topics = await admin.listTopics();
    if (!topics.includes(topic)) {
      console.log(`Topic ${topic} does not exist. Creating...`);
      await admin.createTopics({
        topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
      });
      console.log(`Topic ${topic} created successfully.`);
    } else {
      console.log(`Topic ${topic} already exists.`);
    }
    await admin.disconnect();
  } catch (error) {
    console.error('Failed to ensure topic:', error);
  }
};

export const connectKafkaConsumer = async (groupId) => {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  return consumer;
};