import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockAxios = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(() => ({ get: vi.fn(), defaults: {} })),
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

import scannerRouter from '../routes/scanner'

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
    app = createTestApp()
  })

  it('POST /api/search con filtro municipio incluye ciudad_entidad en el query SODA', async () => {
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

    mockAxios.get.mockResolvedValue({ data: mockData })

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

    // Verify axios called with municipio filter in SODA query
    const axiosCall = mockAxios.get.mock.calls[0]
    const sodaWhere = axiosCall[1]?.params?.$where
    expect(sodaWhere).toContain("ciudad_entidad LIKE '%Facatativá%'")
    expect(sodaWhere).toContain("departamento_entidad LIKE '%Cundinamarca%'")
  })

  it('POST /api/search con searchText lo pasa como filtro de descripción', async () => {
    mockAxios.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ searchText: 'obra pública' })

    const axiosCall = mockAxios.get.mock.calls[0]
    const sodaWhere = axiosCall[1]?.params?.$where
    expect(sodaWhere).toContain("descripci_n_del_procedimiento LIKE '%obra pública%'")
  })

  it('POST /api/search con minBudget y maxBudget', async () => {
    mockAxios.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ minBudget: 1000, maxBudget: 5000 })

    const axiosCall = mockAxios.get.mock.calls[0]
    const sodaWhere = axiosCall[1]?.params?.$where
    expect(sodaWhere).toContain('precio_base >= 1000')
    expect(sodaWhere).toContain('precio_base <= 5000')
  })

  it('POST /api/search con unspscCodes', async () => {
    mockAxios.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ unspscCodes: ['81111800', '81111700'] })

    const axiosCall = mockAxios.get.mock.calls[0]
    const sodaWhere = axiosCall[1]?.params?.$where
    expect(sodaWhere).toContain("codigo_principal_de_categoria LIKE '%81111800%'")
    expect(sodaWhere).toContain("codigo_principal_de_categoria LIKE '%81111700%'")
  })

  it('POST /api/search con status personalizado', async () => {
    mockAxios.get.mockResolvedValue({ data: [] })

    await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ status: ['Abierto', 'Publicado'] })

    const axiosCall = mockAxios.get.mock.calls[0]
    const sodaWhere = axiosCall[1]?.params?.$where
    expect(sodaWhere).toContain("estado_del_procedimiento IN ('Abierto', 'Publicado')")
  })

  it('POST /api/search rechaza sin API key', async () => {
    const res = await request(app)
      .post('/api/search')
      .send({ searchText: 'test' })

    expect(res.status).toBe(401)
  })

  it('POST /api/search devuelve error 500 si SODA falla', async () => {
    mockAxios.get.mockRejectedValue(new Error('SODA timeout'))

    const res = await request(app)
      .post('/api/search')
      .set(AUTH)
      .send({ searchText: 'test' })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Error buscando en SECOP')
  })
})
