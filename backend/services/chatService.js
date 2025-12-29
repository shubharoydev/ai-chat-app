import { getIO } from '../sockets/chatSocket.js';
import { Friend } from '../models/friendModel.js';
import { Message } from '../models/messageModel.js';
import { getRedisClient } from '../config/redisSetup.js';
import { producer } from '../config/kafka.js';
import { createError } from '../utils/errorHandler.js';
import { getGeminiResponse } from '../utils/gemini.js';
import { logInfo, logError } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import asyncRetry from 'async-retry';
import mongoose from 'mongoose';

const RECENT_TTL = 7 * 24 * 60 * 60; // 7 days
const FAILED_TTL = 7 * 24 * 60 * 60; // 7 days

// Kafka publisher
const publishToKafka = async (msg) => {
  try {
    await producer.send({
      topic: 'chat-messages-persist',
      messages: [{ value: JSON.stringify(msg) }],
    });
    logInfo('Published to Kafka', { chatId: msg.chatId, tempId: msg.tempId });
  } catch (err) {
    logError('Kafka publish failed', { error: err.message });
    throw err;
  }
};

export const sendMessage = async (userId, friendId, content, clientTempId) => {
  const tempId = clientTempId;
  const chatId = [userId, friendId].sort().join(':');
  const redisKey = `chat:recent:${chatId}`;

  const message = {
    messageId: uuidv4(),
    tempId, // keep tempId for frontend optimistic match only
    chatId,
    userId,
    friendId,
    content,
    timestamp: new Date().toISOString(),
    isAI: false,
  };

  const redisClient = getRedisClient();
  const io = getIO();

  io.to(userId).emit("receiveMessage", message);
  io.to(friendId).emit("receiveMessage", message);

  // Handle AI mode
  if (content.startsWith("/ai ") || content.startsWith("/ai:")) {
    const query = content.slice(4).trim();
    if (!query) throw createError(400, "AI query cannot be empty");

    // Save user message (Try-Catch to avoid blocking logic if Redis is down)
    try {
      await redisClient.lpush(redisKey, JSON.stringify(message));
      await redisClient.expire(redisKey, 7 * 24 * 3600);
    } catch (redisErr) {
      logError('Redis write failed (AI-UserMsg), proceeding...', { error: redisErr.message });
      message.redisWriteFailed = true;
    }

    // publish to kafka
    try {
      await asyncRetry(() => publishToKafka(message), {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 5000,
      });
    } catch (err) {
      await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(message));
      await redisClient.expire(`chat:failed:${chatId}`, 7 * 24 * 3600);
    }

    //  Generate AI response
    const aiResponse = await getGeminiResponse(query);
    const aiMessage = {
      messageId: uuidv4(),
      tempId,
      chatId,
      userId,
      friendId,
      content: aiResponse,
      timestamp: new Date().toISOString(),
      isAI: true,
    };

    //  Emit AI message instantly too
    io.to(userId).emit("receiveMessage", aiMessage);
    io.to(friendId).emit("receiveMessage", aiMessage);

    // save AI message in same redis key
    try {
      await redisClient.lpush(redisKey, JSON.stringify(aiMessage));
      await redisClient.expire(redisKey, 7 * 24 * 3600);
    } catch (redisErr) {
      logError('Redis write failed (AI-Response), proceeding...', { error: redisErr.message });
      aiMessage.redisWriteFailed = true;
    }

    try {
      await asyncRetry(() => publishToKafka(aiMessage), {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 5000,
      });
    } catch (err) {
      await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(aiMessage));
      await redisClient.expire(`chat:failed:${chatId}`, 7 * 24 * 3600);
    }

    return [message, aiMessage];
  }

  // Normal messages
  try {
    await redisClient.lpush(redisKey, JSON.stringify(message));
    await redisClient.expire(redisKey, 7 * 24 * 3600);
  } catch (redisErr) {
    logError('Redis write failed (Normal), proceeding...', { error: redisErr.message });
    message.redisWriteFailed = true;
  }

  try {
    await asyncRetry(() => publishToKafka(message), {
      retries: 3,
      minTimeout: 1000,
      maxTimeout: 5000,
    });
  } catch (err) {
    await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(message));
    await redisClient.expire(`chat:failed:${chatId}`, 7 * 24 * 3600);
  }

  return message;
};


//Get messages
export const getMessages = async (userId, friendId) => {
  try {
    const redisClient = getRedisClient();
    const chatId = [userId, friendId].sort().join(':');
    const redisKey = `chat:recent:${chatId}`;

    // Try Redis first
    let cachedMessages = await redisClient.lrange(redisKey, 0, -1);

    if (cachedMessages.length > 0) {
      const msgs = cachedMessages.map(JSON.parse);
      return msgs.slice(-20); // ensure only last 20
    }

    // If Redis empty → fetch from MongoDB
    const dbMessages = await Message.find({ chatId })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();

    const finalMessages = dbMessages.reverse(); // oldest → newest

    // Save them to Redis (for next time)
    if (finalMessages.length > 0) {
      const pipeline = redisClient.multi();

      finalMessages.forEach(msg => {
        pipeline.lpush(redisKey, JSON.stringify(msg));
      });

      pipeline.expire(redisKey, 7 * 24 * 3600);
      await pipeline.exec();
    }

    return finalMessages;
  } catch (error) {
    logError("❌ Failed to fetch messages", { error: error.message });
    throw error;
  }
};

// Add friend
export const addFriend = async (userId, friendId) => {
  try {
    if (userId === friendId) {
      throw createError(400, 'Cannot add yourself');
    }

    const uid = new mongoose.Types.ObjectId(userId);
    const fid = new mongoose.Types.ObjectId(friendId);

    const existing = await Friend.findOne({
      $or: [
        { userId: uid, friendId: fid },
        { userId: fid, friendId: uid },
      ],
    });

    if (existing) return existing;

    const friendships = [
      { userId: uid, friendId: fid },
      { userId: fid, friendId: uid },
    ];
    return await Friend.insertMany(friendships);
  } catch (error) {
    logError('❌ Failed to add friend', { error: error.message });
    throw error;
  }
};

// Retry failed messages every 30 min
export const retryFailedMessages = async () => {
  try {
    const redisClient = getRedisClient();
    const keys = await redisClient.keys('chat:failed:*');
    if (!keys.length) return;

    for (const key of keys) {
      const failedMessages = await redisClient.lrange(key, 0, -1);
      const messages = failedMessages.map(JSON.parse);

      for (const msg of messages) {
        try {
          await asyncRetry(async () => publishToKafka(msg), {
            retries: 3,
            minTimeout: 1000,
            maxTimeout: 5000,
          });

          await redisClient.lrem(key, 1, JSON.stringify(msg));
        } catch (error) {
          logError('❌ Retry failed', { error: error.message, messageId: msg.messageId });
        }
      }
    }
  } catch (error) {
    logError('❌ Failed retry loop', { error: error.message });
  }
};

setInterval(retryFailedMessages, 30 * 60 * 1000);
