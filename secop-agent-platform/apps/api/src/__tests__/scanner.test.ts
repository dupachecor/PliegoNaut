import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockClient = vi.hoisted(() => ({ get: vi.fn(), defaults: {} }))
const mockAxios = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(() => mockClient),
}))

vi.mock('axios', () => ({
  default: mockAxios,
}))

vi.mock('axios-retry', () => ({
  default: vi.fn(),
}))

const mockPrisma = vi.hoisted(() => ({
  contractMatch: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
}))

vi.mock('@pliegonaut/database', () => ({
  prisma: mockPrisma,
  default: mockPrisma,
}))

import scannerRouter, { clearSearchCache } from '../routes/scanner'

function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use(scannerRouter)
  return app
}

const TEST_KEY = 'test-admin-key'
const AUTH = { Authorization: `Bearer ${TEST_KEY}` }

describe('Manual Search API', () => {
  let app: express.Express

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SEARCH_USE_DB
    clearSearchCache()
    app = createTestApp()
  })

  it('POST /api/search con filtro municipio usa dual-query $q (full-text)', async () => {
    const mockData = [
      {
        id_del_proceso: 'CO1.TEST.1',
        entidad: 'Secretaría',
        descripci_n_del_procedimiento: 'Obra en Facatativá',
        precio_base: '5000000',
        departamento_entidad: 'Cundinamarca',
        ciudad_entidad: 'Facatativá',
        estado_del_procedimiento: 'Convocado',
        fase: 'Fase 1',
      },
    ]

    mockClient.get.mockResolvedValue({ data: mockData })

    const res = await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({
        department: 'Cundinamarca',
        municipio: 'Facatativá',
      })

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.results[0].municipio).toBe('Facatativá')
    expect(res.body.results[0].department).toBe('Cundinamarca')

    // The route uses dual-query: first call is $q full-text over SECOP II
    const axiosCall = mockClient.get.mock.calls[0]
    const url = new URL(axiosCall[0])
    expect(url.searchParams.get('$q')).toBe('Facatativá')
    expect(url.searchParams.get('$limit')).toBe('1500')
  })

  it('POST /api/search con searchText lo pasa como filtro de descripción', async () => {
    mockClient.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ searchText: 'obra pública' })

    const axiosCall = mockClient.get.mock.calls[0]
    const url = new URL(axiosCall[0])
    const sodaWhere = url.searchParams.get('$where')
    expect(sodaWhere).toContain("upper(descripci_n_del_procedimiento) LIKE '%OBRA PUBLICA%'")
  })

  it('POST /api/search con minBudget y maxBudget', async () => {
    mockClient.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ minBudget: 1000, maxBudget: 5000 })

    const axiosCall = mockClient.get.mock.calls[0]
    const url = new URL(axiosCall[0])
    const sodaWhere = url.searchParams.get('$where')
    expect(sodaWhere).toContain('precio_base >= 1000')
    expect(sodaWhere).toContain('precio_base <= 5000')
  })

  it('POST /api/search con unspscCodes', async () => {
    mockClient.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ unspscCodes: ['81111800', '81111700'] })

    const axiosCall = mockClient.get.mock.calls[0]
    const url = new URL(axiosCall[0])
    const sodaWhere = url.searchParams.get('$where')
    expect(sodaWhere).toContain("codigo_principal_de_categoria LIKE '%81111800%'")
    expect(sodaWhere).toContain("codigo_principal_de_categoria LIKE '%81111700%'")
  })

  it('POST /api/search con status personalizado', async () => {
    mockClient.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ status: ['Abierto', 'Publicado'] })

    const axiosCall = mockClient.get.mock.calls[0]
    const url = new URL(axiosCall[0])
    const sodaWhere = url.searchParams.get('$where')
    expect(sodaWhere).toContain("estado_del_procedimiento IN ('Abierto', 'Publicado')")
  })

  it('POST /api/search rechaza sin API key', async () => {
    const res = await request(app)
      .post('/api/search')
      .send({ searchText: 'test' })

    expect(res.status).toBe(401)
  })

  it('POST /api/search devuelve error 500 si SODA falla', async () => {
    mockClient.get.mockRejectedValue(new Error('SODA timeout'))

    const res = await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ searchText: 'test' })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Error buscando en SECOP')
  })

  it('POST /api/search envía X-App-Token cuando SOCRATA_APP_TOKEN está configurado', async () => {
    process.env.SOCRATA_APP_TOKEN = 'test-soda-token'
    mockClient.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ searchText: 'token-test' })

    expect(mockAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-App-Token': 'test-soda-token' }),
      }),
    )
    delete process.env.SOCRATA_APP_TOKEN
  })

  it('sirve desde caché la segunda búsqueda con el mismo body', async () => {
    const record = {
      id_del_proceso: 'CO1.CACHE.1',
      entidad: 'Entidad',
      descripci_n_del_procedimiento: 'cache-test Objeto de prueba',
      precio_base: '1000000',
      estado_del_procedimiento: 'Convocado',
    }
    mockClient.get.mockResolvedValue({ data: [record] })
    const body = { searchText: 'cache-test' }

    const first = await request(app).post('/api/search').set(AUTH).send(body)
    expect(first.status).toBe(200)
    expect(mockClient.get).toHaveBeenCalledTimes(1)
    expect(first.body.total).toBe(1)

    mockClient.get.mockClear()

    const second = await request(app).post('/api/search').set(AUTH).send(body)
    expect(second.status).toBe(200)
    expect(second.body.total).toBe(1)
    expect(mockClient.get).not.toHaveBeenCalled()
  })

  it('no sirve desde caché si el body cambia', async () => {
    mockClient.get.mockResolvedValue({ data: [] })

    await request(app).post('/api/search').set(AUTH).send({ searchText: 'uno' })
    expect(mockClient.get).toHaveBeenCalledTimes(1)

    await request(app).post('/api/search').set(AUTH).send({ searchText: 'dos' })
    expect(mockClient.get).toHaveBeenCalledTimes(2)
  })

  it('rechaza body inválido con 400 (validate searchSchema)', async () => {
    const res = await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ minBudget: 'no-es-un-numero' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Datos inválidos')
  })

  it('lee resultados desde la DB enriquecida cuando SEARCH_USE_DB=true', async () => {
    process.env.SEARCH_USE_DB = 'true'
    mockPrisma.contractMatch.findMany.mockResolvedValue([
      {
        id: '1',
        secopId: 'CO1.DB.1',
        entity: 'Entidad',
        title: 'Obra en Facatativá',
        budget: 1000000,
        urlPliego: 'http://secop.example',
        phase: 'Presentación de oferta',
        contractStatus: 'Convocado',
        status: 'PENDING_ANALYSIS',
        department: 'Cundinamarca',
        region: 'Facatativá',
        publishedAt: new Date('2026-08-05T00:00:00.000Z'),
        closingDate: new Date('2026-08-30T00:00:00.000Z'),
        awarded: false,
        source: 'secop_ii',
        categoryCode: '81111800',
        estimatedDuration: '30 días',
      },
    ])

    const res = await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ department: 'Cundinamarca', municipio: 'Facatativá' })

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.results[0].secopId).toBe('CO1.DB.1')
    expect(res.body.results[0].source).toBe('secop_ii')
    expect(res.body.results[0].isExpired).toBe(false)
    expect(mockPrisma.contractMatch.findMany).toHaveBeenCalled()
    expect(mockClient.get).not.toHaveBeenCalled()
  })

  it('cae a SODA cuando la DB enriquecida no tiene resultados', async () => {
    process.env.SEARCH_USE_DB = 'true'
    mockPrisma.contractMatch.findMany.mockResolvedValue([])
    mockClient.get.mockResolvedValue({ data: [] })

    const res = await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ searchText: 'x' })

    expect(res.status).toBe(200)
    expect(mockPrisma.contractMatch.findMany).toHaveBeenCalled()
    expect(mockClient.get).toHaveBeenCalled()
  })

  it('cae a SODA si la búsqueda en DB lanza error', async () => {
    process.env.SEARCH_USE_DB = 'true'
    mockPrisma.contractMatch.findMany.mockRejectedValue(new Error('db down'))
    mockClient.get.mockResolvedValue({ data: [] })

    const res = await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ searchText: 'x' })

    expect(res.status).toBe(200)
    expect(mockClient.get).toHaveBeenCalled()
  })
})
