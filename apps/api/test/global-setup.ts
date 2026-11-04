import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Applies migrations to the dedicated test database before any test runs. */
export async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://avn:avn@localhost:5432/avn_test?schema=public';
  execSync('npx prisma migrate deploy', { cwd: resolve(__dirname, '../../../packages/database'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
