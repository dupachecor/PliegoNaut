import { beforeAll, afterAll } from 'vitest'

beforeAll(() => {
  process.env.API_KEY = 'test-admin-key'
  process.env.WORKER_API_KEY = 'test-worker-key'
  process.env.DATABASE_URL = 'file:./test.db'
  process.env.NODE_ENV = 'test'
})

afterAll(() => {
  // cleanup if needed
})
