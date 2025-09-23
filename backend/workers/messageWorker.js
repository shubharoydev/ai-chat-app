import { connectKafkaConsumer } from '../config/kafka.js';
import { Message } from '../models/messageModel.js';
import { getRedisClient } from '../config/redisSetup.js';
import { logInfo, logError } from '../utils/logger.js';

let messageBuffer = [];
const BATCH_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export const startMessageBatching = async () => {
  try {
    const consumer = await connectKafkaConsumer('chat-consumer-group');
    await consumer.subscribe({ topic: 'chat-messages-persist', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const parsed = JSON.parse(message.value.toString());
          messageBuffer.push(parsed);

          logInfo('📥 Message received from Kafka', { messageId: parsed.id, chatId: parsed.chatId });
        } catch (err) {
          logError('❌ Failed to parse Kafka message', { error: err.message });
        }
      },
    });

    // ✅ Process batches
    setInterval(async () => {
      if (!messageBuffer.length) return;

      const toInsert = [...messageBuffer];
      messageBuffer = [];

      try {

        const bulkOps = toInsert.map(msg => ({
         updateOne: {
         filter: { chatId: msg.chatId, timestamp: msg.timestamp, userId: msg.userId },
             update: {
             $setOnInsert: {
        chatId: msg.chatId,
        userId: msg.userId,
        friendId: msg.friendId,
        content: msg.content,
        timestamp: new Date(msg.timestamp),
        isAI: msg.isAI ?? false,
      },
    },
    upsert: true, // ✅ prevents duplicates
  },
}));


        await Message.bulkWrite(bulkOps, { ordered: false });
        logInfo('✅ Batch persisted to MongoDB', { count: bulkOps.length });
      } catch (error) {
        logError('❌ MongoDB batch insert failed', { error: error.message });
        messageBuffer.push(...toInsert); // retry next cycle
      }
    }, BATCH_INTERVAL_MS);

    process.on('SIGTERM', async () => {
      await consumer.disconnect();
      process.exit(0);
    });
  } catch (error) {
    logError('❌ Failed to start batching', { error: error.message });
    throw error;
  }
};
