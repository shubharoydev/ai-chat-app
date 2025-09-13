import { Message } from '../models/messageModel.js';
import { getRedisClient } from '../config/redisSetup.js';
import { producer } from '../config/kafka.js';
import { createError } from '../utils/errorHandler.js';

export const batchMessagesToKafka = async () => {
  const redisClient = getRedisClient();
  
  if (!redisClient.isReady) {
    throw createError(503, 'Redis client is not connected');
  }

  try {
    let cursor = '0';
    const batchSize = 100;
    let processedCount = 0;

    do {
      const [nextCursor, keys] = await redisClient.scan(
        cursor,
        'MATCH', 'chat:*',
        'COUNT', batchSize
      );
      
      cursor = nextCursor;

      for (const key of keys) {
        try {
          const messages = await redisClient.multi()
            .lrange(key, 0, -1)
            .del(key)
            .exec();

          if (!messages || !messages[0]?.length) continue;
          
          const messageBatch = messages[0].map(msg => {
            try {
              return JSON.parse(msg);
            } catch (parseError) {
              logError('Error parsing message', { error: parseError, message: msg });
              return null;
            }
          }).filter(Boolean);

          if (!messageBatch.length) continue;

          try {
            await producer.send({
              topic: 'chat-messages-persist',
              messages: messageBatch.map(msg => ({
                key: msg.chatId,
                value: JSON.stringify(msg),
                timestamp: Date.now()
              })),
            });
            processedCount += messageBatch.length;
          } catch (kafkaError) {
            logError('Failed to send batch to Kafka', { 
              error: kafkaError,
              batchSize: messageBatch.length 
            });
          }
        } catch (keyError) {
          logError('Error processing key', { key, error: keyError });
          continue;
        }
      }
    } while (cursor !== '0');

    return { success: true, processedCount };
  } catch (error) {
    const errorMsg = 'Failed to batch messages to Kafka';
    logError(errorMsg, { error: error.message, stack: error.stack });
    throw createError(500, errorMsg, error);
  }
};

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export const persistMessagesFromKafka = async (messages, attempt = 1) => {
  if (!messages || !messages.length) {
    logInfo('No messages to persist');
    return { success: true, processed: 0 };
  }

  try {
    const validMessages = [];
    const invalidMessages = [];
    
    messages.forEach(msg => {
      try {
        if (!msg.chatId || !msg.userId || !msg.content) { // Modified: Use userId
          throw new Error('Missing required fields');
        }
        
        validMessages.push({
          chatId: msg.chatId,
          userId: msg.userId, // Modified: Use userId
          friendId: msg.friendId, // Modified: Include friendId
          content: msg.content,
          timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
          isAI: msg.isAI ?? false, // Fixed: Ensure isAI is boolean
          metadata: msg.metadata || {}
        });
      } catch (validationError) {
        logError('Invalid message format', { 
          message: msg, 
          error: validationError.message 
        });
        invalidMessages.push({ message: msg, error: validationError });
      }
    });

    if (!validMessages.length) {
      logError('No valid messages to persist');
      return { 
        success: false, 
        error: 'No valid messages to persist',
        invalidCount: invalidMessages.length
      };
    }

    const bulkOps = validMessages.map(msg => ({
      updateOne: {
        filter: { 
          chatId: msg.chatId,
          'metadata.messageId': msg.metadata?.messageId || null
        },
        update: { $set: msg },
        upsert: true
      }
    }));

    let result;
    try {
      result = await Message.bulkWrite(bulkOps, { 
        ordered: false,
        writeConcern: { w: 'majority', wtimeout: 5000 }
      });
      
      logInfo('Messages persisted successfully', { 
        inserted: result.upsertedCount,
        modified: result.modifiedCount,
        total: validMessages.length
      });
      
      return { 
        success: true, 
        processed: result.upsertedCount + result.modifiedCount,
        invalidCount: invalidMessages.length
      };
      
    } catch (bulkError) {
      logError('Bulk write error', { 
        error: bulkError.message,
        failedCount: validMessages.length,
        attempt
      });
      
      if (attempt < MAX_RETRIES) {
        logInfo(`Retrying bulk write (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        return persistMessagesFromKafka(validMessages, attempt + 1);
      }
      
      throw createError(500, 'Failed to persist messages after multiple attempts', bulkError);
    }
    
  } catch (error) {
    const errorMsg = 'Failed to persist messages to MongoDB';
    logError(errorMsg, { 
      error: error.message, 
      stack: error.stack,
      failedCount: messages ? messages.length : 0
    });
    
    throw createError(500, errorMsg, error);
  }
};