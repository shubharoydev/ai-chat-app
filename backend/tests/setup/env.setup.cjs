/**
 * Deterministic test environment.
 *
 * Runs BEFORE any application module is imported. It pins every external
 * dependency to the local docker-compose stack and forces Kafka into local
 * (plaintext) mode by defining SERVICE_URI as an empty string. Because dotenv
 * does not overwrite already-defined variables, the cloud credentials in
 * backend/.env can never leak into a test run.
 *
 * Override any value with the matching TEST_* variable if your local stack
 * uses different ports.
 */
process.env.NODE_ENV = 'test';

// Force local Kafka mode (empty string => falsy => local broker list is used).
// KAFKA_MODE is an explicit override that also wins over SERVICE_URI.
process.env.SERVICE_URI = '';
process.env.KAFKA_MODE = 'local';

process.env.KAFKA_BROKERS = process.env.TEST_KAFKA_BROKERS
  || 'localhost:9092,localhost:9093,localhost:9094';
process.env.KAFKA_CLIENT_ID = 'chat-app-test';

process.env.MONGODB_URI = process.env.TEST_MONGODB_URI
  || 'mongodb://localhost:27017/chatapp_test';

process.env.REDIS_URL = process.env.TEST_REDIS_URL
  || 'redis://localhost:6379/1';

process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '28d';

process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.PORT = '0';
