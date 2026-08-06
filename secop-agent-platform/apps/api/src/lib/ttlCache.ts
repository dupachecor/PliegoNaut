// Caché TTL en memoria (sin DB). Expiración lazy: se valida al leer.
// Si supera maxSize, evicta la entrada más antigua (orden de inserción del Map).
export class TtlCache<K, V> {
  private map = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize = 500,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
