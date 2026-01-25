import jwt from 'jsonwebtoken';
import { getRedisClient } from '../config/redisSetup.js';
import {
  jwtAccessSecret,
  jwtRefreshSecret,
  jwtAccessExpiry,
} from '../config/env.js';
import ms from 'ms';
import { createError } from '../utils/errorHandler.js';

export const authMiddleware = async (req, res, next) => {
  try {
    // Only use cookies for tokens (fully cookie-based)
    const accessToken = req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;
    //console.log('Cookies:', req.cookies);
    //console.log('AccessToken:', req.cookies?.accessToken);

    if (!accessToken) throw createError(401, 'Access token missing');

    try {
      // Verify the access token first
      const decoded = jwt.verify(accessToken, jwtAccessSecret);
      req.user = { userId: decoded.userId };
      return next();
    } catch (err) {
      // If the access token is expired, try using the refresh token
      if (err.name !== 'TokenExpiredError') throw err;

      if (!refreshToken) throw createError(401, 'Refresh token missing');

      // Verify refresh token validity
      const decodedRefresh = jwt.verify(refreshToken, jwtRefreshSecret);
      if (!decodedRefresh?.userId) throw createError(401, 'Invalid refresh token');

      // Validate refresh token with Redis (token rotation check)
      const redisClient = getRedisClient();
      const storedRefreshToken = await redisClient.get(`refresh:${decodedRefresh.userId}`);
      if (!storedRefreshToken || storedRefreshToken !== refreshToken)
        throw createError(401, 'Invalid or expired refresh token');

      // Issue a new access token
      const newAccessToken = jwt.sign(
        { userId: decodedRefresh.userId },
        jwtAccessSecret,
        { expiresIn: jwtAccessExpiry }
      );

      // Send the new access token cookie
      res.cookie('accessToken', newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: ms(jwtAccessExpiry),
      });

      // Attach user ID to request and continue
      req.user = { userId: decodedRefresh.userId };
      return next();
    }
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(createError(401, 'Invalid or malformed token'));
    } else {
      next(error);
    }
  }
};
