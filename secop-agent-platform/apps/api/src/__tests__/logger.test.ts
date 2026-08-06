import { describe, it, expect } from 'vitest'
import { createLogger } from '../lib/logger'

describe('createLogger', () => {
  it('retorna una instancia de logger funcional', () => {
    const log = createLogger('test-logger')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    // En modo test no usa transports de archivo (evita workers en Vitest)
    log.info('smoke')
    log.error('smoke-error')
  })
})
