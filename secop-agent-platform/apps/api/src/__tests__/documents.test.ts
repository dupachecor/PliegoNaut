import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'

const mockPrisma = vi.hoisted(() => ({
  contractMatch: {
    findFirst: vi.fn(),
  },
  processDocument: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}))

vi.mock('@pliegonaut/database', () => ({
  prisma: mockPrisma,
  default: mockPrisma,
}))

import documentsRouter from '../routes/documents'

function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use(documentsRouter)
  return app
}

const TEST_KEY = 'test-admin-key'
const AUTH = { Authorization: `Bearer ${TEST_KEY}` }

describe('Documents routes', () => {
  let app: express.Express
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pliego-docs-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const contract = { id: 'contract-1', secopId: 'CO1.NTC.1', vortalNoticeUid: 'CO1.NTC.1' }

  describe('GET /api/contracts/:secopId/documents', () => {
    it('devuelve la lista de documentos de un proceso', async () => {
      mockPrisma.contractMatch.findFirst.mockResolvedValue(contract)
      mockPrisma.processDocument.findMany.mockResolvedValue([
        { id: 'doc-1', documentType: 'pliego', fileName: 'Pliego de Condiciones.pdf', sizeBytes: 100, checksum: 'abc', fetchedAt: '2026-08-06', downloadUrl: 'https://x' },
      ])

      const res = await request(app).get('/api/contracts/CO1.NTC.1/documents').set(AUTH)

      expect(res.status).toBe(200)
      expect(res.body.secopId).toBe('CO1.NTC.1')
      expect(res.body.documents).toHaveLength(1)
      expect(res.body.documents[0].documentType).toBe('pliego')
      expect(mockPrisma.contractMatch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ secopId: 'CO1.NTC.1' }, { vortalNoticeUid: 'CO1.NTC.1' }] } }),
      )
    })

    it('404 si el proceso no existe', async () => {
      mockPrisma.contractMatch.findFirst.mockResolvedValue(null)
      const res = await request(app).get('/api/contracts/NO-EXISTE/documents').set(AUTH)
      expect(res.status).toBe(404)
    })

    it('401 sin API Key', async () => {
      const res = await request(app).get('/api/contracts/CO1.NTC.1/documents')
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/contracts/:secopId/documents/:docId/download', () => {
    it('streaming del PDF desde disco', async () => {
      const pdfPath = path.join(tmpDir, 'pliego.pdf')
      fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.7 test'))
      mockPrisma.contractMatch.findFirst.mockResolvedValue(contract)
      mockPrisma.processDocument.findFirst.mockResolvedValue({
        id: 'doc-1',
        contractId: 'contract-1',
        fileName: 'Pliego de Condiciones.pdf',
        contentType: 'application/pdf',
        sizeBytes: 15,
        storagePath: pdfPath,
      })

      const res = await request(app).get('/api/contracts/CO1.NTC.1/documents/doc-1/download').set(AUTH)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/pdf')
      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.body.toString('latin1')).toBe('%PDF-1.7 test')
    })

    it('404 si el documento no existe', async () => {
      mockPrisma.contractMatch.findFirst.mockResolvedValue(contract)
      mockPrisma.processDocument.findFirst.mockResolvedValue(null)
      const res = await request(app).get('/api/contracts/CO1.NTC.1/documents/doc-9/download').set(AUTH)
      expect(res.status).toBe(404)
    })

    it('404 si el archivo no está en disco', async () => {
      mockPrisma.contractMatch.findFirst.mockResolvedValue(contract)
      mockPrisma.processDocument.findFirst.mockResolvedValue({
        id: 'doc-1',
        contractId: 'contract-1',
        fileName: 'x.pdf',
        storagePath: path.join(tmpDir, 'no-existe.pdf'),
      })
      const res = await request(app).get('/api/contracts/CO1.NTC.1/documents/doc-1/download').set(AUTH)
      expect(res.status).toBe(404)
    })
  })
})
