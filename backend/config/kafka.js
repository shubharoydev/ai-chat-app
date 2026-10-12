// NOTE:
// KAFKA CONFIGURATION SWITCH — READ BEFORE CHANGING
//
// This application previously used a LOCAL Kafka instance
// started via Docker Compose. It was later upgraded to use an
// AIVEN cloud-based Kafka service. Both modes are now supported
// and selected automatically at runtime:
//
//   - AIVEN / CLOUD (default): used when SERVICE_URI is set.
//     Requires SASL/SSL credentials and a CA certificate.
//   - LOCAL / DOCKER COMPOSE (fallback): used when SERVICE_URI is
//     NOT set. Connects to the plaintext brokers in KAFKA_BROKERS.
//
// Do NOT point local Kafka settings at Aiven brokers (or vice versa):
// incorrect configuration causes authentication or connection failures.

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

// ---------------------------------------------------------------------------
// Kafka client configuration.
//
// Two mutually exclusive modes are supported:
//
//   1. AIVEN / CLOUD (default): used whenever SERVICE_URI is set. Requires
//      KAFKA_USERNAME, KAFKA_PASSWORD and a CA certificate. This is the
//      original production configuration and is preserved unchanged.
//
//   2. LOCAL / DOCKER COMPOSE (fallback): used when SERVICE_URI is NOT set.
//      Connects to the plaintext brokers listed in KAFKA_BROKERS. This mode
//      exists for local development and the automated integration test suite.
// ---------------------------------------------------------------------------
const serviceUri = process.env.SERVICE_URI;
// Explicit override wins: KAFKA_MODE=local forces local brokers even if
// SERVICE_URI is present; KAFKA_MODE=cloud forces the cloud configuration.
// When KAFKA_MODE is unset, presence of SERVICE_URI selects cloud mode.
const kafkaMode = process.env.KAFKA_MODE;
export const isCloudKafka = kafkaMode
  ? kafkaMode !== 'local'
  : Boolean(serviceUri);

const buildKafkaConfig = () => {
  if (isCloudKafka) {
    const hostname = serviceUri.split(':')[0];

    const caPath = path.resolve(process.cwd(), process.env.KAFKA_CA_CERT_PATH || './certs/ca.pem');
    if (!fs.existsSync(caPath)) {
      throw new Error(`Kafka CA certificate not found at: ${caPath}`);
    }
    const ca = fs.readFileSync(caPath, 'utf-8');

    if (!process.env.KAFKA_USERNAME || !process.env.KAFKA_PASSWORD) {
      throw new Error('KAFKA_USERNAME and KAFKA_PASSWORD environment variables must be set');
    }

    return {
      clientId: process.env.KAFKA_CLIENT_ID || 'chat-app',
      brokers: [serviceUri],
      ssl: {
        ca: [ca],
        rejectUnauthorized: true,
        servername: hostname,
      },
      sasl: {
        mechanism: 'scram-sha-256',
        username: process.env.KAFKA_USERNAME,
        password: process.env.KAFKA_PASSWORD,
      },
      logLevel: logLevel.ERROR,
      connectionTimeout: 30000,
      requestTimeout: 30000,
      retry: {
        initialRetryTime: 100,
        maxRetryTime: 30000,
        retries: 10,
        factor: 0.2,
      },
    };
  }

  // Local / docker-compose plaintext brokers.
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  return {
    clientId: process.env.KAFKA_CLIENT_ID || 'chat-app',
    brokers,
    logLevel: logLevel.ERROR,
    connectionTimeout: 30000,
    requestTimeout: 30000,
    retry: {
      initialRetryTime: 100,
      maxRetryTime: 30000,
      retries: 10,
      factor: 0.2,
    },
  };
};

export const kafka = new Kafka(buildKafkaConfig());

export const producer = kafka.producer({
  idempotent: true,
  maxInFlightRequests: 1,
});

export const ensureTopic = async (topic, options = {}) => {
  const numPartitions = options.numPartitions
    || Number(process.env.KAFKA_TOPIC_PARTITIONS)
    || 1;
  const replicationFactor = options.replicationFactor
    || Number(process.env.KAFKA_TOPIC_REPLICATION_FACTOR)
    || (isCloudKafka ? 1 : 3);

  // In local mode the broker default min.insync.replicas may be 2, which
  // would reject acks=all produces for a topic created with replicationFactor
  // 1. Override it per-topic so the idempotent producer keeps working.
  const topicConfig = isCloudKafka ? [] : [{ name: 'min.insync.replicas', value: '1' }];

  const admin = kafka.admin();
  try {
    await admin.connect();
    const topics = await admin.listTopics();
    if (!topics.includes(topic)) {
      console.log(`Topic ${topic} does not exist. Creating...`);
      await admin.createTopics({
        topics: [{
          topic,
          numPartitions,
          replicationFactor,
          configEntries: topicConfig,
        }],
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

export const disconnectProducer = async () => {
  try {
    await producer.disconnect();
  } catch (err) {
    console.error('Failed to disconnect producer:', err);
  }
};
