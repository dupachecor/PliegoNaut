import { describe, it, expect, vi, afterEach } from 'vitest';
import { VortalFallback, VORTAL_MAX_FAILURES, VORTAL_FALLBACK_DURATION_MS } from '../lib/vortalFallback';

afterEach(() => {
  vi.useRealTimers();
});

describe('VortalFallback', () => {
  it('activa el fallback tras N fallos consecutivos', () => {
    const fb = new VortalFallback();
    for (let i = 1; i < VORTAL_MAX_FAILURES; i++) {
      expect(fb.recordFailure(1000)).toBe(false);
      expect(fb.inFallback(1000)).toBe(false);
    }
    // el enésimo fallo activa el fallback
    expect(fb.recordFailure(1000)).toBe(true);
    expect(fb.inFallback(1000)).toBe(true);
  });

  it('un éxito limpia fallos y fallback', () => {
    const fb = new VortalFallback();
    fb.recordFailure(1000);
    fb.recordFailure(1000);
    fb.recordFailure(1000); // activa
    expect(fb.inFallback(1000)).toBe(true);

    fb.recordSuccess(2000);
    expect(fb.inFallback(2000)).toBe(false);
    expect(fb.failuresCount).toBe(0);
  });

  it('auto-recuperación: el fallback expira tras la duración', () => {
    const fb = new VortalFallback();
    fb.recordFailure(1000);
    fb.recordFailure(1000);
    fb.recordFailure(1000);
    expect(fb.inFallback(1000)).toBe(true);

    // justo antes de expirar sigue activo
    expect(fb.inFallback(1000 + VORTAL_FALLBACK_DURATION_MS - 1)).toBe(true);
    // tras la duración se recupera
    expect(fb.inFallback(1000 + VORTAL_FALLBACK_DURATION_MS + 1)).toBe(false);
    expect(fb.remainingMs(1000 + VORTAL_FALLBACK_DURATION_MS + 1)).toBe(0);
  });

  it('el ciclo se reinicia al activarse (re-trigger en la siguiente racha)', () => {
    const fb = new VortalFallback();
    fb.recordFailure(1000);
    fb.recordFailure(1000);
    fb.recordFailure(1000); // activa, resetea contador
    expect(fb.failuresCount).toBe(0);
    // primer fallo tras expirar no re-activa
    expect(fb.recordFailure(2000 + VORTAL_FALLBACK_DURATION_MS)).toBe(false);
  });
});
