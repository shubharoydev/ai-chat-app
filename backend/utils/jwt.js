import jwt from 'jsonwebtoken';
import { jwtAccessSecret, jwtRefreshSecret, jwtAccessExpiry, jwtRefreshExpiry } from '../config/env.js';
import { createError } from './errorHandler.js';

export const generateAccessToken = (userId) => {
  try {
    return jwt.sign({ userId }, jwtAccessSecret, { expiresIn: jwtAccessExpiry });
  } catch (error) {
    throw createError(500, 'Failed to generate access token', error);
  }
};

export const generateRefreshToken = (userId) => {
  try {
    return jwt.sign({ userId }, jwtRefreshSecret, { expiresIn: jwtRefreshExpiry });
  } catch (error) {
    throw createError(500, 'Failed to generate refresh token', error);
  }
};

export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, jwtAccessSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw createError(401, 'Access token expired');
    }
    throw createError(401, 'Invalid access token', error);
  }
};

export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, jwtRefreshSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw createError(401, 'Refresh token expired');
    }
    throw createError(401, 'Invalid refresh token', error);
  }
};