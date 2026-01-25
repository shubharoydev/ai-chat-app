import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyAccessToken } from '../utils/jwt.js';
import { sendMessage } from '../services/chatService.js';
import { getRedisClient } from '../config/redisSetup.js';
import { logInfo, logError } from '../utils/logger.js';
import { createError } from '../utils/errorHandler.js';
import cookie from 'cookie';
import jwt from "jsonwebtoken";
import { jwtAccessSecret,jwtRefreshSecret,jwtAccessExpiry} from '../config/env.js';
import {User} from "../models/userModel.js";
import {Friend} from '../models/friendModel.js';
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

      let accessToken = cookies.accessToken;

      // Try accessToken first
      if (accessToken) {
        try {
          const decoded = jwt.verify(accessToken, jwtAccessSecret);
          socket.user = { userId: decoded.userId };
          return next();
        } catch (err) {
          console.log("Access token expired, trying refresh...");
        }
      }

      // Use refreshToken
      const refreshToken = cookies.refreshToken;
      if (!refreshToken) {
        return next(createError(401, "No session"));
      }

      const decoded = jwt.verify(refreshToken, jwtRefreshSecret);

      // Critical: Check Redis
      const redisClient = getRedisClient();
      const stored = await redisClient.get(`refresh:${decoded.userId}`);
      if (stored !== refreshToken) {
        return next(createError(401, "Invalid refresh token"));
      }

      const user = await User.findById(decoded.userId);
      if (!user) return next(createError(401, "User not found"));

      const newAccessToken = jwt.sign(
        { userId: user._id },
        jwtAccessSecret,
        { expiresIn: jwtAccessExpiry }
      );

      socket.user = { userId: user._id.toString() };

      // Send token to frontend
      socket.emit('access-token-refreshed', newAccessToken);

      logInfo("WebSocket authenticated via refresh token", {
        userId: socket.user.userId,
        socketId: socket.id,
      });

      next();
    } catch (err) {
      logError("Socket auth failed", { error: err.message });
      next(err);
    }
  });
  io.on('connection', async (socket) => {
    const userId = socket.user.userId;
    const redisClient = getRedisClient();

    logInfo('User connected', { userId });
    socket.join(userId);

    // ONLINE STATUS LOGIC 
    try {
      //  Mark as online immediately
      await redisClient.set(`online:${userId}`, 'true', 'EX', 15);

      // Notify friends (Live Update)
      // Find users who have this user as a friend
      const followers = await Friend.find({ friendId: userId }).select('userId');
      followers.forEach(doc => {
        io.to(doc.userId.toString()).emit('friend-status', { userId, status: 'online' });
      });
    } catch (err) {
      logError('Error processing online status', { error: err.message, userId });
    }

    //  Heartbeat listener
    socket.on('heartbeat', async () => {
      try {
        await redisClient.set(`online:${userId}`, 'true', 'EX', 15);
      } catch (err) {
        // silent fail or log debug
      }
    });

    // Batch Check Status
    socket.on('check-status', async ({ friendIds }, callback) => {
      try {
        if (!Array.isArray(friendIds)) {
          if (typeof callback === 'function') callback([]);
          return;
        }

        const pipeline = redisClient.pipeline();
        friendIds.forEach(id => pipeline.get(`online:${id}`));
        const results = await pipeline.exec();

        const onlineIds = [];
        results.forEach((res, index) => {
          // res = [error, value]
          if (!res[0] && res[1]) {
            onlineIds.push(friendIds[index]);
          }
        });

        if (typeof callback === 'function') callback(onlineIds);
      } catch (err) {
        logError('check-status error', { error: err.message });
        if (typeof callback === 'function') callback([]);
      }
    });

    // sendMessage handler 
    socket.on('sendMessage', async ({ friendId, content, tempId }, callback) => {
      try {
        if (!friendId || !content) {
          throw createError(400, 'Friend ID and content are required');
        }
        const result = await sendMessage(userId, friendId, content, tempId);
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
        await redisClient.del(`online:${socket.user.userId}`);

        // Notify friends
        const followers = await Friend.find({ friendId: socket.user.userId }).select('userId');
        followers.forEach(doc => {
          io.to(doc.userId.toString()).emit('friend-status', {
            userId: socket.user.userId,
            status: 'offline'
          });
        });

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