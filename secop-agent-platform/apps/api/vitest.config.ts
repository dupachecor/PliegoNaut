import { defineConfig } from 'vitest/config'

const databasePath = '/home/dvn-portatil/Documentos/PliegoNaut/secop-agent-platform/packages/database/index.ts'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    alias: {
      '@pliegonaut/database': {
        find: /.*/,
        replacement: databasePath,
      },
    },
  },
  define: {
    'process.env.API_KEY': JSON.stringify('test-admin-key'),
    'process.env.WORKER_API_KEY': JSON.stringify('test-worker-key'),
    'process.env.DATABASE_URL': JSON.stringify('file:./test.db'),
    'process.env.NODE_ENV': JSON.stringify('test'),
  },
})
