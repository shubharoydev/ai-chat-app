import dotenv from 'dotenv';
dotenv.config();

const requiredVars = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0 && process.env.NODE_ENV !== 'test') {
  console.error('Missing required environment variables:', missingVars.join(', '));
  process.exit(1);
}

export const port = process.env.PORT || 3000;
export const nodeEnv = process.env.NODE_ENV || 'development';

export const mongoUri = process.env.MONGODB_URI;
export const redisUrl = process.env.REDIS_URL;

export const kafkaBrokers = process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'];
export const kafkaClientId = process.env.KAFKA_CLIENT_ID || 'chat-app';

export const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
export const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
export const jwtAccessExpiry = process.env.JWT_ACCESS_EXPIRY;
export const jwtRefreshExpiry = process.env.JWT_REFRESH_EXPIRY;

export const arcjetKey = process.env.ARCJET_KEY;
export const arcjetEnv = process.env.ARCJET_ENV || nodeEnv;
