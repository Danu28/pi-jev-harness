/** LRU + TTL cache for Jev responses — saves $$ on repeated states */
export class JevCache {
  private m = new Map<string, { v: unknown; exp: number }>();
  constructor(private ttlMs: number, private max = 200) {}
  private key(s: string) { return s.slice(0, 4000); }
  get<T>(k: string): T | undefined {
    const e = this.m.get(this.key(k));
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.m.delete(this.key(k)); return undefined; }
    return e.v as T;
  }
  set(k: string, v: unknown) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value!);
    this.m.set(this.key(k), { v, exp: Date.now() + this.ttlMs });
  }
  clear() { this.m.clear(); }
}
