import { describe, it, expect } from 'vitest'

describe('Dashboard', () => {
  it('el módulo se importa correctamente', async () => {
    const mod = await import('../page')
    expect(mod.default).toBeDefined()
  })
})
