import { consumeBatch, stopConsumer } from '../utils/kafkaConsumer.js';
import { Message } from '../models/messageModel.js';
import { logInfo, logError } from '../utils/logger.js';
import { producer, ensureTopic } from '../config/kafka.js';

// All values are configurable for operability and testing, with defaults that
// preserve the original production behaviour.
const PERSIST_TOPIC = process.env.KAFKA_PERSIST_TOPIC || 'chat-messages-persist';
const DLQ_TOPIC = process.env.KAFKA_DLQ_TOPIC || 'chat-messages-dlq';
const CONSUMER_GROUP = process.env.KAFKA_CONSUMER_GROUP || 'chat-group-worker';
const FLUSH_INTERVAL = Number(process.env.MESSAGE_FLUSH_INTERVAL_MS) || 5 * 60 * 1000; // 5 minutes
const BULK_THRESHOLD = Number(process.env.MESSAGE_BULK_THRESHOLD) || 1000; // flush at 1000 messages
const MAX_BUFFER_SIZE = Number(process.env.MESSAGE_MAX_BUFFER_SIZE) || 5000; // backpressure ceiling

// Handle to the active timer and flush routine, so the worker can be stopped
// cleanly (flushing pending messages) on graceful shutdown.
let flushTimer = null;
let flushNow = null;

// Sends a poison message to the dead-letter topic.
// Returns true only if the message was successfully handed off to Kafka.
// Callers MUST NOT commit the source offset when this returns false, otherwise
// the message would be silently dropped.
const sendToDLQ = async (msg, errorMessage) => {
  try {
    await producer.send({
      topic: DLQ_TOPIC,
      messages: [{
        key: msg.key,
        value: msg.value,
        headers: {
          ...msg.headers,
          error: errorMessage,
          originalTopic: PERSIST_TOPIC,
        },
      }],
    });
    logInfo('Message sent to DLQ', { topic: DLQ_TOPIC });
    return true;
  } catch (err) {
    logError('Failed to send message to DLQ', { error: err.message });
    return false;
  }
};

export const startMessageBatching = async () => {
  try {
    logInfo('Starting message batch worker...', { topic: PERSIST_TOPIC, groupId: CONSUMER_GROUP });
    await ensureTopic(DLQ_TOPIC);

    const messageBuffer = [];
    let lastFlushTime = Date.now();

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
          bufferSize: messageBuffer.length,
        });
        // DO NOT clear buffer → Kafka will retry
        throw err; // Re-throw to trigger consumer pause
      }
    };

    // Flush every FLUSH_INTERVAL
    flushNow = flushToMongo;
    flushTimer = setInterval(() => {
      flushToMongo().catch(err => logError('Background flush to Mongo failed', { error: err.message }));
    }, FLUSH_INTERVAL);

    await consumeBatch(PERSIST_TOPIC, async (kafkaMessages, resolveOffset, heartbeat) => {
      if (!kafkaMessages.length) return;

      for (const msg of kafkaMessages) {
        let parsed;
        try {
          parsed = JSON.parse(msg.value.toString());
          if (!parsed.messageId) {
            throw new Error('Missing messageId');
          }
        } catch (err) {
          logError('Invalid Kafka message, sending to DLQ', { error: err.message });
          const delivered = await sendToDLQ(msg, err.message);
          if (delivered) {
            // Only commit the offset once the poison message is safely in the DLQ.
            resolveOffset(msg.offset);
          } else {
            // DLQ unavailable: leave the offset uncommitted so the message is
            // redelivered after a restart/rebalance instead of being lost.
            logError('DLQ delivery failed; leaving offset uncommitted for redelivery', {
              offset: msg.offset,
            });
          }
          continue;
        }

        // Flow control / Backpressure: if buffer is at or exceeds MAX_BUFFER_SIZE, flush immediately and wait
        while (messageBuffer.length >= MAX_BUFFER_SIZE) {
          logInfo('Buffer capacity reached, applying backpressure and flushing', {
            bufferSize: messageBuffer.length,
            maxBufferSize: MAX_BUFFER_SIZE,
          });
          await flushToMongo();
          if (messageBuffer.length >= MAX_BUFFER_SIZE) {
            await heartbeat();
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }

        messageBuffer.push({
          kafkaMsg: msg,
          data: parsed,
          resolveOffset,
        });

        // Auto-flush when buffer reaches threshold
        if (messageBuffer.length >= BULK_THRESHOLD) {
          logInfo('Bulk threshold reached, flushing immediately', {
            count: messageBuffer.length,
            threshold: BULK_THRESHOLD,
          });
          await flushToMongo();
        }
      }

      await heartbeat();
    }, { groupId: CONSUMER_GROUP });
  } catch (error) {
    logError('Failed to start batching', { error: error.message });
    throw error;
  }
};

// Graceful shutdown: attempt a final flush of any buffered messages, then
// disconnect the Kafka consumer. Safe to call when the worker is not running.
export const stopMessageBatching = async () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (flushNow) {
    try {
      await flushNow();
    } catch (err) {
      logError('Final flush during shutdown failed; messages remain committed-safe for redelivery', {
        error: err.message,
      });
    }
    flushNow = null;
  }
  await stopConsumer();
};
