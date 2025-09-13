import { connectKafkaConsumer } from '../config/kafka.js';
import { Message } from '../models/messageModel.js';
import { getRedisClient } from '../config/redisSetup.js';
import { logInfo, logError } from '../utils/logger.js';
import { createError } from '../utils/errorHandler.js';

let messageBuffer = [];
const BATCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BUFFER_TTL_SECONDS = 3600; // 1 hour

export const startMessageBatching = async () => {
  try {
    const redisClient = getRedisClient();
    logInfo('⏳ Connecting to Kafka consumer for message batching...');

    const consumer = await connectKafkaConsumer('chat-consumer-group');
    logInfo('✅ Successfully connected to Kafka consumer');

    await consumer.subscribe({ topic: 'chat-messages-persist', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const parsed = JSON.parse(message.value.toString());
          messageBuffer.push(parsed);

          const bufferKey = `chat:buffer:${parsed.chatId}`;
          await redisClient.lpush(bufferKey, JSON.stringify(parsed));
          await redisClient.expire(bufferKey, BUFFER_TTL_SECONDS);

          logInfo('📥 Kafka batch received with 1 message', {
            messageId: parsed.id,
            chatId: parsed.chatId,
            isAI: parsed.isAI, // Added: Log isAI for debugging
          });
        } catch (error) {
          logError('❌ Failed to process Kafka message', {
            error: error.message,
            message: message?.value?.toString()?.substring(0, 100) + '...',
          });
        }
      },
    });

    // Periodic batch processing
    setInterval(async () => {
      logInfo('⏳ Starting message batch processing...', { batchSize: messageBuffer.length });

      if (messageBuffer.length === 0) {
        logInfo('🚫 No messages to persist in this batch');
        return;
      }

      const toInsert = [...messageBuffer];
      messageBuffer = [];

      // Include failed messages from Redis
      const failedKeys = await redisClient.keys('chat:failed:*');
      for (const key of failedKeys) {
        const failedMessages = await redisClient.lrange(key, 0, -1);
        const parsedMessages = failedMessages.map(JSON.parse);
        toInsert.push(...parsedMessages);
      }

      logInfo('📥 Kafka batch received with ' + toInsert.length + ' messages', { batchSize: toInsert.length });
      logInfo('📦 Inserting ' + toInsert.length + ' messages into MongoDB...');

      try {
        const bulkOps = toInsert.map((msg) => {
          return {
            insertOne: {
              document: {
                chatId: msg.chatId,
                userId: msg.userId, // Fixed: Use userId
                friendId: msg.friendId, // Fixed: Use friendId
                content: msg.content,
                timestamp: new Date(msg.timestamp),
                isAI: msg.isAI ?? false, // Fixed: Include isAI field
              },
            },
          };
        });

        if (bulkOps.length) {
          await Message.bulkWrite(bulkOps);
          logInfo('✅ MongoDB insert successful', { insertedCount: bulkOps.length });

          // Clean up Redis after MongoDB success
          for (const msg of toInsert) {
            const bufferKey = `chat:buffer:${msg.chatId}`;
            const failedKey = `chat:failed:${msg.chatId}`;

            await redisClient.lrem(bufferKey, 1, JSON.stringify(msg));
            await redisClient.lrem(failedKey, 1, JSON.stringify(msg));
            // Removed: Status field not used
            // await redisClient.setWithExpiry(`msg:status:${msg.id}`, 'delivered', 3600);
          }

          // Delete empty failed keys
          for (const key of failedKeys) {
            if ((await redisClient.llen(key)) === 0) {
              await redisClient.del(key);
            }
          }
        }
      } catch (error) {
        logError('❌ Failed to insert batch to MongoDB', { error: error.message });
        messageBuffer.push(...toInsert);
        logInfo('Batch pushed back into buffer for retry', { restoredCount: toInsert.length });
      }
    }, BATCH_INTERVAL_MS);

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      logInfo('Shutting down Kafka consumer...');
      await consumer.disconnect();
      logInfo('Kafka consumer disconnected');
      process.exit(0);
    });
  } catch (error) {
    logError('❌ Failed to start message batching', { error: error.message });
    throw error;
  }
};