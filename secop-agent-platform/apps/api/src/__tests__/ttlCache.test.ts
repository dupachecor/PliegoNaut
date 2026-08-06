import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TtlCache } from '../lib/ttlCache'

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('devuelve el valor dentro del TTL', () => {
    const cache = new TtlCache<string, number>(1000)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    expect(cache.size).toBe(1)
  })

  it('expira y elimina la entrada tras el TTL', () => {
    const cache = new TtlCache<string, number>(1000)
    cache.set('a', 1)
    vi.advanceTimersByTime(1001)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('evicta la entrada más antigua cuando supera maxSize', () => {
    const cache = new TtlCache<string, number>(60000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('clear vacía la caché', () => {
    const cache = new TtlCache<string, number>(60000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })
})
