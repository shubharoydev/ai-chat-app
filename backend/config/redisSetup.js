import Redis from 'ioredis';
import { logInfo, logError } from '../utils/logger.js';
import { redisUrl } from '../config/env.js';

let redisClient;
let isConnected = false;
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const handleRedisError = (error) => {
  logError('❌ Redis error', { 
    error: error.message,
    stack: error.stack,
    code: error.code
  });
};

const initializeRedisClient = () => {
  if (redisClient) return redisClient;

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      const delay = Math.min(times * 100, 2000);
      logInfo(`Redis reconnecting in ${delay}ms...`); 
      return delay;
    },
    reconnectOnError: (err) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
  });

  redisClient.setWithExpiry = async (key, value, ttl) => {
    try {
      if (!Number.isInteger(Number(ttl)) || ttl <= 0) {
        throw new Error('TTL must be a positive integer');
      }
      return await redisClient.set(key, value, 'EX', ttl);
    } catch (error) {
      handleRedisError(error);
      throw error;
    }
  };

  redisClient.on('connect', () => {
    isConnected = true;
    connectionAttempts = 0;
    logInfo('✅ Connected to Redis');
  });

  redisClient.on('error', handleRedisError);

  redisClient.on('reconnecting', () => {
    connectionAttempts++;
    logInfo(`⏳ Redis reconnecting (attempt ${connectionAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  });

  redisClient.on('end', () => {
    isConnected = false;
    logInfo('🔴 Redis connection closed');
  });

  redisClient.on('ready', () => {
    isConnected = true;
    logInfo('🟢 Redis client ready');
  });

  return redisClient;
};

export const getRedisClient = () => {
  if (!redisClient) {
    initializeRedisClient();
  }
  return redisClient;
};

export const isRedisConnected = () => isConnected;

export const closeRedisClient = async () => {
  if (!redisClient) return;
  try {
    logInfo('Closing Redis connection...');
    await redisClient.quit();
    logInfo('Redis connection closed');
  } catch (error) {
    logError('Error closing Redis connection', { error: error.message });
  }
};