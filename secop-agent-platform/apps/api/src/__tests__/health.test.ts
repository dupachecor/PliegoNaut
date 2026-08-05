import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'

function createTestApp() {
  const app = express()
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() })
  })
  return app
}

describe('Health Endpoint', () => {
  const app = createTestApp()

  it('responde con status ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body).toHaveProperty('uptime')
    expect(res.body).toHaveProperty('timestamp')
  })
})
