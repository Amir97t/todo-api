import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Every e2e suite shares one PostgreSQL database, so files must not run
    // concurrently or row-count and uniqueness assertions in one suite race
    // against writes from another.
    fileParallelism: false,
    // Each suite boots a Nest app and a Prisma client; parallel workers can
    // push module init past vitest's 10s default.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
