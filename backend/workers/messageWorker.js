import { consumeBatch } from '../utils/kafkaConsumer.js';
import { Message } from '../models/messageModel.js';
import { logInfo, logError } from '../utils/logger.js';

export const startMessageBatching = async () => {
  try {
    logInfo('Starting message batch worker...');

    const messageBuffer = [];
    let lastFlushTime = Date.now();
    const FLUSH_INTERVAL = 5 * 60 * 1000; // 5 minutes
    const BULK_THRESHOLD = 1000; // Flush immediately when buffer reaches 1000 messages

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
        const result = await Message.bulkWrite(bulkOps, { ordered: false });

        logInfo('MongoDB bulkWrite completed', {
          insertedCount: result.upsertedCount || 0,
          modifiedCount: result.modifiedCount || 0,
          totalProcessed: messageBuffer.length,
        });

        // Commit Kafka offsets ONLY after DB success
        for (const { kafkaMsg, resolveOffset } of messageBuffer) {
          resolveOffset(kafkaMsg.offset);
        }

        // Clear buffer and update timestamp
        messageBuffer.length = 0;
        lastFlushTime = Date.now();

        logInfo('Kafka offsets committed successfully');
      } catch (err) {
        logError('MongoDB bulkWrite failed', { 
          error: err.message,
          bufferSize: messageBuffer.length 
        });
        // DO NOT clear buffer → Kafka will retry
        throw err; // Re-throw to trigger consumer pause
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

          // Auto-flush when buffer reaches threshold (1000 messages)
          if (messageBuffer.length >= BULK_THRESHOLD) {
            logInfo('Bulk threshold reached, flushing immediately', {
              count: messageBuffer.length,
              threshold: BULK_THRESHOLD,
            });
            await flushToMongo();
          }

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
