import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockPrisma = vi.hoisted(() => ({
  company: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  contractMatch: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@pliegonaut/database', () => ({
  prisma: mockPrisma,
  default: mockPrisma,
}))

import { prisma } from '@pliegonaut/database'
import { requireApiKey, requireWorkerKey } from '../middleware/auth'
import { validate, companySchema, analysisSchema } from '../middleware/validate'

function createTestApp() {
  const app = express()
  app.use(express.json())

  app.get('/api/companies', requireApiKey, async (_req: any, res: any) => {
    const companies = await prisma.company.findMany({ orderBy: { createdAt: 'desc' } })
    res.json(companies)
  })

  app.get('/api/contracts/:companyId', requireApiKey, async (req: any, res: any) => {
    const { companyId } = req.params
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50))
    const skip = (page - 1) * limit

    const [contracts, total] = await Promise.all([
      prisma.contractMatch.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.contractMatch.count({ where: { companyId } }),
    ])
    res.json({ data: contracts, total, page, limit, pages: Math.ceil(total / limit) })
  })

  app.post('/api/companies', requireApiKey, validate(companySchema), async (req: any, res: any) => {
    try {
      const newCompany = await prisma.company.create({ data: req.body })
      res.status(201).json(newCompany)
    } catch (error: any) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'Ya existe una empresa con ese NIT' })
      res.status(500).json({ error: 'Error interno' })
    }
  })

  app.get('/api/worker/tasks', requireWorkerKey, async (_req: any, res: any) => {
    const pendingTasks = await prisma.contractMatch.findMany({
      where: { status: "PENDING_ANALYSIS" },
      include: { company: true },
      take: 5,
      orderBy: { createdAt: 'asc' },
    })

    const ids = pendingTasks.map((t: any) => t.id)
    if (ids.length > 0) {
      await prisma.contractMatch.updateMany({
        where: { id: { in: ids }, status: "PENDING_ANALYSIS" },
        data: { status: "PROCESSING" },
      })
    }
    res.json(pendingTasks)
  })

  app.patch('/api/worker/tasks/:id/analysis', requireWorkerKey, validate(analysisSchema), async (req: any, res: any) => {
    const { id } = req.params
    const { status, viabilityScore, reportLegal, reportFinancial, reportFinal } = req.body

    const existing = await prisma.contractMatch.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Contrato no encontrado' })
    if (existing.status !== "PROCESSING") {
      return res.status(409).json({ error: `El contrato ya fue procesado (estado: ${existing.status})` })
    }

    const updated = await prisma.contractMatch.update({
      where: { id },
      data: { status, viabilityScore, reportLegal, reportFinancial, reportFinal },
    })
    res.json(updated)
  })

  app.post('/api/trigger-scanner', requireApiKey, (_req: any, res: any) => {
    res.json({ message: 'Escaneo SODA iniciado en background' })
  })

  return app
}

describe('Companies API', () => {
  let app: express.Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
  })

  it('GET /api/companies lista empresas', async () => {
    mockPrisma.company.findMany.mockResolvedValue([
      { id: '1', name: 'A', nit: '123', workingCapital: 100, liquidity: 1.5 },
    ])

    const res = await request(app).get('/api/companies').set('Authorization', 'Bearer test-admin-key')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('POST /api/companies crea empresa válida', async () => {
    mockPrisma.company.create.mockResolvedValue({ id: '3', name: 'Nueva SAS', nit: '789' })

    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', 'Bearer test-admin-key')
      .send({ name: 'Nueva SAS', nit: '789', workingCapital: 500000, liquidity: 2.5, unspscCodes: '81111800' })

    expect(res.status).toBe(201)
  })

  it('POST /api/companies rechaza datos inválidos', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', 'Bearer test-admin-key')
      .send({ name: '', nit: '', workingCapital: -1, liquidity: -1, unspscCodes: '' })

    expect(res.status).toBe(400)
  })

  it('POST /api/companies rechaza NIT duplicado', async () => {
    mockPrisma.company.create.mockRejectedValue({ code: 'P2002' })

    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', 'Bearer test-admin-key')
      .send({ name: 'Dupe', nit: '789', workingCapital: 100, liquidity: 1.0, unspscCodes: '81111800' })

    expect(res.status).toBe(409)
  })

  it('GET /api/companies rechaza sin API key', async () => {
    const res = await request(app).get('/api/companies')
    expect(res.status).toBe(401)
  })
})

describe('Contracts API', () => {
  let app: express.Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
  })

  it('GET /api/contracts/:companyId lista contratos paginados', async () => {
    mockPrisma.contractMatch.findMany.mockResolvedValue([
      { id: 'c1', companyId: '1', secopId: 's1', entity: 'Entidad', title: 'Título', budget: 1000, status: 'PENDING_ANALYSIS' },
    ])
    mockPrisma.contractMatch.count.mockResolvedValue(1)

    const res = await request(app).get('/api/contracts/1').set('Authorization', 'Bearer test-admin-key')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
  })
})

describe('Worker Tasks API', () => {
  let app: express.Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
  })

  it('GET /api/worker/tasks devuelve tareas pendientes', async () => {
    mockPrisma.contractMatch.findMany.mockResolvedValue([
      { id: 't1', companyId: '1', secopId: 's1', status: 'PENDING_ANALYSIS', company: { name: 'Empresa' } },
    ])
    mockPrisma.contractMatch.updateMany.mockResolvedValue({ count: 1 })

    const res = await request(app).get('/api/worker/tasks').set('Authorization', 'Bearer test-worker-key')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('PATCH /api/worker/tasks/:id/analysis actualiza resultado', async () => {
    mockPrisma.contractMatch.findUnique.mockResolvedValue({ id: 't1', status: 'PROCESSING' })
    mockPrisma.contractMatch.update.mockResolvedValue({ id: 't1', status: 'VIABLE', viabilityScore: 85 })

    const res = await request(app)
      .patch('/api/worker/tasks/t1/analysis')
      .set('Authorization', 'Bearer test-worker-key')
      .send({ status: 'VIABLE', viabilityScore: 85 })

    expect(res.status).toBe(200)
  })

  it('PATCH rechaza si contrato ya procesado', async () => {
    mockPrisma.contractMatch.findUnique.mockResolvedValue({ id: 't1', status: 'VIABLE' })

    const res = await request(app)
      .patch('/api/worker/tasks/t1/analysis')
      .set('Authorization', 'Bearer test-worker-key')
      .send({ status: 'REJECTED', viabilityScore: 30 })

    expect(res.status).toBe(409)
  })

  it('PATCH 404 si no existe', async () => {
    mockPrisma.contractMatch.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .patch('/api/worker/tasks/notfound/analysis')
      .set('Authorization', 'Bearer test-worker-key')
      .send({ status: 'REJECTED', viabilityScore: 30 })

    expect(res.status).toBe(404)
  })
})

describe('Scanner API', () => {
  let app: express.Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
  })

  it('POST /api/trigger-scanner inicia escaneo', async () => {
    const res = await request(app)
      .post('/api/trigger-scanner')
      .set('Authorization', 'Bearer test-admin-key')

    expect(res.status).toBe(200)
    expect(res.body.message).toContain('Escaneo SODA iniciado')
  })
})
