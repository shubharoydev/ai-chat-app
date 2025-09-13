// import { Message } from '../models/messageModel.js';
// import { createError } from '../utils/errorHandler.js';

// export const persistMessages = async (messages) => {
//   try {
//     if (!messages.length) return;

//     // Prepare bulk write operations
//     const bulkOps = messages.map((msg) => ({
//       insertOne: {
//         document: {
//           chatId: msg.chatId,
//           friendId: msg.friendId,
//           content: msg.content,
//           timestamp: new Date(msg.timestamp),
//           //status: msg.status,
//         },
//       },
//     }));

//     await Message.bulkWrite(bulkOps);
//   } catch (error) {
//     throw createError(500, 'Failed to persist messages', error);
//   }
// };

// export const getMessagesByChatId = async (chatId, page = 1, limit = 20) => {
//   try {
//     const messages = await Message.find({ chatId })
//       .sort({ timestamp: -1 })
//       .skip((page - 1) * limit)
//       .limit(limit)
//       .lean();
//     return messages;
//   } catch (error) {
//     throw createError(500, 'Failed to retrieve messages', error);
//   }
// };


import { Message } from '../models/messageModel.js';
import { createError } from '../utils/errorHandler.js';

export const persistMessages = async (messages) => {
  try {
    if (!messages.length) return;

    // Prepare bulk write operations
    const bulkOps = messages.map((msg) => ({
      insertOne: {
        document: {
          chatId: msg.chatId,
          userId: msg.userId, // Fixed: Use userId
          friendId: msg.friendId,
          content: msg.content,
          timestamp: new Date(msg.timestamp),
          isAI: msg.isAI ?? false, // Fixed: Include isAI field
        },
      },
    }));

    await Message.bulkWrite(bulkOps);
  } catch (error) {
    throw createError(500, 'Failed to persist messages', error);
  }
};

export const getMessagesByChatId = async (chatId, page = 1, limit = 20) => {
  try {
    const messages = await Message.find({ chatId })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    return messages;
  } catch (error) {
    throw createError(500, 'Failed to retrieve messages', error);
  }
};