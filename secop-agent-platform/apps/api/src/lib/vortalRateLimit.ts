// ===== Robustez y rate limiting auto-impuesto VORTAL (Fase 2.7) =====
// Delay aleatorio entre requests, User-Agent rotativo y reintentos con backoff
// exponencial, para no ser baneados por el WAF de community.secop.gov.co.

import { VORTAL } from '../config/vortal';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Delay aleatorio en [minDelayMs, maxDelayMs] (default 30-60s).
export function randomDelay(): number {
  const min = VORTAL.rateLimit.minDelayMs;
  const max = VORTAL.rateLimit.maxDelayMs;
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min));
}

// Rotación de User-Agent entre requests.
let uaIdx = 0;
export function pickUserAgent(): string {
  const pool = VORTAL.rateLimit.userAgents;
  if (pool.length === 0) return 'Mozilla/5.0 (X11; Linux x86_64) Chrome/125.0.0.0 Safari/537.36';
  const ua = pool[uaIdx % pool.length];
  uaIdx += 1;
  return ua;
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: any) => boolean;
}

// Reintenta con backoff exponencial (2s, 4s, 8s, … acotado a maxDelayMs).
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 2000;
  const maxDelayMs = opts.maxDelayMs ?? 15000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || (opts.shouldRetry && !opts.shouldRetry(err))) throw err;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 500), maxDelayMs);
      await sleep(delay);
    }
  }
}
