import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyAccessToken } from '../utils/jwt.js';
import { sendMessage } from '../services/chatService.js';
import { getRedisClient } from '../config/redisSetup.js';
import { logInfo, logError } from '../utils/logger.js';
import { createError } from '../utils/errorHandler.js';
import cookie from 'cookie';

let io;

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  const redisClient = getRedisClient();
  
  try {
    io.adapter(createAdapter(redisClient, redisClient.duplicate()));
  } catch (error) {
    logError('Failed to create Redis adapter', { error: error.message });
    throw error;
  }

  io.use(async (socket, next) => {
    try {
      const cookies = socket.handshake.headers.cookie
        ? cookie.parse(socket.handshake.headers.cookie)
        : {};
      const token = cookies.accessToken;

      console.log("Parsed cookies:", cookies);
      console.log("Access token from cookie:", token ? "exists" : "missing");

      if (!token) {
        throw createError(401, "No access token provided");
      }

      const decoded = verifyAccessToken(token);
      socket.user = { userId: decoded.userId };

      const redisClient = getRedisClient();
      // await redisClient.set(
      //   `user:online:${socket.user.userId}`,
      //   "true",
      //   "EX",
      //   60
      // );

      logInfo("Socket authenticated", {
        userId: socket.user.userId,
        socketId: socket.id,
      });

      next();
    } catch (error) {
      logError("Socket authentication failed", {
        error: error.message,
        socketId: socket?.id,
      });
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.userId;
    logInfo('User connected', { userId });
    socket.join(userId);
    console.log('User joined room:', userId);

    // sendMessage handler 
    socket.on('sendMessage', async ({ friendId, content, tempId }, callback) => {
      try {
        if (!friendId || !content) {
          throw createError(400, 'Friend ID and content are required');
        }
        const result = await sendMessage(userId, friendId, content,tempId);
        const messages = Array.isArray(result) ? result : [result];

        // Log success
        logInfo('Message sent', { 
          chatId: messages[0].chatId, 
          userId,
          friendId: messages[0].friendId,
          tempId: messages[0].tempId
        });

        // Confirm to sender (frontend)
        if (typeof callback === 'function') {
          callback({ status: 'success', messages });
        }

      } catch (error) {
        logError('Failed to send message', { 
          error: error.message, 
          userId,
          tempId
        });

        // Send error back to sender only
        if (tempId) {
          io.to(userId).emit('error', {
            tempId,
            error: error.message
          });
        }

        if (typeof callback === 'function') {
          callback({ 
            status: 'error', 
            error: error.message,
            tempId
          });
        }
      }
    });

    // DISCONNECT HANDLER 
    socket.on('disconnect', async () => {
      try {
        if (!socket.user?.userId) {
          logInfo('Socket disconnected without user session', { socketId: socket.id });
          return;
        }

        const redisClient = getRedisClient();
        // await redisClient.del(`user:online:${socket.user.userId}`);

        logInfo('User disconnected', { 
          userId: socket.user.userId, 
          socketId: socket.id 
        });
      } catch (error) {
        logError('Error handling socket disconnect', {
          error: error.message,
          userId: socket.user?.userId,
          socketId: socket.id
        });
      }
    });
  });

  return io;
};

// EXPORT getIO 
export const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};