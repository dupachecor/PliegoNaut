import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      API_KEY: 'test-admin-key',
      WORKER_API_KEY: 'test-worker-key',
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./test.db',
    },
    setupFiles: ['./src/__tests__/setup.ts'],
  },
})
