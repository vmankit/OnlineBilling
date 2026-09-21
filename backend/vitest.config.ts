import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real PostgreSQL database, because the rules
 * worth testing here — atomic rollback, row locking, unique invoice numbers —
 * only exist in the database. A mocked driver would test nothing.
 *
 * TEST_DATABASE_URL points at a throwaway database that globalSetup drops and
 * recreates on every run, so tests never touch the shop's data.
 */
const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres@localhost:5433/santu_hardware_test';

export default defineConfig({
  test: {
    globals: false,
    globalSetup: ['./src/test/globalSetup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
      DATABASE_SSL: 'false',
      JWT_SECRET: 'test-secret-value-that-is-long-enough',
      CORS_ORIGIN: 'http://localhost:5173',
      SEED_ADMIN_EMAIL: 'admin@santuhardware.in',
      SEED_ADMIN_PASSWORD: 'Admin@12345',
    },
    // The suite shares one database, so files must not race each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
