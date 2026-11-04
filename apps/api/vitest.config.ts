import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

const root = resolve(__dirname, '../..');
if (existsSync(resolve(root, '.env'))) loadEnv({ path: resolve(root, '.env'), quiet: true });
const testDb = process.env.TEST_DATABASE_URL ?? 'postgresql://avn:avn@localhost:5432/avn_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    globalSetup: ['./test/global-setup.ts'],
    env: {
      APP_ENV: 'test',
      NODE_ENV: 'test',
      JOBS_MODE: 'inline',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDb,
      STORAGE_LOCAL_DIR: resolve(__dirname, '.test-storage'),
      PAYMENT_PROVIDER: 'simulator',
      PAYOUT_PROVIDER: 'simulator',
      AI_PROVIDER: 'disabled',
      ROUTING_PROVIDER: 'estimate',
      GEOCODER_PROVIDER: 'disabled',
      OTP_DEV_ECHO: 'true',
      IDENTITY_PROVIDER: 'simulator',
    },
  },
});
