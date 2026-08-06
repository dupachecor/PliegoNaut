import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAxios = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('axios', () => ({ default: mockAxios }))

import { sendAlert } from '../lib/alert'

describe('sendAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ALERT_WEBHOOK_URL
  })

  it('no hace nada si ALERT_WEBHOOK_URL no está configurado', async () => {
    const ok = await sendAlert('mensaje')
    expect(ok).toBe(false)
    expect(mockAxios.post).not.toHaveBeenCalled()
  })

  it('POSTea al webhook cuando está configurado', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/abc'
    mockAxios.post.mockResolvedValue({ status: 200 })

    const ok = await sendAlert('mensaje de prueba', { error: 'rate limited' })

    expect(ok).toBe(true)
    expect(mockAxios.post).toHaveBeenCalledWith(
      'https://hooks.example.com/abc',
      expect.objectContaining({
        text: 'mensaje de prueba',
        details: { error: 'rate limited' },
      }),
      expect.objectContaining({ timeout: 10000 }),
    )
  })

  it('no lanza si el webhook falla', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/abc'
    mockAxios.post.mockRejectedValue(new Error('network down'))

    const ok = await sendAlert('mensaje')

    expect(ok).toBe(false)
  })
})
