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

// ✅ Kafka publisher
const publishToKafka = async (msg) => {
  await producer.send({
    topic: 'chat-messages-persist',
    messages: [{ value: JSON.stringify(msg) }],
  });

  logInfo('📤 Published to Kafka', { messageId: msg.id, chatId: msg.chatId });
};

export const sendMessage = async (userId, friendId, content) => {
  const tempId = uuidv4(); // ✅ temp unique ID for Redis/Kafka
  const chatId = [userId, friendId].sort().join(':');

  const message = {
    tempId,        
    chatId,
    userId,
    friendId,
    content,
    timestamp: new Date().toISOString(),
    isAI: false,
  };

  const redisClient = getRedisClient();

  // ==================  Handle /ai messages ==================
  if (content.startsWith('/ai ') || content.startsWith('/ai:')) {
    const query = content.slice(4).trim();
    if (!query) throw createError(400, 'AI query cannot be empty');

    // Push user message to Redis recent
    await redisClient.lpush(`chat:recent:${userId}:${friendId}`, JSON.stringify(message));
    await redisClient.lpush(`chat:recent:${friendId}:${userId}`, JSON.stringify(message));
    await redisClient.expire(`chat:recent:${userId}:${friendId}`, 7 * 24 * 3600);
    await redisClient.expire(`chat:recent:${friendId}:${userId}`, 7 * 24 * 3600);

    // Publish user message to Kafka
    try {
      await asyncRetry(async () => publishToKafka(message), { retries: 3, minTimeout: 1000, maxTimeout: 5000 });
    } catch (err) {
      await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(message));
      await redisClient.expire(`chat:failed:${chatId}`, 7 * 24 * 3600);
    }

    // Call Gemini AI
    const aiResponse = await getGeminiResponse(query);
    const aiMessage = {
      tempId: uuidv4(),
      chatId,
      userId,
      friendId,
      content: aiResponse,
      timestamp: new Date().toISOString(),
      isAI: true,
    };

    // Push AI message to Redis recent
    await redisClient.lpush(`chat:recent:${userId}:${friendId}`, JSON.stringify(aiMessage));
    await redisClient.lpush(`chat:recent:${friendId}:${userId}`, JSON.stringify(aiMessage));
    await redisClient.expire(`chat:recent:${userId}:${friendId}`, 7 * 24 * 3600);
    await redisClient.expire(`chat:recent:${friendId}:${userId}`, 7 * 24 * 3600);

    // Publish AI message to Kafka
    try {
      await asyncRetry(async () => publishToKafka(aiMessage), { retries: 3, minTimeout: 1000, maxTimeout: 5000 });
    } catch (err) {
      await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(aiMessage));
      await redisClient.expire(`chat:failed:${chatId}`, 7 * 24 * 3600);
    }

    return [message, aiMessage];
  }

  // Push normal message to Redis recent
  await redisClient.lpush(`chat:recent:${userId}:${friendId}`, JSON.stringify(message));
  await redisClient.lpush(`chat:recent:${friendId}:${userId}`, JSON.stringify(message));
  await redisClient.expire(`chat:recent:${userId}:${friendId}`, 7 * 24 * 3600);
  await redisClient.expire(`chat:recent:${friendId}:${userId}`, 7 * 24 * 3600);

  // Publish to Kafka
  try {
    await asyncRetry(async () => publishToKafka(message), { retries: 3, minTimeout: 1000, maxTimeout: 5000 });
  } catch (err) {
    await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(message));
    await redisClient.expire(`chat:failed:${chatId}`, 7 * 24 * 3600);
  }

  return message;
};


// ✅ Get last 20 messages
export const getMessages = async (userId, friendId) => {
  try {
    const redisClient = getRedisClient();
    const chatId = [userId, friendId].sort().join(':');

    let messages = [];
    const cachedMessages = await redisClient.lrange(`chat:recent:${userId}:${friendId}`, 0, -1);

    if (cachedMessages.length > 0) {
      messages = cachedMessages.map(JSON.parse);
    } else {
      const dbMessages = await Message.find({ chatId })
        .sort({ timestamp: -1 })
        .limit(20)
        .lean();
      messages = dbMessages.reverse();
    }

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return messages.slice(-20);
  } catch (error) {
    logError('❌ Failed to fetch messages', { error: error.message });
    throw error;
  }
};

// ✅ Add friend
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

// ✅ Retry failed messages every 30 min
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
          logError('❌ Retry failed', { error: error.message, messageId: msg.id });
        }
      }
    }
  } catch (error) {
    logError('❌ Failed retry loop', { error: error.message });
  }
};

setInterval(retryFailedMessages, 30 * 60 * 1000);
