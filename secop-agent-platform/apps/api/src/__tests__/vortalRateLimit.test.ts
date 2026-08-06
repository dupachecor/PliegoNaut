import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomDelay, pickUserAgent, withRetry } from '../lib/vortalRateLimit';
import { VORTAL } from '../config/vortal';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('randomDelay', () => {
  it('devuelve un valor dentro de [minDelayMs, maxDelayMs]', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const d = randomDelay();
    expect(d).toBeGreaterThanOrEqual(VORTAL.rateLimit.minDelayMs);
    expect(d).toBeLessThanOrEqual(VORTAL.rateLimit.maxDelayMs);
    expect(d).toBe((VORTAL.rateLimit.minDelayMs + VORTAL.rateLimit.maxDelayMs) / 2);
  });
});

describe('pickUserAgent', () => {
  it('rota por el pool de User-Agents', () => {
    const first = pickUserAgent();
    const second = pickUserAgent();
    const pool = VORTAL.rateLimit.userAgents;
    expect(pool.length).toBeGreaterThanOrEqual(2);
    expect(first).toBe(pool[0]);
    expect(second).toBe(pool[1]);
  });
});

describe('withRetry', () => {
  it('reintenta con backoff y eventualmente tiene éxito', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('boom');
        return 'ok';
      },
      { retries: 3, baseDelayMs: 10, maxDelayMs: 100 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('lanza si se agotan los reintentos', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('boom');
        },
        { retries: 2, baseDelayMs: 10, maxDelayMs: 100 },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toBe(3);
  });

  it('respeta shouldRetry (no reintenta errores que no lo ameritan)', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('fatal');
        },
        { retries: 3, baseDelayMs: 10, shouldRetry: (e) => (e as Error).message === 'transient' },
      ),
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });
});
