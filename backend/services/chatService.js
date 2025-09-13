import { findMutualFriendship } from '../repositories/friendRepository.js';
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

export const sendMessage = async (userId, friendId, content) => {
  try {
    if (userId === friendId) {
      throw createError(400, '❌ Cannot message yourself');
    }

    const redisClient = getRedisClient();
    const chatId = [userId, friendId].sort().join(':');
    const messageId = uuidv4();
    const message = {
      id: messageId,
      chatId,
      userId,
      friendId,
      content,
      timestamp: new Date().toISOString(),
      isAI: false,
    };

    const publishToKafka = async (msg) => {
      await producer.send({
        topic: 'chat-messages-persist',
        messages: [{ value: JSON.stringify(msg) }],
      });
      logInfo('📤 Message sent to Kafka for persistence', { messageId: msg.id, chatId });
    };

    if (content.startsWith('/ai ') || content.startsWith('/ai:')) {
      logInfo('🤖 /ai message detected', { userId, chatId });
      const query = content.slice(4).trim();
      if (!query) throw createError(400, 'AI query cannot be empty');

      try {
        await asyncRetry(
          async () => publishToKafka(message),
          { retries: 3, minTimeout: 1000, maxTimeout: 5000 }
        );
      } catch (error) {
        logError('❌ Failed to publish user message to Kafka, buffering in Redis', { error: error.message, messageId });
        await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(message));
        await redisClient.expire(`chat:failed:${chatId}`, 604800);
      }

      await redisClient.lpush(`chat:buffer:${chatId}`, JSON.stringify(message));
      await redisClient.lpush(`chat:recent:${userId}:${friendId}`, JSON.stringify(message));
      await redisClient.lpush(`chat:recent:${friendId}:${userId}`, JSON.stringify(message));
      await redisClient.expire(`chat:buffer:${chatId}`, 604800);
      await redisClient.expire(`chat:recent:${userId}:${friendId}`, 604800);
      await redisClient.expire(`chat:recent:${friendId}:${userId}`, 604800);

      logInfo('📡 Sending prompt to Gemini...', { query: query.substring(0, 50) + '...' });
      const aiResponse = await getGeminiResponse(query);
      console.log('AI response:', aiResponse);
      logInfo('✅ Received Gemini response', { responseLength: aiResponse.length });

      const aiMessageId = uuidv4();
      const aiMessage = {
        id: aiMessageId,
        chatId,
        userId,
        friendId,
        content: aiResponse,
        timestamp: new Date().toISOString(),
        isAI: true,
      };

      try {
        await asyncRetry(
          async () => publishToKafka(aiMessage),
          { retries: 3, minTimeout: 1000, maxTimeout: 5000 }
        );
      } catch (error) {
        logError('❌ Failed to publish AI message to Kafka, buffering in Redis', { error: error.message, messageId: aiMessageId });
        await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(aiMessage));
        await redisClient.expire(`chat:failed:${chatId}`, 604800);
      }

      await redisClient.lpush(`chat:buffer:${chatId}`, JSON.stringify(aiMessage));
      await redisClient.lpush(`chat:recent:${userId}:${friendId}`, JSON.stringify(aiMessage));
      await redisClient.lpush(`chat:recent:${friendId}:${userId}`, JSON.stringify(aiMessage));
      await redisClient.expire(`chat:buffer:${chatId}`, 604800);
      await redisClient.expire(`chat:recent:${userId}:${friendId}`, 604800);
      await redisClient.expire(`chat:recent:${friendId}:${userId}`, 604800);

      logInfo('💾 Saved AI response', { messageId: aiMessageId, chatId });
      return [message, aiMessage];
    }

    logInfo('🔍 Checking friendship: ' + userId + ' -> ' + friendId, { userId, friendId });
    const friendship = await findMutualFriendship(userId, friendId);
    if (!friendship) {
      logInfo('🔍 Checking friendship: ' + userId + ' -> ' + friendId + ' = false', { userId, friendId });
      throw createError(403, 'No friendship exists with this user');
    }
    logInfo('🔍 Checking friendship: ' + userId + ' -> ' + friendId + ' = true', { userId, friendId });

    try {
      await asyncRetry(
        async () => publishToKafka(message),
        { retries: 3, minTimeout: 1000, maxTimeout: 5000 }
      );
    } catch (error) {
      logError('❌ Failed to publish message to Kafka, buffering in Redis', { error: error.message, messageId });
      await redisClient.lpush(`chat:failed:${chatId}`, JSON.stringify(message));
      await redisClient.expire(`chat:failed:${chatId}`, 604800);
    }

    logInfo('📦 Message saved to Redis', { messageId, chatId });
    await redisClient.lpush(`chat:buffer:${chatId}`, JSON.stringify(message));
    await redisClient.lpush(`chat:recent:${userId}:${friendId}`, JSON.stringify(message));
    await redisClient.lpush(`chat:recent:${friendId}:${userId}`, JSON.stringify(message));
    await redisClient.expire(`chat:buffer:${chatId}`, 604800);
    await redisClient.expire(`chat:recent:${userId}:${friendId}`, 604800);
    await redisClient.expire(`chat:recent:${friendId}:${userId}`, 604800);

    return message;
  } catch (error) {
    logError('❌ Failed to send message', { error: error.message, userId, friendId });
    throw error;
  }
};

