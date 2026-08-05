import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { requireApiKey, requireWorkerKey } from '../middleware/auth'

function createTestApp() {
  const app = express()
  app.get('/api/admin', requireApiKey, (_req, res) => res.json({ ok: true }))
  app.get('/api/worker', requireWorkerKey, (_req, res) => res.json({ ok: true }))
  return app
}

describe('Auth Middleware', () => {
  const app = createTestApp()

  it('rechaza solicitudes sin token', async () => {
    const res = await request(app).get('/api/admin')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Token de autenticación requerido')
  })

  it('rechaza token inválido', async () => {
    const res = await request(app)
      .get('/api/admin')
      .set('Authorization', 'Bearer token-incorrecto')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Token inválido')
  })

  it('rechaza token inválido para worker', async () => {
    const res = await request(app)
      .get('/api/worker')
      .set('Authorization', 'Bearer token-incorrecto')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Token de worker inválido')
  })

  it('autoriza con token admin correcto', async () => {
    const res = await request(app)
      .get('/api/admin')
      .set('Authorization', 'Bearer test-admin-key')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('autoriza con token worker correcto', async () => {
    const res = await request(app)
      .get('/api/worker')
      .set('Authorization', 'Bearer test-worker-key')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('rechaza admin token en ruta worker', async () => {
    const res = await request(app)
      .get('/api/worker')
      .set('Authorization', 'Bearer test-admin-key')
    expect(res.status).toBe(403)
  })
})
