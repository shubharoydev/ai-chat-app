import { consumeBatch } from '../utils/kafkaConsumer.js';
import { Message } from '../models/messageModel.js';
import { logInfo, logError } from '../utils/logger.js';

export const startMessageBatching = async () => {
  try {
    logInfo('Starting message batch worker...');

    const messageBuffer = [];
    let lastFlushTime = Date.now();
    const FLUSH_INTERVAL = 5 * 60 * 1000; // 5 minutes

    const flushToMongo = async () => {
      if (!messageBuffer.length) return;

      logInfo('Flushing messages to MongoDB...', {
        count: messageBuffer.length,
      });

      const bulkOps = messageBuffer.map(({ data }) => ({
        updateOne: {
          filter: { messageId: data.messageId },
          update: {
            $setOnInsert: {
              chatId: data.chatId,
              userId: data.userId,
              friendId: data.friendId,
              content: data.content,
              timestamp: new Date(data.timestamp),
              isAI: data.isAI ?? false,
              messageId: data.messageId,
            },
          },
          upsert: true,
        },
      }));

      try {
        await Message.bulkWrite(bulkOps, { ordered: false });

        // Commit Kafka offsets ONLY after DB success
        for (const { kafkaMsg, resolveOffset } of messageBuffer) {
          resolveOffset(kafkaMsg.offset);
        }

        messageBuffer.length = 0;
        lastFlushTime = Date.now();

        logInfo('MongoDB bulkWrite completed');
      } catch (err) {
        logError('MongoDB bulkWrite failed', { error: err.message });
        // DO NOT clear buffer → Kafka will retry
      }
    };

    // Flush every 5 minutes
    setInterval(flushToMongo, FLUSH_INTERVAL);

    await consumeBatch('chat-messages-persist', async (kafkaMessages, resolveOffset, heartbeat) => {
      if (!kafkaMessages.length) return;

      for (const msg of kafkaMessages) {
        try {
          const parsed = JSON.parse(msg.value.toString());

          if (!parsed.messageId) {
            console.warn('Skipping message without messageId', { parsed });
            resolveOffset(msg.offset);
            continue;
          }

          messageBuffer.push({
            kafkaMsg: msg,
            data: parsed,
            resolveOffset,
          });
        } catch (err) {
          logError('Failed to parse Kafka message', { error: err.message });
          resolveOffset(msg.offset); 
        }
      }

      await heartbeat();
    });
  } catch (error) {
    logError('Failed to start batching', { error: error.message });
    throw error;
  }
};
