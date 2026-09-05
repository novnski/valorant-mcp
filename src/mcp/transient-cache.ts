/** Bounded, demand-driven TTL/LRU memory only; no timers or durable state. */
export class TransientCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number; bytes: number }>();
  private bytes = 0;
  constructor(
    private readonly maxEntries = 64,
    private readonly maxBytes = 8 * 1024 * 1024,
    private readonly clock: () => number = Date.now,
  ) {}
  get(key: string): T | null {
    this.sweep();
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, ttlMs: number): void {
    this.sweep();
    this.delete(key);
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? "null");
    if (bytes > this.maxBytes || ttlMs <= 0) return;
    this.entries.set(key, { value, expiresAt: this.clock() + ttlMs, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)
      this.delete(this.entries.keys().next().value!);
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
  keys(): string[] {
    this.sweep();
    return [...this.entries.keys()];
  }
  get size(): number {
    this.sweep();
    return this.entries.size;
  }
  get byteSize(): number {
    this.sweep();
    return this.bytes;
  }
  private sweep(): void {
    const now = this.clock();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.delete(key);
  }
}
