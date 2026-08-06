import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Api = typeof import('@/lib/api')
let api: Api

beforeEach(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'http://test.local'
  process.env.NEXT_PUBLIC_API_KEY = 'test-key'
  api = await import('@/lib/api')
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_API_URL
  delete process.env.NEXT_PUBLIC_API_KEY
  vi.restoreAllMocks()
})

describe('api documents (Fase 2.5)', () => {
  it('fetchDocuments llama al endpoint correcto con auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ secopId: 'CO1.NTC.1', documents: [{ id: 'doc-1', fileName: 'a.pdf' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await api.fetchDocuments('CO1.NTC.1')

    expect(res.documents).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/contracts/CO1.NTC.1/documents',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    )
  })

  it('openDocument descarga el PDF con auth y abre un blob URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['%PDF-1.7'], { type: 'application/pdf' })),
    })
    vi.stubGlobal('fetch', fetchMock)
    const openSpy = vi.fn().mockReturnValue({}) // window.open devuelve una ventana (popup OK)
    vi.stubGlobal('window', { open: openSpy })

    await api.openDocument('CO1.NTC.1', 'doc-1', 'pliego.pdf')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.local/api/contracts/CO1.NTC.1/documents/doc-1/download',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    )
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('blob:'), '_blank')
  })
})
