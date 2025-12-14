import jwt from 'jsonwebtoken';
import { User } from '../models/userModel.js';
import { getRedisClient } from '../config/redisSetup.js';
import { jwtAccessSecret, jwtRefreshSecret, jwtAccessExpiry, jwtRefreshExpiry } from '../config/env.js';
import ms from 'ms';
import { createError } from '../utils/errorHandler.js';

export const signup = async ({ name, email, password }) => {
  // Check for duplicate email
  const existingUser = await User.findOne({ email });
  if (existingUser) throw createError(409, 'Email already exists');

  // Create user
  const user = new User({ name, email, password });
  await user.save();

  // Generate tokens
  const accessToken = jwt.sign({ userId: user._id }, jwtAccessSecret, { expiresIn: jwtAccessExpiry });
  const refreshToken = jwt.sign({ userId: user._id }, jwtRefreshSecret, { expiresIn: jwtRefreshExpiry });

  // Store refresh token in Redis
  const redisClient = getRedisClient();
  await redisClient.setWithExpiry(`refresh:${user._id}`, ms(jwtRefreshExpiry) / 1000, refreshToken);

  return { user: { id: user._id, name, email }, accessToken, refreshToken };
};

export const login = async ({ email, password }) => {
  // Find user
  const user = await User.findOne({ email });
  if (!user) throw createError(401, 'Invalid email or password');

  // Verify password
  const isValidPassword = await user.comparePassword(password);
  if (!isValidPassword) throw createError(401, 'Invalid email or password');

  // Generate tokens
  const accessToken = jwt.sign({ userId: user._id }, jwtAccessSecret, { expiresIn: jwtAccessExpiry });
  const refreshToken = jwt.sign({ userId: user._id }, jwtRefreshSecret, { expiresIn: jwtRefreshExpiry });

  // Store refresh token in Redis
  const redisClient = getRedisClient();
  await redisClient.setWithExpiry(`refresh:${user._id}`, ms(jwtRefreshExpiry) / 1000, refreshToken);

  return { user: { id: user._id, name: user.name, email }, accessToken, refreshToken };
};

export const refreshToken = async (userId, providedRefreshToken) => {
  // Check Redis for refresh token
  const redisClient = getRedisClient();
  const storedRefreshToken = await redisClient.get(`refresh:${userId}`);
  if (!storedRefreshToken || storedRefreshToken !== providedRefreshToken) {
    throw createError(401, 'Invalid or expired refresh token. Please log in again.');
  }

  // Verify refresh token
  try {
    const decoded = jwt.verify(providedRefreshToken, jwtRefreshSecret);
    if (decoded.userId !== userId) throw createError(401, 'Invalid refresh token payload.');

    // Generate new access token
    const newAccessToken = jwt.sign({ userId: decoded.userId }, jwtAccessSecret, { expiresIn: jwtAccessExpiry });

    return { accessToken: newAccessToken };
  } catch (error) {
    // If verification fails (e.g., expired), it's an invalid token.
    // It's good practice to also remove it from Redis to prevent reuse.
    await redisClient.del(`refresh:${userId}`);
    if (error instanceof jwt.JsonWebTokenError) {
        throw createError(401, 'Invalid refresh token. Please log in again.');
    }
    throw error; // rethrow other errors
  }
};