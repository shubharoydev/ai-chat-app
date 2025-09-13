

import jwt from 'jsonwebtoken';
import { getRedisClient } from '../config/redisSetup.js';
import {
  jwtAccessSecret,
  jwtRefreshSecret,
  jwtAccessExpiry,
} from '../config/env.js';
import { createError } from '../utils/errorHandler.js';

/**
 * Middleware to authenticate requests and refresh access tokens if expired.
 */
export const authMiddleware = async (req, res, next) => {
  try {
    // const accessToken = req.cookies.accessToken;
    const accessToken =
  req.cookies.accessToken ||
  (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.split(' ')[1]);


    if (!accessToken) {
      throw createError(401, 'No access token provided');
    }

    // First try to verify access token
    try {
      const decoded = jwt.verify(accessToken, jwtAccessSecret);
      req.user = { userId: decoded.userId };
      return next();
    } catch (err) {
      // Token expired? Try to auto-refresh using Redis-stored refresh token
      if (err.name !== 'TokenExpiredError') throw err;

      // Decode the expired token just to extract the user ID
      const decodedExpired = jwt.decode(accessToken);
      if (!decodedExpired?.userId) throw createError(401, 'Invalid access token');

      const redisClient = getRedisClient();
      const refreshToken = await redisClient.get(`refresh:${decodedExpired.userId}`);
      if (!refreshToken) throw createError(401, 'Refresh token not found');

      // Verify refresh token
      const decodedRefresh = jwt.verify(refreshToken, jwtRefreshSecret);
      if (!decodedRefresh?.userId) throw createError(401, 'Invalid refresh token');

      // Issue a new access token
      const newAccessToken = jwt.sign(
        { userId: decodedRefresh.userId },
        jwtAccessSecret,
        { expiresIn: jwtAccessExpiry }
      );

      res.cookie('accessToken', newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: jwtAccessExpiry,
      });

      req.user = { userId: decodedRefresh.userId };
      return next();
    }
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(createError(401, 'Invalid access token'));
    } else {
      next(error);
    }
  }
};
