/**
 * Jest configuration for the backend.
 *
 * - Serial execution (maxWorkers: 1) keeps the integration tests (which share a
 *   single local Kafka/Mongo/Redis instance) deterministic.
 * - setupFiles inject test-only environment variables before any application
 *   module is imported, forcing local (non-Aiven) infrastructure.
 */
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/env.setup.cjs'],
  testMatch: ['**/tests/**/*.test.js'],
  maxWorkers: 1,
  testTimeout: 120000,
  forceExit: true,
  verbose: true,
};
