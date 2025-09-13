import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyAccessToken } from '../utils/jwt.js';
import { sendMessage } from '../services/chatService.js';
import { getRedisClient } from '../config/redisSetup.js';
import { logInfo, logError } from '../utils/logger.js';
import { createError } from '../utils/errorHandler.js';

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
      let token = socket.handshake.auth?.token || socket.handshake.headers["authorization"];
      console.log('Received token:', token);
      if (!token) {
        throw createError(401, 'No access token provided');
      }

      if (token.startsWith('Bearer ')) {
        token = token.slice(7);
      }

      const decoded = verifyAccessToken(token);
      console.log('Decoded token:', decoded);
      socket.user = { userId: decoded.userId };

      // await redisClient.setWithExpiry(
      //   `user:online:${socket.user.userId}`,
      //   'true',
      //   60,
      // );
      
      logInfo('✅ User logged in', { 
        userId: socket.user.userId,
        socketId: socket.id 
      });

      next();
    } catch (error) {
      logError('❌ Socket authentication failed', { 
        error: error.message,
        stack: error.stack,
        socketId: socket?.id
      });
      next(error);
    }
  });

  io.on('connection', (socket) => {
    logInfo('User connected', { userId: socket.user.userId });
    socket.join(socket.user.userId);
    console.log('User joined room:', socket.user.userId);

    socket.on('sendMessage', async ({ friendId, content, tempId }, callback) => {
      try {
        if (!friendId || !content) throw createError(400, 'Friend ID and content are required');

        const messages = await sendMessage(socket.user.userId, friendId, content);
        const messageArray = Array.isArray(messages) ? messages : [messages];

        for (const message of messageArray) {
          const messageWithTemp = tempId ? { ...message, tempId } : message;
          
          // Modified: Emit to both userId and friendId explicitly
          console.log('Emitting to userId:', socket.user.userId, messageWithTemp);
          io.to(socket.user.userId).emit('receiveMessage', messageWithTemp);
          console.log('Emitting to friendId:', message.friendId, messageWithTemp);
          io.to(message.friendId).emit('receiveMessage', messageWithTemp);
        }

        logInfo('📤 Message sent', { 
          chatId: messageArray[0].chatId, 
          userId: socket.user.userId,
          friendId: messageArray[0].friendId,
          tempId
        });
        
        if (typeof callback === 'function') {
          callback({ 
            status: 'success', 
            messages: messageArray,
            tempId
          });
        }
      } catch (error) {
        logError('❌ Failed to send message', { 
          error: error.message, 
          userId: socket.user.userId,
          tempId
        });
        
        if (tempId) {
          io.to(socket.user.userId).emit('error', {
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

    socket.on('disconnect', async () => {
      try {
        if (!socket.user?.userId) {
          logInfo('Socket disconnected without user session', { socketId: socket.id });
          return;
        }

        const redisClient = getRedisClient();
        //await redisClient.del(`user:online:${socket.user.userId}`);
        
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

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};