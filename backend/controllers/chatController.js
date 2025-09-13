import mongoose from 'mongoose';
import { messageSchema } from '../utils/validator.js';
import { createError } from '../utils/errorHandler.js';
import { sendMessage as sendMessageService, getMessages as getMessagesService, addFriend as addFriendService} from '../services/chatService.js'; // Remove aliases
import { logInfo, logError } from '../utils/logger.js';

// Send Message API
export const sendMessage = async (req, res, next) => {
  try {
    const { error } = messageSchema.validate(req.body);
    if (error) throw createError(400, error.details[0].message);

    const { friendId, content } = req.body;
    const userId = req.user.userId;

    logInfo('📤 Sending message', { userId, friendId, content: content.substring(0, 50) + '...' });

    const message = await sendMessageService(userId, friendId, content);
    res.status(201).json({ message: 'Message sent', data: message });
  } catch (error) {
    logError('❌ Send message failed', { error: error.message, userId: req.user.userId });
    next(error);
  }
};

// Get Messages API
export const getMessages = async (req, res, next) => {
  try {
    const friendId = req.params.friendId || req.query.friendId;
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    if (!friendId) throw createError(400, 'Friend ID is required');

    const messages = await getMessagesService(userId, friendId, page, limit);
    res.json({ messages });
  } catch (error) {
    logError('❌ Get messages failed', { error: error.message, userId: req.user.userId });
    next(error);
  }
};

// Add Friend API
export const addFriend = async (req, res, next) => {
  try {
    const { friendId } = req.body;
    const userId = req.user.userId;

    if (!friendId) throw createError(400, 'Friend ID is required');

    logInfo('✅ Adding friend', { userId, friendId });
    const friendship = await addFriendService(userId, friendId);
    res.status(201).json({ message: 'Friend added', data: friendship });
  } catch (error) {
    logError('❌ Add friend failed', { error: error.message, userId: req.user.userId });
    next(error);
  }
};