// ===== Fallback automático VORTAL (Fase 2.6) =====
// Circuit breaker: si el scraper falla N veces consecutivas (captcha no resuelto,
// ban del WAF, 5xx), se desactiva durante 1 hora y la ingestión SODA (Fase 1)
// sigue proveyendo datos con lag de 24h. Tras 1h se reintenta (auto-recuperación).

export const VORTAL_MAX_FAILURES = parseInt(process.env.VORTAL_MAX_FAILURES || '3', 10);
export const VORTAL_FALLBACK_DURATION_MS = parseInt(
  process.env.VORTAL_FALLBACK_DURATION_MS || `${60 * 60 * 1000}`,
  10,
);

export class VortalFallback {
  private failures = 0;
  private fallbackUntil: number | null = null;

  /** Registra un fallo. Devuelve true si se acaba de ACTIVAR el fallback. */
  recordFailure(now: number = Date.now()): boolean {
    this.failures += 1;
    if (this.failures >= VORTAL_MAX_FAILURES) {
      this.fallbackUntil = now + VORTAL_FALLBACK_DURATION_MS;
      this.failures = 0; // reinicia el ciclo: si tras recuperarse vuelve a fallar, re-triggera
      return true;
    }
    return false;
  }

  /** Registra un éxito: limpia fallos y fallback. */
  recordSuccess(now: number = Date.now()): void {
    this.failures = 0;
    this.fallbackUntil = null;
  }

  inFallback(now: number = Date.now()): boolean {
    return this.fallbackUntil !== null && now < this.fallbackUntil;
  }

  remainingMs(now: number = Date.now()): number {
    if (this.fallbackUntil === null) return 0;
    const rem = this.fallbackUntil - now;
    return rem > 0 ? rem : 0;
  }

  get failuresCount(): number {
    return this.failures;
  }
}

// Singleton compartido por el servicio y el cron.
export const vortalFallback = new VortalFallback();
