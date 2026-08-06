import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIngest = vi.hoisted(() => ({ runIncrementalSodaIngest: vi.fn() }))
const mockWs = vi.hoisted(() => ({ broadcastNewTask: vi.fn() }))
const mockAlert = vi.hoisted(() => ({ sendAlert: vi.fn() }))

vi.mock('../services/sodaIngestService', () => mockIngest)
vi.mock('../lib/wsServer', () => mockWs)
vi.mock('../lib/alert', () => mockAlert)

describe('runSodaIngestOnce (alertas y broadcast)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LOG_LEVEL = 'silent'
  })

  // Re-importa el módulo para reiniciar el contador de fallos consecutivos por test
  async function importFresh() {
    vi.resetModules()
    return await import('../cron/sodaIngest')
  }

  it('no dispara alerta antes de 3 fallos consecutivos', async () => {
    mockIngest.runIncrementalSodaIngest.mockRejectedValue(new Error('fail'))
    const mod = await importFresh()

    await expect(mod.runSodaIngestOnce()).rejects.toThrow('fail')
    await expect(mod.runSodaIngestOnce()).rejects.toThrow('fail')

    expect(mockAlert.sendAlert).not.toHaveBeenCalled()
  })

  it('dispara alerta webhook al tercer fallo consecutivo', async () => {
    mockIngest.runIncrementalSodaIngest.mockRejectedValue(new Error('rate limited'))
    const mod = await importFresh()

    await expect(mod.runSodaIngestOnce()).rejects.toThrow()
    await expect(mod.runSodaIngestOnce()).rejects.toThrow()
    await expect(mod.runSodaIngestOnce()).rejects.toThrow()

    expect(mockAlert.sendAlert).toHaveBeenCalledTimes(1)
    expect(mockAlert.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('3'),
      expect.objectContaining({ error: 'rate limited' }),
    )
  })

  it('resetea el contador tras un éxito', async () => {
    mockIngest.runIncrementalSodaIngest
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ records: 1, nuevos: 0, watermark: new Date() })
      .mockRejectedValue(new Error('fail'))
    const mod = await importFresh()

    await expect(mod.runSodaIngestOnce()).rejects.toThrow() // fallo 1
    await expect(mod.runSodaIngestOnce()).rejects.toThrow() // fallo 2
    await mod.runSodaIngestOnce() // éxito -> resetea contador
    await expect(mod.runSodaIngestOnce()).rejects.toThrow() // fallo 1
    await expect(mod.runSodaIngestOnce()).rejects.toThrow() // fallo 2

    expect(mockAlert.sendAlert).not.toHaveBeenCalled()
  })

  it('hace broadcast cuando hay nuevos matches', async () => {
    mockIngest.runIncrementalSodaIngest.mockResolvedValue({ records: 5, nuevos: 3, watermark: new Date() })
    const mod = await importFresh()

    await mod.runSodaIngestOnce()

    expect(mockWs.broadcastNewTask).toHaveBeenCalledTimes(1)
  })

  it('no hace broadcast si no hay nuevos', async () => {
    mockIngest.runIncrementalSodaIngest.mockResolvedValue({ records: 1, nuevos: 0, watermark: new Date() })
    const mod = await importFresh()

    await mod.runSodaIngestOnce()

    expect(mockWs.broadcastNewTask).not.toHaveBeenCalled()
  })
})