export const getMessages = async (userId, friendId, page = 1, limit = 20) => {
  try {
    if (page < 1 || limit < 1) {
      throw createError(400, 'Invalid page or limit values');
    }

    if (friendId === 'ai') {
      logInfo('🤖 Bypassing friendship check for AI messages', { userId });

      const chatId = [userId, friendId].sort().join(':');
      const redisClient = getRedisClient();
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      logInfo('🔁 Fetching AI messages for chatId: ' + chatId, { chatId, page, limit });

      const cachedMessages = await redisClient.lrange(`chat:recent:${userId}:${friendId}`, 0, -1);
      let messages = cachedMessages.map(JSON.parse);

      for (const msg of messages) {
        const status = await redisClient.get(`msg:status:${msg.id}`);
        msg.status = status || msg.status;
        msg.isAI = msg.isAI ?? false; // Fixed: Ensure isAI is boolean
        msg.displayLabel = msg.isAI ? '(AI)' : 'You';
      }

      messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const paginatedMessages = messages.slice(start, start + limit);

      logInfo('📦 Retrieved ' + paginatedMessages.length + ' AI messages', {
        chatId,
        redisCount: cachedMessages.length,
        mongoCount: 0,
      });

      return paginatedMessages;
    }

    logInfo('🔍 Checking friendship: ' + userId + ' -> ' + friendId, { userId, friendId });
    const friendship = await findMutualFriendship(userId, friendId);
    if (!friendship) {
      logInfo('🔍 Checking friendship: ' + userId + ' -> ' + friendId + ' = false', { userId, friendId });
      throw createError(403, 'No friendship exists with this user');
    }
    logInfo('🔍 Checking friendship: ' + userId + ' -> ' + friendId + ' = true', { userId, friendId });

    const chatId = [userId, friendId].sort().join(':');
    const redisClient = getRedisClient();
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    logInfo('🔁 Fetching messages for chatId: ' + chatId, { chatId, page, limit });

    const cachedMessages = await redisClient.lrange(`chat:recent:${userId}:${friendId}`, 0, -1);
    let messages = cachedMessages.map(JSON.parse);

    if (messages.length < limit) {
      const dbMessages = await Message.find({ chatId })
        .sort({ timestamp: 1 })
        .skip(Math.max(0, start - messages.length))
        .limit(limit)
        .lean();
      messages = messages.concat(dbMessages);
    }

    const messageMap = new Map();
    messages.forEach((msg) => {
      msg.isAI = msg.isAI ?? false; // Fixed: Ensure isAI is boolean
      msg.displayLabel = msg.isAI ? '(AI)' : (msg.userId === userId ? 'You' : 'Friend');
      messageMap.set(msg.id, msg);
    });
    messages = Array.from(messageMap.values());

    // for (const msg of messages) {
    //   const status = await redisClient.get(`msg:status:${msg.id}`);
    //   msg.status = status || msg.status;
    // }

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const paginatedMessages = messages.slice(start, start + limit);

    logInfo('📦 Retrieved ' + paginatedMessages.length + ' messages', {
      chatId,
      redisCount: cachedMessages.length,
      mongoCount: messages.length - cachedMessages.length,
    });

    return paginatedMessages;
  } catch (error) {
    logError('❌ Failed to retrieve messages', { error: error.message, userId, friendId });
    throw error;
  }
};

export const addFriend = async (userId, friendId) => {
  try {
    if (userId === friendId) {
      throw createError(400, 'Cannot add yourself as a friend');
    }

    const uid = new mongoose.Types.ObjectId(userId);
    const fid = new mongoose.Types.ObjectId(friendId);

    const existing = await Friend.findOne({
      $or: [
        { userId: uid, friendId: fid },
        { userId: fid, friendId: uid },
      ],
    });

    if (existing) {
      logInfo('🔍 Friendship already exists', { userId, friendId });
      return existing;
    }

    const friendships = [
      { userId: uid, friendId: fid },
      { userId: fid, friendId: uid },
    ];

    const result = await Friend.insertMany(friendships);
    logInfo('✅ Friendship created', { userId, friendId });
    return result;
  } catch (error) {
    logError('❌ Failed to add friend', { error: error.message, userId, friendId });
    throw error;
  }
};

export const retryFailedMessages = async () => {
  try {
    const redisClient = getRedisClient();
    const keys = await redisClient.keys('chat:failed:*');
    if (!keys.length) return;

    logInfo('⏳ Retrying failed messages from Redis', { count: keys.length });

    for (const key of keys) {
      const failedMessages = await redisClient.lrange(key, 0, -1);
      const messages = failedMessages.map(JSON.parse);

      for (const msg of messages) {
        try {
          await asyncRetry(
            async () => {
              await producer.send({
                topic: 'chat-messages-persist',
                messages: [{ value: JSON.stringify(msg) }],
              });
              logInfo('📤 Retried message sent to Kafka', { messageId: msg.id, chatId: msg.chatId });
            },
            { retries: 3, minTimeout: 1000, maxTimeout: 5000 }
          );

          await redisClient.lrem(key, 1, JSON.stringify(msg));
        } catch (error) {
          logError('❌ Failed to retry message to Kafka', { error: error.message, messageId: msg.id });
        }
      }

      if ((await redisClient.llen(key)) === 0) {
        await redisClient.del(key);
      }
    }
  } catch (error) {
    logError('❌ Failed to retry messages', { error: error.message });
  }
};

setInterval(retryFailedMessages, 60 * 1000);