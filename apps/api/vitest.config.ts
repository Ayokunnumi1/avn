import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    globalSetup: ['./test/global-setup.ts'],
    env: { APP_ENV: 'test', NODE_ENV: 'test', JOBS_MODE: 'inline', LOG_LEVEL: 'silent' },
  },
});
