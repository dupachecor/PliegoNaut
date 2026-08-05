import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockPrisma = vi.hoisted(() => ({
  contractMatch: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
}))

vi.mock('@pliegonaut/database', () => ({
  prisma: mockPrisma,
  default: mockPrisma,
}))

import contractsRouter from '../routes/contracts'

function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use(contractsRouter)
  return app
}

const TEST_KEY = 'test-admin-key'
const AUTH = { Authorization: `Bearer ${TEST_KEY}` }

describe('Contract Locations & Municipio Filters', () => {
  let app: express.Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
  })

  describe('GET /api/contracts/:companyId/locations', () => {
    it('devuelve departamentos agrupados con municipios', async () => {
      mockPrisma.contractMatch.findMany.mockResolvedValue([
        { department: 'Cundinamarca', region: 'Bogotá' },
        { department: 'Cundinamarca', region: 'Facatativá' },
        { department: 'Boyacá', region: 'Tunja' },
        { department: 'Cundinamarca', region: 'Bogotá' }, // duplicado, debe agruparse
      ])

      const res = await request(app).get('/api/contracts/company-1/locations').set(AUTH)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([
        { department: 'Boyacá', municipios: ['Tunja'] },
        { department: 'Cundinamarca', municipios: ['Bogotá', 'Facatativá'] },
      ])

      expect(mockPrisma.contractMatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', department: { not: '' } },
          select: { department: true, region: true },
          distinct: ['department', 'region'],
        }),
      )
    })

    it('filtra por departamento cuando se pasa query param', async () => {
      mockPrisma.contractMatch.findMany.mockResolvedValue([
        { department: 'Cundinamarca', region: 'Facatativá' },
      ])

      const res = await request(app)
        .get('/api/contracts/company-1/locations?department=Cundina')
        .set(AUTH)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([{ department: 'Cundinamarca', municipios: ['Facatativá'] }])

      // The route replaces department: { not: '' } with { contains: departmentFilter }
      const callArgs = mockPrisma.contractMatch.findMany.mock.calls[0][0]
      expect(callArgs.where).toEqual(
        expect.objectContaining({
          companyId: 'company-1',
          department: { contains: 'Cundina' },
        }),
      )
    })

    it('rechaza sin API key', async () => {
      const res = await request(app).get('/api/contracts/company-1/locations')
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/contracts/:companyId/municipios', () => {
    it('devuelve municipios para un departamento', async () => {
      mockPrisma.contractMatch.findMany.mockResolvedValue([
        { region: 'Facatativá' },
        { region: 'Bogotá' },
      ])

      const res = await request(app)
        .get('/api/contracts/company-1/municipios?department=Cundinamarca')
        .set(AUTH)

      expect(res.status).toBe(200)
      expect(res.body).toEqual(['Bogotá', 'Facatativá'])
    })

    it('rechaza sin API key', async () => {
      const res = await request(app).get('/api/contracts/company-1/municipios')
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/contracts/:companyId con filtro municipio', () => {
    it('aplica filtro de municipio (ciudad_entidad)', async () => {
      mockPrisma.contractMatch.findMany.mockResolvedValue([
        { id: 'c1', region: 'Facatativá', department: 'Cundinamarca' },
      ])
      mockPrisma.contractMatch.count.mockResolvedValue(1)
      mockPrisma.contractMatch.groupBy.mockResolvedValue([])

      const res = await request(app)
        .get('/api/contracts/company-1?municipio=Facatativ%C3%A1')
        .set(AUTH)

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)

      expect(mockPrisma.contractMatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'company-1',
            region: { contains: 'Facatativá' },
          }),
        }),
      )
    })

    it('aplica filtro de search (case-insensitive vía contains)', async () => {
      mockPrisma.contractMatch.findMany.mockResolvedValue([])
      mockPrisma.contractMatch.count.mockResolvedValue(0)
      mockPrisma.contractMatch.groupBy.mockResolvedValue([])

      const res = await request(app)
        .get('/api/contracts/company-1?search=obra')
        .set(AUTH)

      expect(res.status).toBe(200)
      expect(mockPrisma.contractMatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { title: { contains: 'obra' } },
              { entity: { contains: 'obra' } },
              { secopId: { contains: 'obra' } },
            ],
          }),
        }),
      )
    })
  })

  describe('GET /api/contracts/:companyId con filtros de presupuesto', () => {
    it('aplica minBudget y maxBudget en la query where', async () => {
      mockPrisma.contractMatch.findMany.mockResolvedValue([])
      mockPrisma.contractMatch.count.mockResolvedValue(0)
      mockPrisma.contractMatch.groupBy.mockResolvedValue([])

      const res = await request(app)
        .get('/api/contracts/company-1?minBudget=1000&maxBudget=5000')
        .set(AUTH)

      expect(res.status).toBe(200)
      expect(mockPrisma.contractMatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'company-1',
            budget: { gte: 1000, lte: 5000 },
          }),
        }),
      )
    })
  })

  describe('GET /api/contracts/detail/:id', () => {
    it('devuelve el contrato con su empresa', async () => {
      mockPrisma.contractMatch.findUnique.mockResolvedValue({
        id: 'abc',
        company: { id: 'c1', name: 'Empresa S.A.' },
      })

      const res = await request(app).get('/api/contracts/detail/abc').set(AUTH)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe('abc')
      expect(mockPrisma.contractMatch.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ include: { company: true } }),
      )
    })

    it('404 si no existe', async () => {
      mockPrisma.contractMatch.findUnique.mockResolvedValue(null)

      const res = await request(app).get('/api/contracts/detail/notfound').set(AUTH)

      expect(res.status).toBe(404)
    })
  })
})
